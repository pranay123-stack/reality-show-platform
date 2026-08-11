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

---

## Phase 14 — Reward Economy

Spending the points the ledger has been accumulating since Phase 6. The ledger itself was not
touched: it stays the single source of truth for every movement, and nothing in this module writes
a balance.

### What was built

`RewardCatalog` (with `RewardInventory`, `RewardRule` and an append-only `RewardFulfillment`
transition log) and `RewardRedemption`, migration `20260810180000_reward_economy`. Rules live in
a pure, database-free `rules.ts`: level thresholds, eligibility evaluation, and the transition
machine `REQUESTED → RESERVED → APPROVED → FULFILLED` with `REJECTED`/`CANCELLED`/`EXPIRED` as
terminal failures. 27 unit tests cover it without touching a database.

### Redemption is one transaction

Ordered so the scarce thing is claimed first:

1. **Claim a unit** — `UPDATE ... WHERE remaining IS NULL OR remaining > 0`. A single conditional
   statement the database serialises; `count === 0` means the stock ran out. `NULL - 1` is still
   `NULL`, so unlimited rewards never deplete while finite ones can never go negative.
2. **Create the redemption** — the unique `(userId, rewardId, cycleKey)` is the duplicate guard.
3. **Debit** — `spendPoints` joins the same transaction and appends to `PointsLedger`.
4. **Log the lifecycle.**

Anything failing rolls back the lot, which is what gives the two guarantees the brief asked for:
inventory failing moves no points, and points failing holds no unit.

### Two financial bugs found on the way

- **`spendPoints` could be raced.** It read the balance, then wrote it. Two simultaneous spends
  could both pass a check only one could afford. The balance test now lives in the `WHERE` clause
  of the debit itself, so checking and deducting are one statement. A regression test redeems two
  100-point rewards concurrently on a 100-point balance and asserts exactly one wins.
- **Refunds inflated lifetime points**, and therefore levels — redeem-then-cancel was a way to farm
  levels for free. Only an `EARN` moves lifetime points now; reversing an award un-earns it, while
  returning a spend does not.

Neither was reachable before this phase, because nothing spent points.

### Real-world rewards

`PHYSICAL` and `EXPERIENCE` carry the same controls as an in-person weekend opportunity: their own
permission (`reward.physical_authorise`), an explicit acknowledgement, a disclaimer of at least 20
characters, and creation forced to `DRAFT`. Publishing one without authorisation is a **409**, not a
403 — the producer is allowed to publish, the reward simply is not ready. Changing a reward's
category drops its authorisation.

The permission split was corrected: `REWARD_MANAGE` had been admin-only, which contradicted the
brief. Now moderators view, producers run the catalogue, and retiring plus force-cancelling — the
two actions that take something away from a user who already earned it — stay with admins.

### Tests

38 integration tests covering the ten required scenarios. The concurrency case is the brief's own:
**100 users, 10 units → exactly 10 successes**, 90 rejections all carrying `REWARD_UNAVAILABLE`,
`remaining + reserved + fulfilled === totalUnits`, ten ledger rows, no balance below zero. Plus a
double-tapping user charged exactly once, and the cross-reward overdraw case above.

### Live verification

| Check | Result |
| --- | --- |
| `/rewards`, `/rewards/[id]`, `/my-rewards`, `/admin/rewards` at 1440/834/390 | **0 px** horizontal overflow everywhere |
| Redeem a digital reward | balance 2,155 → 955 on a 1,200-point reward; granted immediately |
| Redeem a free (0-point) reward | granted, **no ledger row written** |
| Physical reward, unauthorised | invisible to viewers; Publish disabled in the admin UI |
| Authorise dialog | Authorise stays disabled until the acknowledgement is ticked |
| After authorisation | reward publishes, appears to viewers with its disclaimer |
| Redeem it | lands at **RESERVED**, not fulfilled; balance 1,820 → 1,770 |
| Cancel it | *"Cancelled · 50 points returned"*; balance back to exactly 1,820 |
| Moderator on `/admin/rewards` | read-only notice, no create/publish/retire controls |

### A bug only the browser could find

The first live redemption failed with *"Failed to fetch"* while every integration test passed.
The CORS `allowedHeaders` list never included `X-CSRF-Token`, so the browser blocked every
cross-origin write at the preflight — before the request was ever sent. `app.inject()` bypasses
CORS entirely, so no amount of integration testing would have caught it. It is fixed at the
source in `core/plugins.ts`, which repairs every unsafe method across the whole API, not just
rewards.

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 (0 warnings) · `pnpm test` 403 passed · `pnpm build` 4/4.

---

## Phase 15 — Leaderboard System

Ranking users on the points the ledger has been recording since Phase 6, without
ever asking an activity table a question at request time.

### The shape

`PointsLedger` → projector → Redis sorted sets → API. Redis holds the live
ranking; Postgres holds snapshots, history and the audit trail. The framing that
decides everything else is that **the sorted set is a derived view, not a system
of record**:

- Nothing outside the projector can write a score. There is no "add points to
  the leaderboard" function, and no endpoint anywhere accepts a score, a rank or
  a points total — a client can only influence its position by earning points.
- Any board can be rebuilt from the ledger, so losing Redis loses nothing.
- Every application is guarded per (entry, window), so replays are free.

### Why a watermark with overlap rather than a strict cursor

Rows are drained in `createdAt` order, but concurrent inserts commit out of
order: a transaction that stamped 12:00:01 can become visible *after* one that
stamped 12:00:02. A strict "everything after the last timestamp I saw" cursor
steps over that row and loses it permanently.

So each pass re-reads a 120-second overlap and relies on the idempotency guard to
discard what it has already applied. Late rows are picked up; nothing is counted
twice. `LEADERBOARD_OVERLAP_S` tunes it.

### Ranking rules

