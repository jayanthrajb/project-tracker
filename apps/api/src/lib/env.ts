import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

dotenv.config();

if (!process.env.DATABASE_URL) {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(currentDir, '../../../.env') });
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const env = envSchema.parse(process.env);
