import assert from 'assert/strict';
import { S3Client, DeleteObjectCommand, HeadObjectCommand, HeadObjectCommandOutput } from '@aws-sdk/client-s3';
import {
  CreateUploadUrl,
  CreateReadUrl,
  DeleteFile,
  FileExists,
  GetFileMetadata,
  FileNotFoundError,
  UploadValidationError,
} from '@ajs.local/file-storage/beta';

const ExistingResourceKey = 'folder/existing.txt';
const MissingResourceKey = 'folder/missing.txt';
const MetadataOnlyResourceKey = 'folder/metadata-only.txt';
const UploadPath = '/uploads/';
const PublicStorage = 'public-assets';

interface StoredFile {
  size: number;
  mimetype: string;
  lastModified: Date;
  metadata?: Record<string, string>;
}

interface NotFoundErrorShape extends Error {
  $metadata: NotFoundMetadata;
}

type S3SendMethod = S3Client['send'];
type SendCommand = DeleteObjectCommand | HeadObjectCommand;

interface NotFoundMetadata {
  httpStatusCode: number;
}

const originalSend = S3Client.prototype.send;
const storageByResourceKey: Map<string, StoredFile> = new Map();

describe('file-storage interface', () => {
  before(() => {
    S3Client.prototype.send = createMockSendMethod();
  });

  after(() => {
    S3Client.prototype.send = originalSend;
  });

  beforeEach(() => {
    resetStorage();
  });

  it('creates an upload URL with signed headers and normalized resource key', async () => {
    const response = await CreateUploadUrl({
      filename: 'avatar.png',
      size: 128,
      mimetype: 'image/png',
      path: UploadPath,
      metadata: { source: 'profile' },
    });

    assert.ok(response.uploadUrl.includes('X-Amz-Signature='));
    assert.ok(response.resourceKey.startsWith('uploads/'));
    assert.ok(response.resourceKey.endsWith('.png'));
    assert.equal(response.headers['Content-Type'], 'image/png');
    assert.equal(response.headers['Content-Length'], '128');
    assert.equal(response.headers['x-amz-meta-filename'], 'avatar.png');
    assert.equal(response.headers['x-amz-meta-source'], 'profile');
    assert.ok(response.expiresAt > Date.now());
  });

  it('validates upload max size constraints', async () => {
    await assert.rejects(
      () =>
        CreateUploadUrl(
          {
            filename: 'oversized.txt',
            size: 20,
            mimetype: 'text/plain',
          },
          { maxSize: 10 },
        ),
      (error: unknown) =>
        error instanceof UploadValidationError && error.code === 'SIZE_EXCEEDED' && error.message.includes('20'),
    );
  });

  it('validates upload mimetype constraints', async () => {
    await assert.rejects(
      () =>
        CreateUploadUrl(
          {
            filename: 'document.pdf',
            size: 10,
            mimetype: 'application/pdf',
          },
          { allowedMimetypes: ['image/png', 'image/jpeg'] },
        ),
      (error: unknown) =>
        error instanceof UploadValidationError &&
        error.code === 'MIMETYPE_NOT_ALLOWED' &&
        error.message.includes('pdf'),
    );
  });

  it('returns public read URL when storage visibility is public', async () => {
    const response = await CreateReadUrl('assets/logo.svg', undefined, PublicStorage);
    assert.equal(response.url, 'https://cdn.example.com/assets/logo.svg');
    assert.equal(response.expiresAt, undefined);
  });

  it('returns presigned read URL and expiration for private storage', async () => {
    const response = await CreateReadUrl(ExistingResourceKey, 120);
    assert.ok(response.url.includes('X-Amz-Signature='));
    assert.ok(response.expiresAt !== undefined);
    assert.ok((response.expiresAt ?? 0) > Date.now());
  });

  it('returns true when the file exists', async () => {
    const exists = await FileExists(ExistingResourceKey);
    assert.equal(exists, true);
  });

  it('returns false when the file does not exist', async () => {
    const exists = await FileExists(MissingResourceKey);
    assert.equal(exists, false);
  });

  it('returns metadata for existing files', async () => {
    const metadata = await GetFileMetadata(ExistingResourceKey);
    assert.equal(metadata.resourceKey, ExistingResourceKey);
    assert.equal(metadata.filename, 'existing.txt');
    assert.equal(metadata.size, 42);
    assert.equal(metadata.mimetype, 'text/plain');
    assert.ok(metadata.lastModified > 0);
    assert.deepEqual(metadata.metadata, {
      filename: 'existing.txt',
      source: 'seed',
    });
  });

  it('throws FileNotFoundError when metadata is requested for a missing file', async () => {
    await assert.rejects(
      () => GetFileMetadata(MissingResourceKey),
      (error: unknown) => error instanceof FileNotFoundError,
    );
  });

  it('deletes files from storage', async () => {
    const existsBeforeDelete = await FileExists(ExistingResourceKey);
    assert.equal(existsBeforeDelete, true);
    await DeleteFile(ExistingResourceKey);
    const existsAfterDelete = await FileExists(ExistingResourceKey);
    assert.equal(existsAfterDelete, false);
  });

  it('defaults metadata filename to empty string when filename metadata is not set', async () => {
    const metadata = await GetFileMetadata(MetadataOnlyResourceKey);
    assert.equal(metadata.filename, '');
    assert.deepEqual(metadata.metadata, { source: 'imported' });
  });
});

function createMockSendMethod(): S3SendMethod {
  return ((command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      return Promise.resolve(handleHeadObjectCommand(command));
    }
    if (command instanceof DeleteObjectCommand) {
      return Promise.resolve(handleDeleteObjectCommand(command));
    }
    return Promise.reject(new Error(`Unexpected S3 command: ${String(command)}`));
  }) as S3SendMethod;
}

function handleHeadObjectCommand(command: HeadObjectCommand): HeadObjectCommandOutput {
  const resourceKey = getCommandResourceKey(command);
  const storedFile = storageByResourceKey.get(resourceKey);
  if (!storedFile) {
    throw createNotFoundError();
  }
  const output: HeadObjectCommandOutput = {
    ContentLength: storedFile.size,
    ContentType: storedFile.mimetype,
    LastModified: storedFile.lastModified,
    $metadata: {},
  };
  if (storedFile.metadata) {
    output.Metadata = storedFile.metadata;
  }
  return output;
}

function handleDeleteObjectCommand(command: DeleteObjectCommand): Record<string, never> {
  const resourceKey = getCommandResourceKey(command);
  storageByResourceKey.delete(resourceKey);
  return {};
}

function getCommandResourceKey(command: SendCommand): string {
  const resourceKey = command.input.Key;
  if (!resourceKey) {
    throw new Error('Missing resource key in S3 command input');
  }
  return resourceKey;
}

function createNotFoundError(): NotFoundErrorShape {
  const error = new Error('Not found') as NotFoundErrorShape;
  error.name = 'NotFound';
  error.$metadata = { httpStatusCode: 404 };
  return error;
}

function resetStorage(): void {
  storageByResourceKey.clear();
  storageByResourceKey.set(ExistingResourceKey, {
    size: 42,
    mimetype: 'text/plain',
    lastModified: new Date('2026-01-01T00:00:00.000Z'),
    metadata: {
      filename: 'existing.txt',
      source: 'seed',
    },
  });
  storageByResourceKey.set(MetadataOnlyResourceKey, {
    size: 64,
    mimetype: 'text/plain',
    lastModified: new Date('2026-01-02T00:00:00.000Z'),
    metadata: {
      source: 'imported',
    },
  });
}
