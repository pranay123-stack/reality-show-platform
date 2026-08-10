# Reality Platform — Architecture

**Working title:** Reality Platform (generic, unbranded)
**Document status:** Phase 0 deliverable — approved baseline for Phases 1–24.

---

## 0. Repository inspection

The target directory `/home/pranay-hft/Desktop/reality-platform` was empty before this phase.
There is no pre-existing code, package manifest, migration history, or CI configuration to
preserve or migrate. Everything below is greenfield.

Host environment observed:

| Tool | Version |
| --- | --- |
| Node | 20.20.0 |
| pnpm | 9.15.9 |
| Docker / Compose | 29.2.0 / v5.0.2 |
| PostgreSQL client | 16.14 |
| redis-cli | 7.0.15 |

Host ports `5432` (postgres), `6379` (redis) and `3000` (a running Next dev server) are **already
occupied by unrelated services**. To avoid collisions this project standardises on:

| Service | Host port |
| --- | --- |
| PostgreSQL (docker) | **5442** |
| Redis (docker) | **6389** |
| API | **4000** |
| Web | **3010** |

---

## 1. Product definition

An interactive audience platform for a live reality show. Viewers watch the broadcast on TV/OTT
and use this platform as a **second screen** to participate.

### 1.1 Explicit non-goal

> **This is NOT a fantasy league / fantasy sports application.**
> There is no team drafting, no squad selection, no player transfer market, no salary cap, no
> per-player fantasy scoring roll-up into a user-owned roster, and no entry-fee contests.

Points earned on this platform are **engagement points**, not fantasy scores, and are never
purchasable or withdrawable. There is no cash wagering, no odds, no stake, no payout.

### 1.2 Feature surface (12 pillars)

| # | Pillar | One-line definition |
| --- | --- | --- |
| 1 | Prediction Game | Users predict outcomes of upcoming show events; resolved by staff; points awarded. |
| 2 | Audience Challenges | Users author task ideas for the house; community votes; producers select and execute. |
| 3 | Contestant Heat Meter | A server-computed popularity/momentum score **for show contestants** (never for users). |
| 4 | Audience Perspective | Opinion polling *about an event that already happened* ("who was right?"). |
| 5 | Real-Time Live Polls | WebSocket-driven polls *during* the live broadcast, with countdown and live tallies. |
| 6 | Nomination & Eviction | Structured audience voting rounds with per-user vote limits and quotas. |
| 7 | Kitchen Control | Budget-constrained voting on the house menu / quantities / special items. |
| 8 | Weekend Participation | Weekly submission → moderation → shortlist → producer selection funnel. |
| 9 | Points / Rewards | Central immutable ledger + reward catalogue + redemption. |
| 10 | Leaderboards | Daily / weekly / season / friends / community ranking, Redis-cached. |
| 11 | Contestant Profiles | Public profile, heat history charts, related events and polls. |
| 12 | Admin / Producer panel | Full operational control, moderation, audit logs, analytics. |

### 1.3 Licensing / brand safety rules (binding on every later phase)

- No real show name, logo, wordmark, typography, colour palette, still, or clip.
- All contestants, episodes and events in seed data are **fictional placeholders**.
- No claim that audience voting decides an official eviction. The platform stores an *audience
  result* and, separately, an optional *official outcome* entered by an authorised operator.
- No promise of physical appearances, house tours, or celebrity meetings unless a producer with
  the right role explicitly configures such a reward.

---

## 2. Technology decisions

| Layer | Choice | Rationale |
| --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo | Native to pnpm 9; cheap task graph + caching; no Nx overhead. |
| Web | Next.js (App Router) + React + TypeScript | Required by brief; RSC for public pages, client components for realtime. |
| Styling | Tailwind CSS + shadcn/ui primitives (vendored) | Required by brief; vendored copies keep the build hermetic (no CLI network fetch). |
| Data fetching | TanStack Query v5 | Required by brief; cache + invalidation story fits polling/realtime merge. |
| Forms/validation | React Hook Form + Zod | Required by brief; Zod schemas are **shared** with the API via `@reality/shared`. |
| API | **Fastify 5** + modular feature folders | Brief allows "NestJS or a clean modular Express/Fastify architecture". Fastify chosen for: fastest cold start (matters for 25 phased rebuilds), first-class JSON-schema validation, native `@fastify/websocket`, and trivially testable plain functions instead of decorator/DI metadata. |
| ORM | Prisma | Required by brief. |
| DB | PostgreSQL 16 | Required by brief. |
| Cache/realtime fan-out | Redis 7 (ioredis) | Required by brief; also the Socket.IO adapter backplane and rate-limit store. |
| Realtime | Socket.IO 4 (+ Redis adapter) | Required by brief; gives rooms, acks, auto-reconnect, and horizontal fan-out. |
| Tests | Vitest (unit+integration), Playwright (E2E) | Required by brief. |
| Lint/format | ESLint 9 flat config + Prettier 3 | Required by brief. |

