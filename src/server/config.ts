/**
 * Boot-time configuration checks (ARCHITECTURE.md §6). No fallbacks: a missing or unsafe setting
 * stops the server from starting instead of silently running with a default.
 * Plain module (no "server-only") so instrumentation.ts can import it.
 */

const EXAMPLE_SECRET = "change-me-to-a-long-random-string";

export class ConfigError extends Error {
  constructor(message: string) {
    super(`PATS configuration error: ${message}`);
    this.name = "ConfigError";
  }
}

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * A hosted demo environment (PATS_ENV=demo): a production build that holds synthetic data only.
 * Demo sign-in may run there; Microsoft 365 and Entra stay off so nothing reaches real people, and
 * every page carries a "demo" banner. Approved by Kian Chen, 2026-10-03 (ARCHITECTURE.md §6.2).
 */
export function isDemoEnvironment() {
  return process.env.PATS_ENV === "demo";
}

/** Demo sign-in ("pick any user"): PATS_DEMO_AUTH=true, and either not production or a demo environment. */
export function demoAuthEnabled() {
  return process.env.PATS_DEMO_AUTH === "true" && (!isProduction() || isDemoEnvironment());
}

export function sessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new ConfigError("SESSION_SECRET is required (see .env.example).");
  if (secret.length < 32) throw new ConfigError("SESSION_SECRET must be at least 32 characters.");
  if (isProduction() && secret === EXAMPLE_SECRET) throw new ConfigError("SESSION_SECRET is still the example value.");
  return new TextEncoder().encode(secret);
}

/** Entra ID sign-in is on when the app registration's credentials are set (docs/INTEGRATIONS.md). */
export function entraConfigured() {
  return !!(process.env.M365_TENANT_ID && process.env.M365_CLIENT_ID && process.env.M365_CLIENT_SECRET);
}

/** Called once at server start. Throws to refuse to boot. */
export function assertBootConfig() {
  if (isProduction() && process.env.PATS_DEMO_AUTH === "true" && !isDemoEnvironment()) {
    throw new ConfigError("PATS_DEMO_AUTH=true is not allowed in production. Remove it and use Entra ID sign-in (or set PATS_ENV=demo for a synthetic-data demo environment).");
  }
  if (process.env.PATS_ENV && !["demo", "production"].includes(process.env.PATS_ENV)) {
    throw new ConfigError('PATS_ENV must be "demo" or "production" (or unset).');
  }
  if (isDemoEnvironment()) {
    // A demo holds made-up people: no real mail, calendars, Teams or sign-in from it.
    const live = ["M365_TENANT_ID", "M365_CLIENT_ID", "M365_CLIENT_SECRET", "TEAMS_BOT_APP_ID", "TEAMS_BOT_APP_SECRET", "REPORTING_DATABASE_URL"].filter((k) => process.env[k]);
    if (live.length) throw new ConfigError(`A demo environment (PATS_ENV=demo) must not connect to live services. Remove: ${live.join(", ")}.`);
  }
  sessionSecret();
  if (!process.env.DATABASE_URL) throw new ConfigError("DATABASE_URL is required.");
  if (entraConfigured()) {
    const k = process.env.TOKEN_ENCRYPTION_KEY;
    if (!k || Buffer.from(k, "base64").length !== 32) throw new ConfigError("TOKEN_ENCRYPTION_KEY (32 bytes, base64) is required when Entra ID sign-in is configured.");
    if (isProduction() && !process.env.APP_URL?.startsWith("https://")) throw new ConfigError("APP_URL must be the https:// address registered as the Entra redirect URI.");
  }
}
