import { createHash } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import {
  FileConflictError,
  FileNotFoundError,
} from "@antelopejs/interface-file-storage";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  type PutObjectCommandInput,
  type S3Client,
} from "@aws-sdk/client-s3";

const OriginPrefix = "antelope-promotion-";
const OriginHeader = `${OriginPrefix}origin`;
const UnpromotedOrigin = "unpromoted";
const NotFoundStatus = 404;

export interface PromotionTarget {
  client: S3Client;
  bucket: string;
  sourceKey: string;
  destinationKey: string;
}

interface ErrorMetadata {
  httpStatusCode?: number;
}

interface StorageError {
  $metadata?: ErrorMetadata;
}

function isMissing(error: unknown): boolean {
  return (error as StorageError)?.$metadata?.httpStatusCode === NotFoundStatus;
}

function userMetadata(
  metadata?: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata ?? {}).filter(
      ([key]) => !key.toLowerCase().startsWith(OriginPrefix),
    ),
  );
}

export function uploadMetadata(
  metadata: Record<string, string>,
): Record<string, string> {
  return { ...userMetadata(metadata), [OriginHeader]: UnpromotedOrigin };
}

function origin(target: PromotionTarget): string {
  const identity = JSON.stringify([
    target.bucket,
    target.sourceKey,
    target.destinationKey,
  ]);
  return createHash("sha256").update(identity).digest("hex");
}

async function destination(
  target: PromotionTarget,
): Promise<HeadObjectCommandOutput | undefined> {
  try {
    return await target.client.send(
      new HeadObjectCommand({
        Bucket: target.bucket,
        Key: target.destinationKey,
      }),
    );
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function verifyDestination(target: PromotionTarget): Promise<boolean> {
  const response = await destination(target);
  if (!response) return false;
  if (
    !response.ETag ||
    response.ContentLength === undefined ||
    response.ContentLength < 0 ||
    response.Metadata?.[OriginHeader] !== origin(target)
  ) {
    throw new FileConflictError(target.destinationKey);
  }
  return true;
}

function publicationInput(
  target: PromotionTarget,
  source: GetObjectCommandOutput,
  body: Readable,
): PutObjectCommandInput {
  if (source.ContentLength === undefined || source.ContentLength < 0) {
    throw new Error("Promotion requires the source content length");
  }
  const input: PutObjectCommandInput = {
    Bucket: target.bucket,
    Key: target.destinationKey,
    Body: body,
    ContentLength: source.ContentLength,
    IfNoneMatch: "*",
    Metadata: {
      ...userMetadata(source.Metadata),
      [OriginHeader]: origin(target),
    },
  };
  if (source.ContentType !== undefined) input.ContentType = source.ContentType;
  if (source.ContentDisposition !== undefined)
    input.ContentDisposition = source.ContentDisposition;
  if (source.ContentEncoding !== undefined)
    input.ContentEncoding = source.ContentEncoding;
  if (source.ContentLanguage !== undefined)
    input.ContentLanguage = source.ContentLanguage;
  if (source.CacheControl !== undefined)
    input.CacheControl = source.CacheControl;
  if (source.Expires !== undefined) input.Expires = source.Expires;
  return input;
}

async function streamPromotion(target: PromotionTarget): Promise<void> {
  const source = await target.client.send(
    new GetObjectCommand({ Bucket: target.bucket, Key: target.sourceKey }),
  );
  const body = source.Body;
  if (!(body instanceof Readable))
    throw new Error("Promotion requires a readable source body");
  const controller = new AbortController();
  const upload = new PassThrough();
  const abort = () => {
    controller.abort();
    upload.end();
  };
  body.once("error", abort);
  body.once("close", () => {
    if (!body.readableEnded) abort();
    body.off("error", abort);
  });
  body.pipe(upload);
  try {
    await target.client.send(
      new PutObjectCommand(publicationInput(target, source, upload)),
      {
        abortSignal: controller.signal,
      },
    );
  } finally {
    body.unpipe(upload);
    body.destroy();
    upload.end();
  }
}

export async function promote(target: PromotionTarget): Promise<void> {
  if (!(await verifyDestination(target))) {
    try {
      await streamPromotion(target);
    } catch (error) {
      if (!(await verifyDestination(target))) {
        if (isMissing(error)) throw new FileNotFoundError(target.sourceKey);
        throw error;
      }
    }
    if (!(await verifyDestination(target))) {
      throw new Error("Promotion destination could not be verified");
    }
  }
  await target.client.send(
    new DeleteObjectCommand({
      Bucket: target.bucket,
      Key: target.sourceKey,
    }),
  );
}
