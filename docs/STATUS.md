# Build status

**Last updated:** end of Phase 15.

Everything below was executed and observed, not assumed. Per-phase detail is in
[`PHASE_REPORTS.md`](PHASE_REPORTS.md); the design is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Green state (verified on this machine)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | 7/7 packages |
| Lint | `pnpm lint` | 5/5 packages, 0 warnings |
| Tests | `pnpm test` | **483 passed** (476 API across 25 files, 7 shared) |
| Build | `pnpm build` | 4/4 (API bundle + Next production build) |
| Migrations | `prisma migrate deploy` | 7 migrations, applied cleanly, no drift |
| Seed | `pnpm db:seed` | idempotent, completes |
| Runtime | API + web started, flows exercised via curl and headless Chromium | see below |

---

## Phases complete: 0 – 15

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
| **8** | Audience Challenges: 11-state lifecycle gated on human moderation, content screening (block vs flag), configurable top-N ranking, abuse reporting with escalation |
| **9** | Audience Perspective: event-anchored opinion polling, kept structurally distinct from live polls, with historical consensus analytics |
| **10** | Live Polls over WebSockets: Socket.IO + Redis adapter, race-safe close, 250 ms coalesced broadcast, split rooms so the tally stays off the wire for non-voters |
| **11** | Nomination & Eviction: atomic per-user vote allowances, and a hard structural separation between the audience result and the show's official outcome |
| **12** | Kitchen Control: configurable food decisions, server-side budget resolution, `KitchenResult` holding audience choice and official implementation separately; budget spends only on implementation |
| **13** | Weekend Participation: seven-step funnel gated on human moderation, eligibility earned across *different* features, and a four-point gate keeping in-person rewards off unless production authorises them |
| **14** | Reward Economy: catalogue, inventory, eligibility rules and a validated redemption lifecycle. Redemption is one transaction that claims stock atomically before debiting the ledger — 100 concurrent redeemers against 10 units yield exactly 10 winners. Physical and experience rewards carry the same authorisation gate as weekend participation |
| **15** | Leaderboard System: `PointsLedger` → idempotent projector → Redis sorted sets, never an aggregate query at request time. Daily / weekly / season windows on a configurable board timezone, plus friends and community boards. Competition ranking with tie handling, rank movement from snapshots, privacy controls, and admin rebuild / snapshot / freeze / export / inspect. 1000 simultaneous events lose no updates |

### Things worth knowing

- **Ports** are non-default because 5432/6379/3000 were occupied: Postgres **5442**, Redis **6389**,
  API **4000**, web **3010**.
- **Demo accounts** (development seed only, password `DemoPass!2026`):
  `admin@`, `producer@`, `moderator@`, `viewer1@`–`viewer6@reality.local`.
- The **points ledger core landed in Phase 6**, ahead of its nominal Phase 14, because Phase 7
  depends on it. Phase 14 built the economy on top of it without altering it.
- **Phase 14 fixed two financial bugs that nothing could reach until points became spendable**: a
  read-then-write race in `spendPoints` that let two concurrent spends both pass one affordability
  check, and refunds crediting *lifetime* points, which made redeem-then-cancel a way to farm levels.
- **CORS never allowed `X-CSRF-Token`**, so every cross-origin write was blocked at the preflight in
  a real browser. `app.inject()` skips CORS, so the integration suite could not see it. Fixed in
  `core/plugins.ts`; it affected every unsafe method, not just rewards.
- **The leaderboard is a projection, not a source of truth.** `PointsLedger` is authoritative;
  Redis is a cache that can always be rebuilt from it. The projector re-reads a 120 s overlap on
  every pass because concurrent inserts commit out of order, and a strict cursor would skip them —
  per-entry idempotency makes the re-reads free.
- **Ranking counts earned points, not the balance.** Spending on a reward never costs a place,
  which also means the dashboard rank no longer moves when someone redeems something.
- **Period boundaries use `LEADERBOARD_TIMEZONE`** (default UTC), not the server's zone and not the
  viewer's — a shared ranking needs one agreed "today".
- Remaining 404 routes: `/notifications`, `/admin` (the `/admin/challenges` moderation queue,
  `/admin/rewards` and `/admin/leaderboard` dashboards do exist). The sidebar prefetches them,
  which is the only source of console errors in the app today.

---

## Remaining: Phases 16 – 24

| Phase | Scope | Notes for whoever picks this up |
| --- | --- | --- |
| 16 | Notifications | Models and preferences exist; `/notifications` route is referenced by the shell but not built. The realtime layer already has a `user:{id}` room and a `points:awarded` emitter to build on. |
| 17 | Admin/Producer dashboard | `writeAudit` and the permission catalogue are ready; `/admin/challenges` (moderation queue) already exists as a template. |
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