### 2.1 Why Fastify over NestJS (recorded decision)

Both satisfy the brief. Fastify is selected because the delivery plan spans 25 phases in which the
API is rebuilt and re-tested constantly; NestJS's DI container, module metadata and `reflect-metadata`
compile step add per-iteration cost without adding capability we need at this scale. The modularity
NestJS provides via `@Module` is reproduced here with an explicit convention:

```
apps/api/src/modules/<feature>/
  <feature>.routes.ts      # HTTP surface only: auth guard, schema, → service
  <feature>.service.ts     # all business logic, pure-ish, unit-testable
  <feature>.repository.ts  # all Prisma access for this feature
  <feature>.schema.ts      # Zod contracts (re-exported from @reality/shared when public)
  <feature>.events.ts      # domain events this feature emits (optional)
  __tests__/               # unit + integration tests
```

Rule: **routes never touch Prisma, services never touch `req`/`res`.**

---

## 3. Folder structure

```
reality-platform/
├─ apps/
│  ├─ web/                          # Next.js App Router
│  │  ├─ src/app/
│  │  │  ├─ (marketing)/            # public landing, how-it-works
│  │  │  ├─ (auth)/                 # login, signup, forgot/reset, verify-email
│  │  │  ├─ (app)/                  # authenticated shell: dashboard + 8 feature modules
│  │  │  └─ (admin)/                # producer/admin console
│  │  ├─ src/components/            # feature components
│  │  ├─ src/lib/                   # api client, socket client, query client, utils
│  │  └─ e2e/                       # Playwright specs
│  └─ api/                          # Fastify
│     ├─ src/modules/<feature>/     # see convention above
│     ├─ src/core/                  # config, logger, errors, prisma, redis, hooks
│     ├─ src/realtime/              # socket.io server, auth, rooms, emitters
│     ├─ prisma/                    # schema.prisma, migrations/, seed.ts
│     └─ tests/                     # integration + concurrency suites
├─ packages/
│  ├─ shared/                       # zod schemas, DTO types, enums, constants, points config
│  ├─ config/                       # eslint / prettier / tsconfig / vitest presets
│  └─ ui/                           # design-system primitives + tokens (Tailwind preset)
├─ docker/                          # Dockerfiles + entrypoints
├─ docs/                            # architecture, phase reports, performance, release
├─ docker-compose.yml               # dev: postgres + redis
├─ docker-compose.prod.yml          # prod: web + api + postgres + redis
├─ turbo.json
├─ pnpm-workspace.yaml
└─ package.json
```

### 3.1 Dependency direction

```
apps/web ─┐
          ├─→ packages/shared ──→ (zod only)
apps/api ─┘
apps/web ────→ packages/ui ──→ (react, tailwind)
both ────────→ packages/config (dev-only)
```

`packages/shared` must **never** import Prisma, Fastify, React or Next. It is the only module both
apps depend on, so it stays runtime-agnostic and side-effect free.

---

## 4. Database entities (high level)

Detailed columns land in Phase 2. This is the entity map and the invariants that constrain it.

### 4.1 Identity & access
`User`, `UserProfile`, `UserSession`, `UserDevice`, `Role`, `Permission`, `RolePermission`,
`UserRole`, `EmailVerificationToken`, `PasswordResetToken`, `PhoneVerification`.

### 4.2 Show domain
`Show`, `Season`, `Episode`, `Event`, `Contestant`, `ContestantMetric`, `ContestantHeatSnapshot`.

### 4.3 Participation domain
- Prediction: `Prediction`, `PredictionOption`, `PredictionEntry`, `PredictionResult`
- Challenges: `AudienceChallenge`, `ChallengeSubmission`, `ChallengeVote`, `ChallengeReport`
- Perspective: `AudiencePerspective`, `PerspectiveOption`, `PerspectiveVote`
- Live polls: `LivePoll`, `PollOption`, `PollVote`
- Nomination: `NominationRound`, `NominationCandidate`, `Nomination`, `NominationVote`
- Eviction: `EvictionRound`, `EvictionCandidate`, `EvictionVote`
- Kitchen: `KitchenBudget`, `KitchenDecision`, `KitchenOption`, `KitchenVote`
- Weekend: `WeekendParticipationRound`, `WeekendQuestion`, `WeekendSubmission`, `WeekendSelection`

