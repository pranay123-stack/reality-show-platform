/**
 * The arena, the sample profile and the house spotlight.
 *
 * Fictional, like everything else on the landing page. Kept apart from
 * `mock-features.ts` because these describe *this evening* — what is open, who
 * is being talked about, what a profile looks like a month in — rather than
 * what each feature is.
 *
 * Countdowns are expressed as seconds-from-now rather than fixed timestamps.
 * The landing page is statically prerendered, so a literal date would be in the
 * past for every visitor after the first deploy.
 */

export interface ArenaEvent {
  key: string;
  title: string;
  /** Drives the badge, the accent and whether the countdown reads as urgent. */
  state: 'live' | 'closing' | 'open' | 'upcoming';
  theme: 'pink' | 'cyan' | 'purple' | 'gold';
  participants: number;
  /** Seconds from render. */
  closesInSeconds: number;
  cta: { label: string; href: string };
  /** A one-line read on where it currently stands. */
  standing: string;
}

export const arenaEvents: ArenaEvent[] = [
  {
    key: 'nomination',
    title: 'Nomination Night',
    state: 'live',
    theme: 'pink',
    participants: 12_450,
    closesInSeconds: 512,
    cta: { label: 'Vote now', href: '/nominations' },
    standing: 'Tomás Reyes leads on 41% of audience support',
  },
  {
    key: 'kitchen',
    title: 'Kitchen Battle',
    state: 'open',
    theme: 'cyan',
    participants: 6_120,
    closesInSeconds: 3_240,
    cta: { label: 'Make your move', href: '/kitchen' },
    standing: '3,150 of 5,000 budget units committed',
  },
  {
    key: 'poll',
    title: 'Audience Poll',
    state: 'live',
    theme: 'purple',
    participants: 9_980,
    closesInSeconds: 138,
    cta: { label: 'Vote live', href: '/polls' },
    standing: '58% say the house earned the luxury budget',
  },
  {
    key: 'weekend',
    title: 'Weekend Spotlight',
    state: 'open',
    theme: 'gold',
    participants: 2_180,
    closesInSeconds: 15_600,
    cta: { label: 'Take the spotlight', href: '/weekend' },
    standing: '24 shortlisted so far · 3 make the episode',
  },
];

/**
 * A sample profile.
 *
 * Shown to signed-out visitors as *an example of what they would have*, never
 * dressed up as their own. The section says so in as many words: inventing a
 * streak for somebody who has not played yet would be a lie told for engagement.
 */
export const sampleProfile = {
  displayName: 'RemoteRuler',
  level: 8,
  levelTitle: 'House Regular',
  points: 990,
  pointsIntoLevel: 490,
  pointsForNextLevel: 510,
  rank: 42,
  rankOf: 12_480,
  streakDays: 5,
  rewardsUnlocked: 6,
  rewardsTotal: 14,
};

export interface SpotlightContestant {
  id: string;
  name: string;
  occupation: string;
  heatScore: number;
  heatDelta: number;
  trend: 'UP' | 'DOWN' | 'FLAT';
  /** What the house is actually talking about. */
  storyline: string;
  /** Share of audience opinion that is favourable, 0–100. */
  sentiment: number;
  badge?: string;
}

export const houseSpotlight: SpotlightContestant[] = [
  {
    id: 'con_03',
    name: 'Mira Sol',
    occupation: 'Dancer',
    heatScore: 82,
    heatDelta: 12,
    trend: 'UP',
    storyline: 'Won the endurance task after being written off all week.',
    sentiment: 74,
    badge: 'Most discussed today',
  },
  {
    id: 'con_01',
    name: 'Aria Vale',
    occupation: 'Chef',
    heatScore: 78,
    heatDelta: 5,
    trend: 'UP',
    storyline: 'At the centre of the kitchen argument the house is still replaying.',
    sentiment: 62,
  },
  {
    id: 'con_02',
    name: 'Dev Rahman',
    occupation: 'Stand-up comic',
    heatScore: 71,
    heatDelta: -3,
    trend: 'DOWN',
    storyline: 'Quieter this week after Sunday’s alliance collapsed.',
    sentiment: 48,
  },
  {
    id: 'con_05',
    name: 'Lena Frost',
    occupation: 'Chess coach',
    heatScore: 59,
    heatDelta: -8,
    trend: 'DOWN',
    storyline: 'Named in two nominations and has not answered either.',
    sentiment: 39,
  },
];

/** The metric each feature card leads with. */
export const featureMetrics = {
  prediction: { value: 8_240, label: 'playing now' },
  challenge: { value: 12_450, label: 'submissions' },
  heat: { value: 24, label: 'contestants tracked' },
  perspective: { value: 6_410, label: 'voices counted' },
  poll: { value: 3_910, label: 'votes a minute' },
  nomination: { value: 12_450, label: 'votes cast' },
  kitchen: { value: 6_120, label: 'menus picked' },
  weekend: { value: 2_180, label: 'questions in' },
} as const;
