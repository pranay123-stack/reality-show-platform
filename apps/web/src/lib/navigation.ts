import {
  Flame,
  Gift,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Radio,
  Scale,
  Trophy,
  UtensilsCrossed,
  Users,
  CalendarHeart,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  /** Key into the dashboard `modules` payload, used to badge the item. */
  moduleKey?:
    | 'predictions'
    | 'polls'
    | 'challenges'
    | 'perspectives'
    | 'nominations'
    | 'evictions'
    | 'kitchen'
    | 'weekend';
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Play',
    items: [
      { href: '/predictions', label: 'Prediction Game', shortLabel: 'Predict', icon: ListChecks, moduleKey: 'predictions' },
      { href: '/polls', label: 'Live Polls', shortLabel: 'Polls', icon: Radio, moduleKey: 'polls' },
      { href: '/challenges', label: 'Audience Challenges', shortLabel: 'Challenges', icon: MessagesSquare, moduleKey: 'challenges' },
      { href: '/perspectives', label: 'Audience Perspective', shortLabel: 'Perspective', icon: Scale, moduleKey: 'perspectives' },
    ],
  },
  {
    label: 'The house',
    items: [
      { href: '/contestants', label: 'Contestant Heat', shortLabel: 'Heat', icon: Flame },
      { href: '/nominations', label: 'Nomination & Eviction', shortLabel: 'Rounds', icon: Users, moduleKey: 'nominations' },
      { href: '/kitchen', label: 'Kitchen Control', shortLabel: 'Kitchen', icon: UtensilsCrossed, moduleKey: 'kitchen' },
      { href: '/weekend', label: 'Weekend Participation', shortLabel: 'Weekend', icon: CalendarHeart, moduleKey: 'weekend' },
    ],
  },
  {
    label: 'You',
    items: [
      { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
      { href: '/rewards', label: 'Points & Rewards', shortLabel: 'Rewards', icon: Gift },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** The five that fit a phone's bottom bar without crowding the tap targets. */
export const BOTTOM_NAV: NavItem[] = [
  ALL_NAV_ITEMS[0]!,
  ALL_NAV_ITEMS[1]!,
  ALL_NAV_ITEMS[2]!,
  ALL_NAV_ITEMS[5]!,
  ALL_NAV_ITEMS[9]!,
];
