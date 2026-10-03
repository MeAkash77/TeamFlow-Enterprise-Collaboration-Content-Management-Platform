const e = process.env;
export const config = {
  env: e.NODE_ENV || 'development',
  port: Number(e.PORT || 4000),
  databaseUrl: e.DATABASE_URL || 'postgres://teamflow:teamflow@localhost:5432/teamflow',
  redisUrl: e.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: e.JWT_SECRET || 'dev-secret-change-me',
  jwtTtl: e.JWT_TTL || '1h',
  // 32-byte hex key (64 chars) used for AES-256-GCM encryption of stored integration tokens
  encryptionKey: e.ENCRYPTION_KEY || '0'.repeat(64),
  auditUrl: e.AUDIT_URL || 'http://localhost:8081',
  auditKey: e.AUDIT_API_KEY || 'dev-audit-key',
  appUrl: e.APP_URL || 'http://localhost:8080',
  rateLimit: { windowSec: Number(e.RATE_WINDOW_SEC || 60), max: Number(e.RATE_MAX || 600) },
  github: { clientId: e.GITHUB_CLIENT_ID || '', clientSecret: e.GITHUB_CLIENT_SECRET || '' },
};
if (config.env === 'production' && (config.jwtSecret === 'dev-secret-change-me' || /^0+$/.test(config.encryptionKey))) {
  throw new Error('Refusing to start in production with default JWT_SECRET / ENCRYPTION_KEY');
}
