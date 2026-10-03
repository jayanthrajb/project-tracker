import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { PresignedDownloadOptions, StorageDriver } from './driver.js';
import { StorageObjectNotFoundError, StorageUnavailableError } from './errors.js';

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicUrl?: string;
}

const STORAGE_UNAVAILABLE_MESSAGE =
  'Attachment storage is unavailable. Check the S3 endpoint, bucket, credentials, and bucket permissions, then retry.';

function getErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('Code' in error && typeof error.Code === 'string') return error.Code;
  if ('name' in error && typeof error.name === 'string') return error.name;
  return undefined;
}

function getHttpStatus(error: unknown) {
  if (typeof error !== 'object' || error === null || !('$metadata' in error)) return undefined;
  const metadata = error.$metadata;
  if (typeof metadata !== 'object' || metadata === null || !('httpStatusCode' in metadata)) return undefined;
  return typeof metadata.httpStatusCode === 'number' ? metadata.httpStatusCode : undefined;
}

function isObjectNotFound(error: unknown) {
  const code = getErrorCode(error);
  if (code === 'NoSuchBucket') return false;
  return getHttpStatus(error) === 404 || ['NotFound', 'NoSuchKey'].includes(code ?? '');
}

function isMissingBucket(error: unknown) {
  return getHttpStatus(error) === 404 || ['NotFound', 'NoSuchBucket'].includes(getErrorCode(error) ?? '');
}

function isBucketAlreadyCreated(error: unknown) {
  return ['BucketAlreadyExists', 'BucketAlreadyOwnedByYou'].includes(getErrorCode(error) ?? '');
}

export function sanitizeFilename(filename: string) {
  const basename = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  const sanitized = basename
    .normalize('NFKC')
    .replace(/\p{Cc}/gu, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 180);
  return sanitized || 'attachment';
}

export function createS3StorageKey(itemId: string, filename: string) {
  const safeItemId = itemId.replace(/[^A-Za-z0-9_-]/g, '_');
  if (!safeItemId) throw new Error('Invalid item ID for attachment storage');
  return `items/${safeItemId}/${randomUUID()}-${sanitizeFilename(filename)}`;
}

export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;
  private readonly presignerClient: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private ready = false;
  private initialization: Promise<void> | undefined;

  constructor(config: S3StorageConfig, client?: S3Client) {
    const clientConfig = {
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    this.client = client ?? new S3Client(clientConfig);
    this.presignerClient = config.publicUrl
      ? new S3Client({ ...clientConfig, endpoint: config.publicUrl })
      : this.client;
    this.bucket = config.bucket;
    this.region = config.region;
  }

  async initialize() {
    if (this.ready) return;
    if (!this.initialization) {
      this.initialization = this.bootstrapBucket()
        .then(() => {
          this.ready = true;
        })
        .catch((error: unknown) => {
          throw new StorageUnavailableError(STORAGE_UNAVAILABLE_MESSAGE, { cause: error });
        })
        .finally(() => {
          this.initialization = undefined;
        });
    }
    return this.initialization;
  }

  private async bootstrapBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      console.info(`[storage] S3 bucket "${this.bucket}" exists`);
    } catch (error) {
      if (!isMissingBucket(error)) throw error;
      try {
        await this.client.send(new CreateBucketCommand({
          Bucket: this.bucket,
          ...(this.region === 'us-east-1'
            ? {}
            : {
                CreateBucketConfiguration: {
                  LocationConstraint: this.region as BucketLocationConstraint,
                },
              }),
        }));
        console.info(`[storage] Created S3 bucket "${this.bucket}"`);
      } catch (createError) {
        if (!isBucketAlreadyCreated(createError)) throw createError;
        console.info(`[storage] S3 bucket "${this.bucket}" was created by another instance`);
      }
    }
  }

  private async ensureReady() {
    await this.initialize();
  }

  async save(storageKey: string, content: Readable, sizeBytes: number) {
    await this.ensureReady();
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: content,
        ContentLength: sizeBytes,
      }));
    } catch (error) {
      throw new StorageUnavailableError(STORAGE_UNAVAILABLE_MESSAGE, { cause: error });
    }
  }

  async createReadStream(storageKey: string) {
    await this.ensureReady();
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      }));
      if (!(response.Body instanceof Readable)) {
        throw new StorageUnavailableError('S3 returned no readable attachment stream.');
      }
      return response.Body;
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw error;
      if (isObjectNotFound(error)) throw new StorageObjectNotFoundError();
      throw new StorageUnavailableError(STORAGE_UNAVAILABLE_MESSAGE, { cause: error });
    }
  }

  async delete(storageKey: string) {
    await this.ensureReady();
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      }));
    } catch (error) {
      throw new StorageUnavailableError(STORAGE_UNAVAILABLE_MESSAGE, { cause: error });
    }
  }

  async exists(storageKey: string) {
    await this.ensureReady();
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      }));
      return true;
    } catch (error) {
      if (isObjectNotFound(error)) return false;
      throw new StorageUnavailableError(STORAGE_UNAVAILABLE_MESSAGE, { cause: error });
    }
  }

  async createPresignedDownloadUrl(storageKey: string, options?: PresignedDownloadOptions) {
    await this.ensureReady();
    try {
      return await getSignedUrl(
        this.presignerClient,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          ...(options
            ? {
                ResponseContentType: options.mimeType,
                ResponseContentDisposition: `attachment; filename="${options.filename}"`,
              }
            : {}),
        }),
        { expiresIn: 300 },
      );
    } catch (error) {
      throw new StorageUnavailableError(STORAGE_UNAVAILABLE_MESSAGE, { cause: error });
    }
  }
}
