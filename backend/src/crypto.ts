import crypto from 'node:crypto';
import { config } from './config.js';

const key = () => Buffer.from(config.encryptionKey, 'hex');

/** AES-256-GCM: returns iv.tag.ciphertext (base64) */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
/** HMAC-SHA256 signature in GitHub's `sha256=<hex>` format. */
export const sign = (secret: string, body: Buffer | string) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export const randomSecret = () => crypto.randomBytes(24).toString('hex');
