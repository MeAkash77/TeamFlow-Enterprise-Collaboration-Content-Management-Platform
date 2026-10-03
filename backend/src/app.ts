import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorHandler } from './errors.js';
import { authenticate } from './auth.js';
import { metricsMiddleware, registry } from './metrics.js';
import { rateLimit, redis } from './ratelimit.js';
import { pool } from './db.js';
import { publicAuth, userRoutes } from './routes/auth.js';
import { documents } from './routes/documents.js';
import { collab } from './routes/collab.js';
import { integrations, githubHook } from './routes/integrations.js';
import { webhookAdmin } from './routes/webhookAdmin.js';

export function buildApp() {
  const app = express();
  app.set('trust proxy', 1); // behind NGINX
  app.use(helmet());
  app.use(cors({ origin: config.appUrl }));
  app.use(express.json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use(pinoHttp({
    logger, genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
    autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/metrics' },
  }));
  app.use(metricsMiddleware);

  // Liveness / readiness / metrics
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (_req, res) => {
    const db = await pool.query('select 1').then(() => true, () => false);
    const cache = redis.status === 'ready';
    res.status(db ? 200 : 503).json({ status: db ? 'ready' : 'degraded', db, redis: cache });
  });
  app.get('/metrics', async (_req, res) => { res.type(registry.contentType).send(await registry.metrics()); });

  // Public routes
  app.get('/api/health', async (_req, res) => {
    const ok = await pool.query('select 1').then(() => true, () => false);
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'down' });
  });
  app.use('/api', rateLimit);
  app.use('/api/auth', publicAuth);
  app.use('/api/hooks', githubHook);

  // Everything below requires a valid JWT
  app.use('/api', authenticate);
  app.use('/api', userRoutes);
  app.use('/api/documents', documents);
  app.use('/api', collab);
  app.use('/api', integrations);
  app.use('/api/webhook-endpoints', webhookAdmin);

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use(errorHandler);
  return app;
}
