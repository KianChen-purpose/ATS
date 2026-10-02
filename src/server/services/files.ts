import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { fileStore } from "@/server/integrations/files";
import {
  actorUserId,
  assertCanSeeJobs,
  canManageRecruiting,
  canViewCompensation,
  ForbiddenError,
  NotFoundError,
  requireUserActor,
  type Actor,
} from "@/server/policy";
import { recordAudit } from "./audit";
import type { DbOrTx } from "./tx";

type FileKind = (typeof s.fileKind.enumValues)[number];

/**
 * Store bytes in the FileStore and record their metadata. The bytes are written first; if the
 * row insert then fails, an orphan blob is left behind, never a row without bytes.
 */
export async function storeFile(
  tx: DbOrTx,
  actor: Actor,
  f: {
    kind: FileKind;
    fileName: string;
    contentType: string;
    bytes: Buffer;
    jobId?: string | null;
    applicationId?: string | null;
    candidateId?: string | null;
    brandId?: string | null;
  },
) {
  const id = randomUUID();
  const storageKey = `${f.kind}/${id.slice(0, 2)}/${id}`;
  await fileStore().put(storageKey, f.bytes, f.contentType);
  const [row] = await tx
    .insert(s.files)
    .values({
      id,
      kind: f.kind,
      storageKey,
      fileName: f.fileName,
      contentType: f.contentType,
      sizeBytes: f.bytes.length,
      sha256: createHash("sha256").update(f.bytes).digest("hex"),
      jobId: f.jobId ?? null,
      applicationId: f.applicationId ?? null,
      candidateId: f.candidateId ?? null,
      brandId: f.brandId ?? null,
      createdById: actorUserId(actor),
    })
    .returning();
  return row;
}

/**
 * Read a file for download. Offer letters follow their job's visibility and the compensation
 * rule; templates are for recruiting roles. Every download is audited as an export.
 */
export async function downloadFile(actor: Actor, fileId: string) {
  const user = requireUserActor(actor);
  const file = await db.query.files.findFirst({ where: eq(s.files.id, fileId) });
  if (!file || file.deletedAt) throw new NotFoundError("File");
  if (file.kind === "offer_letter_template") {
    if (!canManageRecruiting(user)) throw new ForbiddenError();
  } else {
    if (!file.jobId) throw new NotFoundError("File");
    await assertCanSeeJobs(actor, [file.jobId]);
    if (file.kind === "offer_letter" && !canViewCompensation(user)) throw new ForbiddenError();
  }
  const bytes = await fileStore().get(file.storageKey);
  await recordAudit(db, actor, "file.exported", "file", file.id, { kind: file.kind, candidateId: file.candidateId, applicationId: file.applicationId });
  return { file, bytes };
}

/**
 * Anonymization: mark a candidate's files deleted inside the caller's transaction and return
 * their keys. Remove the bytes with removeStoredFiles after the transaction commits.
 */
export async function markCandidateFilesDeleted(tx: DbOrTx, candidateId: string) {
  const rows = await tx
    .update(s.files)
    .set({ deletedAt: new Date(), fileName: "[redacted]" })
    .where(and(eq(s.files.candidateId, candidateId), isNull(s.files.deletedAt)))
    .returning({ storageKey: s.files.storageKey });
  return rows.map((r) => r.storageKey);
}

export async function removeStoredFiles(keys: string[]) {
  for (const k of keys) await fileStore().remove(k);
}
