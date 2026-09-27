import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../lib/errors.js';

interface Entry {
  count: number;
  resetAt: number;
}

export function rateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  const store = new Map<string, Entry>();

  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.baseUrl || req.path}`;
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      return next(new AppError(429, 'Too many requests, please try again later.'));
    }

    entry.count += 1;
    next();
  };
}
