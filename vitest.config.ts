import { defineConfig } from "vitest/config";
import path from "node:path";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://pats:pats@localhost:5432/pats_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next.js guard module; meaningless outside the bundler.
      "server-only": path.resolve(__dirname, "tests/stubs/empty.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    env: { DATABASE_URL: TEST_DATABASE_URL, TEST_DATABASE_URL, SESSION_SECRET: "test-secret-at-least-32-characters-long", NODE_ENV: "test" },
    // Tests share one real Postgres database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