### 4.4 Economy & engagement
`PointsLedger`, `PointsRule`, `Reward`, `RewardRedemption`, `Leaderboard`, `LeaderboardEntry`,
`Notification`, `NotificationEvent`, `NotificationPreference`, `NotificationTemplate`,
`NotificationDelivery`, `AnalyticsEvent`, `AnalyticsAggregate`, `AnalyticsSnapshot`.

### 4.5 Governance
`AdminAction`, `AuditLog`, `AbuseReport`, `ModerationDecision`, `IdempotencyKey`.

### 4.6 Cross-cutting invariants

1. **Immutable points ledger.** `PointsLedger` rows are append-only (insert only; no update/delete
   path is exposed). A user's balance is `SUM(delta)` over their ledger, materialised into a
   `UserProfile.pointsBalance` cache column that is only ever written inside the same transaction
   that inserts the ledger row. Corrections are *reversal rows*, never edits.
2. **One vote per user per subject.** Enforced by a DB `UNIQUE` constraint on every vote table
   (`(userId, pollId)`, `(userId, predictionId)`, `(userId, challengeId)`, …) — not by application
   checks alone. Application checks exist only to return a friendly error before the DB rejects.
3. **Idempotent rewards.** `PointsLedger` carries a `UNIQUE (userId, sourceType, sourceId, reason)`
   so replaying a resolve/award job can never double-credit.
4. **Soft deletion** (`deletedAt`) on user-authored and operator-visible content
   (users, challenges, submissions, contestants) — never on ledger/vote/audit rows, which are
   permanent records.
5. **Every state machine is explicit.** Statuses are Postgres enums, and transitions are validated
   in the service layer against an allow-list table.
6. **Timestamps** `createdAt` / `updatedAt` on all tables.
7. **Audit everything sensitive.** Any admin/producer mutation writes an `AuditLog` row inside the
   same transaction as the mutation.

---

## 5. API boundaries

Base URL `http://localhost:4000`, all business routes under `/api/v1`.

| Group | Prefix | Notes |
| --- | --- | --- |
| System | `/health`, `/ready`, `/metrics` | No auth. `/health` is liveness only. |
| Auth | `/api/v1/auth/*` | signup, login, logout, refresh, verify-email, forgot/reset password, me |
| Users | `/api/v1/users/*` | profile read/update, devices, sessions |
| Show | `/api/v1/show/*` | current show, episodes, events, live state |
| Contestants | `/api/v1/contestants/*` | list, detail, heat, heat-history |
| Predictions | `/api/v1/predictions/*` | list, detail, submit entry, my entries |
| Challenges | `/api/v1/challenges/*` | feed, create, detail, vote, report |
| Perspective | `/api/v1/perspectives/*` | list, detail, vote, results |
| Polls | `/api/v1/polls/*` | active, detail, vote, results (WS carries the live deltas) |
| Nomination | `/api/v1/nominations/*` | round, candidates, vote, my-votes, result |
| Eviction | `/api/v1/evictions/*` | round, candidates, vote, my-votes, result |
| Kitchen | `/api/v1/kitchen/*` | decision, options, vote, budget status, result |
| Weekend | `/api/v1/weekend/*` | round, eligibility, submit, my submissions |
| Points | `/api/v1/points/*` | balance, history, rules |
| Rewards | `/api/v1/rewards/*` | catalogue, eligibility, redeem, my redemptions |
| Leaderboards | `/api/v1/leaderboards/*` | type+period scoped, paginated, `me` position |
| Notifications | `/api/v1/notifications/*` | list, unread count, mark read, preferences |
| Analytics | `/api/v1/analytics/*` | client event ingest (throttled), admin metrics |
| Admin | `/api/v1/admin/**` | mirrors every domain with operator verbs; role-guarded |

### 5.1 Conventions

- **Envelope.** Success `{ data, meta? }`. Error `{ error: { code, message, details? } }` with a
  stable machine-readable `code` (e.g. `VOTE_DUPLICATE`, `POLL_CLOSED`, `RATE_LIMITED`).
- **Validation.** Every request body/query is parsed by a Zod schema from `@reality/shared`.
  Unparsed input never reaches a service.
