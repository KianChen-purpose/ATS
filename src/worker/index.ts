/**
 * PATS background worker (ARCHITECTURE.md D5). A separate process that reuses the service layer.
 * Today it delivers scheduled reports; email sync, Graph webhooks, retention and reminders join it
 * as they're built. Run with `npm run worker` (add `-- --once` for a single pass, e.g. from cron).
 *
 * Safe to run more than one: due work is claimed with FOR UPDATE SKIP LOCKED.
 */
import { systemActor } from "@/server/policy/actor";
import { runDueSchedules } from "@/server/services/reports/schedules";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 60_000);
const actor = systemActor("worker");
let stopping = false;

async function tick() {
  const results = await runDueSchedules(actor);
  for (const r of results) console.log(`[worker] report schedule ${r.scheduleId}: ${r.delivered} delivered, ${r.skipped} skipped, ${r.failed} failed`);
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
