import { assertBootConfig } from "@/server/config";

/** Runs once when the server starts; a configuration error stops the boot (ARCHITECTURE.md §6). */
export function register() {
  try {
    assertBootConfig();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    // Exit so the container restarts visibly instead of idling without serving requests.
    if (process.env.NEXT_RUNTIME === "nodejs") process.exit(1);
    throw e;
  }
}