Competition ranking — 1, 2, 2, 4 — computed as `ZCOUNT (score +inf` plus one, so
rank 40 000 costs the same as rank 3 and ties share a rank by construction.
Display order inside a tie is the earliest scorer, so a board never renders two
ways. Percentile sits beside rank because "#312" stops meaning anything on a
large board while "top 8%" does not.

Two decisions worth stating plainly:

- **Spending points does not cost you a place.** Leaderboards rank *earned*
  engagement, so `SPEND` contributes nothing — the same principle as Phase 14's
  "spending never costs you a level". A refund is a positive `REVERSAL` and is
  likewise ignored, otherwise redeem-then-cancel would inflate a ranking.
- **Hiding happens after ranking, never before.** A user who opts out keeps their
  true position and simply is not listed. Removing them from the ranking would
  silently promote everyone below them and make the number a lie.

### Time windows

Boundaries are computed with `Intl` in a **configurable board timezone**
(`LEADERBOARD_TIMEZONE`), not the server's and not the viewer's. A shared ranking
needs one agreed definition of "today"; if each viewer's zone defined the window,
two people would sit on different boards and their scores would stop being
comparable. The viewer's zone is used only to *display* when the reset lands.

The period module is pure and clock-free, which is what let the awkward cases be
tests: a Kolkata day starting at 18:30Z, a Kathmandu +05:45 offset, 1 January 2027
belonging to ISO week 53 of 2026, and a New York spring-forward day that is
genuinely 23 hours long.

### Friends, communities, privacy

Friends are mutual `ACCEPTED` connections only — a follow is one-sided, and
letting it count would let anyone insert themselves into a stranger's private
ranking by following them. Friend boards are scored with `ZMSCORE` against the
global board rather than a per-user sorted set, because friend lists are small
and churn constantly.

Communities *do* get their own sorted sets, maintained in the same projection
step, so a large community reads in O(page) rather than O(members). Community
**types are rows, not an enum**: a producer adds "college" or "creator community"
at runtime without a migration.

### Administration

View, rebuild, snapshot, freeze, export, and an inspector that recomputes a
user's score from the ledger and reports it next to the cached one with a
consistency verdict — so "why is this account top" has an answer rather than an
assurance. Split three ways: moderators inspect, producers rebuild, admins freeze
and export. Every action writes an `AuditLog` row.

A frozen board deliberately stops moving, and entries that arrive meanwhile are
left unapplied rather than silently dropped — which is why unfreezing always
rebuilds.

### Tests

38 unit tests over the pure period and ranking modules; 42 integration tests
covering all eleven required scenarios. The concurrency case is the brief's own:
**1000 events projected simultaneously**, asserting every score is exactly right,
the board total equals the ledger total, and the final ordering is the one known
in advance. A second case fires the same 1000 events five times each,
concurrently, and still lands on the same numbers.

### Live verification

| Check | Result |
| --- | --- |
| `/leaderboard` (Everyone / Friends / Communities) and `/admin/leaderboard` at 1440/834/390 | **0 px** horizontal overflow on every tab at every breakpoint |
| Daily vs weekly vs season | genuinely different boards — 4 ranked today, 6 this season |
| Friends board | 4 people: the viewer plus three *accepted* friends; a pending request correctly excluded |
| Communities | private "Production Insiders" invisible to a non-member; public boards listed |
| Privacy toggle | "Hide me" → *"You are hidden from other people's boards"*, and the user still sees their own true rank |
| Rank movement | after a snapshot and a 9 000-point award, `LateShiftLee` #6 → #1 (**up 5**) and everyone else down 1 |
| Freeze | +5 000 points landed in the ledger and the board did not move |
| Unfreeze | rebuilt automatically; the frozen-period points appeared, nothing lost |
| Inspector | cached 9 315 = ledger 9 315, `consistent: true`, with the contributing rows listed |
| Cold cache | every `lb:*` key deleted; the projection heartbeat repopulated all six users with no admin action |
| CSV export | correct, and audited |

### Two things fixed on the way

The dashboard's provisional rank was a `COUNT(*) WHERE pointsBalance > mine`,
which scanned every profile for one number on every page load; it now reads the
sorted set. More importantly it ranked *balance*, so spending points would have
dropped a user's dashboard rank.

The seed set `pointsBalance` directly without matching ledger rows, so balances
did not reconcile with `SUM(ledger)` — the invariant the schema header claims.
Harmless until Phase 15 ranked from the ledger and put everyone at zero. Balances
are now built by replaying seeded deltas from zero.

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 (0 warnings) · `pnpm test` 483 passed ·
`pnpm build` 4/4.

---

## Phase 16 — Notification System

Telling people what happened, without any feature knowing that anybody is
listening.

### The shape

`Feature → NotificationEvent (outbox) → dispatcher → NotificationService →
channel providers`. The organising rule is the direction of dependency: the
challenge module records that a challenge was approved, and it does not import
the notification service, does not know a template exists, and does not change
when the wording does. Deleting `notifications.subscriber.ts` would stop every
notification on the platform without breaking a single feature — which is the
test of whether the decoupling is real rather than decorative.

### Why events are a table and not an emitter

An in-process emitter would be a third of the code and would lose an event
whenever the process died between "the challenge was approved" and "the author
was told" — silently, with nothing to replay and nothing to inspect. Writing the
event down first makes the handoff durable: the row survives a crash, a failed
fan-out shows up in an admin queue, and retrying is re-reading a row rather than
reconstructing what happened from a log.

The trade is eventual consistency, which for a notification is exactly right —
nobody needs to be told inside the transaction that produced the thing.

### Three levels, kept distinct

- **Event** (`prediction.resolved`) — fine-grained, keys the template and the
  deduplication.
