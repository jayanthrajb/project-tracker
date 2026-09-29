import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';

import { AppError } from './errors.js';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function parseJsonField<T>(value: unknown, schema: ZodSchema<T>, fieldName: string) {
  if (typeof value !== 'string') {
    throw new AppError(400, `${fieldName} must be a JSON string`);
  }

  try {
    return schema.parse(JSON.parse(value));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, `Invalid ${fieldName} JSON`);
  }
}
