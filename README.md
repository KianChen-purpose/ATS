# PATS — Purpose Applicant Tracking System

Purpose Unlimited's in-house recruiting platform: Ashby-grade recruiting, built for Purpose, running on Microsoft 365.

## Foundation documents

| Document | What it covers |
|---|---|
| [PRD.md](PRD.md) | Product requirements: features, priorities, M365 integration, reporting, roadmap |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Locked architecture decisions and invariants (binding) |
| [CLAUDE.md](CLAUDE.md) | Rules every contributor and Claude session checks each change against |
| [brand/BRAND.md](brand/BRAND.md) | Brand guidelines; tokens in [brand/tokens.css](brand/tokens.css) |

## Quick start

Requirements: Node 20+, PostgreSQL 16 (or Docker).

```bash
cp .env.example .env
docker compose up -d        # or use a local Postgres matching DATABASE_URL
npm install
npm run db:reset            # apply migrations + load demo data
npm run dev                 # http://localhost:3000
```

With `PATS_DEMO_AUTH=true` (the `.env.example` default), sign in from the demo login screen as any seeded user. Each role (admin, recruiter, coordinator, hiring manager, interviewer, executive) sees a different home page.

Demo sign-in only works outside production: the server refuses to start if `PATS_DEMO_AUTH=true` with `NODE_ENV=production`, or if `SESSION_SECRET` is missing, shorter than 32 characters or still the example value.

Reports live at `/reports`: standard reports, a point-in-time pipeline snapshot, a custom report builder with saved reports and dashboards, Excel/CSV export, scheduled email delivery (run `npm run worker`) and a Power BI / Excel OData feed (`/api/odata`, see [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)).

Public career sites run at `/careers` (all brands) and `/careers/<brand>` (e.g. `/careers/steadyhand`, `?lang=fr` for French). Brand websites can embed roles from `GET /api/public/jobs?brand=<slug>&lang=en|fr`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode |
| `npm run db:generate` | Create a SQL migration in `drizzle/` from changes to `src/db/schema.ts` (commit it) |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:check` | Fail if the schema has changes with no committed migration (CI) |
| `npm run db:seed` | Wipe and reload demo data (deterministic) |
| `npm run db:reset` | Local only: drop the database, migrate from scratch, reseed |
| `npm test` | Run the test suite (vitest) against a throwaway `pats_test` Postgres database, built from the migrations |
| `npm run worker` | Background worker: job queue (mail sync, Graph subscriptions) and scheduled reports. `-- --once` for one pass |
| `npm run typecheck` / `npm run lint` | Checks |

## Microsoft 365

Without credentials every M365 action (email, calendar, Teams) runs in **mock mode** and is logged under **Settings → Integrations**. Add Entra ID app credentials to `.env` to switch to live Microsoft Graph. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Stack

Next.js 16 (App Router, server actions) · TypeScript · Tailwind CSS 4 · PostgreSQL + Drizzle ORM · Microsoft Graph

```
src/
  app/(app)/              Staff app (requires sign-in). No database access.
  app/login/              Demo sign-in / Entra SSO
  app/schedule/[token]/   Public candidate self-scheduling
  components/             UI primitives and app shell. No database access.
  db/                     Schema, client, migration runner, seed
  server/actions/         "use server" adapters: zod → service → revalidate
  server/services/        Business logic: every read/write, permission check and audit row
  server/policy/          Authorization: actors, job visibility, field-level rules
  server/integrations/m365/   M365 client: mock + Microsoft Graph
drizzle/                  Committed SQL migrations
tests/                    vitest suites against a real Postgres
```

## Build phases

Per [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §10, foundation hardening comes before any further feature phase.

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation: schema, demo data, app shell, ⌘K, demo auth, M365 integration layer | ✅ |
| 1 | Core ATS: jobs, pipeline board/table, candidate profiles, notes, stage moves, archive | ✅ |
| 2 | Scheduling & feedback: Outlook free/busy, self-scheduling, Teams links, scorecards, interviews hub | ✅ |
| **H** | **Foundation hardening:** service and policy layers, authorization fixes, audit (incl. view logging), immutable history, versioned migrations, demo-auth guard, consent/retention schema, tests and CI | ✅ |
| 3 | Offers, approval chains (jobs + offers), approvals inbox, openings, Word offer letters (EN/FR-CA) | ✅ |
| 4 | Career sites (multi-brand, EN/FR) + public jobs API, applications with questions/consent/resumes, referrals, talent pools & prospects | ✅ (agency portal, email sequences, browser extension later) |
| 5 | Reporting: standard reports, drill-down, point-in-time snapshot, custom builder, saved reports & dashboards, Excel/CSV export, scheduled delivery, Power BI OData feed | ✅ (diversity reports, candidate NPS, agency spend later) |
| 6 | Live M365: Entra SSO (delegated Graph), SCIM provisioning, queue + two-way mail sync, Teams app with approval cards | ✅ (needs tenant consent, an Azure Bot and a public https URL to go live) |
| 7 | AI assist: application review, notes, summaries, drafting | ⏳ |
