import { describe, expect, it } from 'vitest';

import { isSameMailbox, normalizeEmail, usedAlias } from '../email-normalization.js';

describe('normalizeEmail', () => {
  it('lower-cases and trims', () => {
    expect(normalizeEmail('  Viewer@Example.COM ')).toBe('viewer@example.com');
  });

  it('strips gmail dots and plus tags, and folds googlemail', () => {
    expect(normalizeEmail('first.last@gmail.com')).toBe('firstlast@gmail.com');
    expect(normalizeEmail('firstlast+showfan@gmail.com')).toBe('firstlast@gmail.com');
    expect(normalizeEmail('f.i.r.s.t.last+a+b@googlemail.com')).toBe('firstlast@gmail.com');
  });

  it('strips plus tags on providers that support them, keeping dots', () => {
    expect(normalizeEmail('first.last+tag@outlook.com')).toBe('first.last@outlook.com');
    expect(normalizeEmail('someone+x@icloud.com')).toBe('someone@icloud.com');
  });

  it('folds provider domain aliases', () => {
    expect(normalizeEmail('a@hotmail.com')).toBe('a@outlook.com');
    expect(normalizeEmail('a@live.com')).toBe('a@outlook.com');
    expect(normalizeEmail('a@me.com')).toBe('a@icloud.com');
    expect(normalizeEmail('a@proton.me')).toBe('a@protonmail.com');
  });

  it('leaves unknown providers alone — dots and plus signs may be significant there', () => {
    expect(normalizeEmail('first.last+tag@corporate.example')).toBe(
      'first.last+tag@corporate.example',
    );
  });

  it('keeps genuinely different addresses different', () => {
    expect(normalizeEmail('alice@gmail.com')).not.toBe(normalizeEmail('bob@gmail.com'));
    expect(normalizeEmail('alice@gmail.com')).not.toBe(normalizeEmail('alice@outlook.com'));
  });

  it('handles malformed input without throwing', () => {
    expect(normalizeEmail('not-an-email')).toBe('not-an-email');
    expect(normalizeEmail('@nolocal.com')).toBe('@nolocal.com');
  });
});

describe('isSameMailbox', () => {
  it('detects the alias tricks a duplicate account would rely on', () => {
    expect(isSameMailbox('fan@gmail.com', 'f.a.n+second@gmail.com')).toBe(true);
    expect(isSameMailbox('fan@gmail.com', 'fan2@gmail.com')).toBe(false);
  });
});

describe('usedAlias', () => {
  it('flags a submitted address that is an alias of its canonical form', () => {
    expect(usedAlias('fan+two@gmail.com')).toBe(true);
    expect(usedAlias('fan@gmail.com')).toBe(false);
  });
});
