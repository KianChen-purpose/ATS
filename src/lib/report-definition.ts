/**
 * Browser-safe encoding of a builder definition into the URL (?q=), matching
 * decodeDefinition in services/reports/builder.ts (base64url of UTF-8 JSON).
 */
export function encodeReportDefinition(def: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(def));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
