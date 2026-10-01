# PATS — Purpose Applicant Tracking System

Purpose Unlimited's in-house recruiting platform, built to match Ashby's feature set and run natively on Microsoft 365. See [PRD.md](PRD.md) for the full product requirements.

## Quick start

Requirements: Node 20+, PostgreSQL 16 (or Docker).

```bash
cp .env.example .env
docker compose up -d        # or use a local Postgres matching DATABASE_URL
npm install
npm run db:reset            # create tables + load demo data
npm run dev                 # http://localhost:3000
```

Sign in from the demo login screen as any seeded user. Each role (admin, recruiter, coordinator, hiring manager, interviewer, executive) sees a different home page.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode |
| `npm run db:push` | Sync the database schema from `src/db/schema.ts` |
| `npm run db:seed` | Wipe and reload demo data (deterministic) |
| `npm run db:reset` | Both of the above |
| `npm run typecheck` / `npm run lint` | Checks |

## Microsoft 365

Without credentials every M365 action (email, calendar, Teams) runs in **mock mode** and is logged under **Settings → Integrations**. Add Entra ID app credentials to `.env` to switch to live Microsoft Graph. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Stack

Next.js 16 (App Router, server actions) · TypeScript · Tailwind CSS 4 · PostgreSQL + Drizzle ORM · Microsoft Graph

```
src/
  app/(app)/         Staff app (requires sign-in)
  app/login/         Demo sign-in / Entra SSO
  components/        UI primitives and app shell
  db/                Schema, client, seed
  server/actions/    Server actions (mutations)
  server/queries/    Data loading
  server/integrations/m365/   M365 client: mock + Microsoft Graph
```

## Build phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation: schema, demo data, app shell, ⌘K, demo auth, M365 integration layer | ✅ |
| 1 | Core ATS: jobs, pipeline board/table, candidate profiles, notes, stage moves, archive | ✅ |
| 2 | Scheduling & feedback: Outlook free/busy, self-scheduling, Teams links, scorecards, interviews hub | ✅ |
| 3 | Offers, approvals, headcount & openings, Word offer letters | ⏳ |
| 4 | Career sites (multi-brand, EN/FR), applications, referrals, sourcing & CRM | ⏳ |
| 5 | Reporting: standard reports, custom builder, Excel/Power BI | ⏳ |
| 6 | Live M365: Entra SSO/SCIM, Graph mail sync, Teams app & approvals | ⏳ |
| 7 | AI assist: application review, notes, summaries, drafting | ⏳ |
