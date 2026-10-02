/**
 * PATS background worker (ARCHITECTURE.md D5). A separate process that reuses the service layer:
 * the job queue (mail sync, Graph subscription upkeep) and scheduled report delivery. Run with
 * `npm run worker` (add `-- --once` for a single pass, e.g. from cron).
 *
 * Safe to run more than one: queued jobs and due schedules are claimed with FOR UPDATE SKIP LOCKED.
 */
import { systemActor } from "@/server/policy/actor";
import { pruneFinishedJobs, queue } from "@/server/integrations/queue";
import { mailSyncHandlers, schedulePeriodicMailJobs } from "@/server/services/mail-sync";
import { runDueSchedules } from "@/server/services/reports/schedules";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 60_000);
const actor = systemActor("worker");
const handlers = { ...mailSyncHandlers };
let stopping = false;
let lastPrune = 0;

async function tick() {
  await schedulePeriodicMailJobs();
  const jobs = await queue().work(handlers);
  if (jobs.done || jobs.retried || jobs.dead) console.log(`[worker] jobs: ${jobs.done} done, ${jobs.retried} retrying, ${jobs.dead} dead`);
  const results = await runDueSchedules(actor);
  for (const r of results) console.log(`[worker] report schedule ${r.scheduleId}: ${r.delivered} delivered, ${r.skipped} skipped, ${r.failed} failed`);
  if (Date.now() - lastPrune > 6 * 3_600_000) {
    await pruneFinishedJobs();
    lastPrune = Date.now();
  }
}

async function main() {
  if (process.argv.includes("--once")) {
    await tick();
    process.exit(0);
  }
  console.log(`[worker] started; polling every ${POLL_MS / 1000}s`);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));
  while (!stopping) {
    try {
      await tick();
    } catch (e) {
      console.error("[worker] tick failed:", (e as Error).name);
    }
    for (let waited = 0; waited < POLL_MS && !stopping; waited += 1000) await new Promise((r) => setTimeout(r, 1000));
  }
  console.log("[worker] stopped");
  process.exit(0);
}

main();
