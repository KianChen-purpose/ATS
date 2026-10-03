import { afterEach, describe, expect, it, vi } from "vitest";
import { assertBootConfig, ConfigError, demoAuthEnabled, sessionSecret } from "@/server/config";
import { listDemoSignInUsers } from "@/server/services/users";

const GOOD_SECRET = "x".repeat(40);

describe("boot configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["development", "true", true],
    ["development", "false", false],
    ["development", undefined, false],
    ["test", "true", true],
    ["production", "true", false],
  ])("NODE_ENV=%s PATS_DEMO_AUTH=%s → demo auth %s", (env, flag, expected) => {
    vi.stubEnv("NODE_ENV", env);
    vi.stubEnv("PATS_DEMO_AUTH", flag);
    expect(demoAuthEnabled()).toBe(expected);
  });

  it("a demo environment allows demo sign-in in a production build, and refuses live services", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PATS_DEMO_AUTH", "true");
    vi.stubEnv("PATS_ENV", "demo");
    vi.stubEnv("SESSION_SECRET", GOOD_SECRET);
    vi.stubEnv("DATABASE_URL", "postgres://x");
    expect(demoAuthEnabled()).toBe(true);
    expect(() => assertBootConfig()).not.toThrow();
    vi.stubEnv("M365_CLIENT_SECRET", "s");
    expect(() => assertBootConfig()).toThrow(/must not connect to live services.*M365_CLIENT_SECRET/);
    vi.stubEnv("M365_CLIENT_SECRET", "");
    vi.stubEnv("PATS_ENV", "staging");
    expect(() => assertBootConfig()).toThrow(ConfigError);
    vi.stubEnv("PATS_ENV", "production");
    expect(demoAuthEnabled()).toBe(false);
    expect(() => assertBootConfig()).toThrow(/not allowed in production/);
  });

  it("refuses to boot in production with demo auth on", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PATS_DEMO_AUTH", "true");
    vi.stubEnv("SESSION_SECRET", GOOD_SECRET);
    expect(() => assertBootConfig()).toThrow(ConfigError);
    vi.stubEnv("PATS_DEMO_AUTH", "false");
    expect(() => assertBootConfig()).not.toThrow();
  });

  it("has no fallback session secret", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => sessionSecret()).toThrow(/required/);
    expect(() => assertBootConfig()).toThrow(/SESSION_SECRET/);
    vi.stubEnv("SESSION_SECRET", "short");
    expect(() => sessionSecret()).toThrow(/32/);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "change-me-to-a-long-random-string");
    expect(() => sessionSecret()).toThrow(/example/);
  });

  it("the demo user list is empty when demo auth is off", async () => {
    vi.stubEnv("PATS_DEMO_AUTH", "false");
    expect(await listDemoSignInUsers()).toEqual([]);
  });
});
