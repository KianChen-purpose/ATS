import { and, eq, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { redact } from "@/server/integrations/m365/record";

/**
 * The queue port (ARCHITECTURE.md D5). Requests enqueue; the worker process runs the jobs. This is
 * the Postgres-backed adapter (claims with FOR UPDATE SKIP LOCKED, retries with exponential
 * backoff, dead-letters after maxAttempts); an Azure Service Bus adapter can sit behind the same
 * interface. Payloads carry ids only, never personal data (§4.6).
 */
export type JobPayload = Record<string, string | number | boolean | null>;
export type EnqueueOptions = { runAt?: Date; dedupeKey?: string; maxAttempts?: number };
export type ClaimedJob = { id: string; type: string; payload: JobPayload; attempts: number; maxAttempts: number };
export type JobHandler = (job: ClaimedJob) => Promise<void>;

const STALE_MS = 10 * 60_000;
const BASE_BACKOFF_MS = 30_000;

export interface Queue {
  enqueue(type: string, payload?: JobPayload, opts?: EnqueueOptions): Promise<{ id: string | null }>;
  /** Runs up to `limit` ready jobs with the matching handlers. Returns what happened. */
  work(handlers: Record<string, JobHandler>, limit?: number): Promise<{ done: number; retried: number; dead: number }>;
}

export const postgresQueue: Queue = {
  async enqueue(type, payload = {}, opts = {}) {
    const [row] = await db
      .insert(schema.jobQueue)
      .values({ type, payload, runAt: opts.runAt ?? new Date(), dedupeKey: opts.dedupeKey, maxAttempts: opts.maxAttempts ?? 5 })
      .onConflictDoNothing({ target: schema.jobQueue.dedupeKey })
      .returning({ id: schema.jobQueue.id });
    return { id: row?.id ?? null };
  },

  async work(handlers, limit = 20) {
    // Jobs left "running" by a crashed worker go back in the queue.
    await db
      .update(schema.jobQueue)
      .set({ status: "queued", lockedAt: null })
      .where(and(eq(schema.jobQueue.status, "running"), lt(schema.jobQueue.lockedAt, new Date(Date.now() - STALE_MS))));
    const types = Object.keys(handlers);
    if (!types.length) return { done: 0, retried: 0, dead: 0 };
    const claimed = (
      await db.execute(sql`
        UPDATE job_queue SET status = 'running', locked_at = now(), attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM job_queue
          WHERE status = 'queued' AND run_at <= now() AND type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
          ORDER BY run_at LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
        RETURNING id, type, payload, attempts, max_attempts AS "maxAttempts"`)
    ).rows as ClaimedJob[];
    const result = { done: 0, retried: 0, dead: 0 };
    for (const job of claimed) {
      try {
        await handlers[job.type](job);
        await db.update(schema.jobQueue).set({ status: "done", finishedAt: new Date(), lastError: null }).where(eq(schema.jobQueue.id, job.id));
        result.done++;
      } catch (e) {
        const lastError = redact(String((e as Error)?.message ?? e));
        if (job.attempts >= job.maxAttempts) {
          await db.update(schema.jobQueue).set({ status: "dead", finishedAt: new Date(), lastError }).where(eq(schema.jobQueue.id, job.id));
          result.dead++;
        } else {
          const runAt = new Date(Date.now() + BASE_BACKOFF_MS * 2 ** (job.attempts - 1));
          await db.update(schema.jobQueue).set({ status: "queued", lockedAt: null, runAt, lastError }).where(eq(schema.jobQueue.id, job.id));
          result.retried++;
        }
      }
    }
    return result;
  },
};

export function queue(): Queue {
  return postgresQueue;
}

/** Keeps the table small: finished jobs older than `days` are removed (dead ones stay for review). */
export async function pruneFinishedJobs(days = 7) {
  await db.delete(schema.jobQueue).where(and(eq(schema.jobQueue.status, "done"), lt(schema.jobQueue.finishedAt, new Date(Date.now() - days * 86_400_000))));
}

/** Counts for Settings → Integrations. */
export async function queueStats() {
  const rows = (await db.execute(sql`SELECT status::text AS status, count(*)::int AS n FROM job_queue GROUP BY 1`)).rows as { status: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}
