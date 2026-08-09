import { NOTIFICATION_EVENT_KEYS, typeForEvent } from '@reality/shared';
import { describe, expect, it } from 'vitest';

import { DEFAULT_TEMPLATES, defaultTemplateFor, render } from '../templates.js';

describe('template rendering', () => {
  it('substitutes a placeholder', () => {
    expect(render('Hello {{name}}', { name: 'Priya' })).toBe('Hello Priya');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(render('Hello {{ name }}', { name: 'Rahul' })).toBe('Hello Rahul');
  });

  it('formats numbers for reading, not for machines', () => {
    expect(render('{{points}} points', { points: 10_420 })).toBe('10,420 points');
  });

  it('drops an unknown placeholder rather than printing braces', () => {
    // A stray `{{reason}}` on screen is worse than a slightly terse sentence.
    expect(render('Rejected. {{reason}}', {})).toBe('Rejected.');
  });

  it('drops a null value the same way', () => {
    expect(render('Result: {{answer}}', { answer: null })).toBe('Result:');
  });

  it('collapses the gap a missing placeholder leaves behind', () => {
    expect(render('{{a}} and {{b}} together', { b: 'B' })).toBe('and B together');
  });

  it('leaves a template with no placeholders alone', () => {
    expect(render('Nothing to fill in', { anything: 1 })).toBe('Nothing to fill in');
  });
});

describe('the template catalogue', () => {
  it('covers every event in the catalogue', () => {
    // A missing template means a real user gets "Something happened on your
    // account", so this is worth asserting rather than assuming.
    for (const event of NOTIFICATION_EVENT_KEYS) {
      expect(DEFAULT_TEMPLATES[event], `no template for ${event}`).toBeDefined();
    }
  });

  it('files every template under the same type its event declares', () => {
    for (const event of NOTIFICATION_EVENT_KEYS) {
      expect(DEFAULT_TEMPLATES[event].type, event).toBe(typeForEvent(event));
    }
  });

  it('gives an unknown event a usable fallback instead of throwing', () => {
    const template = defaultTemplateFor('something.nobody.defined');
    expect(template.type).toBe('SYSTEM');
    expect(template.title.length).toBeGreaterThan(0);
    expect(template.body.length).toBeGreaterThan(0);
  });

  it('never leaves a template body empty', () => {
    for (const event of NOTIFICATION_EVENT_KEYS) {
      expect(DEFAULT_TEMPLATES[event].body.trim().length).toBeGreaterThan(0);
    }
  });
});
