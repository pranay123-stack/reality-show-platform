/**
 * Landing-page content.
 *
 * Mock data only, and deliberately fictional: no real show, person or brand is
 * referenced anywhere on this page. Once the show API is public these become
 * server-fetched, but the landing page must render without a database so it can
 * be statically generated.
 */

export const landingContestants = [
  { id: 'con_01', name: 'Aria Vale', occupation: 'Chef', tagline: 'Cooks under pressure, argues under oath.', heatScore: 78, heatTrend: 'UP' as const },
  { id: 'con_02', name: 'Dev Rahman', occupation: 'Stand-up comic', tagline: 'Turns every task into a bit.', heatScore: 71, heatTrend: 'UP' as const },
  { id: 'con_03', name: 'Mira Sol', occupation: 'Dancer', tagline: 'Quiet all week, unstoppable on task day.', heatScore: 66, heatTrend: 'FLAT' as const },
  { id: 'con_05', name: 'Lena Frost', occupation: 'Chess coach', tagline: 'Three moves ahead of every alliance.', heatScore: 59, heatTrend: 'DOWN' as const },
];

export const landingPoll = {
  question: 'Who should get the last spot in tonight’s task?',
  options: [
    { id: 'a', label: 'Mira Sol', voteCount: 4820 },
    { id: 'b', label: 'Tomás Reyes', voteCount: 3115 },
    { id: 'c', label: 'Grace Obi', voteCount: 2064 },
  ],
  totalVotes: 9999,
};

export const landingLeaderboard = [
  { rank: 1, name: 'NightOwl', points: 1898, previousRank: 3 },
  { rank: 2, name: 'CouchCritic', points: 1575, previousRank: 2 },
  { rank: 3, name: 'PopcornPro', points: 1290, previousRank: 1 },
  { rank: 4, name: 'RemoteRuler', points: 990, previousRank: 4 },
  { rank: 5, name: 'PrimeTimeSam', points: 640, previousRank: 7 },
];

export const howItWorks = [
  {
    step: '01',
    title: 'Create your account',
    copy: 'One account per person. Confirm your email and you are in — no payment, ever.',
  },
  {
    step: '02',
    title: 'Play along while it airs',
    copy: 'Predictions, live polls, kitchen votes and nominations all run against the broadcast.',
  },
  {
    step: '03',
    title: 'Earn points for taking part',
    copy: 'Every action is recorded in an auditable ledger. Correct predictions are worth more.',
  },
  {
    step: '04',
    title: 'Climb the leaderboard',
    copy: 'Daily, weekly and season boards. Redeem points for badges, frames and shout-outs.',
  },
];

export const featurePillars = [
  {
    title: 'Prediction Game',
    copy: 'Call who gets nominated, who wins the task, what happens next. One prediction per question, locked when it closes.',
    accent: 'primary' as const,
  },
  {
    title: 'Audience Challenges',
    copy: 'Write a task for the house. The community votes, moderators check it, producers pick what actually runs.',
    accent: 'accent' as const,
  },
  {
    title: 'Contestant Heat Meter',
    copy: 'A live popularity score for each contestant, built from votes, reactions and momentum — not a fantasy score.',
    accent: 'primary' as const,
  },
  {
    title: 'Audience Perspective',
    copy: 'After an argument, say who was right. Opinion about what already happened, kept separate from live polls.',
    accent: 'accent' as const,
  },
  {
    title: 'Real-time Live Polls',
    copy: 'Vote during the broadcast and watch the bars move. Counts come from the server, never the browser.',
    accent: 'primary' as const,
  },
  {
    title: 'Nomination & Eviction',
    copy: 'Take part in every round with a clear vote limit — and a clear line between the audience result and the show’s official outcome.',
    accent: 'accent' as const,
  },
  {
    title: 'Kitchen Control',
    copy: 'Decide what the house eats within a fixed budget. The final basket is calculated on the server.',
    accent: 'primary' as const,
  },
  {
    title: 'Weekend Participation',
    copy: 'Send a question for the weekend episode. Moderated, shortlisted, then chosen by production.',
    accent: 'accent' as const,
  },
];

export const rewardTiers = [
  { name: 'First Call', cost: 'Free', description: 'Your first prediction of the season.', type: 'Badge' },
  { name: 'Seven Nights', cost: 'Free', description: 'Take part seven show days in a row.', type: 'Badge' },
  { name: 'Neon Profile Frame', cost: '500 pts', description: 'A glowing frame for your avatar.', type: 'Profile' },
  { name: 'Double Points Night', cost: '1,200 pts', description: 'Double points for one live episode.', type: 'Boost' },
  { name: 'Leaderboard Shout-out', cost: '2,500 pts', description: 'Your name on the weekly community wall.', type: 'Recognition' },
];
