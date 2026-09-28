import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { env } from './lib/env.js';
import { requireCsrf } from './middleware/csrf.js';
import { errorHandler } from './middleware/error-handler.js';
import { rateLimit } from './middleware/rate-limit.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { itemsRouter } from './routes/items.js';
import { projectsRouter } from './routes/projects.js';
import { usersRouter } from './routes/users.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use('/api', requireCsrf);
  app.use('/api', rateLimit({ windowMs: 60_000, max: 300 }));
  app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 30 }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/items', itemsRouter);
  app.use('/api/dashboard', dashboardRouter);

  app.use(errorHandler);

  return app;
}
