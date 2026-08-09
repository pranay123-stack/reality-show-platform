/**
 * Demo seed.
 *
 * Everything here is FICTIONAL PLACEHOLDER CONTENT. No real show, person,
 * brand or asset is referenced. Ids are fixed strings so the seed is idempotent
 * and so E2E tests can rely on stable fixtures.
 *
 * Run: `pnpm db:seed`
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_POINT_RULES } from '@reality/shared';

import { hashPassword } from '../src/core/password.js';
import { normalizeEmail } from '../src/modules/auth/email-normalization.js';
import {
  ALL_PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
} from '../src/core/permissions.js';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'DemoPass!2026';

const now = new Date();
const minutes = (n: number) => n * 60 * 1000;
const hours = (n: number) => n * minutes(60);
const days = (n: number) => n * hours(24);
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

async function seedAccessControl() {
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: `Grants ${key.replace(/\./g, ' ')}` },
    });
  }

  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS) as [
    keyof typeof ROLE_PERMISSIONS,
    string[],
  ][]) {
    const definition = await prisma.roleDefinition.upsert({
      where: { role },
      update: { label: ROLE_LABELS[role], description: ROLE_DESCRIPTIONS[role] },
      create: { role, label: ROLE_LABELS[role], description: ROLE_DESCRIPTIONS[role] },
    });

    for (const key of permissions) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.upsert({
        where: {
          roleDefinitionId_permissionId: {
            roleDefinitionId: definition.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: { roleDefinitionId: definition.id, permissionId: permission.id },
      });
    }
  }

  console.log(`  ✓ ${ALL_PERMISSIONS.length} permissions across 4 roles`);
}

// ---------------------------------------------------------------------------
// Points configuration & reward catalogue
// ---------------------------------------------------------------------------

const POINT_RULE_DESCRIPTIONS: Record<string, string> = {
  PREDICTION_PARTICIPATION: 'Submitting any prediction',
  PREDICTION_CORRECT: 'Predicting the correct outcome',
  POLL_PARTICIPATION: 'Voting in a live poll',
  PERSPECTIVE_PARTICIPATION: 'Sharing an audience perspective',
  CHALLENGE_SUBMISSION: 'Submitting a challenge for moderation',
  CHALLENGE_APPROVED: 'Having a challenge approved',
  CHALLENGE_TOP3: 'Reaching the top challenges of a cycle',
  CHALLENGE_SELECTED: 'Having a challenge selected by production',
  NOMINATION_PARTICIPATION: 'Voting in a nomination round',
  EVICTION_PARTICIPATION: 'Voting in an eviction round',
  KITCHEN_PARTICIPATION: 'Voting on a kitchen decision',
  WEEKEND_SUBMISSION: 'Submitting a weekend entry',
  WEEKEND_SHORTLISTED: 'Being shortlisted for the weekend',
  WEEKEND_SELECTED: 'Being selected for the weekend',
  DAILY_STREAK: 'Maintaining a daily participation streak',
};

async function seedPointsRules() {
  for (const [key, points] of Object.entries(DEFAULT_POINT_RULES)) {
    await prisma.pointsRule.upsert({
      where: { key },
      update: {},
      create: { key, points, description: POINT_RULE_DESCRIPTIONS[key] ?? key },
    });
  }
  console.log(`  ✓ ${Object.keys(DEFAULT_POINT_RULES).length} points rules`);
}

async function seedRewards() {
  const rewards = [
    {
      code: 'BADGE_FIRST_PREDICTION',
      name: 'First Call',
      description: 'Awarded for your first prediction of the season.',
      type: 'DIGITAL_BADGE' as const,
      costPoints: 0,
      oncePerUser: true,
    },
    {
      code: 'BADGE_STREAK_7',
      name: 'Seven Nights',
      description: 'Take part on seven consecutive show days.',
      type: 'DIGITAL_BADGE' as const,
      costPoints: 0,
      oncePerUser: true,
    },
    {
      code: 'FRAME_NEON',
      name: 'Neon Profile Frame',
      description: 'A glowing frame for your profile picture.',
      type: 'PROFILE_ITEM' as const,
      costPoints: 500,
      oncePerUser: true,
    },
    {
      code: 'BOOST_DOUBLE_NIGHT',
      name: 'Double Points Night',
      description: 'Doubles the points you earn for one live episode.',
      type: 'POINT_BOOST' as const,
      costPoints: 1200,
      oncePerUser: false,
    },
    {
      code: 'SHOUTOUT_LEADERBOARD',
      name: 'Leaderboard Shout-out',
      description: 'Your display name appears on the weekly community wall.',
      type: 'SHOUTOUT' as const,
      costPoints: 2500,
      oncePerUser: false,
      requiresApproval: true,
    },
    {
      code: 'MERCH_TSHIRT',
      name: 'Season Merch Tee',
      description: 'A season T-shirt. Fulfilment is arranged by production.',
      type: 'MERCH' as const,
      costPoints: 10_000,
      oncePerUser: true,
      requiresApproval: true,
      requiresProductionApproval: true,
      active: false,
      disclaimer:
        'Physical rewards are disabled by default and require authorised production staff to enable, confirm availability and arrange fulfilment.',
    },
  ];

  for (const reward of rewards) {
    await prisma.reward.upsert({
      where: { code: reward.code },
      update: {},
      create: reward,
    });
  }
  console.log(`  ✓ ${rewards.length} rewards (physical reward disabled by default)`);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

interface DemoUser {
  id: string;
  email: string;
  displayName: string;
  role: 'USER' | 'MODERATOR' | 'PRODUCER' | 'ADMIN';
  points: number;
}

const DEMO_USERS: DemoUser[] = [
  { id: 'usr_admin', email: 'admin@reality.local', displayName: 'Studio Admin', role: 'ADMIN', points: 0 },
  { id: 'usr_producer', email: 'producer@reality.local', displayName: 'Show Producer', role: 'PRODUCER', points: 0 },
  { id: 'usr_moderator', email: 'moderator@reality.local', displayName: 'Community Mod', role: 'MODERATOR', points: 0 },
  { id: 'usr_viewer1', email: 'viewer1@reality.local', displayName: 'NightOwl', role: 'USER', points: 1840 },
  { id: 'usr_viewer2', email: 'viewer2@reality.local', displayName: 'CouchCritic', role: 'USER', points: 1520 },
  { id: 'usr_viewer3', email: 'viewer3@reality.local', displayName: 'PopcornPro', role: 'USER', points: 1275 },
  { id: 'usr_viewer4', email: 'viewer4@reality.local', displayName: 'RemoteRuler', role: 'USER', points: 990 },
  { id: 'usr_viewer5', email: 'viewer5@reality.local', displayName: 'PrimeTimeSam', role: 'USER', points: 640 },
  { id: 'usr_viewer6', email: 'viewer6@reality.local', displayName: 'LateShiftLee', role: 'USER', points: 310 },
];

async function seedUsers() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const demo of DEMO_USERS) {
    await prisma.user.upsert({
      where: { id: demo.id },
      update: { role: demo.role, status: 'ACTIVE' },
      create: {
        id: demo.id,
        email: demo.email,
        emailNormalized: normalizeEmail(demo.email),
        passwordHash,
        role: demo.role,
        status: 'ACTIVE',
        emailVerifiedAt: now,
        profile: {
          create: {
            displayName: demo.displayName,
            pointsBalance: demo.points,
            lifetimePoints: demo.points,
            timezone: 'Asia/Kolkata',
            lastActiveAt: at(-minutes(15)),
          },
        },
      },
    });
  }

  console.log(`  ✓ ${DEMO_USERS.length} demo users (password: ${DEMO_PASSWORD})`);
}

// ---------------------------------------------------------------------------
// Show, season, episodes, contestants, events
// ---------------------------------------------------------------------------

const SHOW_ID = 'show_demo';
const SEASON_ID = 'season_demo_1';
const EPISODE_ID = 'ep_demo_12';
const PREVIOUS_EPISODE_ID = 'ep_demo_11';

const CONTESTANTS = [
  { id: 'con_01', slug: 'aria-vale', displayName: 'Aria Vale', age: 27, occupation: 'Chef', hometown: 'Coastline City', tagline: 'Cooks under pressure, argues under oath.', heat: 78 },
  { id: 'con_02', slug: 'dev-rahman', displayName: 'Dev Rahman', age: 31, occupation: 'Stand-up comic', hometown: 'Old Quarter', tagline: 'Turns every task into a bit.', heat: 71 },
  { id: 'con_03', slug: 'mira-sol', displayName: 'Mira Sol', age: 24, occupation: 'Dancer', hometown: 'Riverbend', tagline: 'Quiet all week, unstoppable on task day.', heat: 66 },
  { id: 'con_04', slug: 'kofi-adeyemi', displayName: 'Kofi Adeyemi', age: 29, occupation: 'Firefighter', hometown: 'Northgate', tagline: 'The house calls him when something breaks.', heat: 62 },
  { id: 'con_05', slug: 'lena-frost', displayName: 'Lena Frost', age: 33, occupation: 'Chess coach', hometown: 'Highvale', tagline: 'Three moves ahead of every alliance.', heat: 59 },
  { id: 'con_06', slug: 'tomas-reyes', displayName: 'Tomás Reyes', age: 26, occupation: 'Mechanic', hometown: 'Southport', tagline: 'Fixes the kitchen and the drama.', heat: 54 },
  { id: 'con_07', slug: 'nadia-kaur', displayName: 'Nadia Kaur', age: 22, occupation: 'Student', hometown: 'Greenfields', tagline: 'Youngest in the house, loudest in the diary room.', heat: 48 },
  { id: 'con_08', slug: 'ivan-petrov', displayName: 'Ivan Petrov', age: 35, occupation: 'Ex-athlete', hometown: 'Stonebridge', tagline: 'Wins the physical tasks, loses the arguments.', heat: 44 },
  { id: 'con_09', slug: 'yuki-tanaka', displayName: 'Yuki Tanaka', age: 28, occupation: 'Illustrator', hometown: 'Lantern Bay', tagline: 'Draws the house — and reads it.', heat: 39 },
  { id: 'con_10', slug: 'grace-obi', displayName: 'Grace Obi', age: 30, occupation: 'Nurse', hometown: 'Eastmoor', tagline: 'The peacemaker nobody wants to nominate.', heat: 35 },
];

async function seedShow() {
  await prisma.show.upsert({
    where: { id: SHOW_ID },
    update: { status: 'LIVE' },
    create: {
      id: SHOW_ID,
      slug: 'the-house-demo',
      name: 'The House (Demo Season)',
      tagline: 'Ten strangers. One house. Every decision on camera.',
      description:
        'A fictional placeholder show used for development. No real programme, brand or person is depicted.',
      status: 'LIVE',
      startsAt: at(-days(84)),
      endsAt: at(days(21)),
      currencySymbol: '₹',
    },
  });

  await prisma.season.upsert({
    where: { id: SEASON_ID },
    update: {},
    create: {
      id: SEASON_ID,
      showId: SHOW_ID,
      number: 1,
      name: 'Demo Season 1',
      startsAt: at(-days(84)),
    },
  });

  await prisma.episode.upsert({
    where: { id: PREVIOUS_EPISODE_ID },
    update: {},
    create: {
      id: PREVIOUS_EPISODE_ID,
      showId: SHOW_ID,
      seasonId: SEASON_ID,
      number: 11,
      title: 'The Broken Alliance',
      synopsis: 'Two alliances collapse over a single missing ingredient.',
      airsAt: at(-days(1)),
      endedAt: at(-days(1) + hours(1.5)),
      status: 'ENDED',
      isLive: false,
    },
  });

  await prisma.episode.upsert({
    where: { id: EPISODE_ID },
    update: { status: 'LIVE', isLive: true },
    create: {
      id: EPISODE_ID,
      showId: SHOW_ID,
      seasonId: SEASON_ID,
      number: 12,
      title: 'Nomination Night',
      synopsis: 'The house nominates, the audience reacts, the kitchen budget runs out.',
      airsAt: at(-minutes(40)),
      status: 'LIVE',
      isLive: true,
    },
  });

  for (const contestant of CONTESTANTS) {
    await prisma.contestant.upsert({
      where: { id: contestant.id },
      update: { heatScore: contestant.heat },
      create: {
        id: contestant.id,
        showId: SHOW_ID,
        seasonId: SEASON_ID,
        slug: contestant.slug,
        displayName: contestant.displayName,
        tagline: contestant.tagline,
        bio: `${contestant.displayName} is a fictional contestant created for development. ${contestant.tagline}`,
        age: contestant.age,
        occupation: contestant.occupation,
        hometown: contestant.hometown,
        status: 'ACTIVE',
        enteredAt: at(-days(84)),
        heatScore: contestant.heat,
        heatTrend: contestant.heat > 60 ? 'UP' : contestant.heat < 45 ? 'DOWN' : 'FLAT',
        heatUpdatedAt: now,
      },
    });
  }

  console.log(`  ✓ 1 show, 1 season, 2 episodes, ${CONTESTANTS.length} contestants`);
}

const EVENTS = [
  { id: 'evt_01', type: 'TASK' as const, title: 'The Balance Task', description: 'Teams had to keep a tray of glasses level for twenty minutes.', offset: -hours(26), contestants: ['con_01', 'con_04', 'con_08'], major: true },
  { id: 'evt_02', type: 'ARGUMENT' as const, title: 'The Missing Ingredient', description: 'A disagreement in the kitchen escalated after supplies ran short.', offset: -hours(22), contestants: ['con_01', 'con_06'], major: true },
  { id: 'evt_03', type: 'TWIST' as const, title: 'The Silent Hour', description: 'For one hour nobody in the house was allowed to speak.', offset: -hours(18), contestants: [], major: false },
  { id: 'evt_04', type: 'ANNOUNCEMENT' as const, title: 'Immunity Announced', description: 'One contestant received immunity for the coming week.', offset: -hours(4), contestants: ['con_03'], major: true },
  { id: 'evt_05', type: 'NOMINATION' as const, title: 'Nomination Night Begins', description: 'The house entered the nomination room one by one.', offset: -minutes(35), contestants: ['con_02', 'con_05', 'con_07', 'con_09'], major: true },
  { id: 'evt_06', type: 'KITCHEN' as const, title: 'Budget Cut', description: 'The weekly food budget was reduced after a failed task.', offset: -minutes(30), contestants: [], major: false },
];

async function seedEvents() {
  for (const event of EVENTS) {
    await prisma.event.upsert({
      where: { id: event.id },
      update: {},
      create: {
        id: event.id,
        showId: SHOW_ID,
        episodeId: event.offset < -hours(12) ? PREVIOUS_EPISODE_ID : EPISODE_ID,
        type: event.type,
        title: event.title,
        description: event.description,
        occurredAt: at(event.offset),
        isMajor: event.major,
      },
    });

    for (const contestantId of event.contestants) {
      await prisma.eventContestant.upsert({
        where: { eventId_contestantId: { eventId: event.id, contestantId } },
        update: {},
        create: { eventId: event.id, contestantId },
      });
    }
  }
  console.log(`  ✓ ${EVENTS.length} show events`);
}

// ---------------------------------------------------------------------------
// Heat history (metrics + snapshots so the 24h / 7d / season charts have data)
// ---------------------------------------------------------------------------

async function seedHeat() {
  const metricKeys = [
    'audienceVotes',
    'reactions',
    'profileViews',
    'contentEngagement',
    'predictionActivity',
    'challengeActivity',
  ];

  let snapshotCount = 0;

  for (const contestant of CONTESTANTS) {
    for (const [index, metricKey] of metricKeys.entries()) {
      // Deterministic pseudo-values derived from the contestant's heat, so the
      // seeded snapshots are reproducible across runs.
      const value = Math.round(contestant.heat * (1 + index * 0.35) * 3.7);
      await prisma.contestantMetric.upsert({
        where: { contestantId_metricKey: { contestantId: contestant.id, metricKey } },
        update: { value },
        create: { contestantId: contestant.id, metricKey, value },
      });
    }

    // 90 days of history at 6-hour resolution would be 360 rows per contestant;
    // hourly for the last 24h plus daily for the season keeps the charts honest
    // without bloating the demo database.
    const points: { offset: number; score: number }[] = [];
    for (let hour = 24; hour >= 0; hour -= 2) {
      const wobble = Math.sin((hour + contestant.heat) / 3) * 4;
      points.push({ offset: -hours(hour), score: clampHeat(contestant.heat + wobble) });
    }
    for (let day = 30; day >= 2; day -= 1) {
      const drift = Math.sin((day + contestant.heat) / 6) * 9 - day * 0.2;
      points.push({ offset: -days(day), score: clampHeat(contestant.heat + drift) });
    }

    for (const point of points) {
      const computedAt = at(point.offset);
      await prisma.contestantHeatSnapshot.create({
        data: {
          contestantId: contestant.id,
          heatScore: Number(point.score.toFixed(2)),
          trend: point.score > contestant.heat ? 'UP' : point.score < contestant.heat ? 'DOWN' : 'FLAT',
          inputs: {
            seeded: true,
            baseline: contestant.heat,
            note: 'Seeded demo history; not produced by ContestantHeatService.',
          },
          computedAt,
        },
      });
      snapshotCount += 1;
    }
  }

  console.log(`  ✓ ${snapshotCount} heat snapshots + ${CONTESTANTS.length * metricKeys.length} metrics`);
}

function clampHeat(value: number): number {
  return Math.min(100, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Participation fixtures
// ---------------------------------------------------------------------------

async function seedPredictions() {
  await prisma.prediction.upsert({
    where: { id: 'pred_open_1' },
    update: { status: 'OPEN' },
    create: {
      id: 'pred_open_1',
      showId: SHOW_ID,
      episodeId: EPISODE_ID,
      question: "Who will be nominated first tonight?",
      description: 'Nominations are read out in the order the house entered the room.',
      status: 'OPEN',
      opensAt: at(-minutes(30)),
      closesAt: at(minutes(45)),
      participationPoints: DEFAULT_POINT_RULES.PREDICTION_PARTICIPATION,
      rewardPoints: DEFAULT_POINT_RULES.PREDICTION_CORRECT,
      createdById: 'usr_producer',
      options: {
        create: [
          { id: 'predopt_1a', label: 'Dev Rahman', contestantId: 'con_02', sortOrder: 0 },
          { id: 'predopt_1b', label: 'Lena Frost', contestantId: 'con_05', sortOrder: 1 },
          { id: 'predopt_1c', label: 'Nadia Kaur', contestantId: 'con_07', sortOrder: 2 },
          { id: 'predopt_1d', label: 'Yuki Tanaka', contestantId: 'con_09', sortOrder: 3 },
        ],
      },
    },
  });

  await prisma.prediction.upsert({
    where: { id: 'pred_open_2' },
    update: { status: 'OPEN' },
    create: {
      id: 'pred_open_2',
      showId: SHOW_ID,
      episodeId: EPISODE_ID,
      question: 'Will the house complete tonight’s task?',
      status: 'OPEN',
      opensAt: at(-minutes(20)),
      closesAt: at(hours(2)),
      createdById: 'usr_producer',
      options: {
        create: [
          { id: 'predopt_2a', label: 'Yes, comfortably', sortOrder: 0 },
          { id: 'predopt_2b', label: 'Yes, but only just', sortOrder: 1 },
          { id: 'predopt_2c', label: 'No', sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.prediction.upsert({
    where: { id: 'pred_resolved_1' },
    update: {},
    create: {
      id: 'pred_resolved_1',
      showId: SHOW_ID,
      episodeId: PREVIOUS_EPISODE_ID,
      eventId: 'evt_01',
      question: 'Who will win the balance task?',
      status: 'RESOLVED',
      opensAt: at(-hours(30)),
      closesAt: at(-hours(26)),
      resolvedAt: at(-hours(25)),
      createdById: 'usr_producer',
      options: {
        create: [
          { id: 'predopt_3a', label: 'Aria Vale', contestantId: 'con_01', sortOrder: 0, entryCount: 2 },
          { id: 'predopt_3b', label: 'Kofi Adeyemi', contestantId: 'con_04', sortOrder: 1, entryCount: 1 },
          { id: 'predopt_3c', label: 'Ivan Petrov', contestantId: 'con_08', sortOrder: 2, entryCount: 0 },
        ],
      },
    },
  });

  await prisma.predictionResult.upsert({
    where: { predictionId: 'pred_resolved_1' },
    update: {},
    create: {
      predictionId: 'pred_resolved_1',
      correctOptionId: 'predopt_3a',
      resolvedById: 'usr_producer',
      resolvedAt: at(-hours(25)),
      totalEntries: 3,
      correctEntries: 2,
      notes: 'Confirmed against the broadcast recording.',
    },
  });

  const resolvedEntries = [
    { userId: 'usr_viewer1', optionId: 'predopt_3a', isCorrect: true },
    { userId: 'usr_viewer2', optionId: 'predopt_3a', isCorrect: true },
    { userId: 'usr_viewer3', optionId: 'predopt_3b', isCorrect: false },
  ];

  for (const entry of resolvedEntries) {
    await prisma.predictionEntry.upsert({
      where: { predictionId_userId: { predictionId: 'pred_resolved_1', userId: entry.userId } },
      update: {},
      create: {
        predictionId: 'pred_resolved_1',
        userId: entry.userId,
        optionId: entry.optionId,
        isCorrect: entry.isCorrect,
        awardedAt: at(-hours(25)),
        createdAt: at(-hours(27)),
      },
    });
  }

  await prisma.prediction.update({
    where: { id: 'pred_resolved_1' },
    data: { entryCount: resolvedEntries.length },
  });

  console.log('  ✓ 3 predictions (2 open, 1 resolved with entries)');
}

async function seedPolls() {
  await prisma.livePoll.upsert({
    where: { id: 'poll_active_1' },
    update: { status: 'ACTIVE' },
    create: {
      id: 'poll_active_1',
      showId: SHOW_ID,
      episodeId: EPISODE_ID,
      question: 'Who should get the last spot in tonight’s task?',
      description: 'Voting closes when the timer runs out.',
      status: 'ACTIVE',
      opensAt: at(-minutes(3)),
      closesAt: at(minutes(7)),
      durationSeconds: 600,
      participationPoints: DEFAULT_POINT_RULES.POLL_PARTICIPATION,
      createdById: 'usr_producer',
      options: {
        create: [
          { id: 'pollopt_1a', label: 'Mira Sol', contestantId: 'con_03', sortOrder: 0 },
          { id: 'pollopt_1b', label: 'Tomás Reyes', contestantId: 'con_06', sortOrder: 1 },
          { id: 'pollopt_1c', label: 'Grace Obi', contestantId: 'con_10', sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.livePoll.upsert({
    where: { id: 'poll_closed_1' },
    update: {},
    create: {
      id: 'poll_closed_1',
      showId: SHOW_ID,
      episodeId: PREVIOUS_EPISODE_ID,
      question: 'Was the kitchen argument fair?',
      status: 'PUBLISHED',
      opensAt: at(-hours(22)),
      closesAt: at(-hours(21.8)),
      closedAt: at(-hours(21.8)),
      publishedAt: at(-hours(21.7)),
      totalVotes: 3,
      version: 4,
      createdById: 'usr_producer',
      options: {
        create: [
          { id: 'pollopt_2a', label: 'Yes', sortOrder: 0, voteCount: 1 },
          { id: 'pollopt_2b', label: 'No', sortOrder: 1, voteCount: 2 },
        ],
      },
    },
  });

  const closedVotes = [
    { userId: 'usr_viewer1', optionId: 'pollopt_2b' },
    { userId: 'usr_viewer2', optionId: 'pollopt_2b' },
    { userId: 'usr_viewer3', optionId: 'pollopt_2a' },
  ];

  for (const vote of closedVotes) {
    await prisma.pollVote.upsert({
      where: { pollId_userId: { pollId: 'poll_closed_1', userId: vote.userId } },
      update: {},
      create: {
        pollId: 'poll_closed_1',
        userId: vote.userId,
        optionId: vote.optionId,
        createdAt: at(-hours(21.9)),
      },
    });
  }

  console.log('  ✓ 2 live polls (1 active, 1 published with votes)');
}

async function seedPerspectives() {
  await prisma.audiencePerspective.upsert({
    where: { id: 'persp_1' },
    update: { status: 'OPEN' },
    create: {
      id: 'persp_1',
      showId: SHOW_ID,
      episodeId: PREVIOUS_EPISODE_ID,
      eventId: 'evt_02',
      question: 'In the kitchen argument, who was right?',
      description: 'Think about what each of them actually said, not who you like.',
      status: 'OPEN',
      opensAt: at(-hours(21)),
      closesAt: at(hours(12)),
      createdById: 'usr_producer',
      options: {
        create: [
          { id: 'perspopt_1a', label: 'Aria was right', contestantId: 'con_01', sortOrder: 0 },
          { id: 'perspopt_1b', label: 'Tomás was right', contestantId: 'con_06', sortOrder: 1 },
          { id: 'perspopt_1c', label: 'Both were out of line', sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.audiencePerspective.upsert({
    where: { id: 'persp_2' },
    update: {},
    create: {
      id: 'persp_2',
      showId: SHOW_ID,
      episodeId: PREVIOUS_EPISODE_ID,
      eventId: 'evt_04',
      question: 'Was giving immunity to one contestant fair this week?',
      status: 'OPEN',
      opensAt: at(-hours(3)),
      closesAt: at(days(1)),
      createdById: 'usr_producer',
      options: {
        create: [
          { id: 'perspopt_2a', label: 'Fair — she earned it', sortOrder: 0 },
          { id: 'perspopt_2b', label: 'Unfair — the task was rigged', sortOrder: 1 },
        ],
      },
    },
  });

  console.log('  ✓ 2 audience perspectives');
}

async function seedChallenges() {
  await prisma.challengeCycle.upsert({
    where: { id: 'cycle_1' },
    update: { status: 'OPEN' },
    create: {
      id: 'cycle_1',
      showId: SHOW_ID,
      episodeId: EPISODE_ID,
      title: 'Week 12 audience challenges',
      status: 'OPEN',
      opensAt: at(-days(1)),
      closesAt: at(days(1)),
      topN: 3,
      rankingConfig: { votes: 0.7, recency: 0.2, authorTrust: 0.1 },
      createdById: 'usr_producer',
    },
  });

  const challenges = [
    { id: 'chal_1', authorId: 'usr_viewer1', title: 'Silent breakfast', description: 'The house must prepare and eat breakfast without speaking a single word.', category: 'MENTAL' as const, status: 'COMMUNITY_VOTING' as const, votes: 3 },
    { id: 'chal_2', authorId: 'usr_viewer2', title: 'Swap the roles', description: 'Every contestant takes over another contestant’s daily duties for a full day.', category: 'SOCIAL' as const, status: 'COMMUNITY_VOTING' as const, votes: 2 },
    { id: 'chal_3', authorId: 'usr_viewer3', title: 'Blindfold cook-off', description: 'Two contestants cook a full meal blindfolded while a third gives instructions.', category: 'FUNNY' as const, status: 'COMMUNITY_VOTING' as const, votes: 1 },
    { id: 'chal_4', authorId: 'usr_viewer4', title: 'The long hold', description: 'Contestants hold a plank position in shifts until the whole house has done an hour.', category: 'ENDURANCE' as const, status: 'MODERATION' as const, votes: 0 },
  ];

  for (const challenge of challenges) {
    await prisma.audienceChallenge.upsert({
      where: { id: challenge.id },
      update: { status: challenge.status, voteCount: challenge.votes },
      create: {
        id: challenge.id,
        showId: SHOW_ID,
        authorId: challenge.authorId,
        title: challenge.title,
        description: challenge.description,
        category: challenge.category,
        targetType: 'HOUSE',
        status: challenge.status,
        moderationStatus: challenge.status === 'MODERATION' ? 'PENDING' : 'APPROVED',
        voteCount: challenge.votes,
        createdAt: at(-hours(20)),
      },
    });

    if (challenge.status === 'COMMUNITY_VOTING') {
      await prisma.challengeSubmission.upsert({
        where: { challengeId_cycleId: { challengeId: challenge.id, cycleId: 'cycle_1' } },
        update: {},
        create: {
          challengeId: challenge.id,
          cycleId: 'cycle_1',
          status: 'APPROVED',
          score: challenge.votes,
        },
      });
    }
  }

  const votes = [
    { challengeId: 'chal_1', userId: 'usr_viewer2' },
    { challengeId: 'chal_1', userId: 'usr_viewer3' },
    { challengeId: 'chal_1', userId: 'usr_viewer4' },
    { challengeId: 'chal_2', userId: 'usr_viewer1' },
    { challengeId: 'chal_2', userId: 'usr_viewer5' },
    { challengeId: 'chal_3', userId: 'usr_viewer6' },
  ];

  for (const vote of votes) {
    await prisma.challengeVote.upsert({
      where: { challengeId_userId: { challengeId: vote.challengeId, userId: vote.userId } },
      update: {},
      create: { ...vote, cycleId: 'cycle_1' },
    });
  }

  console.log(`  ✓ 1 challenge cycle, ${challenges.length} challenges, ${votes.length} votes`);
}

async function seedRounds() {
  await prisma.nominationRound.upsert({
    where: { id: 'nom_round_1' },
    update: { status: 'OPEN' },
    create: {
      id: 'nom_round_1',
      showId: SHOW_ID,
      episodeId: EPISODE_ID,
      title: 'Week 12 nominations',
      description:
        'Pick the contestants you believe should face nomination. This is the audience view, not the show’s official nomination.',
      status: 'OPEN',
      opensAt: at(-minutes(30)),
      closesAt: at(hours(3)),
      maxVotesPerUser: 2,
      createdById: 'usr_producer',
      candidates: {
        create: CONTESTANTS.slice(0, 8).map((contestant) => ({
          contestantId: contestant.id,
          eligible: true,
        })),
      },
    },
  });

  await prisma.evictionRound.upsert({
    where: { id: 'evic_round_1' },
    update: {},
    create: {
      id: 'evic_round_1',
      showId: SHOW_ID,
      episodeId: EPISODE_ID,
      title: 'Week 12 eviction — save your favourite',
      description:
        'Vote to SAVE a nominated contestant. The audience result is published here; the official eviction is announced by production.',
      status: 'DRAFT',
      opensAt: at(hours(4)),
      closesAt: at(days(1)),
      maxVotesPerUser: 3,
      voteMeaning: 'SAVE',
      createdById: 'usr_producer',
      candidates: {
        create: ['con_02', 'con_05', 'con_07', 'con_09'].map((contestantId) => ({
          contestantId,
          eligible: true,
        })),
      },
    },
  });

  console.log('  ✓ 1 nomination round (open) + 1 eviction round (draft)');
}

async function seedKitchen() {
  await prisma.kitchenBudget.upsert({
    where: { id: 'budget_wk12' },
    update: {},
    create: {
      id: 'budget_wk12',
      showId: SHOW_ID,
      label: 'Week 12 food budget',
      totalUnits: 12_000,
      spentUnits: 4_300,
      currencySymbol: '₹',
      periodStart: at(-days(2)),
      periodEnd: at(days(5)),
      createdById: 'usr_producer',
    },
  });

  await prisma.kitchenDecision.upsert({
    where: { id: 'kitchen_dec_1' },
    update: { status: 'OPEN' },
    create: {
      id: 'kitchen_dec_1',
      showId: SHOW_ID,
      episodeId: EPISODE_ID,
      budgetId: 'budget_wk12',
      title: 'Tomorrow’s main meal',
      question: 'What should the house cook tomorrow?',
      status: 'OPEN',
      opensAt: at(-minutes(25)),
      closesAt: at(hours(6)),
      maxSelections: 2,
      maxQuantity: 8,
      createdById: 'usr_producer',
      options: {
        create: [
          { id: 'kopt_rice', kind: 'MENU', label: 'Rice', unitCost: 600, quantity: 4, unit: 'kg', sortOrder: 0 },
          { id: 'kopt_chicken', kind: 'MENU', label: 'Chicken', unitCost: 2400, quantity: 3, unit: 'kg', sortOrder: 1 },
          { id: 'kopt_veg', kind: 'MENU', label: 'Vegetables', unitCost: 900, quantity: 5, unit: 'kg', sortOrder: 2 },
          { id: 'kopt_dessert', kind: 'SPECIAL', label: 'Dessert', unitCost: 1500, quantity: 1, unit: 'batch', sortOrder: 3 },
        ],
      },
    },
  });

  await prisma.kitchenDecision.upsert({
    where: { id: 'kitchen_dec_2' },
    update: { status: 'OPEN' },
    create: {
      id: 'kitchen_dec_2',
      showId: SHOW_ID,
      episodeId: EPISODE_ID,
      budgetId: 'budget_wk12',
      title: 'How much rice?',
      question: 'How much rice should be bought?',
      status: 'OPEN',
      opensAt: at(-minutes(25)),
      closesAt: at(hours(6)),
      maxSelections: 1,
      maxQuantity: 8,
      createdById: 'usr_producer',
      options: {
        create: [
          { id: 'kopt_q2', kind: 'QUANTITY', label: '2 kg', unitCost: 300, quantity: 2, unit: 'kg', sortOrder: 0 },
          { id: 'kopt_q4', kind: 'QUANTITY', label: '4 kg', unitCost: 600, quantity: 4, unit: 'kg', sortOrder: 1 },
          { id: 'kopt_q6', kind: 'QUANTITY', label: '6 kg', unitCost: 900, quantity: 6, unit: 'kg', sortOrder: 2 },
          { id: 'kopt_q8', kind: 'QUANTITY', label: '8 kg', unitCost: 1200, quantity: 8, unit: 'kg', sortOrder: 3 },
        ],
      },
    },
  });

  console.log('  ✓ 1 kitchen budget + 2 open kitchen decisions');
}

async function seedWeekend() {
  await prisma.weekendParticipationRound.upsert({
    where: { id: 'weekend_1' },
    update: { status: 'SUBMIT' },
    create: {
      id: 'weekend_1',
      showId: SHOW_ID,
      episodeId: EPISODE_ID,
      title: 'Weekend 12 — Ask the house',
      description:
        'Send a question for the weekend episode. Selected questions are read out on air.',
      status: 'SUBMIT',
      participationTypes: ['ASK_CONTESTANT', 'VIDEO_QUESTION', 'MINI_GAME'],
      opensAt: at(-days(1)),
      submissionDeadline: at(days(2)),
      closesAt: at(days(3)),
      shortlistSize: 10,
      selectionCount: 3,
      eligibilityConfig: { minPoints: 100, minActivities: 3 },
      allowPhysicalRewards: false,
      rewardDisclaimer:
        'Rewards for this round are on-air recognition and platform points only. No physical appearance, house visit or meeting is offered.',
      createdById: 'usr_producer',
      questions: {
        create: [
          {
            id: 'wq_1',
            prompt: 'What would you ask a contestant about last week’s argument?',
            type: 'ASK_CONTESTANT',
            sortOrder: 0,
            required: true,
            maxLength: 400,
          },
          {
            id: 'wq_2',
            prompt: 'Suggest a mini game for the weekend episode.',
            type: 'MINI_GAME',
            sortOrder: 1,
            maxLength: 400,
          },
        ],
      },
    },
  });

  console.log('  ✓ 1 weekend round (physical rewards disabled)');
}

// ---------------------------------------------------------------------------
// Points ledger for the demo viewers
// ---------------------------------------------------------------------------

async function seedLedger() {
  const entries = [
    { userId: 'usr_viewer1', delta: DEFAULT_POINT_RULES.PREDICTION_PARTICIPATION, sourceType: 'PREDICTION' as const, sourceId: 'pred_resolved_1', reason: 'participation' },
    { userId: 'usr_viewer1', delta: DEFAULT_POINT_RULES.PREDICTION_CORRECT, sourceType: 'PREDICTION' as const, sourceId: 'pred_resolved_1', reason: 'correct' },
    { userId: 'usr_viewer1', delta: DEFAULT_POINT_RULES.POLL_PARTICIPATION, sourceType: 'POLL' as const, sourceId: 'poll_closed_1', reason: 'participation' },
    { userId: 'usr_viewer2', delta: DEFAULT_POINT_RULES.PREDICTION_PARTICIPATION, sourceType: 'PREDICTION' as const, sourceId: 'pred_resolved_1', reason: 'participation' },
    { userId: 'usr_viewer2', delta: DEFAULT_POINT_RULES.PREDICTION_CORRECT, sourceType: 'PREDICTION' as const, sourceId: 'pred_resolved_1', reason: 'correct' },
    { userId: 'usr_viewer3', delta: DEFAULT_POINT_RULES.PREDICTION_PARTICIPATION, sourceType: 'PREDICTION' as const, sourceId: 'pred_resolved_1', reason: 'participation' },
    { userId: 'usr_viewer3', delta: DEFAULT_POINT_RULES.CHALLENGE_SUBMISSION, sourceType: 'CHALLENGE' as const, sourceId: 'chal_3', reason: 'submission' },
  ];

  // Balances start from the profile figures seeded above; the ledger rows here
  // are the *most recent* activity, so balanceAfter builds on that baseline.
  const running = new Map<string, number>();

  for (const entry of entries) {
    const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: entry.userId } });
    const base = running.get(entry.userId) ?? profile.pointsBalance;
    const balanceAfter = base + entry.delta;
    running.set(entry.userId, balanceAfter);

    await prisma.pointsLedger.upsert({
      where: {
        userId_sourceType_sourceId_reason: {
          userId: entry.userId,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          reason: entry.reason,
        },
      },
      update: {},
      create: {
        userId: entry.userId,
        delta: entry.delta,
        balanceAfter,
        entryType: 'EARN',
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        reason: entry.reason,
        createdAt: at(-hours(24)),
      },
    });
  }

  for (const [userId, balance] of running) {
    await prisma.userProfile.update({
      where: { userId },
      data: { pointsBalance: balance, lifetimePoints: balance },
    });
  }

  console.log(`  ✓ ${entries.length} ledger entries`);
}

async function seedNotificationPreferences() {
  const types = ['POLL_STARTED', 'PREDICTION_CLOSING', 'REWARD_RECEIVED', 'WEEKEND_OPEN'] as const;
  let count = 0;

  for (const user of DEMO_USERS) {
    for (const type of types) {
      await prisma.notificationPreference.upsert({
        where: { userId_type: { userId: user.id, type } },
        update: {},
        create: { userId: user.id, type, inApp: true, email: false, push: false },
      });
      count += 1;
    }
  }

  console.log(`  ✓ ${count} notification preferences`);
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\nSeeding demo data (fictional placeholder content)…\n');

  await seedAccessControl();
  await seedPointsRules();
  await seedRewards();
  await seedUsers();
  await seedShow();
  await seedEvents();
  await seedHeat();
  await seedPredictions();
  await seedPolls();
  await seedPerspectives();
  await seedChallenges();
  await seedRounds();
  await seedKitchen();
  await seedWeekend();
  await seedLedger();
  await seedNotificationPreferences();

  console.log('\nSeed complete.\n');
  console.log('  Demo accounts (development only):');
  console.log('    admin@reality.local     / DemoPass!2026   ADMIN');
  console.log('    producer@reality.local  / DemoPass!2026   PRODUCER');
  console.log('    moderator@reality.local / DemoPass!2026   MODERATOR');
  console.log('    viewer1@reality.local   / DemoPass!2026   USER\n');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
