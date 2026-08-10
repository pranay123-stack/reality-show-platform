'use client';

import {
  Avatar,
  Badge,
  Button,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  LiveIndicator,
  cn,
} from '@reality/ui';
import { LogOut, Menu, Settings, Shield, Sparkles, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { NotificationBell } from '@/components/notifications/notification-bell';
import { useDashboard } from '@/hooks/use-dashboard';
import { env } from '@/lib/env';
import { ALL_NAV_ITEMS, BOTTOM_NAV, NAV_GROUPS, type NavItem } from '@/lib/navigation';
import { useAuth } from '@/providers/auth-provider';

/**
 * The authenticated frame.
 *
 * Desktop: fixed sidebar + top bar. Mobile: compact header, slide-in drawer and
 * a bottom navigation bar. Feature pages render into `children` and never have
 * to know which layout they are in.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      <DesktopSidebar />

      <div className="flex min-h-dvh flex-col">
        <TopBar />
        <main id="main" className="flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">
          {/*
            Keyed on the path so the enter animation replays per navigation
            rather than once per session. `prefers-reduced-motion` is honoured
            globally, which reduces this to an instant appearance.
          */}
          <div key={pathname} className="mx-auto w-full max-w-6xl animate-slide-up">
            {children}
          </div>
        </main>
      </div>

      <BottomNav />
    </div>
  );
}

// ---------------------------------------------------------------------------

function useBadgeCount(): (item: NavItem) => number | null {
  const { data } = useDashboard();

  return (item: NavItem) => {
    if (!item.moduleKey || !data) return null;
    const modules = data.modules;

    switch (item.moduleKey) {
      case 'predictions':
        return modules.predictions.awaitingYou || null;
      case 'polls':
        return modules.polls.awaitingYou || null;
      case 'challenges':
        return modules.challenges.votingOpen || null;
      case 'perspectives':
        return modules.perspectives.awaitingYou || null;
      case 'nominations':
        return modules.nominations.open || modules.evictions.open ? 1 : null;
      case 'kitchen':
        return modules.kitchen.open || null;
      case 'weekend':
        return modules.weekend.open && !modules.weekend.submitted ? 1 : null;
      default:
        return null;
    }
  };
}

function NavLink({ item, badge, onNavigate }: { item: NavItem; badge: number | null; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-primary/15 font-medium text-foreground'
          : 'text-muted hover:bg-surface-raised hover:text-foreground',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} aria-hidden />
      <span className="flex-1 truncate">{item.label}</span>
      {badge != null && (
        <Badge tone="primary" size="sm" className="tabular-nums">
          {badge}
        </Badge>
      )}
    </Link>
  );
}

function NavTree({ onNavigate }: { onNavigate?: () => void }) {
  const badgeFor = useBadgeCount();
  const { hasRole } = useAuth();

  return (
    <nav aria-label="Sections" className="space-y-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="px-3 text-xs font-semibold uppercase tracking-widest text-muted/70">
            {group.label}
          </p>
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} badge={badgeFor(item)} onNavigate={onNavigate} />
          ))}
        </div>
      ))}

      {hasRole('MODERATOR') && (
        <div className="space-y-1">
          <p className="px-3 text-xs font-semibold uppercase tracking-widest text-muted/70">Staff</p>
          <Link
            href="/admin"
            onClick={onNavigate}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <Shield className="h-4 w-4 shrink-0" aria-hidden />
            Console
          </Link>
        </div>
      )}
    </nav>
  );
}

function DesktopSidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface/40 lg:flex">
      <div className="flex h-16 items-center border-b border-border px-5">
        <Link href="/dashboard" className="flex min-h-10 items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden
            className="h-6 w-6 rounded-md bg-gradient-to-br from-primary to-accent shadow-glow"
          />
          {env.appName}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-5">
        <NavTree />
      </div>

      <div className="border-t border-border p-4">
        <PointsPill />
      </div>
    </aside>
  );
}

function PointsPill() {
  const { user } = useAuth();
  const { data } = useDashboard();
  const balance = data?.points.balance ?? user?.pointsBalance ?? 0;
  const earnedToday = data?.points.earnedToday ?? 0;

  return (
    <Link
      href="/rewards"
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-2.5 transition-colors hover:border-border-strong"
    >
      <span className="flex items-center gap-2 text-sm text-muted">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        Points
      </span>
      <span className="text-right">
        <span className="block font-semibold tabular-nums">{balance.toLocaleString()}</span>
        {earnedToday > 0 && (
          <span className="block text-xs text-success tabular-nums">+{earnedToday} today</span>
        )}
      </span>
    </Link>
  );
}

function TopBar() {
  const { data } = useDashboard();
  const live = data?.live;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <MobileMenu />

        <Link
          href="/dashboard"
          className="inline-flex h-10 items-center font-semibold tracking-tight lg:hidden"
        >
          {env.appName}
        </Link>

        <div className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
          <LiveIndicator live={Boolean(live?.isLive)} />
          {live?.episode && (
            <p className="truncate text-sm text-muted">
              <span className="text-foreground">Episode {live.episode.number}</span> ·{' '}
              {live.episode.title}
            </p>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="rounded-full border border-border bg-surface px-3 py-1 text-sm lg:hidden">
            <span className="font-semibold tabular-nums">
              {(data?.points.balance ?? 0).toLocaleString()}
            </span>
          </span>

          <NotificationBell />
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}

function ProfileMenu() {
  const { user, logout, hasRole } = useAuth();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Account menu"
        >
          <Avatar name={user?.displayName ?? 'You'} src={user?.avatarUrl} size="sm" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{user?.displayName ?? 'Account'}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User className="h-4 w-4" aria-hidden />
            Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/rewards">
            <Sparkles className="h-4 w-4" aria-hidden />
            Points & rewards
          </Link>
        </DropdownMenuItem>

        {hasRole('MODERATOR') && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <Settings className="h-4 w-4" aria-hidden />
              Producer console
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void logout()}>
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileMenu() {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu className="h-5 w-5" aria-hidden />
        </Button>
      </DrawerTrigger>
      <DrawerContent title="Navigation" side="left">
        <DrawerClose asChild>
          <div>
            <NavTree />
          </div>
        </DrawerClose>
        <div className="mt-6">
          <PointsPill />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function BottomNav() {
  const pathname = usePathname();
  const badgeFor = useBadgeCount();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-5">
        {BOTTOM_NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const badge = badgeFor(item);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                // 56px tall keeps every target comfortably above the 44px minimum.
                className={cn(
                  'relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors',
                  active ? 'text-primary' : 'text-muted',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span className="truncate px-1">{item.shortLabel ?? item.label}</span>
                {badge != null && (
                  <span
                    aria-hidden
                    className="absolute right-[22%] top-2 h-2 w-2 rounded-full bg-primary"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export { ALL_NAV_ITEMS };
