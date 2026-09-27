import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { env } from './env.js';

const TOKEN_NAME = 'project_tracker_token';

export interface AuthTokenPayload {
  userId: string;
  role: 'ADMIN' | 'MANAGER' | 'DEVELOPER';
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: false,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export const AUTH_COOKIE_NAME = TOKEN_NAME;
