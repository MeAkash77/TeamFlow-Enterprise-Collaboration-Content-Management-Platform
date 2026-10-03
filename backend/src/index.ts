import { buildApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { redis } from './ratelimit.js';
import { startWebhookWorker } from './webhooks.js';

redis.connect().catch(() => logger.warn('redis unavailable; rate limiting disabled until it recovers'));
const stopWorker = startWebhookWorker();
const server = buildApp().listen(config.port, () => logger.info({ port: config.port }, 'teamflow api listening'));

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  stopWorker();
  server.close(async () => { await pool.end(); redis.disconnect(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
