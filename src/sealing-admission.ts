import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  FileSealError,
  type SealFileRequest,
} from "@antelopejs/interface-file-storage";

import { getS3Client, getStorageConfig } from "./index";
import { BackingPrefix, isMissing, readBounded } from "./sealing-store";

const MaximumAdmissionBytes = 8 * 1024;

function admissionBody(request: SealFileRequest): string {
  const body = JSON.stringify([
    request.admissionId,
    request.destinationKey,
    request.source.storageId,
    request.source.resourceKey,
    request.source.generation,
  ]);
  if (Buffer.byteLength(body) > MaximumAdmissionBytes) {
    throw new FileSealError("Admission is too large", "INVALID_REQUEST");
  }
  return body;
}

function admissionKey(request: SealFileRequest): string {
  const hash = createHash("sha256").update(request.admissionId).digest("hex");
  return `${BackingPrefix}admissions/${hash}`;
}

export async function checkAdmission(
  request: SealFileRequest,
  storage?: string,
): Promise<boolean> {
  const expected = admissionBody(request);
  try {
    const response = await getS3Client(storage).send(
      new GetObjectCommand({
        Bucket: getStorageConfig(storage).bucket,
        Key: admissionKey(request),
      }),
    );
    const body = await readBounded(response, MaximumAdmissionBytes);
    if (body.toString() !== expected) {
      throw new FileSealError(
        "Admission tuple has changed",
        "DESTINATION_CONFLICT",
      );
    }
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    if (error instanceof FileSealError) throw error;
    throw new FileSealError("Cannot read admission binding", "OUTCOME_UNKNOWN");
  }
}

export async function bindAdmission(
  request: SealFileRequest,
  storage?: string,
): Promise<void> {
  if (await checkAdmission(request, storage)) return;
  try {
    await getS3Client(storage).send(
      new PutObjectCommand({
        Bucket: getStorageConfig(storage).bucket,
        Key: admissionKey(request),
        Body: admissionBody(request),
        ContentType: "application/json",
        IfNoneMatch: "*",
      }),
    );
  } catch (error) {
    if (error instanceof FileSealError) throw error;
    if (await checkAdmission(request, storage)) return;
    throw new FileSealError(
      "Admission binding outcome is unknown",
      "OUTCOME_UNKNOWN",
    );
  }
}