- **Type** (`PREDICTION`) — the preference bucket. Deliberately coarse: people
  want to mute a feature, not tune fifteen switches. The old enum mixed the two
  granularities, so the migration collapses `PREDICTION_CLOSING` and
  `PREDICTION_RESOLVED` onto one bucket rather than dropping the rows.
- **Channel** (`IN_APP`) — how it goes out.

### Anti-spam, structurally

- `dedupeKey = event:entityId[:variant]:userId` with a unique index. A thousand
  simultaneous identical events still produce one row per person.
- A muted bucket produces **no row at all**, rather than a hidden one.
- **A recipient list is derived, never supplied.** No caller anywhere can name
  who gets notified — the audience comes from the event catalogue and the data.
  That is what makes "unauthorised notification creation" impossible rather than
  merely guarded; the one hand-authored route, the admin announcement, cannot
  choose recipients either.
- Rank movement is only announced past three places, and milestones only on the
  season board, because a leaderboard shuffles constantly and telling somebody
  about every single-place wobble trains them to ignore the bell.

### Channels

`IN_APP` is real — the `Notification` row *is* the delivery, which is why it
cannot fail. `EMAIL` and `PUSH` are declared rather than faked: an unconfigured
channel reports `SKIPPED`, not `FAILED`, because a provider that silently
pretends to send produces a green dashboard while nobody receives anything, and
because a failure queue full of "no SMTP configured" is noise no retry can fix.

Failures retry with exponential backoff to a ceiling of five attempts, then stop
rather than spinning forever.

### Tests

11 unit tests on template rendering and catalogue coverage, 37 integration tests
covering all eight required scenarios. The concurrency case is the brief's own:
**1000 identical events emitted simultaneously** produce exactly one event row,
and processing that event 50 times concurrently produces exactly one notification
and one delivery per user.

### Live verification

| Check | Result |
| --- | --- |
| Moderator approves a challenge via the real API | event `challenge.approved` recorded → `PROCESSED`, `fanout: 1` |
| The notification it produced | correct template, placeholder filled, link `/challenges/chal_4` |
| Author's feed and bell | unread count 1; mark-read returns `unreadCount: 0` |
| Author mutes the CHALLENGE bucket, another approval lands | event recorded, **`fanout: 0`**, no new row |
| Admin health | 2 events processed, 3 channels listed, EMAIL/PUSH `available: false`, 0 failures |
| Admin announcement | reached all 10 verified accounts, audited as `notification.announce` |
| Bell, panel, inbox, settings, admin at 1440/834/390 | **0 px** horizontal overflow, including the popover on mobile |
| Preference toggle | persisted across a reload; 10 buckets × 3 channels |

### Two bugs the tests found

**A repeated happening could only ever notify once.** The notification dedupe key
was `event:entityId:userId` while the *event* key included a variant, so a
challenge trending again next week was silently collapsed into the first
telling. The notification key now derives from the event's own key, which
carries the variant.

**Background fan-outs deadlocked the test suite.** Fire-and-forget dispatch meant
a fan-out from one test was still writing when the next test's `TRUNCATE` asked
for an exclusive lock — an intermittent `40P01` in unrelated suites. The bus now
tracks in-flight work and exposes `settleDomainEvents()`, which the test reset
awaits and which graceful shutdown now also awaits, so a deploy no longer cuts a
fan-out in half.

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 (0 warnings) · `pnpm test` 531 passed ·
`pnpm build` 4/4.

---

## Phase 17 — Producer / Admin Dashboard

A console for operators, built almost entirely out of endpoints that already
existed.

### What was *not* built

The brief's own instruction — "reuse existing services, do not duplicate
business logic" — turned out to be most of the design. Auditing the operator
surface first found 47 admin endpoints already shipped across ten modules:
challenge moderation, poll and prediction lifecycles, kitchen, weekend, rewards,
leaderboards and notifications. The console drives those. Closing a poll from the
dashboard is `POST /polls/admin/:id/close` — the same call, the same permission
check, the same audit row. There is no admin-only duplicate of any feature.

Three genuine gaps existed, and only those were added:

1. **Contestant management** had no service at all — the module was read-only.
2. **An operator list for predictions and polls.** Both public lists withhold
   things by design: predictions hide the per-option split until resolution so
   nobody follows the crowd, and the poll list excludes drafts. A producer needs
   both. Rather than weakening either audience rule, each module gained a
   permission-gated `admin/list` that reveals them to operators only.
3. **An audit reader.** `writeAudit` had been recording since Phase 3 with
   nothing to read it back.

Plus one small aggregation endpoint for the overview.

### The poll-draft bug

`listPolls` excluded `DRAFT` for every scope. A producer could create a poll and
then never see it again — the id was returned once at creation and that was the
only way to reach it. Every integration test passed, because they held the id in
a variable. It took clicking "New poll" and then looking for it to notice.

### Permissions

The console is gated at MODERATOR, and each section resolves from the caller's
permissions **server-side** — `GET /admin/sections` returns what they may open,
and the sidebar renders from that. That is not the security boundary; every
endpoint still checks independently, and the tests prove a moderator calling a
producer route directly gets a 403. It exists so the navigation never shows a
door that will not open.

The resulting split: a moderator sees 5 sections, a producer 10, an admin 11.
A viewer gets a plain refusal rather than an empty console.

### Audit

Filterable by module, action, actor, target type and date range. The module is
derived from the action prefix (`poll.close` → `poll`) rather than stored, so a
newly audited action appears in the filter without registration, and the filter
values are read from the data — the dropdown cannot offer an action nobody ever
performed.

The viewer is read-only and visibly so: there is no edit control anywhere on the
screen, and a test asserts that `PATCH`, `PUT` and `DELETE` on an audit row are
all 404. An operator who could amend the record of their own actions would make
the record worthless.

### Tests

