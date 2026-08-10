import type { Metadata, Viewport } from 'next';
import { Anton } from 'next/font/google';

import { CinematicBackground } from '@/components/system/cinematic-background';
import { Providers } from '@/providers';

import '@reality/ui/styles.css';
import './globals.css';

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'Reality Platform';

/**
 * The display face.
 *
 * Phase 4 chose system stacks only, on the reasoning that no webfont means a
 * hermetic build and no layout shift. That reasoning still holds for body text,
 * and body text is still on the system stack — but a system stack cannot
 * produce a television title. Anton is a condensed poster face: it is what a
 * show's opening card is set in, and it is the difference between a headline
 * that announces something and one that merely labels it.
 *
 * The trade is narrower than it looks. `next/font` downloads the file at build
 * time and self-hosts it, so at runtime there is still no third-party request,
 * and it generates a size-adjusted local fallback, so there is still no layout
 * shift. What genuinely changes is that a cold build now needs network access.
 */
const displayFont = Anton({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-anton',
  // Metrics-matched to the system stack, so the swap does not reflow.
  adjustFontFallback: true,
});

export const metadata: Metadata = {
  title: {
    default: `${appName} — play along with the live show`,
    template: `%s · ${appName}`,
  },
  description:
    'Predict, vote, challenge and climb the leaderboard while the show is live. An interactive second-screen platform for reality-show audiences.',
  applicationName: appName,
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0b0b10',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={displayFont.variable} suppressHydrationWarning>
      <body className="min-h-dvh bg-background font-sans text-foreground">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {/* Scenery, painted once behind everything. */}
        <CinematicBackground />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
