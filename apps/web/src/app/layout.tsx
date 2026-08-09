import type { Metadata, Viewport } from 'next';

import { Providers } from '@/providers';

import '@reality/ui/styles.css';
import './globals.css';

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'Reality Platform';

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
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className="min-h-dvh bg-background font-sans text-foreground">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