- **Pagination.** Cursor-based (`?cursor=&limit=`) for feeds; offset-based only for leaderboards,
  which are Redis-ranked and need random access by rank.
- **Idempotency.** All point-bearing or vote-bearing `POST`s accept `Idempotency-Key`; the key is
  persisted with the response hash.
- **Authorisation.** A route declares `{ auth: true, roles: ['PRODUCER','ADMIN'], permission: 'poll.close' }`;
  a global `preHandler` enforces it. There is no per-handler ad-hoc role checking.
- **Server authority.** Vote counts, points, ranks, heat scores and results are *always* recomputed
  server-side. Client-submitted totals are ignored.

---

## 6. WebSocket events

Socket.IO on the API process, namespace `/live`, JWT handed over in the connect handshake
(`auth.token`), Redis adapter for fan-out.

### 6.1 Rooms

| Room | Membership |
| --- | --- |
| `show:{showId}` | every connected client |
| `episode:{episodeId}` | clients watching the current episode |
| `poll:{pollId}` | clients on a poll screen |
| `user:{userId}` | that user's sessions (private: notifications, points) |
| `admin` | ADMIN/PRODUCER only (operational telemetry) |

### 6.2 Server → client

```
connection:ready        { userId, serverTime, rooms }
show:state              { showId, isLive, currentEpisodeId, currentEventId }
poll:started            { poll }                       # full payload incl. options + closesAt
poll:updated            { pollId, counts, totalVotes, version }
poll:closed             { pollId, closedAt }
poll:result             { pollId, counts, winningOptionId, totalVotes }
prediction:opened       { prediction }
prediction:closed       { predictionId }
prediction:resolved     { predictionId, correctOptionId }
heat:updated            { contestantId, heatScore, trend }
nomination:opened|closed|result
eviction:opened|closed|result
kitchen:updated         { decisionId, tallies, budgetRemaining }
kitchen:result          { decisionId, selection, cost }
challenge:selected      { challengeId }
weekend:opened|selection
points:awarded          { delta, balance, reason }      # user room only
notification:new        { notification }                # user room only
leaderboard:moved       { type, period, rank, delta }   # user room only
error                   { code, message }
```

### 6.3 Client → server

```
poll:join      { pollId }            → ack { poll, myVote }
poll:leave     { pollId }
poll:vote      { pollId, optionId, idempotencyKey } → ack { ok, counts } | { error }
show:subscribe { showId }
ping                                  → ack { serverTime }
```

### 6.4 Realtime rules

- The client never sends counts; it sends an intent. The server writes the vote in a transaction and
  broadcasts the authoritative tally.
- `poll:updated` payloads carry a monotonically increasing `version`; clients drop out-of-order frames.
- Tallies are broadcast on a **throttled tick** (default 250 ms, coalesced per poll) instead of
  per-vote, so 10 000 voters produce ~4 broadcasts/second, not 10 000.
- On reconnect the client re-joins its rooms and refetches authoritative state over HTTP; the socket
  is a delta channel, never the source of truth.
- Closing a poll is a transactional, single-winner operation guarded by a Redis lock so a vote
  landing at the boundary either counts or is rejected — never half-applied.

---

## 7. Roles & permissions

Four roles, strictly ordered by capability:

| Role | Scope |
| --- | --- |
| `USER` | Participate: vote, predict, submit challenges, redeem rewards. |
| `MODERATOR` | Everything USER, plus content moderation, abuse queue, user warnings, read-only view of the reward catalogue and redemption queue, inspecting how a leaderboard ranking was computed, and reading the notification health dashboard. |
| `PRODUCER` | Everything MODERATOR, plus show operations: create/activate/close/resolve polls, predictions, rounds, kitchen decisions, weekend selection; running the reward catalogue, including authorising a physical or experience reward; rebuilding leaderboard caches, managing communities, and retrying failed notification deliveries. |
| `ADMIN` | Everything PRODUCER, plus user administration, role assignment, points configuration, reversal of ledger entries, audit logs, the two reward actions that take something back from a user who earned it (retiring a reward, force-cancelling a redemption), freezing or exporting a leaderboard, and announcing to every user at once. |

Permissions are stored as strings (`domain.action`, e.g. `poll.create`, `challenge.moderate`,
`points.reverse`) and mapped to roles in the DB, seeded at Phase 2. Role inheritance is materialised
(each role gets the full expanded permission set) so a single indexed lookup answers any check.

Guard chain: `authenticate` → `loadPermissions (Redis-cached, 60 s)` → `requireRole/requirePermission`.

