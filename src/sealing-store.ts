import { Readable } from "node:stream";
import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import {
  FileSealError,
  type FileSealProvenance,
  type SealedFile,
  type SealFileRequest,
  SEALED_PREFIX,
} from "@antelopejs/interface-file-storage";

import { getS3Client, getStorageConfig } from "./index";

export const BackingPrefix = "__seal_data__/";
export const MaximumSealBytes = 16 * 1024 * 1024;
const MaximumSlotBytes = 64 * 1024;
const NotFoundStatus = 404;

interface ServiceError {
  $metadata?: ServiceMetadata;
}

interface ServiceMetadata {
  httpStatusCode?: number;
}

export interface SealSlot {
  status: "sealed" | "removed";
  provenance: FileSealProvenance;
  file?: SealedFile;
  backingKey?: string;
  backingVersion?: string;
}

export interface StoredSlot {
  slot: SealSlot;
  etag: string;
}

export function storageIdentity(storage?: string): string {
  const config = getStorageConfig(storage);
  if (
    !config.sealStorageId ||
    config.defaultVisibility !== "private" ||
    config.publicUrl
  ) {
    throw new FileSealError(
      "Sealing requires a private, explicitly configured store",
      "UNSUPPORTED",
    );
  }
  return config.sealStorageId;
}

export function rejectReservedMutation(key: string): void {
  if (key.startsWith(SEALED_PREFIX) || key.startsWith(BackingPrefix)) {
    throw new FileSealError("Reserved sealing key", "INVALID_REQUEST");
  }
}

export function rejectBackingAccess(key: string): void {
  if (key.startsWith(BackingPrefix)) {
    throw new FileSealError("Private sealing data", "INVALID_REQUEST");
  }
}

export function validateSealRequest(
  request: SealFileRequest,
  storage?: string,
): void {
  const identity = storageIdentity(storage);
  if (
    !request.admissionId ||
    !request.source.generation ||
    !request.source.resourceKey ||
    !request.destinationKey.startsWith(SEALED_PREFIX) ||
    request.destinationKey === SEALED_PREFIX
  ) {
    throw new FileSealError("Incomplete sealing request", "INVALID_REQUEST");
  }
  if (request.source.storageId !== identity) {
    throw new FileSealError(
      "Source belongs to another store",
      "STORAGE_MISMATCH",
    );
  }
  rejectReservedMutation(request.source.resourceKey);
}

function matchesProvenance(slot: SealSlot, request: SealFileRequest): boolean {
  const source = slot.provenance.source;
  return (
    slot.provenance.admissionId === request.admissionId &&
    source.storageId === request.source.storageId &&
    source.resourceKey === request.source.resourceKey &&
    source.generation === request.source.generation
  );
}

export function isMissing(error: unknown): boolean {
  return (error as ServiceError)?.$metadata?.httpStatusCode === NotFoundStatus;
}

async function consumeBounded(
  body: Readable,
  maximum: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of body) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > maximum) {
      throw new FileSealError(
        "Object exceeds bounded sealing limit",
        "UNSUPPORTED",
      );
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export async function readBounded(
  response: GetObjectCommandOutput,
  maximum: number,
): Promise<Buffer> {
  const body = response.Body;
  if (!(body instanceof Readable)) {
    throw new FileSealError("A bounded Node stream is required", "UNSUPPORTED");
  }
  try {
    if (
      response.ContentLength === undefined ||
      response.ContentLength > maximum
    ) {
      throw new FileSealError(
        "Object exceeds bounded sealing limit",
        "UNSUPPORTED",
      );
    }
    const bytes = await consumeBounded(body, maximum);
    if (bytes.length !== response.ContentLength) {
      throw new FileSealError("Incomplete object body", "OUTCOME_UNKNOWN");
    }
    return bytes;
  } catch (error) {
    if (error instanceof FileSealError) throw error;
    throw new FileSealError("Object stream failed", "OUTCOME_UNKNOWN");
  } finally {
    body.destroy();
  }
}

function hasValidPointer(
  slot: SealSlot,
  key: string,
  storageId: string,
): boolean {
  if (slot.status === "removed") return true;
  const file = slot.file;
  return Boolean(
    file &&
    file.identity?.resourceKey === key &&
    file.identity.storageId === storageId &&
    file.identity.generation &&
    file.metadata?.resourceKey === key &&
    JSON.stringify(file.provenance) === JSON.stringify(slot.provenance) &&
    slot.backingKey === `${BackingPrefix}${file.identity.generation}` &&
    slot.backingVersion &&
    slot.backingVersion !== "null",
  );
}

function decodeSlot(bytes: Buffer, key: string, storageId: string): SealSlot {
  const slot = JSON.parse(bytes.toString()) as SealSlot | null;
  const source = slot?.provenance?.source;
  if (
    !slot ||
    !source ||
    !slot.provenance.admissionId ||
    !source.generation ||
    !source.resourceKey ||
    source.storageId !== storageId ||
    !["sealed", "removed"].includes(slot.status) ||
    !hasValidPointer(slot, key, storageId)
  ) {
    throw new FileSealError(
      "Destination is not a trusted seal slot",
      "DESTINATION_CONFLICT",
    );
  }
  return slot;
}

export async function readSlot(
  key: string,
  storage?: string,
): Promise<StoredSlot | undefined> {
  const storageId = storageIdentity(storage);
  try {
    const response = await getS3Client(storage).send(
      new GetObjectCommand({
        Bucket: getStorageConfig(storage).bucket,
        Key: key,
      }),
    );
    const slot = decodeSlot(
      await readBounded(response, MaximumSlotBytes),
      key,
      storageId,
    );
    if (!response.ETag) {
      throw new FileSealError("Slot CAS requires ETag", "UNSUPPORTED");
    }
    return { slot, etag: response.ETag };
  } catch (error) {
    if (isMissing(error)) return undefined;
    if (error instanceof FileSealError) throw error;
    if (error instanceof SyntaxError) {
      throw new FileSealError(
        "Destination is not a seal slot",
        "DESTINATION_CONFLICT",
      );
    }
    throw new FileSealError(
      "Cannot read durable seal state",
      "OUTCOME_UNKNOWN",
    );
  }
}

export async function readMatchingSlot(
  request: SealFileRequest,
  storage?: string,
): Promise<StoredSlot | undefined> {
  const result = await readSlot(request.destinationKey, storage);
  if (result && !matchesProvenance(result.slot, request)) {
    throw new FileSealError(
      "Destination belongs to another admission",
      "DESTINATION_CONFLICT",
    );
  }
  return result;
}

export async function writeSlot(
  request: SealFileRequest,
  slot: SealSlot,
  etag: string | undefined,
  storage?: string,
): Promise<void> {
  const body = JSON.stringify(slot);
  if (Buffer.byteLength(body) > MaximumSlotBytes) {
    throw new FileSealError(
      "Admission exceeds seal slot limit",
      "INVALID_REQUEST",
    );
  }
  const input: PutObjectCommandInput = {
    Bucket: getStorageConfig(storage).bucket,
    Key: request.destinationKey,
    Body: body,
    ContentType: "application/json",
  };
  if (etag) input.IfMatch = etag;
  else input.IfNoneMatch = "*";
  await getS3Client(storage).send(new PutObjectCommand(input));
}
