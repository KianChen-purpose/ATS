import "server-only";
import { graphM365 } from "./graph";
import { mockM365 } from "./mock";
import type { M365Client } from "./types";

export * from "./types";

export function m365Configured() {
  return !!(process.env.M365_TENANT_ID && process.env.M365_CLIENT_ID && process.env.M365_CLIENT_SECRET);
}

/** The M365 client for this deployment: live Graph when Entra credentials are set, otherwise mock. */
export function m365(): M365Client {
  return m365Configured() ? graphM365 : mockM365;
}