---

## 8. Environment variables

| Variable | Scope | Default (dev) | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | both | `development` | runtime mode |
| `API_PORT` | api | `4000` | HTTP port |
| `API_HOST` | api | `0.0.0.0` | bind address |
| `DATABASE_URL` | api | `postgresql://reality:reality@localhost:5442/reality` | Postgres DSN |
| `REDIS_URL` | api | `redis://localhost:6389` | Redis DSN |
| `JWT_ACCESS_SECRET` | api | dev-only placeholder | access token signing |
| `JWT_REFRESH_SECRET` | api | dev-only placeholder | refresh token signing |
| `JWT_ACCESS_TTL` | api | `15m` | access token lifetime |
| `JWT_REFRESH_TTL` | api | `30d` | refresh token lifetime |
| `COOKIE_SECRET` | api | dev-only placeholder | signed cookie secret |
| `COOKIE_DOMAIN` | api | `localhost` | cookie scope |
| `CORS_ORIGIN` | api | `http://localhost:3010` | allow-list (comma separated) |
| `RATE_LIMIT_GLOBAL_MAX` | api | `300` | requests/min/IP |
| `MAIL_DRIVER` | api | `console` | `console` \| `smtp` |
| `SMTP_*` | api | — | SMTP host/port/user/pass/from |
| `OTP_DRIVER` | api | `console` | phone OTP transport placeholder |
| `GOOGLE_CLIENT_ID/SECRET` | api | — | OAuth placeholder (Phase 3 architecture only) |
| `HEAT_RECOMPUTE_INTERVAL_MS` | api | `60000` | heat scheduler cadence |
| `POLL_BROADCAST_THROTTLE_MS` | api | `250` | live tally coalescing |
| `LEADERBOARD_TIMEZONE` | api | `UTC` | zone defining daily/weekly board boundaries |
| `LEADERBOARD_OVERLAP_S` | api | `120` | how far back the projector re-reads the ledger each pass |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:4000` | REST base |
| `NEXT_PUBLIC_WS_URL` | web | `http://localhost:4000` | Socket.IO base |
| `NEXT_PUBLIC_APP_NAME` | web | `Reality Platform` | brand-neutral display name |

Secrets are never committed. `.env.example` carries placeholders only; Phase 24 verifies this.

---

## 9. Development commands

```bash
pnpm install              # install workspace
pnpm dev:infra            # docker compose up -d (postgres 5442, redis 6389)
pnpm dev                  # turbo: api (4000) + web (3010) in watch mode
pnpm db:migrate           # prisma migrate dev
pnpm db:seed              # seed demo show/contestants/events
pnpm db:reset             # drop + migrate + seed
pnpm db:studio            # prisma studio
pnpm typecheck            # tsc --noEmit across workspace
pnpm lint                 # eslint across workspace
pnpm format               # prettier --write
pnpm test                 # vitest run (unit + integration)
pnpm test:e2e             # playwright
pnpm build                # turbo build (web + api)
pnpm start                # production start (after build)
```

---

## 10. Phase-by-phase implementation plan

