import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootEnvPath = path.resolve(currentDir, '../../../../.env');
const apiEnvPath = path.resolve(currentDir, '../../.env');

const loadedEnvFiles: string[] = [];

if (existsSync(repoRootEnvPath)) {
  dotenv.config({ path: repoRootEnvPath, override: false });
  loadedEnvFiles.push(repoRootEnvPath);
}

if (existsSync(apiEnvPath)) {
  dotenv.config({ path: apiEnvPath, override: true });
  loadedEnvFiles.push(apiEnvPath);
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  S3_USE_PRESIGNED_URLS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  S3_PUBLIC_URL: z.string().optional(),
  NOTIFICATION_SCAN_INTERVAL_MS: z.coerce.number().int().min(0).default(15 * 60 * 1000),
});

export const env = envSchema.parse(process.env);

export const envLoadMeta = {
  loadedEnvFiles,
};

export function getDatabaseConnectionMeta(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname.replace(/^\//, '') || 'unknown',
    };
  } catch {
    return {
      host: 'unknown',
      port: 'unknown',
      database: 'unknown',
    };
  }
}
