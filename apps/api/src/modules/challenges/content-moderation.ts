/**
 * Lightweight content screening for user-submitted text.
 *
 * This is a *triage* tool, not a censor. It has two jobs:
 *
 *   - `block`  — refuse outright (slurs, contact harvesting, obvious abuse)
 *   - `flag`   — let it through but mark it for a human moderator
 *
 * Everything ambiguous flags rather than blocks. A false block silently loses a
 * legitimate contribution and the author never learns why, which is a worse
 * failure than a moderator reading one extra item.
 *
 * No text is sent anywhere; this runs in-process on the submitted string only.
 */

export type ScreeningVerdict = 'clean' | 'flag' | 'block';

export interface ScreeningResult {
  verdict: ScreeningVerdict;
  flags: string[];
  /** Human-readable reason, safe to show the author on a block. */
  message: string | null;
}

/**
 * Hard blocks. Deliberately narrow: unambiguous slurs and abuse only.
 * Stored as fragments matched on word boundaries so "assassin" is not a hit.
 */
const BLOCKED_TERMS = [
  'fuck',
  'shit',
  'bitch',
  'bastard',
  'cunt',
  'whore',
  'slut',
  'retard',
  'faggot',
  'nigger',
  'rape',
  'kill yourself',
  'kys',
];

/**
 * Phrases that suggest the submission is trying to organise real-world harm.
 * These block, because "the moderator will catch it" is not good enough when the
 * downside is a contestant being deprived of food, water or sleep on air.
 */
const UNSAFE_PATTERNS = [
  /\b(self[-\s]?harm|suicide)\b/i,
  /\b(starve|starving|dehydrate|dehydrating)\b/i,
  // "without food", "no water", "denied sleep", "go without water", "deprive them of sleep"
  /\b(?:with\s?out|no|denied?|deprived?\s+of)\s+(?:any\s+)?(food|water|sleep|air|oxygen)\b/i,
  /\bdeprive\s+(?:them|him|her|anyone|contestants?)\s+of\b/i,
  /\b(hit|punch|slap|kick|strangle|choke|burn|hurt|injure)\s+(them|him|her|each\s+other|anyone|a\s+contestant)\b/i,
];

const URL_PATTERN = /(https?:\/\/|www\.)\S+/i;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE_PATTERN = /\+?\d[\d\s-]{8,}\d/;
const HANDLE_PATTERN = /(?:^|\s)@[\w.]{3,}/;

export function screenContent(...parts: string[]): ScreeningResult {
  const text = parts.filter(Boolean).join('\n');
  const normalized = normalizeForMatching(text);
  const flags: string[] = [];

  for (const term of BLOCKED_TERMS) {
    if (containsTerm(normalized, term)) {
      return {
        verdict: 'block',
        flags: ['profanity'],
        message: 'Please rewrite this without abusive language.',
      };
    }
  }

  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        verdict: 'block',
        flags: ['unsafe'],
        message:
          'Challenges cannot involve harm, deprivation or anything unsafe for the contestants.',
      };
    }
  }

  // --- spam signals: none of these block on their own ---

  if (URL_PATTERN.test(text)) flags.push('contains-link');
  if (EMAIL_PATTERN.test(text)) flags.push('contains-email');
  if (PHONE_PATTERN.test(text)) flags.push('contains-phone');
  if (HANDLE_PATTERN.test(text)) flags.push('contains-handle');

  const letters = text.replace(/[^a-z]/gi, '');
  if (letters.length >= 20) {
    const upperRatio = (text.match(/[A-Z]/g)?.length ?? 0) / letters.length;
    if (upperRatio > 0.6) flags.push('shouting');
  }

  if (/(.)\1{5,}/.test(text)) flags.push('repeated-characters');
  if (/(\b\w+\b)(\s+\1){3,}/i.test(text)) flags.push('repeated-words');

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 8) {
    const unique = new Set(words.map((word) => word.toLowerCase()));
    if (unique.size / words.length < 0.35) flags.push('low-variety');
  }

  if ((text.match(/[!?]{3,}/g)?.length ?? 0) > 0) flags.push('excessive-punctuation');

  // Two or more independent spam signals is enough to want a human to look.
  const verdict: ScreeningVerdict = flags.length >= 2 ? 'flag' : flags.length === 1 ? 'flag' : 'clean';

  return { verdict, flags, message: null };
}

/**
 * Collapses the common ways people dodge a word list: unicode look-alikes,
 * inserted punctuation, and repeated letters.
 */
function normalizeForMatching(text: string): string {
  return collapseSpacedLetters(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0]/g, 'o')
    .replace(/[1|!]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z\s]/g, '')
    // Repeated letters collapse to one ("shhhiiit" -> "shit"). Blocked terms are
    // put through the same collapse before matching, so the two always agree.
    .replace(/(.)\1+/g, '$1');
}

/**
 * Collapses `s h i t` and `s.h.i.t` back into a word.
 *
 * Only runs of *three or more* single characters are joined, so ordinary short
 * words ("as hit the ball") are left alone.
 */
function collapseSpacedLetters(text: string): string {
  // Anchored on word boundaries at both ends, so the run cannot swallow the tail
  // of the preceding word or the head of the next one — without that, "should
  // s h i t about" collapses to "shouldshitabout" and stops matching at all.
  return text.replace(/\b(?:[a-z0-9]\s*[\s.\-_*]\s*){2,}[a-z0-9]\b/gi, (match) =>
    match.replace(/[\s.\-_*]/g, ''),
  );
}

function containsTerm(normalized: string, term: string): boolean {
  const collapsedTerm = term.replace(/(.)\1+/g, '$1');
  const escaped = collapsedTerm
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s*');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(normalized);
}
