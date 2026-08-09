/**
 * Email canonicalisation for duplicate-account prevention.
 *
 * The requirement is that a user cannot open a second ordinary account simply by
 * changing their email address. The cheapest way to do that is with provider
 * aliases (`name+tag@`, `n.a.m.e@gmail.com`), so the canonical form strips them
 * and the canonical form carries the unique index.
 *
 * Deliberately conservative: it only removes aliasing that the provider itself
 * treats as the same mailbox. Two genuinely different addresses stay different.
 */

/** Providers where `+tag` and dots in the local part route to the same mailbox. */
const DOT_INSENSITIVE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/** Providers that support `+tag` (or `-tag`) sub-addressing. */
const PLUS_ALIAS_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'yahoo.com',
  'protonmail.com',
  'proton.me',
  'fastmail.com',
  'zoho.com',
  'yandex.com',
]);

/** Domains that are the same mailbox under a different name. */
const DOMAIN_ALIASES: Record<string, string> = {
  'googlemail.com': 'gmail.com',
  'hotmail.com': 'outlook.com',
  'live.com': 'outlook.com',
  'me.com': 'icloud.com',
  'proton.me': 'protonmail.com',
};

export function normalizeEmail(rawEmail: string): string {
  const email = rawEmail.trim().toLowerCase();
  const separator = email.lastIndexOf('@');
  if (separator <= 0) return email;

  let local = email.slice(0, separator);
  const domain = email.slice(separator + 1);

  if (PLUS_ALIAS_DOMAINS.has(domain)) {
    const plus = local.indexOf('+');
    if (plus > 0) local = local.slice(0, plus);
  }

  if (DOT_INSENSITIVE_DOMAINS.has(domain)) {
    local = local.replaceAll('.', '');
  }

  const canonicalDomain = DOMAIN_ALIASES[domain] ?? domain;
  return `${local}@${canonicalDomain}`;
}

/** True when two addresses resolve to the same real mailbox. */
export function isSameMailbox(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}

/** True when the submitted address used an alias of its canonical form. */
export function usedAlias(rawEmail: string): boolean {
  return rawEmail.trim().toLowerCase() !== normalizeEmail(rawEmail);
}
