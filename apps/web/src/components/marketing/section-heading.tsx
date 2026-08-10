'use client';

import { cn } from '@reality/ui';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

import { fadeUp, sceneReveal, stagger, viewportOnce } from '@/lib/motion';

/**
 * How every section on the marketing surface opens.
 *
 * The page's real problem was not the type scale — it was that each section
 * argued its case in a paragraph. A visitor scanning a broadcast product does
 * not read three sentences about server authority; they want to know what this
 * is and whether it is happening now.
 *
 * So `kicker` is two short lines, and the type enforces it: `max-w-md` and a
 * size that makes a third line obvious in review. There is nowhere to put a
 * paragraph, which is the point. The technical claims that used to live here
 * are still made — on the pages where somebody has chosen to care.
 */

export interface SectionHeadingProps {
  eyebrow: string;
  title: ReactNode;
  /** Two lines at most. Write it as two if it wants to be two. */
  kicker?: ReactNode;
  /** An action aligned to the end on wide screens. */
  action?: ReactNode;
  tone?: 'pink' | 'cyan' | 'purple' | 'gold';
  align?: 'start' | 'center';
  className?: string;
}

const TONE = {
  pink: 'text-neon-pink',
  cyan: 'text-neon-cyan',
  purple: 'text-neon-purple',
  gold: 'text-neon-gold',
} as const;

export function SectionHeading({
  eyebrow,
  title,
  kicker,
  action,
  tone = 'pink',
  align = 'start',
  className,
}: SectionHeadingProps) {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      whileInView="visible"
      viewport={viewportOnce}
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-8 gap-y-5',
        align === 'center' && 'flex-col items-center text-center',
        className,
      )}
    >
      <div className={cn('min-w-0 space-y-3', align === 'center' && 'flex flex-col items-center')}>
        <motion.p variants={fadeUp} className={cn('label-broadcast', TONE[tone])}>
          {eyebrow}
        </motion.p>

        <motion.h2 variants={sceneReveal} className="text-headline text-balance uppercase">
          {title}
        </motion.h2>

        {kicker && (
          <motion.p variants={fadeUp} className="max-w-md text-lg leading-snug text-muted">
            {kicker}
          </motion.p>
        )}
      </div>

      {action && (
        <motion.div variants={fadeUp} className="shrink-0">
          {action}
        </motion.div>
      )}
    </motion.div>
  );
}

/**
 * Section padding.
 *
 * One constant rather than `py-20` repeated nine times, because the previous
 * pass left the mobile and desktop rhythm identical at 80px — which is airy on
 * a laptop and an enormous amount of scrolling on a phone.
 */
export const SECTION_PADDING = 'py-14 sm:py-20 lg:py-24';
