import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  FileNotFoundError,
  FileSealError,
  type FileMetadata,
  type FileSnapshot,
  type FileSealState,
  type RemovedFileSeal,
  type SealedFile,
  type SealFileRequest,
  SEALED_PREFIX,
} from "@antelopejs/interface-file-storage";

import { getS3Client, getStorageConfig } from "./index";
import { bindAdmission, checkAdmission } from "./sealing-admission";
import {
  BackingPrefix,
  isMissing,
  MaximumSealBytes,
  readBounded,
  readMatchingSlot,
  readSlot,
  rejectBackingAccess,
  type SealSlot,
  storageIdentity,
  validateSealRequest,
  writeSlot,
} from "./sealing-store";

const RemovalAttempts = 3;
const DefaultMimetype = "application/octet-stream";

function requireVersion(version?: string): string {
  if (!version || version === "null") {
    throw new FileSealError(
      "A non-null immutable S3 VersionId is required",
      "UNSUPPORTED",
    );
  }
  return version;
}

function metadataFromObject(
  response: HeadObjectCommandOutput,
  key: string,
): FileMetadata {
  return {
    resourceKey: key,
    filename: response.Metadata?.filename ?? "",
    size: response.ContentLength ?? 0,
    mimetype: response.ContentType ?? DefaultMimetype,
    lastModified: response.LastModified?.getTime() ?? 0,
    metadata: response.Metadata ?? {},
  };
}

export async function getFileSnapshot(
  key: string,
  storage?: string,
): Promise<FileSnapshot> {
  const storageId = storageIdentity(storage);
  rejectBackingAccess(key);
  if (key.startsWith(SEALED_PREFIX)) {
    return (await resolveSealedFile(key, storage)).file!;
  }
  try {
    const response = await getS3Client(storage).send(
      new HeadObjectCommand({
        Bucket: getStorageConfig(storage).bucket,
        Key: key,
      }),
    );
    return {
      identity: {
        storageId,
        resourceKey: key,
        generation: requireVersion(response.VersionId),
      },
      metadata: metadataFromObject(response, key),
    };
  } catch (error) {
    if (isMissing(error)) throw new FileNotFoundError(key);
    if (error instanceof FileSealError) throw error;
    throw new FileSealError(
      "Cannot capture source generation",
      "OUTCOME_UNKNOWN",
    );
  }
}

async function readSource(
  request: SealFileRequest,
  storage?: string,
): Promise<GetObjectCommandOutput> {
  requireVersion(request.source.generation);
  try {
    const response = await getS3Client(storage).send(
      new GetObjectCommand({
        Bucket: getStorageConfig(storage).bucket,
        Key: request.source.resourceKey,
        VersionId: request.source.generation,
      }),
    );
    if (response.VersionId !== request.source.generation) {
      if (response.Body instanceof Readable) response.Body.destroy();
      throw new FileSealError(
        "Source generation differs",
        "GENERATION_MISMATCH",
      );
    }
    return response;
  } catch (error) {
    if (isMissing(error))
      throw new FileSealError(
        "Source generation is absent",
        "GENERATION_MISMATCH",
      );
    if (error instanceof FileSealError) throw error;
    throw new FileSealError("Cannot read source generation", "OUTCOME_UNKNOWN");
  }
}

async function writePayload(
  response: GetObjectCommandOutput,
  backingKey: string,
  storage?: string,
): Promise<string> {
  const bytes = await readBounded(response, MaximumSealBytes);
  try {
    const result = await getS3Client(storage).send(
      new PutObjectCommand({
        Bucket: getStorageConfig(storage).bucket,
        Key: backingKey,
        Body: bytes,
        ContentType: response.ContentType ?? DefaultMimetype,
        IfNoneMatch: "*",
      }),
    );
    return requireVersion(result.VersionId);
  } catch (error) {
    if (error instanceof FileSealError) throw error;
    throw new FileSealError(
      "Private payload write outcome is unknown",
      "OUTCOME_UNKNOWN",
    );
  }
}

async function prepareSlot(
  request: SealFileRequest,
  storage?: string,
): Promise<SealSlot> {
  const response = await readSource(request, storage);
  const generation = randomUUID();
  const backingKey = `${BackingPrefix}${generation}`;
  const backingVersion = await writePayload(response, backingKey, storage);
  const provenance = {
    admissionId: request.admissionId,
    source: request.source,
  };
  return {
    status: "sealed",
    provenance,
    backingKey,
    backingVersion,
    file: {
      identity: {
        storageId: storageIdentity(storage),
        resourceKey: request.destinationKey,
        generation,
      },
      metadata: metadataFromObject(response, request.destinationKey),
      provenance,
    },
  };
}

function committedFile(slot: SealSlot): SealedFile {
  if (slot.status === "removed") {
    throw new FileSealError(
      "Admission permanently removed",
      "ADMISSION_REMOVED",
    );
  }
  return slot.file!;
}

export async function sealFile(
  request: SealFileRequest,
  storage?: string,
): Promise<SealedFile> {
  validateSealRequest(request, storage);
  await bindAdmission(request, storage);
  const existing = await readMatchingSlot(request, storage);
  if (existing) return committedFile(existing.slot);
  const slot = await prepareSlot(request, storage);
  try {
    await writeSlot(request, slot, undefined, storage);
  } catch (error) {
    if (error instanceof FileSealError) throw error;
    const reconciled = await readMatchingSlot(request, storage);
    if (reconciled) return committedFile(reconciled.slot);
    throw new FileSealError(
      "Publication outcome is unknown; reconcile this admission",
      "OUTCOME_UNKNOWN",
    );
  }
  return committedFile(slot);
}

export async function getFileSeal(
  request: SealFileRequest,
  storage?: string,
): Promise<FileSealState> {
  validateSealRequest(request, storage);
  await checkAdmission(request, storage);
  const result = await readMatchingSlot(request, storage);
  if (!result) return { status: "absent" };
  if (result.slot.status === "removed") return { status: "removed" };
  return { status: "sealed", file: committedFile(result.slot) };
}

export async function removeSealedFile(
  request: SealFileRequest,
  storage?: string,
): Promise<RemovedFileSeal> {
  validateSealRequest(request, storage);
  await bindAdmission(request, storage);
  const tombstone: SealSlot = {
    status: "removed",
    provenance: { admissionId: request.admissionId, source: request.source },
  };
  for (let attempt = 0; attempt < RemovalAttempts; attempt++) {
    const existing = await readMatchingSlot(request, storage);
    if (existing?.slot.status === "removed") return { status: "removed" };
    try {
      await writeSlot(request, tombstone, existing?.etag, storage);
      return { status: "removed" };
    } catch {
      const reconciled = await readMatchingSlot(request, storage);
      if (reconciled?.slot.status === "removed") return { status: "removed" };
    }
  }
  throw new FileSealError(
    "Removal outcome is unknown; reconcile this admission",
    "OUTCOME_UNKNOWN",
  );
}

export async function resolveSealedFile(
  key: string,
  storage?: string,
): Promise<SealSlot> {
  const result = await readSlot(key, storage);
  if (!result || result.slot.status === "removed")
    throw new FileNotFoundError(key);
  return result.slot;
}