30 integration tests covering all ten required scenarios, including: a viewer
denied everywhere, a moderator's narrow console, full prediction and poll
lifecycles driven as a producer, reward permissions split three ways, the
challenge moderation workflow, and a sweep proving eight operator verbs are all
refused for an ordinary user with nothing created and *nothing audited* — a
refused action is not an action.

### Live verification

| Check | Result |
| --- | --- |
| All 11 sections at 1440 / 834 / 390 | **0 px** horizontal overflow everywhere |
| Sidebar by role | admin 11 sections, producer 10, moderator 5, viewer refused |
| Create a contestant through the dialog | list went 10 → 11, `contestant.create` audited to PRODUCER |
| Duplicate slug | refused with *"That slug is already taken on this show"* |
| Create and start a poll through the console | `poll.create` + `poll.activate` audited, status DRAFT → ACTIVE |
| Audit filtering | `module=poll` returned 9 rows, every one a `poll.*` action |
| Producer on `/admin/audit` | refused — *"visible to administrators only"* |

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 (0 warnings) · `pnpm test` 561 passed ·
`pnpm build` 4/4.

### A note on a flaky run

One full-suite run failed 24 kitchen tests while the dev API and web servers were
still running alongside it. Kitchen has the heaviest concurrency tests in the
codebase, and they are sensitive to Postgres contention. Re-running with the dev
servers stopped was green, as was the API suite on its own (39/39 kitchen). The
tests are load-sensitive rather than broken, which is worth knowing before
someone runs them on a busy machine and goes looking for a bug that is not there.

---

## Phase 18 — Security Audit and Hardening

Eleven findings, every one reproduced against a running stack before it was fixed and re-tested
afterwards. The full write-up — findings, fixes, defences that held, attack scenarios and remaining
risks — is [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md). What follows is what the audit *taught*.

### The two that mattered

**A socket authorised once and never again.** The Socket.IO handshake resolved the principal and
pinned it. Nothing re-checked. Connecting as an active user, suspending the account, and then voting
produced `ok=true, points=3` — a banned account could keep earning indefinitely, and the only thing
that would stop it was choosing to reconnect. HTTP re-resolves on every request; the socket never
did. Fixed by re-resolving the principal per privileged event, which the 30-second session cache
makes nearly free.

**`z.string().url()` is not a safety check.** It delegates to the `URL` constructor, which accepts
`javascript:alert(1)` and `data:text/html,…`. Four fields took URLs this way, and the notification
link — rendered into an anchor — had no validation at all. An administrator could have shipped a
`javascript:` payload to every account, which is an escalation an administrator should not have.

### The one that had survived seventeen phases

Rate limiting returned **500, not 429**. `@fastify/rate-limit` throws whatever `errorResponseBuilder`
returns; ours returned a plain envelope with no `statusCode`, so it fell through to the internal-error
branch. The limit was enforced the whole time — but every throttled client was told the server had
broken rather than that it should slow down, and no `RATE_LIMITED` code ever reached the web app.
A client that believes it hit a server fault retries harder.

It survived because the path had no test. Writing one found it in a minute.

### What held

Worth recording, because a review that only lists failures gives no sense of what is load-bearing.
Mass assignment, SQL injection, brute force, refresh-token replay, CSRF, duplicate voting under
concurrency, reward replay, refund farming, concurrent overdraw, anonymous socket votes, error
leakage, password-reset enumeration and secret exposure were all attempted and all held. Several of
those defences exist because earlier phases put them there deliberately — the unique indexes, the
reuse detection, the ledger's idempotency tuple — and this audit is where that investment paid.

### Tests

40 security regression tests, grouped by the ten scenarios the brief specified. They assert on
outcomes — what reached the database, what the attacker got back — rather than on the presence of a
guard, because a guard that is present but bypassed still passes an inspection.

### Dependencies

`pnpm audit` reported 10 vulnerabilities (5 high), all transitive and build-time: `postcss`,
`sharp` and `esbuild`. Pinned through `pnpm.overrides` so a fresh install cannot reintroduce them.
**`pnpm audit` now reports no known vulnerabilities.**

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 (0 warnings) · `pnpm test` 601 passed · `pnpm build` 4/4 ·
`pnpm audit` clean.

---

## Phase 19 — Analytics System

Product analytics that observes the platform without participating in it.

### The rule that shaped everything

**Dashboards read aggregates, never the event log.** A chart that scans millions
of raw rows — or worse, the tables serving a live show — is an outage waiting
for a busy night. So the storage splits three ways:

- `AnalyticsEvent` — the raw log. Append-only, thin, and read by exactly one
  thing: the aggregation pass.
- `AnalyticsAggregate` — one row per (day, metric, dimension). Every chart reads
  this.
- `AnalyticsSnapshot` — rolling windows and retention. DAU/WAU/MAU cannot be
  summed from daily values (a user active on three days is one weekly active),
  so they are computed once and stored.

A test proves the separation structurally: it aggregates, **deletes every raw
event**, and asserts the dashboard still answers correctly.

### Where events come from

Three sources, chosen by what each can be trusted with:

1. **The domain event bus** — the second consumer it was built for. Notifications
   subscribe to tell people things; analytics subscribes to count them. Neither
   knows the other exists.
2. **Server-side instrumentation** for anything with a consequence: signups,
   logins, votes, submissions. `void track(...)` at the point the action
   succeeded.
3. **Client ingest** for the one thing a server cannot observe — what somebody
   *looked at*.

The ingest accepts a five-item allow-list of view events and nothing else. A
client posting `poll_voted`, `reward_redeemed` or `signup` gets a 400, which a
test asserts: otherwise the numbers that matter could be inflated from a
console.

### Observation never affects behaviour

`track` swallows every error and returns nothing a caller acts on. A vote that
succeeded must not report failure because an observation could not be written.
The one thing that had to be added for correctness was in-flight tracking —
`settleAnalytics()` — because fire-and-forget writes deadlock against a test's
`TRUNCATE` and would be cut in half by a deploy. Exactly the problem the domain
event bus had in Phase 16, solved the same way.

