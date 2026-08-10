/**
 * The illustrative data behind the eight feature cards.
 *
 * Fictional, like everything else on the landing page, and separated from
 * `mock-landing.ts` because these numbers exist to make each card show what its
 * feature *looks like in use* — a prediction split, a heat reading, a budget —
 * rather than to describe the feature in prose.
 */

export const predictionDemo = {
  question: 'Who gets captaincy tonight?',
  options: [
    { name: 'Aisha', percent: 45 },
    { name: 'Rahul', percent: 35 },
    { name: 'Mira', percent: 20 },
  ],
  playing: 8_240,
  closesInSeconds: 372,
};

export const challengeDemo = {
  submissions: 12_450,
  top: 'Cooking without fire',
  votes: 3_180,
};

export const heatDemo = [
  { name: 'Mira Sol', score: 82, trend: 'UP' as const },
  { name: 'Aria Vale', score: 78, trend: 'UP' as const },
  { name: 'Lena Frost', score: 59, trend: 'DOWN' as const },
];

export const perspectiveDemo = {
  question: 'In the kitchen argument, who was right?',
  left: { name: 'Aria Vale', percent: 62 },
  right: { name: 'Dev Rahman', percent: 38 },
  voices: 6_410,
};

export const livePollDemo = {
  question: 'Should the house get the luxury budget?',
  options: [
    { label: 'Yes, they earned it', percent: 58 },
    { label: 'No, they lost the task', percent: 42 },
  ],
  votesPerMinute: 3_910,
};

export const nominationDemo = {
  nominees: [
    { name: 'Tomás Reyes', support: 41 },
    { name: 'Grace Obi', support: 34 },
    { name: 'Dev Rahman', support: 25 },
  ],
  closesInSeconds: 1_845,
};

export const kitchenDemo = {
  budgetTotal: 5_000,
  budgetSpent: 3_150,
  basket: [
    { label: 'Rice', chosen: true },
    { label: 'Chicken', chosen: true },
    { label: 'Vegetables', chosen: true },
    { label: 'Dessert', chosen: false },
  ],
};

export const weekendDemo = {
  entries: 2_180,
  shortlisted: 24,
  selected: 3,
};
