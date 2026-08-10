import type { Variants } from 'framer-motion';

/**
 * The motion vocabulary.
 *
 * Two rules shaped all of it. Motion here exists to explain a change — where a
 * thing came from, that it is live, that a number moved — and never to be
 * noticed for itself. And nothing bounces, spins or overshoots: this sits
 * behind a live broadcast, where the show is the thing moving and the interface
 * is not competing with it.
 *
 * `prefers-reduced-motion` is honoured globally in `globals.css`, which
 * collapses every duration to near zero. `useReducedMotion` is used on the
 * few surfaces where "instant" is not enough and the effect should be absent.
 */

/** Decelerating, never overshooting. The house easing. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.6, ease: EASE_OUT } },
};

/**
 * A scene arriving: out of focus, then resolving.
 *
 * The blur is what makes a section read as a *cut* rather than a scroll. It is
 * deliberately small — 6px, over half a second — because anything more looks
 * like a rendering fault before it looks like an effect, and because animating
 * `filter` is the most expensive thing on this page. It is used on section
 * openers only, never on a list of eight cards.
 */
export const sceneReveal: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.65, ease: EASE_OUT },
  },
};

/**
 * A container whose children arrive in sequence.
 *
 * 60 ms is the gap that reads as "these belong together and arrived in order".
 * Much longer and a grid of eight cards becomes a queue the reader waits in.
 */
export const stagger: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

/**
 * A title card word: out of focus and slightly oversized, resolving into place.
 *
 * The scale is the part that makes it read as a *title* rather than a fade —
 * 1.06 is barely visible frame to frame but unmistakable as a settling motion,
 * which is what a broadcast opening does.
 */
export const titleWord: Variants = {
  hidden: { opacity: 0, y: '0.35em', scale: 1.06, filter: 'blur(8px)' },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.7, ease: EASE_OUT },
  },
};

/**
 * A word arriving without moving.
 *
 * For text carrying a clipped background: any transform composites the word
 * separately and it drags its slice of the gradient along with it.
 */
export const wordFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5, ease: EASE_OUT } },
};

export const wordStagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.045 } },
};

/**
 * The card hover.
 *
 * Scale and lift together, because lift alone reads as a shadow bug on a large
 * card. 1.02 is deliberately small — at 1.05 the text visibly resamples.
 */
export const cardHover = {
  scale: 1.02,
  y: -6,
  transition: { duration: 0.25, ease: EASE_OUT },
} as const;

/** Only ever applied to a section, so it animates once on the way in. */
export const viewportOnce = { once: true, amount: 0.25 } as const;
