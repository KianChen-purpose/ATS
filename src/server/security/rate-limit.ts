import "server-only";

/**
 * Fixed-window rate limiter for public endpoints (self-scheduling links, later the career site).
 * In-process: fine for a single instance and the demo. Before running several app instances,
 * back this with a shared store (Postgres or Azure Cache for Redis) behind the same function.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export class RateLimitError extends Error {
  constructor() {
    super("Too many requests. Please wait a few minutes and try again.");
    this.name = "RateLimitError";
  }
}

export function rateLimit(key: string, opts: { limit: number; windowMs: number }) {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + opts.windowMs });
    if (windows.size > 10_000) for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    return;
  }
  w.count++;
  if (w.count > opts.limit) throw new RateLimitError();
}

export const PUBLIC_LIMITS = {
  /** Opening a scheduling page (each view queries free/busy). */
  view: { limit: 60, windowMs: 10 * 60_000 },
  /** Booking attempts. */
  book: { limit: 10, windowMs: 10 * 60_000 },
  /** Career-site applications per IP. */
  apply: { limit: 5, windowMs: 10 * 60_000 },
} as const;

/** Test hook. */
export function resetRateLimits() {
  windows.clear();
}
