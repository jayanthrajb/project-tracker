import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AppError } from '../lib/errors.js';

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

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: {
        message: error.message,
        details: error.details ?? null,
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
