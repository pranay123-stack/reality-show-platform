'use client';

import { useEffect, useState } from 'react';

import { cn } from '@reality/ui';

/**
 * The room the product sits in.
 *
 * Four layers, painted once behind everything and never interacted with:
 *
 *   1. a deep gradient base — black, through deep purple, into midnight blue
 *   2. ambient glow blobs drifting on long, deliberately unequal periods
 *   3. star dust, low-opacity and slow
 *   4. a broadcast bloom at the top, where the hero sits
 *
 * Everything here is `fixed`, `pointer-events-none` and `aria-hidden`. It is
 * scenery: it must never intercept a click, never appear in the accessibility
 * tree, and never widen the page — which is why it is `fixed` and `inset-0`
 * rather than absolutely positioned inside a scrolling container.
 *
 * On contrast: the layers are tuned so the darkest ambient point stays below
 * the surface colour the cards sit on. Text contrast is unchanged, because
 * every text surface is a card or the base foreground, and neither reads
 * through to this.
 */

/** A blob: position, size, hue and which drift period it rides. */
const BLOBS = [
  {
    className: 'left-[-12%] top-[-8%] h-[46rem] w-[46rem] animate-drift-a',
    tint: 'hsl(var(--neon-pink) / 0.16)',
  },
  {
    className: 'right-[-16%] top-[12%] h-[40rem] w-[40rem] animate-drift-b',
    tint: 'hsl(var(--neon-cyan) / 0.12)',
  },
  {
    className: 'bottom-[-18%] left-[22%] h-[52rem] w-[52rem] animate-drift-c',
    tint: 'hsl(var(--neon-purple) / 0.14)',
  },
] as const;

export function CinematicBackground() {
  const dustCount = useDustCount();

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* 1 — the base gradient. */}
      <div className="absolute inset-0 bg-cinema" />

      {/* 2 — ambient glow. `blur-3xl` on a radial gradient is far cheaper than
          a real blur filter over content, because nothing is behind it. */}
      {BLOBS.map((blob) => (
        <div
          key={blob.className}
          className={cn('absolute rounded-full blur-3xl will-change-transform', blob.className)}
          style={{ background: `radial-gradient(circle, ${blob.tint} 0%, transparent 68%)` }}
        />
      ))}

      {/* 3 — star dust. Two stacked copies of the same field, so the vertical
          drift loops seamlessly instead of snapping back at the end. */}
      {dustCount > 0 && (
        <div className="absolute inset-x-0 top-0 h-[200%] animate-dust will-change-transform">
          <StarField count={dustCount} />
          <StarField count={dustCount} offset />
        </div>
      )}

      {/* 4 — the broadcast bloom over the hero. */}
      <div className="absolute inset-x-0 top-0 h-[42rem] bg-grid-fade opacity-70" />

      {/* A vignette, so the corners fall away and the centre reads first. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,hsl(240_14%_3%_/_0.55)_100%)]" />
    </div>
  );
}

/**
 * How much dust to draw.
 *
 * None until mounted, so the server and the first client render agree — a
 * random field rendered on the server would mismatch and log a hydration error.
 * Fewer on a phone, where the same count costs more and shows less.
 */
function useDustCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    setCount(window.innerWidth < 640 ? 18 : 46);
  }, []);

  return count;
}

/**
 * A field of particles as one element.
 *
 * Drawn with `box-shadow` rather than N divs: a single 1×1 element carrying
 * forty shadows is one paint and one node, where forty absolutely-positioned
 * divs are forty of each. Positions come from a fixed seed so the field is
 * stable between renders.
 */
function StarField({ count, offset = false }: { count: number; offset?: boolean }) {
  const shadows = Array.from({ length: count }, (_, index) => {
    // A cheap deterministic scatter — no randomness, so no hydration mismatch.
    const x = ((index * 3739) % 1000) / 10;
    const y = ((index * 6113) % 1000) / 10;
    const dim = index % 3 === 0;
    return `${x}vw ${y}vh 0 ${dim ? '0px' : '0.5px'} hsl(0 0% 100% / ${dim ? 0.16 : 0.3})`;
  }).join(', ');

  return (
    <div
      className={cn('absolute left-0 h-px w-px rounded-full', offset ? 'top-1/2' : 'top-0')}
      style={{ boxShadow: shadows }}
    />
  );
}
