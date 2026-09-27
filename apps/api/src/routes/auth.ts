import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { z } from 'zod';

import { AUTH_COOKIE_NAME, CSRF_COOKIE_NAME, authCookieOptions, comparePassword, createCsrfToken, csrfCookieOptions, hashPassword, signToken } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(UserRole).optional().default(UserRole.DEVELOPER),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const authRouter = Router();

authRouter.post('/register', asyncHandler(async (req, res) => {
  const input = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, 'Email already registered');
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
    },
  });

  const token = signToken({ userId: user.id, role: user.role });
  const csrfToken = createCsrfToken();
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
  res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions());
  res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user || !(await comparePassword(input.password, user.passwordHash))) {
    throw new AppError(401, 'Invalid credentials');
  }

  const token = signToken({ userId: user.id, role: user.role });
  const csrfToken = createCsrfToken();
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
  res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions());
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions());
  res.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions());
  res.status(204).send();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
