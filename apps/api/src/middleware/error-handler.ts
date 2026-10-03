import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';

import { AppError } from '../lib/errors.js';
import { StorageUnavailableError } from '../lib/storage/errors.js';

export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction) {
  void next;
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        message: 'Validation failed',
        details: error.issues,
      },
    });
  }

  if (error instanceof StorageUnavailableError) {
    error = new AppError(503, error.message);
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: {
        message: error.message,
        details: error.details ?? null,
      },
    });
  }

  if (error instanceof multer.MulterError) {
    const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(statusCode).json({
      error: {
        message: error.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file exceeds the 10 MB limit' : 'Invalid file upload',
        details: null,
      },
    });
  }

  console.error(error);
  return res.status(500).json({
    error: {
      message: 'Internal server error',
      details: null,
    },
  });
}
