import { afterAll } from "vitest";

afterAll(async () => {
  // Close the shared pool so vitest can exit cleanly.
  const g = globalThis as unknown as { pool?: { end: () => Promise<void> } };
  await g.pool?.end();
  g.pool = undefined;
});
