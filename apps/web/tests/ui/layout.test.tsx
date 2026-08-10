import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '../helpers/render';

import { AnalyticsDashboard } from '@/components/admin/analytics-dashboard';
import { LeaderboardScreen } from '@/components/leaderboard/leaderboard-screen';
import { NotificationAdmin } from '@/components/notifications/notification-admin';
import { PRODUCER } from '../helpers/render';

/**
 * The rules that keep a page from scrolling sideways on a phone.
 *
 * jsdom has no layout engine, so none of this measures pixels — the real
 * measurement is the browser pass. What these guard is the *contract* that two
 * already-shipped overflow bugs violated, so neither can come back quietly:
 *
 *   1. Wide content must sit inside a scroll container. A table declaring
 *      `min-w-[36rem]` in a grid cell pushed a phone viewport 204 px wide.
 *   2. A flex or grid child defaults to `min-width: auto` and refuses to shrink
 *      below its content, which is what stops the inner scroll container ever
 *      scrolling. It needs an explicit `min-w-0`.
 */

const SRC = join(__dirname, '../../src');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

function ancestors(node: Element): Element[] {
  const chain: Element[] = [];
  let current = node.parentElement;
  while (current) {
    chain.push(current);
    current = current.parentElement;
  }
  return chain;
}

const hasClass = (node: Element, needle: string): boolean =>
  typeof node.className === 'string' && node.className.includes(needle);

describe('wide content is always inside a scroll container', () => {
  const CASES: [name: string, render: () => void][] = [
    [
      'notification health',
      () =>
        renderScreen(<NotificationAdmin />, {
          user: PRODUCER,
          routes: {
            '/notifications/admin/health': {
              windowHours: 24,
              events: { pending: 0, processed: 0, failed: 0 },
              notifications: { created: 0, read: 0 },
              channels: [],
              recentFailures: [],
              stuckEvents: [],
            },
          },
        }),
    ],
    [
      'analytics dashboard',
      () =>
        renderScreen(<AnalyticsDashboard />, {
          user: PRODUCER,
          routes: {
            '/analytics/admin/overview': {
              generatedAt: new Date('2026-01-01').toISOString(),
              asOf: '2026-01-01',
              rangeDays: 30,
              stale: false,
              summary: [],
              engagementFunnel: [],
              featureUsage: [],
              contestantTrends: [],
              economy: { pointsEarned: [], pointsSpent: [], redemptions: [] },
              participation: [],
              privacy: { optedOut: 0, totalUsers: 10, coveragePercent: 100 },
            },
            '/analytics/admin/events': [],
          },
        }),
    ],
  ];

  it.each(CASES)('%s keeps every min-width element scrollable and shrinkable', async (
    _name,
    doRender,
  ) => {
    doRender();
    await screen.findByRole('heading', { level: 1 });

    const wide = [...document.querySelectorAll('*')].filter((node) =>
      /min-w-\[/.test(typeof node.className === 'string' ? node.className : ''),
    );

    for (const node of wide) {
      const chain = ancestors(node);

      const scroller = chain.find((parent) => hasClass(parent, 'overflow-x-auto'));
      expect(
        scroller,
        `an element with a min-width has no overflow-x-auto ancestor: ${node.className}`,
      ).toBeDefined();

      // Between the scroller and the page, nothing may refuse to shrink.
      for (const parent of chain.slice(0, chain.indexOf(scroller!))) {
        if (hasClass(parent, 'grid') || hasClass(parent, 'flex')) continue;
        if (!parent.parentElement) continue;
        const inLayout =
          hasClass(parent.parentElement, 'grid') || hasClass(parent.parentElement, 'flex');
        if (inLayout) {
          expect(
            hasClass(parent, 'min-w-0'),
            `a grid/flex child wrapping wide content needs min-w-0: ${parent.className}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('screen-reader tables', () => {
  it('never puts sr-only on the table itself', () => {
    /*
      A `<caption>` is laid out outside the table box and is not reliably
      clipped by the table's own `overflow: hidden`, so `sr-only` on a
      `<table>` leaked the caption into layout and widened the page. The class
      belongs on a wrapping element.
    */
    const offenders: string[] = [];

    for (const file of tsxFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<table[^>]*className="([^"]*)"/g)) {
        if (match[1]!.includes('sr-only')) {
          offenders.push(`${file.replace(SRC, 'src')}: <table className="${match[1]}">`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('horizontally scrolling rows', () => {
  it('lets a chip row scroll rather than widening the page', async () => {
    renderScreen(<LeaderboardScreen />);
    await screen.findByRole('heading', { level: 1 });

    for (const group of screen.getAllByRole('group')) {
      expect(group.className).toContain('overflow-x-auto');
    }
  });
});
