# Phase reports

Running log of what each phase delivered, what was actually executed, and what was left open.
Nothing is recorded here as "verified" unless the command was run and its output observed.

---

## Phase 0 — Architecture

**Deliverable:** [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

Covers repository inspection, product definition and the explicit *not a fantasy league* rule,
technology decisions (including why Fastify was chosen over NestJS), folder structure, entity map,
API boundaries, WebSocket event catalogue, role/permission model, environment variables,
development commands, the 25-phase plan, and a contradiction review of requirements vs. design.

Ten potential requirement/architecture contradictions were reviewed; all ten have an enforcement
point in the schema or service layer rather than only in prose. No blocking contradiction found.

---

## Phase 1 — Monorepo, tooling, infrastructure, health

### Files created

```
package.json  pnpm-workspace.yaml  turbo.json  .gitignore  .prettierrc.json  .prettierignore
.env.example  docker-compose.yml   README.md    scripts/setup-env.mjs

packages/config/   package.json, eslint/{base,node,react}.mjs, prettier/index.json,
                   tsconfig/{base,node,react}.json
packages/shared/   package.json, tsconfig.json, eslint.config.mjs, vitest.config.ts,
                   src/{index,enums,errors,constants}.ts, src/schemas/common.ts,
                   src/__tests__/shared.test.ts
packages/ui/       package.json, tsconfig.json, eslint.config.mjs,
                   src/index.ts, src/lib/cn.ts, src/styles/tokens.css

apps/api/          package.json, tsconfig.json, eslint.config.mjs, tsup.config.ts,
                   vitest.config.ts, prisma/schema.prisma,
                   src/index.ts, src/app.ts,
                   src/core/{config,logger,errors,prisma,redis,validation,plugins}.ts,
                   src/modules/index.ts, src/modules/health/{health.routes,health.service}.ts,
                   src/modules/health/__tests__/health.service.test.ts,
                   tests/{setup,app,errors,config}.test.ts

apps/web/          package.json, tsconfig.json, eslint.config.mjs, next.config.mjs,
                   postcss.config.mjs, tailwind.config.ts, next-env.d.ts,
                   src/app/{layout.tsx,page.tsx,globals.css},
                   src/lib/env.ts, src/components/system/api-status.tsx
```

### Commands to run locally

```bash
pnpm install
pnpm setup:env
pnpm dev:infra     # postgres :5442, redis :6389
pnpm dev           # api :4000, web :3010
```

### Results actually observed

| Check | Command | Result |
| --- | --- | --- |
| Install | `pnpm install` | clean, 0 peer-dependency warnings after version alignment |
| Typecheck | `pnpm typecheck` | 7/7 tasks pass |
| Lint | `pnpm lint` | 5/5 tasks pass, 0 warnings |
| Tests | `pnpm test` | 24 passed (api 17, shared 7) |
| Build | `pnpm build` | api → `dist/index.js` (17.5 KB); web → 4 static routes, 102 KB shared JS |
| Runtime | `node apps/api/dist/index.js` + `curl /health` | `{"status":"ok","dependencies":{"database":"up","redis":"up"}}` |
| Runtime | `next start -p 3010` + `curl /` | HTTP 200, landing page renders, status panel present |
| Infra | `docker compose ps` | `reality_postgres` healthy, `reality_redis` healthy |

### Decisions worth recording

- **Fastify over NestJS.** Allowed by the brief; rationale in `ARCHITECTURE.md` §2.1.
- **Non-default ports.** 5432/6379/3000 were already in use on this machine, so the stack uses
  5442/6389/4000/3010.
- **Workspace packages are consumed as TypeScript source** (no build step) and use *extensionless*
  relative imports, because Next's webpack does not remap `./x.js` to `./x.ts`. The API keeps
  `.js` extensions in its own source, which both `tsx` and `tsup` resolve correctly.
- **System font stacks only** — no `next/font/google`, so builds never need network access.
- **Node's `crypto.scrypt`** is planned for password hashing in Phase 3 instead of `argon2`,
  avoiding a native build dependency.

### Limitations at the end of Phase 1

- `prisma/schema.prisma` has a datasource and generator but no models yet; there are no migrations.
  Phase 2 supplies them.
- No authentication, no business endpoints, no WebSocket server yet.
- The landing page is a functional scaffold; Phase 4 replaces it with the production design.
- `tests/app.test.ts` tolerates a 503 from `/health` so unit tests pass without local infrastructure.

---

## Phase 2 — Database, migrations, seed

### Delivered

- `apps/api/prisma/schema.prisma` — 26 enums and **57 models** covering identity/access, the show
  domain, all eight participation pillars, the points economy, leaderboards, notifications,
  analytics and governance.
- `apps/api/prisma/migrations/20260809175701_init_domain_schema/` — the initial migration.
- `apps/api/prisma/seed.ts` — idempotent demo seed with fixed ids.
- `apps/api/src/core/permissions.ts` — permission catalogue with materialised role inheritance.
- `apps/api/src/core/password.ts` — scrypt password hashing (no native dependency).
- `apps/api/tests/global-setup.ts`, `tests/helpers/db.ts` — integration-test database harness.
- `apps/api/tests/integration/schema-invariants.test.ts` — 18 tests that prove the constraints.

### Invariants enforced by the database, with the test that proves each

| Invariant | Mechanism | Proven by |
| --- | --- | --- |
| One account per email | `User.email @unique` | rejects a second account on the same address |
| One account per verified phone | `User.phone @unique` | rejects a duplicate phone |
| Unique display name | `UserProfile.displayName @unique` | rejects a duplicate display name |
| One poll vote per user | `@@unique([pollId, userId])` | blocks duplicate, allows another user |
| One prediction per user per question | `@@unique([predictionId, userId])` | blocks second entry |
| One challenge vote per user | `@@unique([challengeId, userId])` | blocks duplicate |
| One perspective vote per user | `@@unique([perspectiveId, userId])` | blocks duplicate |
| One nomination vote per contestant | `@@unique([roundId, userId, contestantId])` | blocks duplicate |
| One kitchen selection per option | `@@unique([decisionId, userId, optionId])` | blocks duplicate |
| One weekend submission per type | `@@unique([roundId, userId, participationType])` | blocks duplicate |
| No duplicate point credit | `@@unique([userId, sourceType, sourceId, reason])` | blocks replay, allows a different reason |
| Immutable ledger | reversal rows reference the original | original row unchanged after reversal; replaying deltas reproduces the balance |
| No duplicate reward claim | `@@unique([userId, rewardId, cycleKey])` | blocks re-claim, allows the next cycle |
| Audience ≠ official outcome | separate `audienceResult` / `officialOutcome` columns | both stored independently |
| Soft deletion | `deletedAt` on user-authored/operator-visible content | excluded by `deletedAt: null`, still retrievable |

Vote, ledger and audit tables deliberately have **no** `deletedAt` — they are permanent records.

### Seed contents (all fictional)

1 show, 1 season, 2 episodes (one LIVE), 10 contestants, 6 show events, 420 heat snapshots +
60 metrics, 3 predictions (2 open / 1 resolved with entries and a result), 2 live polls
(1 active / 1 published with votes), 2 audience perspectives, 1 challenge cycle with 4 challenges
and 6 votes, 1 open nomination round, 1 draft eviction round, 1 kitchen budget with 2 open
decisions, 1 weekend round, 7 ledger entries, 36 notification preferences, 41 permissions,
15 points rules, 6 rewards, 9 demo users.

Demo accounts use the password `DemoPass!2026` and exist only in development seed data.

### Results actually observed

| Check | Result |
| --- | --- |
| `prisma validate` | schema valid |
| `prisma migrate dev` | migration `20260809175701_init_domain_schema` applied to an empty database |
| `pnpm db:seed` | completed, all counts printed above |
| `pnpm test` (api) | **35 passed** (17 unit + 18 schema-invariant integration) |
| `pnpm typecheck` | 7/7 pass |
| `pnpm lint` | 5/5 pass |

### Notes and limitations

- The Prisma CLI needs `DATABASE_URL` in its own working directory, so the `db:*` scripts are
  wrapped in `dotenv -e ../../.env`. `db:deploy` and `db:seed:prod` deliberately are **not**
  wrapped, because containers inject the environment directly.
- Integration tests use a separate `reality_test` database, created and migrated automatically by
  `tests/global-setup.ts`. They require `pnpm dev:infra` to be running and say so if it is not.
- `Leaderboard.showId` is nullable (community/global boards are not show-scoped), so its relation
  is optional.
- No services or endpoints touch these tables yet — that starts in Phase 3.

---

## Phase 3 — Authentication, sessions and roles

### Flows implemented

Sign up · log in · log out (single session and everywhere) · refresh with rotation · forgot
password · reset password · change password · email verification (+ resend) · session listing and
revocation · user profile · role/permission-guarded routes.

### Files added

```
packages/shared/src/schemas/auth.ts          shared zod contracts for every auth form
packages/ui/src/components/{button,field,card,alert}.tsx

apps/api/src/core/
  hashing.ts        sha256 for bearer secrets, HMAC for IP/device correlation
  throttle.ts       failure counters (account / IP / sensitive-action policies)
  mailer.ts         console + smtp drivers, message templates
  password.ts       scrypt hashing (added in Phase 2, tested here)
  permissions.ts    permission catalogue, materialised role inheritance
  auth/jwt.ts       short-lived HS256 access tokens (jose)
  auth/cookies.ts   access / refresh / CSRF cookie handling
  auth/context.ts   AuthContext + Fastify request augmentation
  auth/session-cache.ts  Redis-backed session resolution with DB fallback
  auth/guards.ts    authenticate, requireRole, requirePermission, requireVerifiedEmail, CSRF

apps/api/src/modules/auth/
  auth.service.ts   all flows
  auth.routes.ts    HTTP surface with per-route rate limits
  email-normalization.ts   canonical email form
  duplicate-detection.ts   layered anti-duplication

apps/api/src/modules/users/{users.routes,users.service}.ts

apps/web/src/lib/{api-client,query-keys}.ts
apps/web/src/providers/{index,query-provider,auth-provider}.tsx
apps/web/src/middleware.ts
apps/web/src/app/(auth)/{login,signup,forgot-password,reset-password,verify-email}/page.tsx
apps/web/src/components/auth/*.tsx
apps/web/src/app/(app)/{layout,dashboard,profile}  + components/{shell,dashboard,profile}
```

### Security decisions

| Concern | Approach |
| --- | --- |
| Password storage | Node `scrypt`, N=2^15/r=8/p=1, 16-byte salt, parameters stored with the hash so they can be raised later; transparent rehash on next login |
| Access token | HS256 JWT, 15 min, carries `sub`/`sid`/`role` |
| Refresh token | **Not** a JWT — opaque 32-byte secret stored as SHA-256, so it is revocable |
| Refresh rotation | Every refresh issues a new token and remembers the previous hash |
| Token theft | Presenting a rotated-away token destroys the entire session family |
| Session validity | Resolved per request (Redis, 30 s TTL, DB fallback) so logout/suspension/role change take effect immediately |
| CSRF | Double-submit token; required only for cookie-authenticated unsafe methods (bearer requests cannot be forged cross-origin) |
| Brute force | Per-account lock-out after 5 failures; per-IP threshold set to 30 so shared NATs are not collateral damage |
| User enumeration | Login, forgot-password and resend-verification give identical answers for known and unknown addresses |
| Error hygiene | Passwords never logged (pino redaction) and never echoed; 500s never expose internals |
| Open redirect | `?next=` accepts same-site relative paths only |
| Cookies | httpOnly + SameSite=Lax + Secure in production; refresh cookie scoped to `/api/v1/auth` |

### Unique-user architecture (four layers, none of them invasive)

1. **Unique email** — database constraint.
2. **Unique canonical email** — `emailNormalized` strips provider aliasing (gmail dots, `+tags`,
   domain aliases). This closes the "just add a plus sign" route to a second account.
3. **Verified email required to participate** — `requireVerifiedEmail` guards every participation
   endpoint; unverified accounts can browse but not vote. A verified-phone layer exists in the
   schema and is architecturally wired, with the transport left pluggable.
4. **Coarse device/session correlation** — a salted HMAC of user agent, language and network
   *prefix*. It creates an advisory `DuplicateSignal` for a moderator. It never blocks a signup and
   never bans anyone.

Explicitly **not** implemented: canvas/WebGL/audio fingerprinting, advertising identifiers,
cross-site tracking, or storage of raw IP addresses.

### Test results actually observed

`pnpm --filter @reality/api test` → **87 passed** across 8 files:

- `tests/integration/auth.test.ts` (35) — signup, duplicate email, duplicate display name, alias
  duplicate, weak password, terms acceptance, device recording, duplicate signals, verification
  (success/replay/forged), login (success, case-insensitivity, wrong password, enumeration parity,
  lock-out, suspended), protected routes (anonymous, forged bearer, permissions, missing CSRF,
  mismatched CSRF), logout (session end, token invalidation), refresh (rotation, replay detection),
  password reset (enumeration parity, full reset + session kill + token burn), sessions
  (listing, cross-user revocation refused), role protection (per-role permission matrix, role-change
  invalidation), profile (update, no email leak on public profile)
- `tests/integration/schema-invariants.test.ts` (18)
- `tests/password.test.ts` (8), `src/modules/auth/__tests__/email-normalization.test.ts` (9)
- plus the Phase 1 suites (17)

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 · `pnpm build` 4/4.

### Live verification against the running stack

| Check | Result |
| --- | --- |
| `POST /auth/signup` with `flow.test+alias@gmail.com` | 201, all three cookies set |
| `POST /auth/signup` with `flowtest@gmail.com` (same mailbox) | **409 EMAIL_TAKEN** |
| `GET /auth/me` before verifying | `emailVerified: false`, `status: PENDING_VERIFICATION` |
| `POST /auth/verify-email` with the emailed token | `emailVerified: true`, `status: ACTIVE` |
| Login as `admin@reality.local` | role ADMIN, **41 permissions** |
| Login as `viewer1@reality.local` | role USER, **0 permissions**, 1898 points |
| Login with a wrong password | 401 `INVALID_CREDENTIALS`, generic message |
| Cookie-authenticated `POST /auth/logout` without `X-CSRF-Token` | **403** |

### Limitations at the end of Phase 3

- Google OAuth and phone OTP are architecture placeholders: the tables, config and flow shape
  exist, but no provider is wired. Enabling either is a deliberate follow-up, not a hidden default.
- `MAIL_DRIVER=smtp` throws rather than silently pretending to send; the console driver is the
  working development transport.
- The app shell and dashboard are placeholders that Phase 5 replaces.

---

## Phase 4 — Design system and landing page

### Design language

Dark-first, high-contrast "live broadcast" palette defined entirely as HSL tokens in
`packages/ui/src/styles/tokens.css` and exposed through the Tailwind theme, so alpha modifiers
(`bg-surface/60`) work and a light theme is a token swap rather than a rewrite.

- **Neutrals**: cool, blue-shifted charcoals (background → surface → raised → overlay)
- **Brand**: stage magenta primary + electric cyan accent
- **Semantic**: success / warning / danger / live
- **Heat ramp**: five dedicated tokens (cold blue → scorching red) used *only* for contestant heat,
  so the colour itself carries the meaning
- **Type**: system font stacks only — no webfont fetch, so the build is hermetic and there is no
  layout shift on first paint
- **Motion**: three keyframes (`pulse-live`, `slide-up`, `shimmer`); everything is disabled under
  `prefers-reduced-motion`

No colour, mark, typeface or asset is taken from any existing programme.

### Components delivered (`packages/ui`)

| Requested | File |
| --- | --- |
| Button | `components/button.tsx` (7 variants x 4 sizes, `asChild`, loading + `aria-busy`) |
| Card | `components/card.tsx` (+ Header/Title/Description/Content/Footer) |
| Modal, Drawer | `components/overlays.tsx` (Radix Dialog: focus trap, escape, `aria-modal`) |
| Tabs, Badge, Avatar, ProgressBar, LiveIndicator | `components/primitives.tsx` |
| Countdown | `components/countdown.tsx` (compact + blocks, `role="timer"`, urgent state) |
| ContestantCard, HeatBadge, LeaderboardRow, StatCard, ChallengeCard, OptionResult | `components/domain.tsx` |
| PollCard, PredictionCard | `components/voting-cards.tsx` |
| EmptyState, LoadingState, ErrorState (+ Skeleton) | `components/states.tsx` |
| Input, Textarea, Label, FormField | `components/field.tsx` |

Two product decisions are encoded in the components rather than left to each screen:

- **Live tallies are hidden until you vote.** `PollCard` and `PredictionCard` withhold counts while
  the vote is open and the viewer has not participated, so the running total cannot nudge a choice.
- **The countdown is display only.** Whether a poll is still open is decided by the server when the
  vote arrives, so a wrong client clock cannot let anyone vote late.

### Landing page

All nine requested sections, composed in `apps/web/src/app/page.tsx`:
Hero, Live Show Preview, How It Works, Interactive Features, Contestant Preview, Rewards,
Leaderboard Preview, Closing CTA, Footer — plus a sticky `SiteHeader` with a mobile drawer.

Content is mock data (`src/lib/mock-landing.ts`), explicitly fictional, with a visible
"fictional placeholder" disclaimer in the preview panel and the footer, and a plain statement that
points are not purchasable, exchangeable or withdrawable.

### Results actually observed

| Check | Result |
| --- | --- |
| `pnpm typecheck` | 7/7 |
| `pnpm lint` | 5/5 |
| `pnpm build` | 4/4; landing page 6.72 kB, 167 kB first load; 9 static routes |
| Responsive (headless Chromium, real screenshots) | desktop 1440x900, tablet 834x1112, mobile 390x844 — **0 px horizontal overflow at every breakpoint**, all 7 sections present, h1 correct |
| Console errors | 1, and only when the API is stopped (`ERR_CONNECTION_REFUSED` from the `/auth/me` probe); none otherwise |

Screenshots were captured and visually inspected.

### Limitations

- The landing page is intentionally static and does not query the live show.
- `apps/web/src/components/system/api-status.tsx` (the Phase 1 wiring probe) was removed now that
  the real landing page exists.

---

## Phase 5 — Authenticated shell and dashboard

### API added

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/show/live` | Current show, live episode, latest event, `isLive`, `serverTime` (for clock-skew correction) |
| `GET /api/v1/show/episodes` | Recent episodes |
| `GET /api/v1/show/events` | Recent events with their contestants |
| `GET /api/v1/dashboard` | One authenticated payload for the whole dashboard |

`getCurrentShowId()` resolves the active show server-side, so no client ever passes a `showId`.

The dashboard endpoint runs 16 independent queries concurrently and returns a single consistent
snapshot: live state, points (balance / lifetime / earned today), activity, provisional leaderboard
rank, the five hottest contestants, and a per-module status block used to badge the navigation.

### Web added

- `AppShell` — desktop sidebar (grouped navigation + points pill) with a sticky top bar carrying
  the live indicator, current episode, notifications button and profile menu; mobile gets a compact
  header, a slide-in drawer and a five-item bottom bar with 56 px targets and
  `env(safe-area-inset-bottom)` padding.
- Navigation is data-driven (`src/lib/navigation.ts`) and badge counts come straight from the
  dashboard payload, so a new feature module needs one array entry, not layout surgery.
- `DashboardScreen` — live banner with the next real deadline as a countdown, four stat tiles,
  eight feature cards each describing their own live state, and a hottest-contestants panel.
- Staff-only entries (producer console) appear only when `hasRole('MODERATOR')` is true; the API
  enforces the same thing independently.

### Results actually observed

Signed in as the seeded `viewer1` account through the real UI, then measured at three breakpoints:

| Breakpoint | Horizontal overflow | Sidebar | Bottom nav | Countdown | Heading |
| --- | --- | --- | --- | --- | --- |
| 1440×900 | 0 px | visible | hidden | present | "Welcome back, NightOwl" |
| 834×1112 | 0 px | hidden | visible | present | same |
| 390×844 | 0 px | hidden | visible | present | same |

The rendered dashboard showed real seeded data: 1,898 points, rank #1 of 6, 2 open predictions,
3 challenges in community voting, ₹7,700 kitchen budget remaining, and the correct heat ordering
(Aria Vale 78 → Lena Frost 59).

Anonymous `GET /dashboard` returns `307 → /login?next=%2Fdashboard`, confirming route protection.

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 · `pnpm build` 4/4.

### Two real defects found by looking at the rendered page, and fixed

1. **"Episode 12 · Episode 12 — Nomination Night"** — seed titles carried an `Episode N — ` prefix
   that the UI adds itself. Seed titles corrected to just the episode name.
2. **An expired poll still counted as live.** The dashboard query selected polls by
   `status: 'ACTIVE'` only, so a seeded poll whose deadline had passed was reported as open with a
   countdown reading "Closing now". The query now also requires `closesAt > now`. The scheduled
   close job that flips the status arrives in Phase 10; until then the read model tells the truth.

### Known gaps at the end of Phase 5

- Twelve feature routes (`/predictions`, `/polls`, …) are still 404 and are prefetched by the
  sidebar links, which is the only source of console errors on the dashboard. Phases 6–17 create them.
- The notifications button navigates to a route that does not exist yet (Phase 16).
- Leaderboard rank is computed from the balance column one user at a time; Phase 15 replaces it
  with the Redis-backed ranking.

---

## Phase 6 — Contestant system and Heat Meter

### Points ledger core (built here, completed in Phase 14)

`apps/api/src/modules/points/points.service.ts` is the only code that moves points. Phase 7 onwards
depends on it, so it is built here rather than left until Phase 14:

- `awardPoints` / `spendPoints` / `reverseEntry` / `getBalance` / `getHistory` / `verifyLedger`
- Idempotent by construction: `@@unique(userId, sourceType, sourceId, reason)` means a replayed
  award returns `applied: false` instead of double-crediting
- The cached balance moves by an **atomic row-level increment** inside the same transaction that
  appends the ledger row, so two concurrent awards cannot race
- `balanceAfter` is written from the increment's return value, making the ledger self-verifying
- Point values come from the `PointsRule` table (30-second cache) with `DEFAULT_POINT_RULES` as a
  fallback, so feature modules never hard-code an amount
- Reversals are compensating rows; nothing is ever updated or deleted

### ContestantHeatService

`computeHeatScore(inputs, peaks, weights)` is a **pure function** — no database, no clock — which is
what makes it unit-testable and what lets the admin console show a reproducible breakdown.

Seven signals: audience votes (poll + nomination + eviction), reactions, profile views, content
engagement, prediction activity, challenge activity, and momentum.

Three deliberate design decisions:

1. **Relative, not absolute.** Each signal is normalised against the strongest contestant in the
   same run. Vote volume on a finale is nothing like a quiet Tuesday, so an absolute scale would
   make "heat 70" mean different things on different nights.
2. **Square-root normalisation.** One runaway contestant would otherwise flatten everyone else to
   zero; a contestant on 1% of the peak still scores 0.10 rather than 0.01.
3. **Signed momentum centred at 0.5.** A contestant who is merely *stable* is not punished; only a
   falling one loses ground.

The formula is never in frontend code — the client receives a score plus the component breakdown.
Weights are read from `Show.config.heatWeights` and fall back to `DEFAULT_HEAT_WEIGHTS`, so
production can retune without a deploy.

`recomputeShowHeat` appends an immutable `ContestantHeatSnapshot` (raw signals, normalised values,
weights, peaks, window, previous score) and updates the contestant's cached score in one transaction.

### API added

| Endpoint | Auth |
| --- | --- |
| `GET /contestants` (sort by heat or name) | public |
| `GET /contestants/:idOrSlug` | public — also records a profile view as a heat signal |
| `GET /contestants/:id/heat?window=24h\|7d\|season` | public, server-downsampled |
| `GET /contestants/:id/heat/inspect` | `heat.inspect` permission |
| `POST /contestants/heat/recompute` | `heat.inspect` permission |

Heat history is downsampled server-side into a fixed bucket count, so a chart receives ~30 points
whether the window holds 24 rows or 4,000.

### Web added

`/contestants` (heat-ordered grid with an A–Z toggle) and `/contestants/[slug]` (profile, heat
badge, three stat tiles, a Recharts area chart with 24h/7d/season tabs, recent events, related polls
and perspectives, audience support share).

### Results actually observed

- **11 new unit tests** for the heat formula, all passing: bounds, monotonicity, tail compression,
  momentum symmetry, trend classification, breakdown-reconstructs-the-score, empty cohort,
  configured weights override, and cohort ranking. Full API suite: **98 passed** across 9 files.
- Live recompute via `POST /contestants/heat/recompute` as the seeded admin: 10 contestants
  recomputed, ordering preserved (Aria Vale highest, Grace Obi lowest).
- Live `GET /contestants/con_01/heat/inspect` returned a breakdown that reconstructs the score
  exactly: reactions 0.15 + profileViews 0.10 + contentEngagement 0.10 = 0.35 of total weight 1.0
  → **35.00**, matching the stored score.
- The same endpoint as a signed-in viewer returned **403**.
- `GET /contestants/con_01/heat?window=24h` returned 12 downsampled points.
- `pnpm typecheck` 7/7 · `pnpm lint` 5/5 (0 warnings) · `pnpm build` 4/4.

### Note on the recomputed values

Seeded heat scores were arbitrary demo numbers (78, 71, …). The first real recompute produced a
narrower band (35 down to 26) because the demo database has almost no vote activity — only the
seeded reaction/view counters carry signal. The *ordering* is preserved and the arithmetic is
verifiable, which is the property that matters. Scores spread out as real participation arrives.

---

## Phase 7 — Prediction Game

### Rules, and where each is enforced

| Rule | Enforcement |
| --- | --- |
| One prediction per user per question | `@@unique([predictionId, userId])` — the application pre-check only produces a friendlier error |
| Predictions close automatically | `submitPrediction` compares `closesAt` to the clock on every request, so a missed scheduler run can never let a late entry through |
| No editing after submitting | there is no update path; a second submit is a 409 |
| Only authorised staff resolve a result | `prediction.resolve` permission on the route |
| Points awarded transactionally | entry + counters in one transaction, then the ledger award |
| Immutable ledger | all credits go through `awardPoints`, which is append-only and idempotent |

`closeExpiredPredictions()` exists as bookkeeping to flip status, explicitly *not* as the thing that
enforces the deadline.

### Deliberate product decision

Per-option entry counts are returned as **zero until the question is resolved**. Showing a live
distribution on an open question turns a prediction game into a popularity poll.

### API added

`GET /predictions?scope=open|mine|resolved|all` · `GET /predictions/:id` ·
`POST /predictions/:id/entries` (auth + verified email) ·
`POST /predictions/admin` · `PATCH /predictions/admin/:id` ·
`POST /predictions/admin/:id/{activate,close,resolve,cancel}`

State machine: `DRAFT → SCHEDULED → OPEN → CLOSED → RESOLVED`, with `CANCELLED` reachable from any
non-terminal state. Illegal transitions return `INVALID_STATE_TRANSITION`.

Also added `apps/api/src/modules/audit/audit.service.ts`: every operator mutation writes an
`AuditLog` row plus an `AdminAction` row. Audit writes are wrapped so a logging failure can never
fail the action it describes — a producer must not be blocked from closing a poll mid-show.

### Web added

`/predictions` with Open / Mine / Resolved tabs, using the `PredictionCard` from the design system.
Unverified users see every question but get a clear banner instead of vote buttons. On error the
prediction list is invalidated, because the server is the authority on whether a question is open.

### Results actually observed

**14 new integration tests**, all passing. Full API suite: **113 passed** across 10 files.

The tests cover exactly what the phase asked for and more:

- entry recorded + participation points credited, with `balanceAfter` verified in the ledger
- **duplicate prediction refused** (409 `PREDICTION_ALREADY_SUBMITTED`), original entry intact, no
  second payment
- **closed prediction refused** — including the important case where `status` still reads `OPEN`
  but the deadline has passed
- entry on a resolved prediction refused
- option from another question rejected (`OPTION_INVALID`)
- unverified email refused (403), anonymous refused (401)
- distribution hidden until resolution
- lifecycle actions refused to ordinary users (403 on activate/close/cancel/resolve)
- resolve credits only correct entries (winner 55 pts, loser 5 pts) and writes an audit row
- **resolving twice never pays twice** — blocked by the state machine *and* by the ledger's unique
  constraint independently
- cannot open a draft whose close time has passed; cannot edit a live prediction

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 · `pnpm build` 4/4 · `pnpm test` 120 passed (113 api + 7 shared).

---

## Phase 8 — Audience Challenges

### Lifecycle, and who can move each step

```
DRAFT ─(author)→ SUBMITTED ─(auto)→ MODERATION
  MODERATION ─(moderator)→ APPROVED | REJECTED
  APPROVED ─(producer)→ COMMUNITY_VOTING
  COMMUNITY_VOTING ─(producer, ranked)→ TOP_CHALLENGES
  TOP_CHALLENGES ─(producer)→ PRODUCER_REVIEW
  PRODUCER_REVIEW ─(producer)→ SELECTED | REJECTED
  SELECTED ─(producer)→ EXECUTED ─(producer)→ COMPLETED
```

Every transition is checked against an allow-list; an illegal move returns
`INVALID_STATE_TRANSITION`. **Nothing skips moderation** — a challenge can only reach community
voting after a human has approved it, and unapproved work is invisible to everyone but its author.

### Rules, and where each is enforced

| Rule | Enforcement |
| --- | --- |
| One vote per user per challenge | `@@unique([challengeId, userId])` |
| No voting for your own challenge | `SELF_VOTE_FORBIDDEN` before the insert |
| Moderation required | `VOTABLE_STATUSES` gate + hidden from feed until approved |
| Abuse reporting | `@@unique([challengeId, reporterId])`, 3 reports escalate |
| Profanity / spam validation | `content-moderation.ts`, block vs. flag |
| Rate limits | 10 challenges/hour per user, plus a hard cap of 5 in-flight submissions |

### Content screening — a triage tool, not a censor

`screenContent()` returns `block`, `flag` or `clean`:

- **block** — unambiguous slurs, and anything organising real-world harm (deprivation of food,
  water or sleep; hitting; self-harm). These are refused with a reason the author can act on.
- **flag** — links, contact details, shouting, repetition, low word variety. These are *accepted*
  and escalated for a human, never auto-rejected.

Ambiguity always flags rather than blocks: a false block silently loses a legitimate contribution
and the author never learns why, which is worse than a moderator reading one extra item.

Writing the tests caught two real evasions the first implementation missed, both now fixed:

1. `s h i t` survived because collapsing spaced-out letters greedily swallowed the neighbouring
   words (`should s h i t about` → `shouldshitabout`), destroying the word boundary the matcher
   needed. The collapse is now anchored on word boundaries at both ends.
2. `shhhiiit` survived because repeated letters collapsed to *two* characters. Text and blocked
   terms now go through the same collapse-to-one, so they always agree.

### Top-N ranking (`ranking.ts`, pure and configurable)

`score = (votes·w₁ + recency·w₂ + authorTrust·w₃) / Σw`, weights per cycle from
`ChallengeCycle.rankingConfig`, defaulting to 0.7 / 0.2 / 0.1.

- Votes are square-root normalised, so a runaway favourite does not zero everyone else.
- Recency exists so a challenge submitted in the last hour is not automatically buried.
- Author trust is a nudge, never a gate — a first-time submitter with the most votes still wins,
  and there is a test asserting exactly that.
- Ties break on raw votes, then on who submitted first. Input order never changes the outcome.

### Points paid through the ledger

submission 10 · approved 15 · top-3 75 · selected 200 — all via `awardPoints`, so all idempotent.

### Web added

`/challenges` (Vote now / Top challenges / On the show / Mine), `/challenges/new` (with live
character count, house-vs-contestant targeting and an up-front statement of what gets rejected),
`/challenges/[id]` (full text, vote, report modal, and a lifecycle tracker showing where it is),
and `/admin/challenges` (moderation queue with the automatic flags surfaced so a moderator knows
why something was escalated).

### Results actually observed

- **43 new tests**: 9 ranking, 8 content-screening, 26 integration. Full suite **156 API tests**
  across 13 files, plus 7 shared.
- Integration coverage includes: submission points, abusive content refused (422, nothing stored),
  deprivation refused, spam-flagged content accepted-but-escalated, drafts not paid, flood cap at
  five in-flight, unverified email refused, unmoderated challenges invisible in the feed and 404
  to strangers but visible to their author, moderation refused to ordinary users, approval credits
  the author and writes a `ModerationDecision` + audit row, moderator-only fields never leaking
  into the public view, duplicate vote refused, self-vote refused, voting before approval refused,
  withdraw-and-recast, per-viewer vote-blocked reasons, duplicate report refused, three reports
  escalate without removing the challenge, the full production path paying 300 points in four
  correctly-named ledger entries, lifecycle steps that cannot be skipped, `topN` respected, and
  production actions refused to a moderator.
- Live against a running stack: created a challenge over HTTP as `viewer2`, approved and opened
  voting as `producer`, and confirmed a **self-vote returns `SELF_VOTE_FORBIDDEN`**.
- UI verified at 1440/834/390: 0 px horizontal overflow at every breakpoint, correct heading,
  sidebar on desktop and bottom nav below it. The rendered feed showed the right per-card state —
  "You cannot vote for your own challenge", "Voted — undo", and an active Vote button.
- `pnpm typecheck` 7/7 · `pnpm lint` 5/5 · `pnpm build` 4/4.

### One more real bug found and fixed

The Phase 5 fix for the duplicated episode title (`Episode 12 · Episode 12 — Nomination Night`)
had never reached the database: the seed's `upsert` set `title` only in its `create` branch, so
re-seeding silently kept the stale value. The upsert now updates the title too, and a re-seed
corrected the live data — confirmed via `GET /show/live`.

---

## Phase 9 — Audience Perspective

### Kept genuinely distinct from Live Polls

The brief warns against confusing the two, so the distinction is enforced structurally, not just
described in copy:

| | Audience Perspective | Live Poll (Phase 10) |
| --- | --- | --- |
| Subject | an event that already happened | a decision happening now |
| Anchor | **always** tied to an `Event` — creation 404s without a real one | never event-anchored |
| Duration | hours or days | seconds or minutes |
| Results while open | **visible** | hidden until you vote |
| Transport | HTTP | WebSocket push |

The results-visibility rule is the substantive difference. A live poll hides its tally because the
tally can change the outcome; a perspective asks what people made of a fixed past event, so showing
the split informs rather than distorts. The UI states this in plain language on the page.

### API added

`GET /perspectives?scope=open|closed|mine|all&eventId=&contestantId=` ·
`GET /perspectives/analytics` · `GET /perspectives/:id` ·
`POST /perspectives/:id/vote` (auth + verified email) ·
`POST /perspectives/admin` · `POST /perspectives/admin/:id/{open,close}`

`/analytics` is registered before `/:id` so the literal path is never parsed as an id.

### Historical analytics

`getPerspectiveAnalytics()` reports totals, average participation, per-contestant support rate, the
ten most recent verdicts with their winning margin, and a **consensus split** bucketing each result
by how decisively it finished (≥40 points decisive, ≥15 split, otherwise contested). A 90/10 result
says something very different about the audience than 51/49, and a single average would hide that.

### Results actually observed

**17 new integration tests**, all passing. Full suite: **173 API tests** across 14 files, plus 7 shared.

Coverage: vote recorded with the split and points updated; **duplicate vote refused** with no
second ledger entry; vote after the deadline refused even while the status still reads `OPEN`;
foreign option rejected; anonymous vote rejected; the split visible to a non-voter while open;
no leader reported on a dead heat; the anchoring event and its contestants returned; filtering by
event and by contestant; `scope=mine`; analytics totals, per-contestant support rate and margin;
analytics not dividing by zero on an empty set; a near-even result classified as contested rather
than decisive; creation and lifecycle refused to ordinary users; the draft → open → close path with
three audit rows; creation refused without a real event; opening refused when the close time has
already passed.

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 · `pnpm build` 4/4.

### Web added

`/perspectives` with Open / Past / Mine tabs. Each card leads with the event it is about (type,
title, description, links to the contestants involved), then the question, a countdown, and either
answer buttons or the live split. Below the list sits the historical analytics panel: questions
asked, answers given, how many verdicts were clear-cut, and who the audience has sided with.

---

## Phase 10 — Real-time Live Polls over WebSockets

### Transport

Socket.IO bound to the same HTTP server as the REST API (one port, one TLS terminator), namespace
`/live`, with the `@socket.io/redis-adapter` so rooms work across more than one API process —
without it a vote handled by instance A would never reach a client connected to instance B.

Authentication happens once in the handshake, from `auth.token`, an `Authorization` header, or the
`rp_at` cookie (browsers cannot set headers on a WebSocket handshake, so the cookie is the real
path). A revoked session or a changed role invalidates the socket exactly as it does over HTTP.
Anonymous sockets connect and spectate; only a verified, active user may vote.

### Rooms

| Room | Contents |
| --- | --- |
| `show:{id}` | everyone — receives `poll:started` |
| `poll:{id}` | everyone watching a poll — receives **totals only** |
| `poll:{id}:voters` | clients that have already voted — receives the **full split** |
| `user:{id}` | that user's sockets — `points:awarded` |
| `admin` | ADMIN/PRODUCER/MODERATOR |

### The close race

A vote can arrive in the same millisecond as the close, so both are written as **single conditional
UPDATE statements** and the database decides the ordering:

```
vote:  UPDATE LivePoll SET totalVotes = totalVotes + 1, version = version + 1
       WHERE id = ? AND status = 'ACTIVE' AND (closesAt IS NULL OR closesAt > now())

close: UPDATE LivePoll SET status = 'CLOSED', closedAt = now(), version = version + 1
       WHERE id = ? AND status IN ('ACTIVE','PAUSED')
```

Whichever commits first wins. There is no read-then-write window for a race to slip through, and
because the whole vote runs in one transaction a rejected or duplicate vote leaves nothing behind —
no orphaned increment, no phantom ledger entry. Closing is idempotent by construction: the second
call simply matches nothing.

### Coalesced broadcasting

Emitting per vote would make broadcast volume equal vote volume — 10 000 voters would mean 10 000
fan-outs. Instead each poll gets at most one frame per 250 ms tick carrying the latest counts, so
cost scales with the number of *polls*, not votes. The trade is up to one tick of on-screen
staleness, which is invisible next to network latency.

### Client rules

1. **Never trust a stale frame** — every update carries a monotonic `version`; anything not greater
   than what was already applied is dropped.
2. **Re-sync, don't resume** — on reconnect the client re-joins and takes the server's snapshot
   wholesale rather than replaying buffered deltas.
3. **Optimism only where it is safe** — the user's own selection updates immediately; aggregate
   counts only ever come from the server.

### A real leak, found by testing with two browsers

The first implementation broadcast per-option counts to the whole poll room. The two-tab check
showed a spectator's "Results appear once you vote" disappearing the moment *someone else* voted —
the tally was on the wire for anyone with developer tools open, and withholding it in the UI would
have been theatre.

Fixed server-side with the split-room design above: voters get the breakdown, everyone else gets
participation volume only, and `.except()` stops a voter receiving both frames. Once a poll closes
the split becomes public, so every spectator socket is moved into the voters' room before the final
tally is flushed. Three regression tests now cover it.

### Results actually observed

**30 realtime tests**, all against a *real listening server with real socket clients* — nothing
mocked. Full suite: **203 API tests** across 15 files, plus 7 shared.

Coverage of everything the phase asked for:

- **multiple concurrent users** — 12 simultaneous voters, all counted exactly once, per-option
  counts summing to the cached total
- **duplicate votes** — one user firing 8 votes at once: exactly 1 accepted, 7 `VOTE_DUPLICATE`,
  stored total 1
- **reconnect** — a fresh socket re-syncs authoritative state including the vote already cast, and
  keeps receiving broadcasts afterwards; `poll:leave` genuinely stops delivery
- **closed poll** — refused on status, refused on a passed deadline while the status still reads
  `ACTIVE`, and refused with zero points paid
- **race conditions around closing** — 10 votes fired simultaneously with the close: every ack is
  either success or `POLL_CLOSED`, and stored state matches what clients were told exactly
  (`pollVote count == accepted == totalVotes == option count`)
- plus: anonymous and unverified votes refused, forged and revoked tokens treated as anonymous,
  coalescing proven (10 votes → fewer than 10 frames, final state still correct), lifecycle
  broadcasts (`poll:started` / `poll:closed` / `poll:result`), producer-only lifecycle, and a tie
  reported as **no winner** rather than a coin flip

### Live browser verification (two real tabs)

| Check | Result |
| --- | --- |
| Voter sees own tally after voting | yes |
| Spectator's counts hidden before voting | yes |
| Spectator's counts still hidden after someone else votes | **yes** (was the leak) |
| Spectator's total immediately after voting | **"2 votes"** — includes the other tab's vote |

That last line is the end-to-end proof: the second tab cast one vote and immediately saw two, a
number that could only have come from the server.

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 · `pnpm build` 4/4.

### Also added

- HTTP voting (`POST /polls/:id/vote`) alongside the socket path, so a client behind a proxy that
  blocks WebSockets can still take part under identical server-side rules.
- `apps/web/scripts/verify-realtime.mjs` — the two-tab harness used above, kept for reuse.

---

## Phase 11 — Nomination & Eviction

### Two systems, one implementation

Nomination and Eviction are separate systems with separate tables, separate rounds and separate
permissions (`nomination.manage` / `eviction.manage`). The mechanics are identical, so the logic
lives once in `rounds.service.ts` parameterised by round type, and the router is built twice. An
eviction round additionally carries `voteMeaning` (`SAVE` or `EVICT`), configured per show.

### Vote limits — the part that needed real thought

`@@unique([roundId, userId, contestantId])` stops a user voting twice for the *same* contestant, but
nothing in the schema stopped them spreading more votes than the round allows across *different*
contestants. A read-then-write check would let two concurrent requests both pass.

The fix is a new `RoundVoteAllowance` row per (roundType, roundId, user), and voting claims from it
with a single conditional statement:

```
UPDATE "RoundVoteAllowance" SET "votesUsed" = "votesUsed" + 1
WHERE roundType = ? AND roundId = ? AND userId = ? AND "votesUsed" < <limit>
```

Zero rows matched means the allowance is spent. No read-then-write window, no serialisable retry
loop. The claim and the vote insert share one transaction, so:

- a rejected **duplicate** rolls back the claim — being refused never costs you a vote
- a **withdrawal** returns the vote to the allowance, so changing your mind actually works
- the limit is read from the round at request time, so raising it mid-round takes effect immediately

### The rule that matters most

> The audience result and the show's official outcome are different things.

Enforced structurally, not just in copy:

| | Audience result | Official outcome |
| --- | --- | --- |
| Column | `audienceResult` | `officialOutcome` |
| Endpoint | `/publish-audience-result` | `/publish-official-outcome` |
| Permission | `round.publish` | `official.publish` |
| Derived from votes? | yes | **no** — a producer states what the show did |
| Nomination records | `source: AUDIENCE` | `source: OFFICIAL` |

`AUDIENCE_RESULT_DISCLAIMER` is returned on **every** round payload, published or not, so no client
can render a result without the caveat. The UI shows the two in separate cards, and where the
official outcome is absent it says in plain words: *"Not announced yet. The audience result above
does not decide this."*

A test asserts the official outcome can disagree with the audience (audience favours A, production
announces D) and that publishing one never touches the other.

### Other decisions

- **Live standings are hidden until publication**, so late voters cannot pile onto whoever is ahead.
  Total participation *is* public — knowing 2,000 people voted says nothing about who leads.
- **Weighting** applies to `weightedScore` only; `voteCount` stays an honest head count.
- **Participation points are credited once per round**, not once per vote.
- Voting is confirmed through a modal that states how many votes will remain.

### Results actually observed

**22 new integration tests**, all passing. Full suite: **225 API tests** across 16 files, plus 7 shared.

Vote-limit scenarios covered exactly as the phase asked: exact allowance then refusal, a limit of
one, **four concurrent votes against an allowance of two landing exactly two** (with stored state
matching what clients were told), duplicates not consuming an allowance, withdrawal restoring one,
allowances tracked separately per user and per round, and a raised limit taking effect for a user
already at the old one.

Also covered: voting before the round opens, after the deadline while the status still says `OPEN`,
for an ineligible contestant, for a contestant not in the round; standings hidden until published;
audience vs official separation end to end; the disclaimer always present; official outcome refused
without `official.publish`; audience and official nominations recorded under different sources;
operator actions refused to ordinary users; create/open/close with three audit rows; rounds needing
at least two contestants; mid-round eligibility changes; weighting affecting only the weighted
score; and participation credited once per round.

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 · `pnpm build` 4/4.

### A test-harness bug worth recording

Three tests failed initially because `RoundVoteAllowance` was missing from the integration suite's
truncation list, so allowance rows leaked between tests and `findFirst` picked up a stranger's row.
The table is now truncated with the rest. A fourth "failure" was my own assertion being wrong about
whether total participation should be hidden — it should not be, and the reasoning is now a comment
in the code rather than a silent behaviour.

---

## Phase 12 — Kitchen Control

### Entities

`KitchenBudget` · `KitchenDecision` · `KitchenOption` · `KitchenVote` existed from Phase 2.
This phase added **`KitchenResult`** and the configuration a decision needs to resolve itself
(`winnerCount`, `participationPoints`, `bonusPoints`), and dropped the decision's old
`result` / `resultCost` columns.

Those two columns were replaced rather than reused because a single JSON blob could not express the
distinction the module depends on. `KitchenResult` holds both sides explicitly:

| Field | Meaning |
| --- | --- |
| `audienceResult`, `audienceCost` | what the audience voted for, resolved within the budget — **advisory** |
| `implementedResult`, `implementedCost` | what production actually gave the house — **the only thing that spends budget** |

Neither column was read by any code, so nothing was lost. Migration `20260810140000_kitchen_result`.

### Audience decision ≠ official execution

The same principle as nomination/eviction, enforced structurally:

| | Audience decision | Official execution |
| --- | --- | --- |
| Field | `audienceResult` | `implementedResult` |
| Endpoint | `POST /kitchen/admin/:id/publish-audience-result` | `POST /kitchen/admin/:id/implement` |
| Permission | `round.publish` | `official.publish` |
| Derived from votes? | yes, within budget | **no** — production states what it did |
| Spends budget? | **no** | yes |

`KITCHEN_RESULT_DISCLAIMER` ships on every decision payload, published or not. The UI renders the
two as separate cards; where the implementation is missing it says *"Not recorded yet. What the
audience chose does not decide this on its own."*, and where they differ it shows a
**"Differed from the audience"** badge.

### The audience never touches the money

- A vote carries **option ids only** — no cost, no quantity, no budget. There is no field in the
  contract for one, and a test posts `unitCost: 0, budget: 999999` alongside a vote to confirm the
  stored values are unchanged.
- `unitCost` is producer-set and read from the database on every calculation.
- `KitchenBudget.spentUnits` moves in exactly one place: recording the implementation, behind an
  atomic guard `WHERE spentUnits <= totalUnits - cost` that cannot overdraw.

### Budget resolution (`budget.ts`, pure and unit-tested)

Greedy by popularity under three independent caps — `winnerCount`, remaining budget, and
`maxQuantity` — with every rejected option recorded together with **why** (`BUDGET`, `QUANTITY`,
`WINNER_LIMIT`) so the UI can show "wanted, but not possible".

Greedy rather than a knapsack search on purpose: the audience is expressing a preference order, and
quietly buying a less popular combination because it packs the budget better would misrepresent the
vote. Ranking is deterministic — score, then raw votes, then the producer's ordering — so a
recomputed result is reproducible, and weighting shifts the ranking without touching the head count.

### Security, following the established patterns

| Concern | Mechanism |
| --- | --- |
| Duplicate votes | `@@unique([decisionId, userId, optionId])`; a P2002 rolls back the whole request |
| Selection limits | atomic claim on `RoundVoteAllowance` (`roundType: 'KITCHEN'`), one `UPDATE ... WHERE votesUsed < limit` per option |
| Votes after closing | checked against the clock on entry **and** re-checked inside the transaction, so a concurrent close cannot leave a vote counted against a closed decision |
| Unaffordable options | refused up front with `BUDGET_EXCEEDED` — an option the house could never buy is not a real choice |
| Transactions | picks, counters and the decision total all move together; a partial pick is impossible |
| Audit | every operator action writes an `AuditLog` + `AdminAction` row |
| Authorisation | `kitchen.manage` for lifecycle, `round.publish` and `official.publish` for the two results |

### Points, through the ledger only

`awardPoints` is the only path; no balance is ever written directly.

- **Participation** — credited once per decision on the first pick, not once per option.
- **Special kitchen event reward** — `bonusPoints` credited to users who backed something
  production actually implemented, idempotent through the ledger's unique constraint.

### Results actually observed

**55 new tests** — 16 unit (`budget.ts`) + 39 integration. Full suite: **280 API tests** across 18
files, plus 7 shared.

All eight required integration scenarios, and more:

| # | Required scenario | Covered by |
| --- | --- | --- |
| 1 | User sees active kitchen decision | lists with options and budget; costs public but the split hidden while open; drafts invisible; unaffordable options flagged |
| 2 | User votes successfully | pick recorded, ledger credited, multi-pick, withdraw and re-cast, foreign option rejected, anonymous/unverified refused |
| 3 | Duplicate vote blocked | same option twice → `VOTE_DUPLICATE` with the allowance untouched; same id twice in one request; a mixed pair rolls back entirely |
| 4 | Closed decision rejects votes | status `CLOSED`; past the deadline while still `OPEN`; before opening; withdrawal after close |
| 5 | Budget limits enforced | unaffordable pick refused; unaffordable option dropped from the result with reason `BUDGET`; quantity ceiling honoured; over-budget implementation refused with spend untouched; budget moves only on implementation |
| 6 | Concurrent voting | 4 racing picks against a limit of 2 land exactly 2; 10 simultaneous voters counted exactly once with per-option counts summing to the total; votes racing the close never half-applied |
| 7 | Audience ≠ implemented | stored separately, allowed to disagree, match flagged when identical, disclaimer always present, bonus paid only to backers, double implementation refused, implementation before publication refused |
| 8 | Unauthorised admin action rejected | every operator route refused to a user (403) and to a moderator; anonymous → 401 |

### Live verification against a running stack

- Voted two picks as `viewer1` → `used=2 remaining=0 points=+4`; a third pick → `VOTE_LIMIT_REACHED`;
  an admin close as the same viewer → **403**.
- Producer flow: close → publish audience result → **Rice (50%) selected, Vegetables skipped as
  `WINNER_LIMIT`**, budget unchanged at ₹4,300 spent.
- Production then implemented **Chicken** instead: `matchesAudience: false`, the audience record
  still reading Rice, and budget moving 4,300 → 6,700 only at that point.
- `/kitchen` verified at 1440/834/390 — 0 px horizontal overflow at every breakpoint, sidebar on
  desktop and bottom nav below it. The "Decided" tab renders both result cards with the
  "Differed from the audience" badge.

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 (0 warnings) · `pnpm test` 287 passed · `pnpm build` 4/4.

### Note

One integration test initially failed because its setup produced a 1–1 tie, resolved by the
producer's option ordering rather than by the quantity ceiling it claimed to test. The setup now
gives the intended option a clear lead, with a comment explaining why.

---

## Phase 13 — Weekend Participation

### No migration needed

`WeekendParticipationRound`, `WeekendQuestion`, `WeekendSubmission` and `WeekendSelection` were
already modelled in Phase 2, including `participationTypes[]`, `eligibilityConfig`,
`allowPhysicalRewards`, `rewardDisclaimer` and `enabledById`. This phase is service, routes, tests
and UI on top of an unchanged schema.

### The funnel

```
OPEN → SUBMIT → MODERATION → SHORTLIST → PRODUCER_SELECTION → SELECTED → COMPLETED
```

`CANCELLED` is reachable from any non-terminal state. Every transition is checked against an
allow-list, and the funnel has no back door:

- **Nothing is shortlisted that a moderator has not approved** — attempting it returns
  `INVALID_STATE_TRANSITION` and names the offending entries.
- **Nothing is selected that was not shortlisted.**
- Re-shortlisting **replaces** the previous set rather than accumulating, so the shortlist always
  reflects the latest decision.

### Eligibility is earned, and explained

`evaluateEligibility` is pure — the caller gathers the numbers, the function decides what they mean.
That split is what makes the rules both unit-testable and explainable to a user.

The interesting requirement was "legitimate engagement". Points alone are a weak proxy: somebody can
sit on one feature and farm it. So eligibility also counts **how many different features** a person
has actually used, gathered from the vote and submission tables rather than from points — a producer
retuning a point value cannot accidentally change who qualifies.

A test makes the distinction concrete: an account with 10,000 points and 400 actions from a *single*
feature is refused, while a modest account with 120 points across *four* features passes.

The API returns every requirement with its current value against the target, so the UI can show the
gap. A bare "not eligible" tells a person nothing about what to do next.

### No unauthorised promises

The brief is explicit: do not promise physical appearances, celebrity meetings or house tours unless
authorised production staff have configured them. Enforced at four independent points:

1. **Creating a round cannot offer an in-person type.** `VIRTUAL_AUDIENCE` at creation → 403.
2. **Adding one later requires the round to already be authorised** → 403 otherwise.
3. **Authorising takes its own endpoint, its own permission (`weekend.physical_rewards`), an
   explicit acknowledgement flag and a disclaimer of at least 20 characters.** Missing either the
   acknowledgement or the disclaimer → 400. Who authorised it is recorded in `enabledById`.
4. **`describeRewards` is the single place rewards are described.** While physical rewards are off,
   the standard "no physical appearance, house visit or meeting is offered" wording always wins —
   *including over whatever a producer may have typed into the disclaimer field*. A test asserts
   that a disclaimer reading "Winners will be flown to the house to meet the contestants!" is not
   shown while the flag is off.

### Moderation

Reuses `screenContent` from the challenges module — abuse blocked outright, spam signals flagged for
a human — so both user-generated surfaces behave identically.

Authors see the **outcome** of moderation (`PENDING` / `APPROVED` / `REJECTED`) and never a
moderator's notes; an escalated entry simply reads as still pending. A test posts an internal note
("user has prior warnings") and asserts it appears nowhere in the author's payload.

Withdrawal is a soft delete, so the moderation trail survives it, and a selected entry can no longer
be withdrawn.

### Points through the ledger

submission 15 · shortlisted 60 · selected 250 — all via `awardPoints`, all idempotent. Shortlist and
selection awards carry the submission id in their reason, so re-running either step cannot pay twice.

### Results actually observed

**51 new tests** — 18 unit (`eligibility.ts`) + 33 integration. Full suite: **331 API tests** across
20 files, plus 7 shared.

Coverage includes: the full seven-step funnel end to end paying 325 points in three correctly-named
ledger entries; steps that cannot be skipped; shortlisting unmoderated entries refused; selecting
un-shortlisted entries refused; `shortlistSize` and `selectionCount` honoured; eligibility refused
with reasons; the single-feature farmer refused; duplicate entry of the same type refused without
paying twice; a different type from the same user allowed; a type the round does not offer refused;
entries after the deadline and after the round moves on refused; abusive content refused; the
question's own length limit enforced; withdrawal allowed before the deadline and refused for someone
else's entry; moderator notes never leaking; moderation decisions and audit rows written; all four
physical-reward gates; and every operator route refused to users, moderators and anonymous callers.

### Live verification

| Check | Result |
| --- | --- |
| Anonymous `GET /weekend/current` | round returned, `inPersonOpportunity: false`, disclaimer present, eligibility says "sign in" |
| Engaged user (`viewer1`) | points 2024/100, activities 7/3, 4 distinct features → **eligible** |
| Submit an entry | `SUBMITTED` / `PENDING`, +15 points, `ASK_CONTESTANT` removed from available types |
| Duplicate same type | 409 |
| Low-engagement user (`viewer6`) | not eligible — *"Take part 3 more times."*; submit → `NOT_ELIGIBLE` |
| Enable physical rewards without acknowledgement | **400** |
| Add `VIRTUAL_AUDIENCE` to an unauthorised round | **403** |
| `/weekend` at 1440/834/390 | 0 px horizontal overflow at every breakpoint; funnel tracker, eligibility panel and rewards panel all render, with the "no physical appearance" disclaimer visible |

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 (0 warnings) · `pnpm test` 338 passed · `pnpm build` 4/4.

### Note

One test initially failed on a balance assertion that forgot the 500 starting points the engagement
helper seeds. It now asserts the **ledger delta** (325) as the primary check, with the cached balance
checked as `500 + 325` — a better test than the one I first wrote, since it proves the points moved
through the ledger rather than just landing in a column.
