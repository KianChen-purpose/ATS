"use server";

import { z } from "zod";
import { requireActor } from "@/lib/session";
import { searchEverything as search, type SearchResult } from "@/server/services/search";

/** Global search used by the command palette (Cmd/Ctrl+K). */
export async function searchEverything(q: string): Promise<SearchResult> {
  return search(await requireActor(), z.string().max(200).parse(q));
}
