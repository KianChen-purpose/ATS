import { afterAll } from "vitest";

afterAll(async () => {
  // Close the shared pools so vitest can exit cleanly.
  const g = globalThis as unknown as { pool?: { end: () => Promise<void> }; reportingPool?: { end: () => Promise<void> } };
  await g.pool?.end();
  await g.reportingPool?.end();
  g.pool = undefined;
  g.reportingPool = undefined;
});