### Privacy

Opting out means **no event is recorded at all** — not an anonymised one. A
de-identified row is still a row about somebody who asked not to be measured.
Opting out is also retrospective: what was already collected is deleted.

That makes the numbers incomplete, so the dashboard says so: an operator sees
"3 of 47 accounts have opted out … these figures describe 93.6% of the
platform". Hiding the gap would be the dishonest choice.

Properties are sanitised on the way in — anything whose key contains `password`,
`token`, `email`, `phone`, `ip`, `hash` and so on is dropped, along with values
too long or too nested to be context. A test feeds a payload of credentials
through the real ingest path and asserts none of it survives.

### Tests

37 integration tests across the eight required scenarios. The performance case
writes **10 000 events**, aggregates them, and asserts the dashboard read stays
under two seconds — the point being that read cost must not scale with the size
of the log.

### Live verification

| Check | Result |
| --- | --- |
| `/admin/analytics` at 1440 / 834 / 390 | **0 px** horizontal overflow |
| Events observed from real actions | a poll vote recorded `poll_voted` server-side, not from the client |
| Client posting a consequential event | **400** — `poll_voted`, `reward_redeemed`, `signup` all refused |
| Opt-out | events stop, history deleted, other users unaffected |
| Dashboard with the raw log deleted | still correct, because it reads aggregates |
| Permissions | user and moderator refused; producer and admin allowed; rebuild audited |

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 (0 warnings) · `pnpm test` 638 passed ·
`pnpm build` 4/4.

---

## Phase 20 — UI/UX Polish

No new behaviour. The brief was to make what exists feel finished, so the work
divided cleanly in two: absorbing markup that had been rebuilt by hand, and
fixing the defects that all that hand-rebuilding had been hiding.

### What the duplication was actually costing

A scan for repeated markup found the usual thing — and one result that mattered
more than the rest. Nineteen screens each wrote their own page header, and they
had drifted into **two different `h1` treatments**:

- `text-display-md font-semibold` — twelve screens, all built in earlier phases
- `text-2xl font-semibold tracking-tight` — seven screens, all built later

Nobody chose that. It happened one file at a time, which is exactly the failure
a component prevents. Five components now own these shapes:

| Component | Absorbed | Notes |
| --- | --- | --- |
| `PageHeader` | 20 headers | One heading treatment. `size="compact"` for the console, where a fluid 36 px title above a dense table is wasted space rather than presence — an explicit, documented distinction instead of an accident |
| `SectionCard` | 10 `Card` + `h2` blocks | Body wrapped in `min-w-0`, which is what stops wide content widening the page |
| `FilterChips` | 9 chip rows | Three different heights and three different sets of ARIA became one |
| `StatusBadge` | console-local | Promoted to `@reality/ui`; the audience side wanted it too |
| `ConfirmDialog` | console-local `ActionDialog` | Same |

`FilterChips` also settled a semantics question. Several hand-rolled rows
claimed `role="tab"` while implementing none of what a `tablist` owes a keyboard
user — no arrow keys, no roving tabindex. They are filters, not tabs, so they
are now toggle buttons in a labelled group. Where a genuine tab-panel
relationship exists the app already uses Radix `Tabs`, which does implement it.

### The defects underneath

Consolidating the markup put every screen through the same code path, and that
is what surfaced these. Each was reproduced before it was fixed.

