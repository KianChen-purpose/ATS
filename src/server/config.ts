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

/** Demo sign-in ("pick any user") is allowed only with PATS_DEMO_AUTH=true outside production. */
export function demoAuthEnabled() {
  return process.env.PATS_DEMO_AUTH === "true" && !isProduction();
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
  if (isProduction() && process.env.PATS_DEMO_AUTH === "true") {
    throw new ConfigError("PATS_DEMO_AUTH=true is not allowed in production. Remove it and use Entra ID sign-in.");
  }
  sessionSecret();
  if (!process.env.DATABASE_URL) throw new ConfigError("DATABASE_URL is required.");
  if (entraConfigured()) {
    const k = process.env.TOKEN_ENCRYPTION_KEY;
    if (!k || Buffer.from(k, "base64").length !== 32) throw new ConfigError("TOKEN_ENCRYPTION_KEY (32 bytes, base64) is required when Entra ID sign-in is configured.");
    if (isProduction() && !process.env.APP_URL?.startsWith("https://")) throw new ConfigError("APP_URL must be the https:// address registered as the Entra redirect URI.");
  }
}
