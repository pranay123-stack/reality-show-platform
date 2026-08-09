import { describe, expect, it } from 'vitest';

import { screenContent } from '../content-moderation.js';

describe('screenContent', () => {
  it('passes ordinary challenge text', () => {
    const result = screenContent(
      'Silent breakfast',
      'The house must prepare and eat breakfast together without speaking a single word.',
    );
    expect(result.verdict).toBe('clean');
    expect(result.flags).toEqual([]);
  });

  it('blocks abusive language and says why', () => {
    const result = screenContent('Task idea', 'Make that idiot eat shit on camera');
    expect(result.verdict).toBe('block');
    expect(result.flags).toContain('profanity');
    expect(result.message).toBeTruthy();
  });

  it('sees through simple obfuscation', () => {
    for (const attempt of ['sh1t', 's h i t', 'shhhiiit', 'f*u*c*k']) {
      const result = screenContent('Title here', `They should ${attempt} about it`);
      expect(result.verdict, attempt).toBe('block');
    }
  });

  it('does not block innocent words that merely contain a blocked fragment', () => {
    const result = screenContent(
      'Assassin themed night',
      'A murder-mystery style evening where contestants work out who the assassin is.',
    );
    expect(result.verdict).not.toBe('block');
  });

  it('blocks anything that would harm or deprive a contestant', () => {
    const cases = [
      'Make them go without water for a full day',
      'Deprive them of sleep until someone quits',
      'They should punch each other for the task',
    ];
    for (const description of cases) {
      const result = screenContent('Task', description);
      expect(result.verdict, description).toBe('block');
      expect(result.flags).toContain('unsafe');
    }
  });

  it('flags rather than blocks contact details and links', () => {
    const withLink = screenContent('Follow me', 'Check out https://example.com for more ideas');
    expect(withLink.verdict).toBe('flag');
    expect(withLink.flags).toContain('contains-link');

    const withEmail = screenContent('Contact', 'Email me at someone@example.com to collaborate');
    expect(withEmail.flags).toContain('contains-email');
  });

  it('flags shouting and repetition', () => {
    const shouting = screenContent('BIG TASK IDEA', 'THIS IS THE BEST CHALLENGE EVER MADE HERE');
    expect(shouting.flags).toContain('shouting');

    const repeated = screenContent('Task', 'vote vote vote vote vote for this one please');
    expect(repeated.flags).toContain('repeated-words');

    const chars = screenContent('Task', 'This is soooooooo good you have to pick it now');
    expect(chars.flags).toContain('repeated-characters');
  });

  it('never blocks on spam signals alone — a human decides', () => {
    const result = screenContent('CHECK THIS OUT!!!', 'https://example.com vote vote vote vote vote');
    expect(result.verdict).toBe('flag');
    expect(result.message).toBeNull();
  });
});