**The production build never hydrated.** Phase 18 set `script-src 'self'`,
dropping `'unsafe-inline'` — the right instinct, and never checked against a
production build. The App Router bootstraps every page with inline `<script>`
tags carrying the flight payload, so the policy blocked React from starting:
every page in `pnpm build` served a dead shell with no interactivity at all.
Development hid it completely, because dev keeps `'unsafe-inline'` for React
Refresh. A per-request nonce was tried first and cannot work here — a nonce must
be unique per response and 30 of these routes are statically prerendered, so
nonces would mean giving up static rendering across the app. `'unsafe-inline'`
is back, with `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and
no `'unsafe-eval'` in production doing the work instead. Documented as an
accepted trade-off rather than a silent revert.

**Five pages had no `h1`.** Sign-in, sign-up, forgot-password, reset-password
and verify-email each rendered their title through `CardTitle`, an `h3`. Their
document outline started at level three with nothing above it. `CardTitle` now
takes `as`, and the challenge composer had the same problem.

**`FormField` did not do what its own comment said.** The comment claimed it
"wires up the aria relationships so a screen reader announces the error with the
field". It rendered `<p id="{id}-error">` and never pointed anything at it, so
the message sat on the page as unattached prose; `required` drew a red asterisk
and told assistive technology nothing. It now injects `aria-describedby`,
`aria-invalid` and `aria-required` into the control it wraps, so the wiring
cannot be forgotten on the twentieth form.

**`Alert` made every standing explanation a live region.** Non-danger alerts
carried `role="status"`, so "confirm your email to take part" and "you choose
the food, not the budget" announced themselves on load and drowned out the one
announcement that mattered — "Loading…". Live is now opt-in, with `danger`
opting in on its own.

**The weekend screen blanked its own header** while loading and on error, unlike
every other screen, so a slow request lost the reader's place.

**Targets below the WCAG 2.2 minimum.** SC 2.5.8 asks for 24 px. Footer
navigation was 20 px, the console's card links 16–17 px, the mobile logo 24 px
beside a 40 px menu button, and a row of contestant links 16 px. All now clear
24 px. The one exception left is deliberate: "Create an account" sits inside the
sentence "New here? Create an account", which the criterion explicitly exempts.

Also: dialogs without a description left `aria-describedby` dangling, and two
different loading treatments — `animate-pulse` placeholders beside the shimmer
`Skeleton` everywhere else — became one.

### Animation

`slide-up` had been defined in the theme since Phase 4 and never used. It is now
the page transition, keyed on pathname so it replays per navigation.
`prefers-reduced-motion` was already honoured globally, which reduces it to an
instant appearance. Nothing else was added.

### Tests

95 new tests, in the four areas jsdom can honestly speak to:

| File | Covers |
| --- | --- |
| `packages/ui/tests/components.test.tsx` | 26 — the shared surface, including the status-tone mapping and that `ConfirmDialog` keeps cancel reachable mid-flight |
| `apps/web/tests/ui/screens.test.tsx` | every audience screen renders under exactly one `h1`, signed in and signed out; permission refusals |
| `apps/web/tests/ui/states.test.tsx` | loading announces politely and keeps the heading; failure is an alert with a working retry; empty is distinguishable from failed; no transport detail reaches the reader |
| `apps/web/tests/ui/interaction.test.tsx` | keyboard reachability, and form feedback — association, required, no submit while invalid, no double submit |
| `apps/web/tests/ui/layout.test.tsx` | the two contracts the shipped overflow bugs violated |

The layout file is deliberately modest about itself: jsdom has no layout engine,
so it asserts the *contract* — wide content inside a scroll container, grid and
flex children carrying `min-w-0`, no `sr-only` on a `<table>` — and leaves the
pixels to the browser pass.

### Live verification

`node apps/web/scripts/audit-ui.mjs`, against a **production** build, because
that distinction turned out to be the whole story of this phase.

| Check | Result |
| --- | --- |
| Page/viewport combinations measured | **96** (32 pages × 1440 / 834 / 390) |
| Maximum horizontal overflow | **0 px** |
| Pages not owning exactly one `h1` | **0** |
| Interactive targets under 24 px | **0** |
| Uncaught JavaScript errors | **0** |

`pnpm typecheck` 7/7 · `pnpm lint` 5/5 (0 warnings) · `pnpm test` 733 passed ·
`pnpm build` 4/4.

---

## Visual experience pass

Not a numbered phase — a presentation-only pass over a platform that was
functionally complete and visually flat. Nothing here touches business logic,
an API, the schema, or authentication.

### The room the product sits in

The old background was one flat colour. It is now four layers, painted once in
the root layout and never interacted with:

1. a deep gradient — black, through deep purple, into midnight blue
2. three ambient glow blobs on **deliberately unequal periods** (19s, 22s, 26s).
   Equal periods make three blobs visibly march in step, which reads as a
   loading animation rather than atmosphere
3. star dust, drawn as `box-shadow` on a single 1×1 element rather than forty
   positioned divs — one node and one paint instead of forty of each
4. a broadcast bloom over the hero, and a vignette so the corners fall away

The dust count is decided after mount and is lower on phones. That is not only
a performance choice: a randomly-scattered field rendered on the server would
not match the client's, which is a hydration error.

### Glass, with contrast kept

`Card` is now translucent with a blur behind it and a hairline border. The
background is `bg-surface/65`, not the 5% white a glassmorphism tutorial would
suggest — the glow blobs drift directly behind these cards, and contrast is
what makes a dark interface readable over a moving backdrop. The blur is
wrapped in `supports-[backdrop-filter]`, so a browser that cannot blur gets a
solid surface rather than a window onto the scenery.

Hover lift is opt-in via `interactive`. A card the reader cannot act on should
not suggest that they can, and most cards here are read-only panels.

### Eight features that show themselves

The eight pillars were eight identical boxes with a coloured tick above the
title. They describe genuinely different activities, and reading as one
undifferentiated grid was the main thing making the page feel flat.

`FeatureCard` now shares the shape and not the content: each card renders its
own visual — a prediction split with a clock, a heat list with trend arrows, a
two-sided opinion bar, a budget meter, a narrowing weekend funnel — and the
colour theme decides only the light it casts. Meters grow from zero on scroll;
numbers count up when they arrive.

### Two things worth recording

**The hero gradient had to move.** Revealing the headline word by word means
transforming each word, and a transformed child of a `bg-clip-text` parent is
composited separately — it takes its slice of the gradient with it. Painting
the gradient per word instead produced three small rainbows where there should
have been one sweep. The fix was to keep the gradient on the line and reveal
those words with opacity alone, which leaves the layout, and so the gradient,
where it was.

**A latent hydration bug surfaced.** `Countdown` renders the remaining time on
its first render, which is what stops a countdown flashing in a second late. On
a statically prerendered page that text is produced at build time and again at
hydration, and when those fall either side of a second boundary the strings
differ by one — React error #418. It had been there since Phase 4 and only
showed up now because the feature cards added two more countdowns to the same
page, making the race roughly three times as likely to be caught. The numeric
text now carries `suppressHydrationWarning`, which is the case that escape
hatch exists for; everything structural is still checked.

### Cost

Framer Motion is imported only by the landing page. `/` is 54.1 kB / 237 kB
first load; every application route is unchanged at 186–200 kB, and the shared
chunk stays at 103 kB.

### Verification

`node apps/web/scripts/audit-ui.mjs` against a production build:

| Check | Result |
| --- | --- |
| Page/viewport combinations | **96** (32 routes × 1440 / 834 / 390) |
| Maximum horizontal overflow | **0 px** |
| Pages not owning exactly one `h1` | **0** |
| Interactive targets under 24 px | **0** |
| Uncaught JavaScript errors | **0** |

---

## Live arena iteration

A second presentation-only pass, turning the landing page from a marketing site
into the arena the product actually is. Nothing here touches business logic, an
API, the schema, or authentication.

### The order is the argument

The page used to explain itself for four sections before showing anything
happening. It now opens with the answer to the question a visitor arrives with:

1. **Hero** — what this is
2. **Tonight's Arena** — what is open right now
3. **House Trending Now** — who it is happening to
4. **The eight features** — how to take part
5. **Your Reality Profile** — what you accumulate
6. How it works, rewards, leaderboard, sign-up

Someone who bounces after two screens has still seen the product working.

### Tonight's Arena

Four things are open on a show night, and they are open in different senses: a
poll closes in two minutes, a weekend question closes on Friday. The state —
live, closing, open, soon — drives the badge, the accent and whether the clock
reads as urgent, so the difference registers before anything is read. Each card
carries a live participant count, a one-line standing, a countdown and a way in.

### Feature cards became modules

`FeatureCard` is now `InteractiveFeatureCard`, and the two new props are the
substance of the change: `liveStatus` (what the feature is doing) is a separate
axis from `theme` (what colour it casts), and `metric` gives every card one
headline number. Beneath that each feature renders its own preview —
contestant avatars against prediction shares, a heat list with today's movement,
a creator and their rank on the top challenge, a budget meter, a narrowing
weekend funnel.

The live poll card carries the one number on the page that keeps moving while
you read it.

### Two things done deliberately

**The profile widget is labelled an example.** The brief asked for a "Your
Reality Profile" card showing a username, level, points, rank and streak. Every
visitor reading a landing page is signed out, so presenting a sample as *their*
level and *their* streak would be a lie told for engagement. The heading says
whose profile it is, the card is marked "Example profile", and the call to
action is to go and start one. The retention argument still lands — showing what
a month of playing looks like is the reason to sign up — it just has to be true.

**`LiveTicker` starts still.** A counter that begins climbing during render is a
hydration mismatch on a prerendered page, which is exactly the bug the previous
pass had to fix in `Countdown`. It renders its starting value on the server and
on the first client render, and only begins moving in an effect — and only when
it is on screen and motion is not reduced. Its increments follow a fixed uneven
pattern rather than `Math.random`, because randomness would reintroduce the
mismatch it was written to avoid.

### Cost

`/` is 57.7 kB / 241 kB first load, up 3.6 kB from the previous pass. Framer
Motion is still imported only by the landing page; every application route is
unchanged.

### Verification

| Check | Result |
| --- | --- |
| Page/viewport combinations | **96** (32 routes × 1440 / 834 / 390) |
| Maximum horizontal overflow | **0 px** |
| Pages not owning exactly one `h1` | **0** |
| Interactive targets under 24 px | **0** |
| Uncaught JavaScript errors | **0** |

---

## Entertainment typography pass

A third presentation-only pass. The diagnosis was right: the page read like an
article. Every section argued its case in a paragraph, and the type gave those
paragraphs the same weight as everything else.

### Three tiers, and nothing between them

The page had drifted into four display sizes used interchangeably, which is why
every section spoke at the same volume.

| Tier | Range | Used for |
| --- | --- | --- |
| `display` | 40 → 96 px | The hero, and the closing line. Nothing else. |
| `headline` | 32 → 48 px | Section openers. |
| body | ≤ 18 px | Everything else. |

Measured in a production browser: 92/53/40 px display and 48/32/32 px headlines
at 1440/834/390. The application shell keeps the old `display-md` for its page
titles, which sit above dense tables and would be absurd at 48 px.

### The copy did the real work

`SectionHeading` takes a `kicker` of two lines and gives it `max-w-md`. There is
nowhere to put a paragraph, which is the point.

| Before | After |
| --- | --- |
| "Everything here is open while the episode airs. Counts and clocks come from the server — your browser never decides a result." | "Live decisions. / Real audience impact." |
| "Heat is measured on the server from votes, reactions, engagement and momentum. It moves because the audience moved…" | "Heat moves because the audience moved. / Measured, never edited." |
| "Points come from taking part, not from spending. Your level, your streak and your place on the board are all derived from one auditable ledger…" | "Points for showing up. / A rank nobody can buy." |

The technical claims are not lost — they are made on the pages where somebody
has chosen to care.

**One paragraph was deliberately left long.** The footer disclaimer names the
contestants as fictional and the points as having no monetary value. Cutting a
disclaimer down to something punchy would trade an honest statement for a
rhythm, which is not a trade worth making.

### The product learned to talk like a show

Renamed everywhere — landing page, navigation, page titles, metadata, and the
tests that assert them — so the two surfaces do not disagree:

Prediction Game → **Make Your Prediction** · Audience Challenges → **Change The
House** · Contestant Heat Meter → **House Heat** · Audience Perspective → **Pick
A Side** · Kitchen Control → **Kitchen Battle** · Weekend Participation →
**Weekend Spotlight** · Nomination & Eviction → **Nomination Night**

CTAs followed: *Join the game*, *Enter tonight*, *Make your move*, *Vote now*,
*Take the spotlight*.

### EntertainmentCard

The previous card led with a name and a description, then showed the interesting
part underneath — the shape of a documentation entry. A viewer glancing at a
second screen wants, in order: is this live, how many people are in, what am I
being asked, how do I answer. So the structure is fixed and the description is
gone, replaced by the *question the feature actually asks*, which does the same
explanatory work in six words instead of twenty.

### Spacing and one collision

Section padding was 80 px at every width — airy on a laptop, a lot of scrolling
on a phone. Now 56 / 80 / 96 px.

The audit for text collisions found one, and it predated this pass: `StatCard`
rendered its value at 24 px, and a five-figure count in a three-column grid
overflowed its own card at 390 px. It now steps down to 20 px below `sm`.

### Verification

| Check | Result |
| --- | --- |
| Page/viewport combinations | **96** (32 routes × 1440 / 834 / 390) |
| Maximum horizontal overflow | **0 px** |
| Text overflowing its own box | **0** |
| Pages not owning exactly one `h1` | **0** |
| Interactive targets under 24 px | **0** |
| Uncaught JavaScript errors | **0** |

---

## Cinematic experience layer

A fourth presentation-only pass, and the one that required reversing an earlier
decision on purpose.

### A display face, and why the old reasoning was overturned

Phase 4 chose system stacks only, on the reasoning that no webfont means a
hermetic build and no layout shift. That reasoning still holds for body text,
and body text is still on the system stack. But a system stack cannot produce a
television title — that is not a matter of size or weight, it is what the
letterforms are for.

The page now sets its two display tiers in **Anton**, a condensed poster face,
supplied by `next/font/google`. The trade is narrower than the original comment
implies:

| | Before | After |
| --- | --- | --- |
| Runtime request | none | none — `next/font` self-hosts the file |
| Layout shift | none | none — a metrics-adjusted local fallback is generated |
| Build | offline | needs network on a cold cache |

So what actually changed is the build's network requirement. That is worth a
headline that announces something rather than labels it, and the change is
recorded here rather than left for someone to find in a diff.

Body, cards, navigation and stats stay on the system stack. Two personalities,
not five.

### The background became a mesh

Three wide colour fields on their own orbits at 24, 28 and 32 seconds. The
unequal periods are the whole point — matched periods make the field pulse in
step, which reads as a loading animation rather than atmosphere. Same mistake
the drifting blobs avoided in the first visual pass, at a larger scale.

### Scenes rather than scroll

`sceneReveal` adds a blur that resolves as a section arrives, which is what
makes it read as a cut. Deliberately small — 6px over 0.65s — because anything
more looks like a rendering fault before it looks like an effect, and because
`filter` is the most expensive thing being animated on the page. Section openers
only; never a grid of eight cards.

The hero headline got its own variant: out of focus and 6% oversized, settling
into place. The scale is what distinguishes a title card from a fade.

### Card effects, and where they stop

Three new pieces in `system/showcase.tsx`, all pure CSS on the compositor:

- **`GlowBorder`** — a masked gradient ring that fades in on hover. Animates
  opacity only, so no repaint.
- **`LightSweep`** — one light crossing the card, on hover. Not on a timer: a
  sweep that runs by itself is a casino, not a broadcast.
- **`SignalBars`** — three bars rising out of step, replacing the pulsing dot on
  genuinely live cards.

Floating is applied to the four arena cards and nowhere else. A room where
everything drifts is a room where nothing reads as alive.

None of these are in the application shell, where a light sweeping across a data
table would be an irritation rather than a flourish.

### Headings

"Four ways to change the night" → **TONIGHT'S ARENA**. "See who owns the
spotlight" → **THE HOUSE IS MOVING**. "Pick your move" → **YOUR TURN**. "Play
more. Climb higher." → **RISE THROUGH THE SEASON**.

### Verification

Measured in a production browser, at 1440 / 834 / 390:

| Check | Result |
| --- | --- |
| Display tier | 92 / 53 / 40 px, Anton |
| Headline tier | 48 / 32 / 32 px, Anton |
| Body | system sans throughout |
| Page/viewport combinations | **96** |
| Maximum horizontal overflow | **0 px** |
| Text overflowing its own box | **0** |
| Uncaught JavaScript errors | **0** |

---

## Kitchen Markets

A feature, not a visual pass: community-created prediction markets about what
the house will do.

### Two kitchens, kept apart

`/kitchen` is production's budgeted food decision — it spends a real budget, it
is resolved by an operator, and it has had a server module since Phase 12. None
of it was touched.

`/kitchen/markets` is the audience predicting *what the house will do*: who
cooks, who wins, whether the argument happens. They share a subject and nothing
else, which is why they are separate models rather than a flag on one.

### Where the authority is meant to live

`packages/shared/src/schemas/kitchen-markets.ts` is written as the API contract,
not as frontend props. `createKitchenMarketSchema` is what the future route
parses; `KitchenMarket` is what it returns. Two fields are deliberately absent
from anything a client sends — `winningOptionId` and `pointsAwarded` — because a
prediction market where the browser names the winner is not a prediction market.
A test asserts the schema strips both.

The scoring table lives there too, beside the types, because the server will
need exactly those numbers and two copies of a points table is how a platform
ends up paying differently depending on which one you ask.

### What this is, and what it is not

The server module does not exist yet. Rather than mock the screens with static
data — which shows the design and proves nothing — the state transitions are
real: creating a market, predicting on one, recomputing shares, ranking the
result. It is a working prototype held in `sessionStorage`.

**Its points are not platform points.** They never touch `PointsLedger`, cannot
move a leaderboard, and vanish with the tab. Twenty phases rest on the rule that
only the server awards a point, and a browser-side market quietly minting them
would be the worst thing this codebase could ship. The screen says so in an
`Alert` at the top, and the payout panel repeats it.

### Delivered

| Piece | Where |
| --- | --- |
| Five market templates | dish challenge, contestant battle, house decision, cooking duty, drama |
| Market card | question, top three shares, players, countdown, one way in |
| Five-step composer | category → question → options → slot → publish, validated by the shared schema |
| Detail page | creator, live shares, payout breakdown, top predictors |
| Kitchen Champions | a three-place podium and the rest as a list |
| Landing card | the Kitchen Battle feature card is now a live market |

### Verification

18 new tests. The scoring ones matter most — those numbers are what the server
module will be checked against.

One test failure was worth keeping: predicting in one test leaked into the next
through `sessionStorage`, because storage survives Testing Library's `cleanup`.
Fixed in `tests/setup.tsx` rather than in the test — it is the same class of
shared-state leak the integration suite's advisory lock exists to prevent, at a
smaller scale.

| Check | Result |
| --- | --- |
| Page/viewport combinations | **99** (33 routes × 1440 / 834 / 390) |
| Maximum horizontal overflow | **0 px** |
| Create and predict flows, driven in a browser | both complete, no console errors |
