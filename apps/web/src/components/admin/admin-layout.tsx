'use client';

import { Alert, chipClassName, cn, LoadingState } from '@reality/ui';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  ClipboardList,
  Flame,
  Gauge,
  Gift,
  ListChecks,
  MessagesSquare,
  Radio,
  ScrollText,
  Trophy,
  UtensilsCrossed,
  CalendarHeart,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * The operator console frame.
 *
 * The section list comes from the server, not from the client's idea of what
 * the user's role can do. That is not a security measure — every endpoint
 * checks its own permission regardless — it is so the navigation never presents
 * a door that will not open.
 */

interface Section {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  group: 'Overview' | 'Show' | 'Community' | 'Platform';
}

const SECTIONS: Section[] = [
  { key: 'overview', href: '/admin', label: 'Overview', icon: Gauge, group: 'Overview' },
  { key: 'contestants', href: '/admin/contestants', label: 'Contestants', icon: Flame, group: 'Show' },
  { key: 'predictions', href: '/admin/predictions', label: 'Predictions', icon: ListChecks, group: 'Show' },
  { key: 'polls', href: '/admin/polls', label: 'Live polls', icon: Radio, group: 'Show' },
  { key: 'kitchen', href: '/admin/kitchen', label: 'Kitchen', icon: UtensilsCrossed, group: 'Show' },
  { key: 'weekend', href: '/admin/weekend', label: 'Weekend', icon: CalendarHeart, group: 'Show' },
  { key: 'challenges', href: '/admin/challenges', label: 'Moderation', icon: MessagesSquare, group: 'Community' },
  { key: 'rewards', href: '/admin/rewards', label: 'Rewards', icon: Gift, group: 'Community' },
  { key: 'leaderboard', href: '/admin/leaderboard', label: 'Leaderboard', icon: Trophy, group: 'Community' },
  { key: 'analytics', href: '/admin/analytics', label: 'Analytics', icon: BarChart3, group: 'Platform' },
  { key: 'notifications', href: '/admin/notifications', label: 'Notifications', icon: ClipboardList, group: 'Platform' },
  { key: 'audit', href: '/admin/audit', label: 'Audit log', icon: ScrollText, group: 'Platform' },
];

const GROUP_ORDER: Section['group'][] = ['Overview', 'Show', 'Community', 'Platform'];

export function useAdminSections() {
  return useQuery({
    queryKey: queryKeys.admin.overview,
    queryFn: () => api.get<{ sections: string[]; role: string }>('/admin/sections'),
    staleTime: 300_000,
    retry: false,
  });
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useAdminSections();

  if (isLoading) return <LoadingState rows={4} label="Checking your access…" />;

  // A 403 from the sections endpoint is the honest answer for a viewer: the
  // console is not theirs to see, and saying so plainly beats an empty shell.
  if (isError || !data) {
    return (
      <Alert tone="danger" title="No console access">
        Your account does not have operator access. If you think that is wrong, ask an
        administrator.
      </Alert>
    );
  }

  const allowed = SECTIONS.filter((section) => data.sections.includes(section.key));

  return (
    <div className="lg:grid lg:grid-cols-[13rem_1fr] lg:gap-8">
      <AdminNav sections={allowed} role={data.role} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function AdminNav({ sections, role }: { sections: Section[]; role: string }) {
  const pathname = usePathname();
  // `/admin` must not light up for `/admin/polls`, so the root is exact-matched.
  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  return (
    <>
      {/* Desktop: a rail. Below lg the same links become a scrolling strip. */}
      <nav aria-label="Console sections" className="hidden lg:block">
        <div className="sticky top-20 space-y-5">
          <p className="px-3 text-xs font-semibold uppercase tracking-widest text-muted/70">
            {role.toLowerCase()} console
          </p>

          {GROUP_ORDER.map((group) => {
            const items = sections.filter((section) => section.group === group);
            if (items.length === 0) return null;

            return (
              <div key={group} className="space-y-1">
                {group !== 'Overview' && (
                  <p className="px-3 text-[11px] font-medium uppercase tracking-wider text-muted/60">
                    {group}
                  </p>
                )}
                {items.map((section) => (
                  <NavItem key={section.key} section={section} active={isActive(section.href)} />
                ))}
              </div>
            );
          })}
        </div>
      </nav>

      <nav
        aria-label="Console sections"
        className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:hidden"
      >
        {sections.map((section) => (
          <Link
            key={section.key}
            href={section.href}
            aria-current={isActive(section.href) ? 'page' : undefined}
            className={chipClassName(isActive(section.href))}
          >
            <section.icon className="h-4 w-4 shrink-0" aria-hidden />
            {section.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

function NavItem({ section, active }: { section: Section; active: boolean }) {
  const Icon = section.icon;

  return (
    <Link
      href={section.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-primary/15 font-medium text-foreground'
          : 'text-muted hover:bg-surface-raised hover:text-foreground',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} aria-hidden />
      <span className="truncate">{section.label}</span>
    </Link>
  );
}
