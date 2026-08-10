import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Every colour resolves to a CSS variable declared in `@reality/ui/styles.css`,
 * so themes swap without rebuilding and alpha modifiers (`bg-surface/60`) work.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './src/**/*.{ts,tsx,mdx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1rem', sm: '1.5rem', lg: '2rem' },
      screens: { '2xl': '1360px' },
    },
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        surface: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          raised: 'hsl(var(--surface-raised) / <alpha-value>)',
          overlay: 'hsl(var(--surface-overlay) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'hsl(var(--border) / <alpha-value>)',
          strong: 'hsl(var(--border-strong) / <alpha-value>)',
        },
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
          muted: 'hsl(var(--primary-muted) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger) / <alpha-value>)',
          foreground: 'hsl(var(--danger-foreground) / <alpha-value>)',
        },
        live: 'hsl(var(--live) / <alpha-value>)',
        /* Neon hues used only by the marketing feature cards' colour themes. */
        neon: {
          pink: 'hsl(var(--neon-pink) / <alpha-value>)',
          cyan: 'hsl(var(--neon-cyan) / <alpha-value>)',
          purple: 'hsl(var(--neon-purple) / <alpha-value>)',
          gold: 'hsl(var(--neon-gold) / <alpha-value>)',
        },
        heat: {
          1: 'hsl(var(--heat-1) / <alpha-value>)',
          2: 'hsl(var(--heat-2) / <alpha-value>)',
          3: 'hsl(var(--heat-3) / <alpha-value>)',
          4: 'hsl(var(--heat-4) / <alpha-value>)',
          5: 'hsl(var(--heat-5) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'ui-sans-serif', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      /*
        Three tiers and nothing between them.
        
        The page had drifted into using four display sizes interchangeably,
        which is why every section read at the same volume — and why it felt
        like an article rather than a broadcast. `display` is for the two or
        three moments that carry the whole page; `headline` opens a section;
        everything else is body text, capped at 18px.

        All three are fluid, so the mobile and desktop ends of each range are
        chosen deliberately rather than falling out of a breakpoint.
      */
      fontSize: {
        /** Hero and section-hero only. 40px → 96px. */
        display: ['clamp(2.5rem, 6.4vw, 6rem)', { lineHeight: '0.98', letterSpacing: '-0.035em' }],
        /** Section openers. 32px → 48px. */
        headline: ['clamp(2rem, 3.4vw, 3rem)', { lineHeight: '1.05', letterSpacing: '-0.025em' }],

        /*
          Kept for the application shell, whose page titles sit above dense
          tables and would be absurd at 48px. The marketing surface does not
          use these.
        */
        'display-xl': ['clamp(2.75rem, 6vw, 4.5rem)', { lineHeight: '1.03', letterSpacing: '-0.03em' }],
        'display-lg': ['clamp(2.25rem, 4.5vw, 3.25rem)', { lineHeight: '1.06', letterSpacing: '-0.025em' }],
        'display-md': ['clamp(1.75rem, 3vw, 2.25rem)', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
      },
      boxShadow: {
        card: '0 1px 2px hsl(0 0% 0% / 0.4), 0 8px 24px -12px hsl(0 0% 0% / 0.6)',
        glow: '0 0 0 1px hsl(var(--primary) / 0.35), 0 0 32px -6px hsl(var(--primary) / 0.45)',
        'glow-accent': '0 0 0 1px hsl(var(--accent) / 0.35), 0 0 32px -6px hsl(var(--accent) / 0.45)',
      },
      backgroundImage: {
        'grid-fade':
          'radial-gradient(ellipse 80% 55% at 50% -10%, hsl(var(--primary) / 0.22), transparent 70%)',
        'stage': 'linear-gradient(140deg, hsl(var(--primary) / 0.18), hsl(var(--accent) / 0.12) 55%, transparent)',
        /* The cinematic base: black, through deep purple, into midnight blue. */
        'cinema':
          'linear-gradient(175deg, hsl(258 40% 7%) 0%, hsl(266 45% 9%) 28%, hsl(240 50% 8%) 62%, hsl(232 45% 6%) 100%)',
        'ray': 'linear-gradient(100deg, transparent 0%, hsl(var(--primary) / 0.13) 45%, hsl(var(--accent) / 0.10) 55%, transparent 100%)',
      },
      keyframes: {
        'pulse-live': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.85)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        /*
          Ambient glow blobs. Deliberately long and asymmetric: three blobs on
          the same period would visibly march in step, which reads as a loading
          animation rather than atmosphere.
        */
        'drift-a': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '33%': { transform: 'translate3d(6%, -8%, 0) scale(1.12)' },
          '66%': { transform: 'translate3d(-5%, 5%, 0) scale(0.94)' },
        },
        'drift-b': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1.05)' },
          '40%': { transform: 'translate3d(-8%, 6%, 0) scale(0.9)' },
          '75%': { transform: 'translate3d(4%, 9%, 0) scale(1.15)' },
        },
        'drift-c': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(0.95)' },
          '50%': { transform: 'translate3d(7%, 7%, 0) scale(1.2)' },
        },
        /* Star dust: one long vertical pass, so nothing ever snaps back. */
        'dust': {
          from: { transform: 'translate3d(0, 0, 0)' },
          to: { transform: 'translate3d(0, -50%, 0)' },
        },
        /* A broadcast light sweeping across the stage. */
        'ray-sweep': {
          '0%, 100%': { transform: 'translateX(-15%) rotate(8deg)', opacity: '0.35' },
          '50%': { transform: 'translateX(15%) rotate(12deg)', opacity: '0.7' },
        },
        /* Breathing glow for anything that is genuinely live. */
        'aura': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        /*
          The mesh. Three stops travelling on their own long orbits, so the
          field never resolves into a pattern the eye can predict.
        */
        'mesh-a': {
          '0%, 100%': { transform: 'translate3d(-8%, -6%, 0) scale(1.1)' },
          '25%': { transform: 'translate3d(10%, 4%, 0) scale(1.3)' },
          '50%': { transform: 'translate3d(4%, 12%, 0) scale(1)' },
          '75%': { transform: 'translate3d(-6%, 6%, 0) scale(1.2)' },
        },
        'mesh-b': {
          '0%, 100%': { transform: 'translate3d(6%, 8%, 0) scale(1.2)' },
          '33%': { transform: 'translate3d(-10%, -4%, 0) scale(1)' },
          '66%': { transform: 'translate3d(8%, -10%, 0) scale(1.35)' },
        },
        'mesh-c': {
          '0%, 100%': { transform: 'translate3d(0, 10%, 0) scale(1)' },
          '40%': { transform: 'translate3d(-12%, -8%, 0) scale(1.25)' },
          '70%': { transform: 'translate3d(12%, 2%, 0) scale(1.1)' },
        },
        /* A single sweep of light crossing a surface, used on card hover. */
        'sweep': {
          from: { transform: 'translateX(-120%) skewX(-18deg)' },
          to: { transform: 'translateX(220%) skewX(-18deg)' },
        },
        /* Barely-there vertical drift, so a card is never quite still. */
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        /* A broadcast signal: three bars rising out of step. */
        'signal': {
          '0%, 100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' },
        },
      },
      animation: {
        'pulse-live': 'pulse-live 1.6s ease-in-out infinite',
        'slide-up': 'slide-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.6s infinite',
        'drift-a': 'drift-a 22s ease-in-out infinite',
        'drift-b': 'drift-b 26s ease-in-out infinite',
        'drift-c': 'drift-c 19s ease-in-out infinite',
        dust: 'dust 90s linear infinite',
        'ray-sweep': 'ray-sweep 18s ease-in-out infinite',
        aura: 'aura 3s ease-in-out infinite',
        'mesh-a': 'mesh-a 28s ease-in-out infinite',
        'mesh-b': 'mesh-b 24s ease-in-out infinite',
        'mesh-c': 'mesh-c 32s ease-in-out infinite',
        sweep: 'sweep 1.1s ease-out',
        float: 'float 6s ease-in-out infinite',
        signal: 'signal 1s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
