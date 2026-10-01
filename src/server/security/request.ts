import "server-only";
import { headers } from "next/headers";

/** Best-effort client IP for rate limiting (Azure Front Door / App Service set x-forwarded-for). */
export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
