# Reality Platform

An interactive **second-screen audience platform** for a live reality show: predictions, live polls,
audience challenges, a contestant heat meter, nomination/eviction participation, kitchen control,
weekend participation, points and leaderboards.

> **This is not a fantasy league.** There is no drafting, no squads, no entry fees and no wagering.
> Points are engagement points; they are never purchased and never paid out.
>
> All show data in development is **fictional placeholder content**. No real show's name, branding
> or assets are used.

---

## Stack

| Area | Technology |
| --- | --- |
| Web | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, TanStack Query, React Hook Form, Zod |
| API | Node 20, TypeScript, Fastify 5 (modular feature architecture), Socket.IO |
| Data | PostgreSQL 16 + Prisma, Redis 7 |
| Tooling | pnpm workspaces, Turborepo, ESLint 9, Prettier 3, Vitest, Playwright, Docker Compose |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Layout

```
apps/web         Next.js front end
apps/api         Fastify API + Prisma + Socket.IO
packages/shared  Zod schemas, enums, constants shared by both apps
packages/ui      Design tokens and shared React components
packages/config  ESLint / Prettier / TypeScript presets
```

## Prerequisites

- Node.js **20+**
- pnpm **9+** (`corepack enable`)
- Docker + Docker Compose

## Quick start

```bash
pnpm install          # install the workspace
pnpm setup:env        # create .env from .env.example
pnpm dev:infra        # start PostgreSQL (:5442) and Redis (:6389) in Docker
pnpm db:migrate       # apply database migrations   (from Phase 2 onwards)
pnpm db:seed          # load demo show data         (from Phase 2 onwards)
pnpm dev              # API on :4000, web on :3010
```

Then open <http://localhost:3010>. The landing page reports live API, PostgreSQL and Redis status —
if all three are green, the stack is wired correctly.

### Why these ports?

`5432`, `6379` and `3000` are commonly occupied by other local projects, so this stack deliberately
uses **5442 (Postgres)**, **6389 (Redis)**, **4000 (API)** and **3010 (web)**. Change them in `.env`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run web + API in watch mode |
| `pnpm dev:infra` / `pnpm dev:infra:down` | Start / stop Postgres + Redis |
| `pnpm build` | Production build of every package |
| `pnpm start` | Run the production builds |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm lint` | ESLint everywhere |
| `pnpm format` | Prettier write |
| `pnpm test` | Vitest (unit + integration) |
| `pnpm test:e2e` | Playwright end-to-end suite |
| `pnpm db:migrate` | Create/apply a development migration |
| `pnpm db:deploy` | Apply migrations (production/CI) |
| `pnpm db:seed` | Seed demo data |
| `pnpm db:reset` | Drop, re-migrate and re-seed |
| `pnpm db:studio` | Prisma Studio |

## Environment

Every variable is documented in [`.env.example`](.env.example). The monorepo uses a **single root
`.env`**; the API reads it directly and the web app forwards the `NEXT_PUBLIC_*` values through
`next.config.mjs`.

Secrets are never committed. The API refuses to boot in production if it detects development
placeholder secrets.

## Health

| Endpoint | Meaning |
| --- | --- |
| `GET /health` | Liveness plus a PostgreSQL/Redis snapshot (`ok` / `degraded` / `error`) |
| `GET /ready` | Strict readiness — 503 unless every dependency is up |
| `GET /api/v1` | Versioned API root |

## Delivery phases

The project is built in 25 documented phases; per-phase reports live in [`docs/`](docs/).
