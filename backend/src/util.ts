const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { HttpError } from './errors.js';

export function uuid(v: unknown): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpError(400, 'invalid_id');
  return v;
}
/** @alice.smith → ["alice.smith"] (matched against the local-part of user emails) */
export function parseMentions(text: string): string[] {
  return [...new Set([...text.matchAll(/(?:^|\s)@([a-z0-9][a-z0-9._-]{1,40})/gi)].map((m) => m[1].toLowerCase()))];
}
/** "fixes DOC-1a2b3c4d" → ["1a2b3c4d"] — used to auto-link commits/PRs to documents */
export function extractDocRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/DOC-([0-9a-f]{8})/gi)].map((m) => m[1].toLowerCase()))];
}
