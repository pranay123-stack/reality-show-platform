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
