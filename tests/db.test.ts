import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { makeApplication, makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

describe("test database", () => {
  beforeEach(resetDb);

  it("is built from the committed migrations", async () => {
    const { rows } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("supports the fixture helpers", async () => {
    const hm = await makeUser("hiring_manager");
    const job = await makeJob({ hiringManagerId: hm.id });
    const cand = await makeCandidate();
    const app = await makeApplication(cand.id, job);
    expect(job.stages).toHaveLength(8);
    expect(app.stageId).toBe(job.stages[0].id);
  });
});
