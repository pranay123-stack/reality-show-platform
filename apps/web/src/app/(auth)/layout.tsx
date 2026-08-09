import Link from 'next/link';

import { env } from '@/lib/env';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-grid-fade"
      />

      <header className="relative border-b border-border/60">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            {env.appName}
          </Link>
          <Link href="/" className="text-sm text-muted transition-colors hover:text-foreground">
            Back to home
          </Link>
        </div>
      </header>

      <main id="main" className="relative flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="relative border-t border-border/60 py-6">
        <p className="container text-center text-xs text-muted">
          Contestants and episodes shown in development are fictional placeholders.
        </p>
      </footer>
    </div>
  );
}
