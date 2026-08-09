# Build status

**Last updated:** end of Phase 7.

Everything below was executed and observed, not assumed. Per-phase detail is in
[`PHASE_REPORTS.md`](PHASE_REPORTS.md); the design is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Green state (verified on this machine)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | 7/7 packages |
| Lint | `pnpm lint` | 5/5 packages, 0 warnings |
| Tests | `pnpm test` | **120 passed** (113 API across 10 files, 7 shared) |
| Build | `pnpm build` | 4/4 (API bundle + Next production build) |
| Migrations | `prisma migrate deploy` | 3 migrations, applied cleanly |
| Seed | `pnpm db:seed` | idempotent, completes |
| Runtime | API + web started, flows exercised via curl and headless Chromium | see below |

---

## Phases complete: 0 – 7

| Phase | Delivered |
| --- | --- |
| **0** | Architecture document, entity map, API + WebSocket contracts, role model, 25-phase plan, contradiction review |
| **1** | pnpm/Turborepo monorepo, Fastify API, Next.js web, Docker Compose (Postgres 5442 / Redis 6389), `/health`, config validation, error funnel |
| **2** | Prisma schema — 26 enums, 57 models; migrations; idempotent demo seed; 18 tests proving the DB-level invariants |
| **3** | Full auth: signup, login, logout, refresh with rotation + **reuse detection**, email verification, password reset, sessions, roles, permissions, CSRF, brute-force throttling, four-layer anti-duplicate architecture |
| **4** | Design system (20+ components, HSL token palette, heat ramp) + production-quality landing page, verified at 3 breakpoints with screenshots |
| **5** | Authenticated shell (sidebar / top bar / drawer / bottom nav) + API-backed dashboard with live state, points, rank, activity and hottest contestants |
| **6** | `ContestantHeatService` (pure, testable, configurable), snapshots, 24h/7d/season charts, admin inspect endpoint — **plus the points ledger core** (`awardPoints`/`spendPoints`/`reverseEntry`) needed from Phase 7 on |
| **7** | Prediction Game end to end: submit, duplicate + closed guards, operator lifecycle state machine, transactional idempotent payout, audit trail |

### Things worth knowing

- **Ports** are non-default because 5432/6379/3000 were occupied: Postgres **5442**, Redis **6389**,
  API **4000**, web **3010**.
- **Demo accounts** (development seed only, password `DemoPass!2026`):
  `admin@`, `producer@`, `moderator@`, `viewer1@`–`viewer6@reality.local`.
- The **points ledger core landed in Phase 6**, ahead of its nominal Phase 14, because Phase 7
  depends on it. Phase 14 still owes the reward catalogue, redemption flow, admin visibility and
  the concurrency test suite.
- Twelve feature routes are still 404 (`/polls`, `/challenges`, …). The sidebar prefetches them,
  which is the only source of console errors in the app today.

---

## Remaining: Phases 8 – 24

| Phase | Scope | Notes for whoever picks this up |
| --- | --- | --- |
| 8 | Audience Challenges | Schema, cycles and moderation states already exist. Needs service + 11-state lifecycle + moderation UI. Self-vote and duplicate-vote guards: `ChallengeVote` already has the unique constraint. |
| 9 | Audience Perspective | Schema done. Keep it distinct from live polls — perspective is *opinion about a past event*. |
| 10 | Live Polls over WebSockets | Socket.IO + `@socket.io/redis-adapter` are already installed. Contract is written in `ARCHITECTURE.md` §6, including the 250 ms coalesced broadcast and the version counter. Also add the close job that flips expired `ACTIVE` polls. |
| 11 | Nomination & Eviction | Vote-limit enforcement needs a serialisable transaction against `maxVotesPerUser`. `audienceResult` and `officialOutcome` are already separate columns. |
| 12 | Kitchen Control | Budget maths must be server-side; `KitchenOption.unitCost` is never accepted from a client. |
| 13 | Weekend Participation | `allowPhysicalRewards` defaults to false and needs the `weekend.physical_rewards` permission to enable. |
| 14 | Points & Rewards | Core exists. Owes: reward catalogue, redemption, reversal admin UI, **concurrency tests**. |
| 15 | Leaderboards | Replace the provisional `computeRank` in `dashboard.service.ts` with Redis-backed ranking. |
| 16 | Notifications | Models and preferences exist; `/notifications` route is referenced by the shell but not built. |
| 17 | Admin/Producer dashboard | `writeAudit` and the permission catalogue are ready. |
| 18 | Security hardening | Idempotency-key table exists but is not yet wired into vote endpoints. |
| 19 | Analytics | `AnalyticsEvent` + rollup models exist; taxonomy is in `ANALYTICS_EVENT_NAMES`. |
| 20 | UI/UX polish | Loading/empty/error states already exist as components. |
| 21 | Full test pass | Playwright is installed and Chromium is downloaded; `apps/web/scripts/verify-ui.mjs` is a working harness to build on. |
| 22 | Performance | |
| 23 | Production Docker | `docker-compose.prod.yml` and Dockerfiles not started. |
| 24 | Final audit + `FINAL_RELEASE_REPORT.md` | |

### The pattern to follow

Each feature module is four files under `apps/api/src/modules/<feature>/`:
`<feature>.service.ts` (all logic), `<feature>.routes.ts` (guards + validation only),
schemas in `packages/shared/src/schemas/<feature>.ts`, tests in
`apps/api/tests/integration/<feature>.test.ts`. Register in `apps/api/src/modules/index.ts`.
Routes never touch Prisma; services never touch `request`/`reply`.

`apps/api/tests/integration/predictions.test.ts` is the reference for what a feature's test suite
should cover.
