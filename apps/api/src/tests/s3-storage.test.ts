import { Readable } from 'node:stream';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { createStorageDriver } from '../lib/storage/index.js';
import { StorageUnavailableError } from '../lib/storage/errors.js';
import { S3StorageDriver, createS3StorageKey, sanitizeFilename } from '../lib/storage/s3.js';

const s3Config = {
  endpoint: 'http://minio:9000',
  region: 'us-east-1',
  bucket: 'attachments',
  accessKeyId: 'local-access-key',
  secretAccessKey: 'local-secret-key',
  forcePathStyle: true,
};

function createMockDriver(responses: unknown[] = []) {
  const commands: unknown[] = [];
  const send = vi.fn(async (command: unknown) => {
    commands.push(command);
    if (responses.length > 0) {
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    }
    if (command instanceof GetObjectCommand) {
      return { Body: Readable.from([Buffer.from('attachment contents')]) };
    }
    return {};
  });
  const driver = new S3StorageDriver(s3Config, { send } as unknown as S3Client);
  return { driver, commands, send };
}

describe('S3 storage', () => {
  it('selects local storage by default and names missing S3 configuration', () => {
    const local = createStorageDriver({
      STORAGE_DRIVER: 'local',
      UPLOAD_DIR: '/tmp/project-tracker-test-uploads',
      S3_FORCE_PATH_STYLE: true,
      S3_USE_PRESIGNED_URLS: false,
    });
    expect(local.constructor.name).toBe('LocalStorageDriver');

    expect(() => createStorageDriver({
      STORAGE_DRIVER: 's3',
      UPLOAD_DIR: '/tmp/project-tracker-test-uploads',
      S3_FORCE_PATH_STYLE: true,
      S3_USE_PRESIGNED_URLS: false,
    })).toThrow('S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');

    const s3 = createStorageDriver({
      STORAGE_DRIVER: 's3',
      UPLOAD_DIR: '/tmp/project-tracker-test-uploads',
      S3_FORCE_PATH_STYLE: true,
      S3_USE_PRESIGNED_URLS: false,
      S3_ENDPOINT: s3Config.endpoint,
      S3_REGION: s3Config.region,
      S3_BUCKET: s3Config.bucket,
      S3_ACCESS_KEY_ID: s3Config.accessKeyId,
      S3_SECRET_ACCESS_KEY: s3Config.secretAccessKey,
    });
    expect(s3).toBeInstanceOf(S3StorageDriver);

    expect(() => createStorageDriver({
      STORAGE_DRIVER: 's3',
      UPLOAD_DIR: '/tmp/project-tracker-test-uploads',
      S3_FORCE_PATH_STYLE: true,
      S3_USE_PRESIGNED_URLS: false,
      S3_ENDPOINT: s3Config.endpoint,
      S3_REGION: s3Config.region,
      S3_BUCKET: s3Config.bucket,
      S3_ACCESS_KEY_ID: s3Config.accessKeyId,
    })).toThrow('S3_SECRET_ACCESS_KEY');
  });

  it('generates scoped keys and sanitizes path traversal and control characters', () => {
    const key = createS3StorageKey('item-1', '../../etc/passwd');
    expect(key).toMatch(/^items\/item-1\/[0-9a-f-]{36}-passwd$/);
    expect(sanitizeFilename('/etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\.\\..\\report.txt')).toBe('report.txt');
    expect(sanitizeFilename('.hidden')).toBe('hidden');
    expect(sanitizeFilename('report\u0000.txt')).toBe('report.txt');
    expect(sanitizeFilename(`../${'a'.repeat(200)}.txt`)).toHaveLength(180);
    expect(sanitizeFilename('../../')).toBe('attachment');
  });

  it('checks and creates a missing bucket during initialization', async () => {
    const missingBucket = Object.assign(new Error('not found'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });
    const { driver, commands } = createMockDriver([missingBucket, {}]);

    await driver.initialize();

    expect(commands[0]).toBeInstanceOf(HeadBucketCommand);
    expect(commands[1]).toBeInstanceOf(CreateBucketCommand);
  });

  it('reports a bucket that disappears after startup as unavailable, not a missing object', async () => {
    const missingBucket = Object.assign(new Error('bucket not found'), {
      name: 'NoSuchBucket',
      Code: 'NoSuchBucket',
      $metadata: { httpStatusCode: 404 },
    });
    const { driver } = createMockDriver([{}, missingBucket, missingBucket]);

    await driver.initialize();
    await expect(driver.createReadStream('items/item-1/file.txt')).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(driver.exists('items/item-1/file.txt')).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('delegates upload, download, delete, and existence checks to S3 commands', async () => {
    const { driver, commands } = createMockDriver();
    const storageKey = createS3StorageKey('item-1', 'notes.txt');

    await driver.initialize();
    await driver.save(storageKey, Readable.from([Buffer.from('attachment contents')]), 19);
    const stream = await driver.createReadStream(storageKey);
    await driver.delete(storageKey);
    expect(await driver.exists(storageKey)).toBe(true);

    expect(commands.some((command) => command instanceof PutObjectCommand)).toBe(true);
    expect(commands.some((command) => command instanceof GetObjectCommand)).toBe(true);
    expect(commands.some((command) => command instanceof DeleteObjectCommand)).toBe(true);
    expect(commands.some((command) => command instanceof HeadObjectCommand)).toBe(true);
    expect(stream).toBeInstanceOf(Readable);

    const put = commands.find((command) => command instanceof PutObjectCommand);
    if (put instanceof PutObjectCommand) {
      expect(put.input.Key).toBe(storageKey);
      expect(put.input.ContentLength).toBe(19);
      expect(put.input.Body).toBeInstanceOf(Readable);
    }
  });
});
