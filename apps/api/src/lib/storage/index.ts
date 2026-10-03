import { env } from '../env.js';

import type { StorageDriver } from './driver.js';
import { LocalStorageDriver } from './local.js';
import { S3StorageDriver } from './s3.js';

export interface StorageConfig {
  STORAGE_DRIVER: 'local' | 's3';
  UPLOAD_DIR: string;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_FORCE_PATH_STYLE: boolean;
  S3_USE_PRESIGNED_URLS: boolean;
  S3_PUBLIC_URL?: string;
}

export function createStorageDriver(config: StorageConfig): StorageDriver {
  if (config.STORAGE_DRIVER === 'local') return new LocalStorageDriver(config.UPLOAD_DIR);

  const required: Array<
    'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY'
  > = [
    'S3_ENDPOINT',
    'S3_REGION',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ];
  const missing = required.filter((key) => !config[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `STORAGE_DRIVER=s3 requires ${missing.join(', ')}. Set these variables in the API environment before starting.`,
    );
  }

  return new S3StorageDriver({
    endpoint: config.S3_ENDPOINT!,
    region: config.S3_REGION!,
    bucket: config.S3_BUCKET!,
    accessKeyId: config.S3_ACCESS_KEY_ID!,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    publicUrl: config.S3_PUBLIC_URL || undefined,
  });
}

export const storage = createStorageDriver(env);

export async function initializeStorage() {
  if (!(storage instanceof S3StorageDriver)) return;
  try {
    await storage.initialize();
  } catch (error) {
    console.error('[storage] S3 bucket bootstrap failed; attachment requests will return 503 until storage is available.', error);
  }
}
