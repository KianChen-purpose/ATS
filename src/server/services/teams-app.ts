import "server-only";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import PizZip from "pizzip";
import { count } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { botAppId, botConfigured } from "@/server/integrations/teams";
import { canViewSettings, ForbiddenError, type UserActor } from "@/server/policy";

/**
 * The Teams app package an admin uploads in the Teams admin center: manifest.json plus icons. The
 * bot (personal scope) delivers approval cards; the activity type lets Graph's
 * sendActivityNotification show PATS notifications in the Teams activity feed.
 */

// --- Icons: a black square with a white block "P" (color), the same mark white-on-transparent (outline).
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
/** Block "P" in unit coordinates. */
function inP(u: number, v: number) {
  const stem = u >= 0.3 && u < 0.43 && v >= 0.2 && v < 0.8;
  const top = u >= 0.3 && u < 0.66 && v >= 0.2 && v < 0.32;
  const mid = u >= 0.3 && u < 0.66 && v >= 0.48 && v < 0.6;
  const side = u >= 0.56 && u < 0.7 && v >= 0.24 && v < 0.56;
  return stem || top || mid || side;
}
export const colorIcon = () => png(192, (x, y) => (inP(x / 192, y / 192) ? [255, 255, 255, 255] : [0, 0, 0, 255]));
export const outlineIcon = () => png(32, (x, y) => (inP(x / 32, y / 32) ? [255, 255, 255, 255] : [0, 0, 0, 0]));

export function teamsManifest() {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const host = new URL(appUrl).host;
  const bot = botAppId() || "00000000-0000-0000-0000-000000000000";
  // Stable app id derived from the bot id unless one is set explicitly.
  const h = createHash("sha256").update(`pats-teams-app:${bot}`).digest("hex");
  const id = process.env.TEAMS_APP_ID || `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  const clientId = process.env.M365_CLIENT_ID;
  return {
    $schema: "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version: "1.0.0",
    id,
    developer: {
      name: "Purpose Unlimited",
      websiteUrl: appUrl,
      privacyUrl: process.env.TEAMS_PRIVACY_URL || `${appUrl}/careers`,
      termsOfUseUrl: process.env.TEAMS_TERMS_URL || `${appUrl}/careers`,
    },
    name: { short: "PATS", full: "PATS – Purpose Applicant Tracking System" },
    description: {
      short: "Recruiting approvals and updates from PATS.",
      full: "Approve or reject job and offer requests, and get PATS notifications (new applications, feedback due, candidate replies) without leaving Teams.",
    },
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: "#000000",
    bots: [{ botId: bot, scopes: ["personal"], supportsFiles: false, isNotificationOnly: false }],
    permissions: ["identity", "messageTeamMembers"],
    validDomains: [host],
    ...(clientId ? { webApplicationInfo: { id: clientId, resource: `api://${host}/${clientId}` } } : {}),
    activities: { activityTypes: [{ type: "patsNotification", description: "PATS notification", templateText: "{title}" }] },
  };
}

export function teamsAppPackage(admin: UserActor) {
  if (!canViewSettings(admin)) throw new ForbiddenError();
  const zip = new PizZip();
  zip.file("manifest.json", JSON.stringify(teamsManifest(), null, 2));
  zip.file("color.png", colorIcon());
  zip.file("outline.png", outlineIcon());
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function teamsStatus() {
  const [{ n }] = await db.select({ n: count() }).from(s.teamsConversations);
  return { botConfigured: botConfigured(), installedUsers: n };
}
