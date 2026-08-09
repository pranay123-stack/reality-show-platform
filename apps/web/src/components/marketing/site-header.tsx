'use client';

import { Button, Drawer, DrawerClose, DrawerContent, DrawerTrigger } from '@reality/ui';
import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { env } from '@/lib/env';
import { useAuth } from '@/providers/auth-provider';

const NAV = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#contestants', label: 'Contestants' },
  { href: '#rewards', label: 'Rewards' },
  { href: '#leaderboard', label: 'Leaderboard' },
];

export function SiteHeader() {
  const { isAuthenticated, isLoading } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors ${
        scrolled ? 'border-border bg-background/85 backdrop-blur' : 'border-transparent bg-transparent'
      }`}
    >
      <div className="container flex h-16 items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden
            className="h-6 w-6 rounded-md bg-gradient-to-br from-primary to-accent shadow-glow"
          />
          {env.appName}
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {!isLoading && isAuthenticated ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Join free</Link>
              </Button>
            </>
          )}

          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" aria-hidden />
              </Button>
            </DrawerTrigger>
            <DrawerContent title="Menu" side="right">
              <nav aria-label="Mobile" className="flex flex-col gap-1">
                {NAV.map((item) => (
                  <DrawerClose asChild key={item.href}>
                    <a
                      href={item.href}
                      className="rounded-md px-3 py-3 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                    >
                      {item.label}
                    </a>
                  </DrawerClose>
                ))}
                <DrawerClose asChild>
                  <Link
                    href="/login"
                    className="rounded-md px-3 py-3 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                  >
                    Sign in
                  </Link>
                </DrawerClose>
              </nav>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
    </header>
  );
}
