import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ConfigError } from "@/server/config";

/**
 * Encryption at rest for secrets PATS has to keep (delegated refresh tokens). AES-256-GCM with a
 * 32-byte key from TOKEN_ENCRYPTION_KEY (base64), which lives in Key Vault in Azure. No fallback key.
 */
function key() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new ConfigError("TOKEN_ENCRYPTION_KEY is required to store Microsoft sign-in tokens (see .env.example).");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new ConfigError("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return k;
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptSecret(enc: string) {
  const [v, iv, tag, body] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised secret format.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}
