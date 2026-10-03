import { describe, expect, it } from 'vitest';
import { parseMentions, extractDocRefs } from '../src/util';
import { decrypt, encrypt, safeEqual, sign } from '../src/crypto';
import { ROLE_RANK } from '../src/auth';

describe('util', () => {
  it('parses unique mentions', () => {
    expect(parseMentions('hi @Alice.Smith and @bob, @alice.smith again')).toEqual(['alice.smith', 'bob']);
  });
  it('ignores email addresses', () => expect(parseMentions('mail me a@b.com')).toEqual([]));
  it('extracts doc refs from commit messages', () => {
    expect(extractDocRefs('fix: update DOC-1a2b3c4d and DOC-1A2B3C4D')).toEqual(['1a2b3c4d']);
  });
});
describe('crypto', () => {
  it('round-trips AES-GCM', () => expect(decrypt(encrypt('ghp_secret'))).toBe('ghp_secret'));
  it('detects tampering', () => {
    const [iv, tag, enc] = encrypt('x').split('.');
    expect(() => decrypt([iv, tag, Buffer.from('zz').toString('base64')].join('.'))).toThrow();
    expect(enc).toBeTruthy();
  });
  it('verifies webhook signatures', () => {
    const s = sign('secret', '{"a":1}');
    expect(safeEqual(s, sign('secret', '{"a":1}'))).toBe(true);
    expect(safeEqual(s, sign('other', '{"a":1}'))).toBe(false);
  });
});
describe('rbac', () => it('orders roles', () => expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.editor)));
