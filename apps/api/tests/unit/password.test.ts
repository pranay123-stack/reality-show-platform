import { describe, expect, it } from 'vitest';

import { hashPassword, needsRehash, verifyPassword } from '../../src/core/password.js';

describe('password hashing', () => {
  it('produces a versioned, parameterised encoding', async () => {
    const hash = await hashPassword('correct horse battery staple');
    const [scheme, N, r, p, keylen, salt, digest] = hash.split('$');

    expect(scheme).toBe('scrypt');
    expect(Number(N)).toBe(2 ** 15);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(Number(keylen)).toBe(64);
    expect(salt).toBeTruthy();
    expect(digest).toBeTruthy();
  });

  it('never stores the password itself', async () => {
    const password = 'a-very-memorable-passphrase';
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same-password-twice'),
      hashPassword('same-password-twice'),
    ]);
    expect(first).not.toBe(second);
    expect(await verifyPassword('same-password-twice', first)).toBe(true);
    expect(await verifyPassword('same-password-twice', second)).toBe(true);
  });

  it('accepts the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct-password-1');
    expect(await verifyPassword('correct-password-1', hash)).toBe(true);
    expect(await verifyPassword('correct-password-2', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('normalises unicode so the same typed password always matches', async () => {
    const composed = 'passwörd-café-123'.normalize('NFC');
    const decomposed = 'passwörd-café-123'.normalize('NFD');
    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });

  it('returns false rather than throwing for a corrupted stored value', async () => {
    for (const broken of ['', 'not-a-hash', 'scrypt$1$2$3', 'scrypt$0$8$1$64$aaaa$bbbb']) {
      expect(await verifyPassword('anything', broken)).toBe(false);
    }
  });

  it('refuses absurd parameters that could be used as a resource-exhaustion vector', async () => {
    const hostile = `scrypt$${2 ** 22}$64$32$64$${Buffer.from('salt').toString('base64')}$${Buffer.alloc(64).toString('base64')}`;
    expect(await verifyPassword('anything', hostile)).toBe(false);
  });

  it('flags weaker stored parameters for a transparent upgrade', async () => {
    expect(needsRehash(await hashPassword('current-policy-password'))).toBe(false);
    expect(needsRehash('scrypt$16384$8$1$64$c2FsdA==$aGFzaA==')).toBe(true);
    expect(needsRehash('bcrypt$whatever')).toBe(true);
  });
});
