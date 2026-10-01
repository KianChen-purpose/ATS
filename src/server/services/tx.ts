import "server-only";
import { db } from "@/db";

/** A Drizzle transaction handle (or the root client, which has the same query API). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbOrTx = typeof db | Tx;
