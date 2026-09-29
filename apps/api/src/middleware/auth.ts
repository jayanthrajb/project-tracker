import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@prisma/client';

import { AUTH_COOKIE_NAME, verifyToken } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

export interface RequestUser {
  id: string;
  role: UserRole;
  name: string;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: RequestUser;
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies[AUTH_COOKIE_NAME];
  if (!token) {
    return next(new AppError(401, 'Authentication required'));
  }

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) {
      return next(new AppError(401, 'User not found or inactive'));
    }

    req.user = { id: user.id, role: user.role, name: user.name, email: user.email };
    next();
  } catch {
    next(new AppError(401, 'Invalid session'));
  }
}

export function requireRole(roles: UserRole | UserRole[]) {
  const acceptedRoles = Array.isArray(roles) ? roles : [roles];
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !acceptedRoles.includes(req.user.role)) {
      return next(new AppError(403, 'Insufficient permissions'));
    }
    next();
  };
}