| Phase | Deliverable | Definition of done |
| --- | --- | --- |
| 0 | This architecture document | No contradictions with the brief (§11). |
| 1 | Monorepo, tooling, Docker, `/health`, landing stub | typecheck + lint + test + build green; API reaches PG and Redis. |
| 2 | Prisma schema, migrations, seed | migrate + seed run clean on an empty DB. |
| 3 | Auth (email/password, verification, reset, sessions, roles, anti-duplicate) | auth test-suite green; protected + role-guarded routes enforced. |
| 4 | Design system + production-quality landing page | components in `packages/ui`; responsive at 3 breakpoints. |
| 5 | Authenticated shell, nav, dashboard skeleton | 8 feature cards + live/points/leaderboard widgets, API-backed where available. |
| 6 | Contestants + `ContestantHeatService` + snapshots + charts | heat unit tests green; admin can inspect inputs. |
| 7 | Prediction Game + admin lifecycle | duplicate + closed-prediction tests green; points via ledger. |
| 8 | Audience Challenges + moderation pipeline | full lifecycle enforced; self-vote and duplicate-vote blocked. |
| 9 | Audience Perspective | distinct from live polls; duplicate votes blocked; analytics stored. |
| 10 | Live polls over WebSockets | concurrency/reconnect/close-race tests green. |
| 11 | Nomination & Eviction | vote limits enforced; audience vs official outcome separated; audited. |
| 12 | Kitchen Control | budget respected server-side; users cannot alter budget. |
| 13 | Weekend Participation | full funnel + moderation + audit; no unauthorised reward promises. |
| 14 | Points & Rewards engine | concurrency test proves no duplicate credit; reversal supported. |
| 15 | Leaderboards | Redis-backed projection of `PointsLedger`; no aggregate query per request; tie handling, timezone boundaries and 1000-event concurrency all tested. |
| 16 | Notifications | event-driven via a durable outbox; no feature imports the notification module; deduplicated per (event, entity, user); preference-respecting; IN_APP live with EMAIL/PUSH declared. |
| 17 | Admin/producer dashboard | every domain operable from `/admin`, driving the existing endpoints rather than duplicating them; sections resolved server-side per role; audit trail readable and filterable, and provably append-only. |
| 18 | Security & abuse hardening | eleven findings fixed and re-tested; per-event WebSocket authorisation; URL scheme validation; socket and per-account rate limits; CSP; zero dependency advisories. See `SECURITY_AUDIT.md`. |
| 19 | Analytics | raw log separated from pre-aggregated numbers so dashboards never scan events or transactional tables; client ingest limited to view events; opt-out stores nothing and erases history. |
| 20 | UI/UX polish | loading/empty/error states, a11y, keyboard nav, contrast. |
| 21 | Full test pass | unit + integration + Playwright E2E, all listed scenarios. |
| 22 | Performance pass | load scenarios + bottleneck report + optimisations. |
| 23 | Production Docker deployment | `docker-compose.prod.yml` stack verified from clean state. |
| 24 | Final audit + `FINAL_RELEASE_REPORT.md` | nothing claimed that was not executed. |

---

## 11. Contradiction review (requirement ↔ architecture)

Checked the brief against the design above. Findings:

| # | Potential contradiction | Resolution |
| --- | --- | --- |
| 1 | "Points / Rewards / Leaderboards" reads like fantasy-league scoring, which is forbidden. | Points are **engagement** points earned by participating, never a roster's performance score. No drafting, no teams, no entry fees, no payouts. Leaderboards rank participation, not squads. Documented in §1.1 as a binding rule. |
| 2 | Contestant "Heat Meter" vs. user leaderboards could be conflated. | Two separate subsystems with separate storage: `ContestantHeatSnapshot` (about show contestants) and `LeaderboardEntry` (about platform users). Never joined into a single ranking. |
| 3 | "Unique-user enforcement" vs. "no invasive fingerprinting / no unnecessary personal data". | Layered, consent-visible signals only: verified email (hard), verified phone (hard, architecture placeholder), coarse device/session heuristics (soft, advisory flag for moderators), DB unique constraints. No canvas/WebGL/audio fingerprinting, no IDFA/GAID, no cross-site tracking. Duplicate suspicion **flags for human review**; it does not auto-ban. |
| 4 | "Audience decides eviction" vs. legal/licensing caution. | `EvictionRound` stores `audienceResult` and a nullable `officialOutcome` writable only by an authorised operator; the UI labels audience results as *audience opinion* unless an operator publishes the official outcome. |
| 5 | Weekend "virtual/physical audience opportunity" vs. no promises of physical appearances. | Reward types are data-driven; physical/appearance reward types are disabled by default and require a PRODUCER/ADMIN to enable per round, with the disclaimer text stored alongside. |
| 6 | "Optimistic UI" vs. "server-authoritative results". | Optimistic UI is allowed **only** for the user's own vote chip (local echo), never for aggregate counts. Aggregates render only from server frames. Stated in §6.4. |
| 7 | "Real-time counts" vs. 10 000 concurrent voters. | Throttled, coalesced per-poll broadcast (250 ms) + Redis counters, so broadcast volume is independent of vote volume. Validated in Phase 22. |
| 8 | Immutable ledger vs. "reward reversal support". | Reversals are compensating append-only rows (`REVERSAL` type) referencing the original entry; the original is never mutated. |
| 9 | Brief lists both NestJS and Express/Fastify. | Explicitly allowed alternative; Fastify chosen with rationale recorded in §2.1. |
| 10 | Kitchen "₹X budget" implies currency handling. | Budget is a **show-fiction** integer in minor units with a configurable symbol; it is not money, not a wallet, and never connects to payments. |

**Conclusion:** no blocking contradiction. Items 1, 3, 4, 5 and 10 are the ones that constrain later
phases, and each has an enforcement point in the schema or service layer rather than only in prose.
