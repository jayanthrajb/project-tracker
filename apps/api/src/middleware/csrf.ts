import type { NextFunction, Request, Response } from 'express';

import { AUTH_COOKIE_NAME, CSRF_COOKIE_NAME } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  if (
    SAFE_METHODS.has(req.method) ||
    req.path === '/auth/login' ||
    req.path === '/auth/register' ||
    !req.cookies[AUTH_COOKIE_NAME]
  ) {
    return next();
  }

  const csrfCookie = req.cookies[CSRF_COOKIE_NAME];
  const csrfHeader = req.header('x-csrf-token');

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return next(new AppError(403, 'Invalid CSRF token'));
  }

  next();
}
