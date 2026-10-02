# PATS Architecture (locked)

**Status:** Locked v1, 2026-10-01. Owner: Kian Chen.
This document settles the open architecture choices in [PRD.md](../PRD.md) §8 and sets the rules all code must follow. Changing anything marked **LOCKED** needs Kian's explicit approval and a new entry in the Decision log (§11). Until that happens, code that conflicts with this document is a bug.

---

## 1. Locked stack decisions

| # | Decision | Status |
|---|---|---|
| D1 | **TypeScript end to end.** Next.js (App Router) for the staff app, the candidate career sites and the HTTP endpoints. No separate .NET or NestJS service for now. | LOCKED |
| D2 | **PostgreSQL + Drizzle ORM.** Azure Database for PostgreSQL Flexible Server, Canada Central (PRD §8). | LOCKED |
| D3 | **Versioned migrations.** Schema changes go through `drizzle-kit generate`, which produces committed SQL migration files that are applied with `drizzle-kit migrate`. Do not use `drizzle-kit push` (especially `--force`) against any shared or production database. | LOCKED |
| D4 | **A framework-agnostic domain/service layer** holds all business logic, permissions and auditing (§2). Server actions, route handlers, the REST API, workers and the Teams bot are thin adapters over it. | LOCKED |
| D5 | **Background work runs in a separate worker process.** Email sync, Graph webhooks, parsing, reminders, retention jobs and notifications go through a queue interface: Azure Service Bus in production, a Postgres-backed queue (e.g. pg-boss) locally. Workers reuse the same service layer. | LOCKED |
| D6 | **Public REST API (OpenAPI) + webhooks** (P1) are built over the same services, with zod schemas as the single source for validation and OpenAPI generation. | LOCKED (timing P1) |
| D7 | **Microsoft 365 integration goes through the `m365()` port only**, with mock and live adapters. No module calls Graph directly. | LOCKED |
| D8 | **Search goes through a `SearchIndex` port.** Postgres full-text search or ILIKE is acceptable for now, with Azure AI Search later. Callers never write search SQL directly. | LOCKED |
| D9 | **Files go through a `FileStore` port** (Azure Blob, plus SharePoint libraries for offer letters). The database stores metadata and a storage key, never file bytes. | LOCKED |
| D10 | **Reporting reads from a separate store** (read replica or warehouse) once it exists (PRD §7.4). Report queries must never be added to request paths that touch the primary database in ways that could slow the app. | LOCKED |
| D11 | **Design system on Purpose brand tokens.** `brand/tokens.css` is the single source for colour and type. Tailwind theme and components map to those tokens; brand guidance is in `brand/BRAND.md`. Per-brand career-site themes extend the tokens, they don't fork them. | LOCKED |

---

## 2. Layering

```
src/
  app/                    Next.js routes (UI). No business logic, no direct db writes.
  server/actions/         "use server" adapters: parse input (zod) → call a service → revalidate.
  app/api/**              Route handlers (REST, webhooks, public career site API): same rule.
  server/services/        Domain services. ALL reads/writes of domain data, permission checks, audit.
  server/policy/          Authorization: one place that answers "can user X do Y on Z".
  server/integrations/    Ports + adapters: m365, search, files, queue, hris, esign, ai.
  worker/                 Queue consumers (separate process), calling server/services.
  db/                     Schema, migrations, client. Imported only by services and the policy layer.
```

Rules:
1. **`src/app/**` and `src/components/**` never import `@/db`.** They import services or query functions that go through the policy layer.
2. **Every service function takes an explicit `actor`** (`Actor = { userId, role, … } | SystemActor`). It never reads cookies or session state itself, which lets workers and the API call it.
3. **Every exported server action is a public HTTP endpoint.** Each one authenticates, validates input with zod, and calls a service that runs the authorization check. Hiding something in the UI does not count as authorization.

---

## 3. Authorization invariants (PRD §4.12, P0)

1. **Job visibility is the root of access.** Anything tied to a job (applications, interviews, scorecards, offers, emails, notes, activities, files) is visible or editable only if the actor can see that job. Visibility rules (`server/policy`):
   - Admin and executive see all jobs.
   - Recruiter and coordinator see all non-confidential jobs, plus confidential jobs where they are on the hiring team.
   - Hiring managers and interviewers see only jobs where they are on the hiring team.
2. **Mutations check the target, not just the role.** Before changing an application, job, candidate or offer, the service checks that the actor can see the job(s) involved. A bulk action whose list includes a record the actor can't see must fail entirely; it must not silently skip that record.
3. **A candidate is visible** if the actor can see at least one of their applications. A candidate with no applications (sourced prospect) is visible only to admin, recruiter, coordinator (and sourcer, once that role exists).
4. **Every query that returns lists or search results is permission-trimmed**, including ⌘K search, autocompletes, counts, exports, reports and the API.
5. **Field-level permissions** live in one policy module, not in scattered `role !==` checks:
   - Compensation (job comp ranges, offers) and voluntary self-ID data are restricted fields.
   - Self-ID data is never shown per candidate in the staff UI. It appears only in aggregated reports with a minimum group size (PRD §7.1).
6. **Blind feedback:** an interviewer cannot see other people's scorecards for an application until they have submitted their own.
7. **Every record tied to a job must store its application ID or job ID.** Emails, notes, files and interviews need this so the visibility filter can apply to them. Rows tied only to a candidate (no job) are visible only to the broad roles above (admin, recruiter, coordinator, sourcer), not to hiring managers or interviewers.

## 4. Audit & history invariants

1. **The `audit_logs` table is append-only.** No updates or deletes from the app. Enforce this at the database level: the app's database role gets INSERT and SELECT only, plus a trigger that blocks UPDATE and DELETE.
2. **Logged events:** every create, update or delete of candidate personal data, applications, offers, scorecards, permissions or settings, plus every **view** of a candidate profile or resume and every **export**. Each entry records actor, action, entity type, entity id (one row per entity, never null for a single-entity action), timestamp, request id and IP/user agent where available.
3. **Each audit write happens in the same database transaction as the change it records.**
4. **`application_stage_events` is immutable** (append-only, same enforcement as audit logs). Every change to an application's stage or status (move, archive, unarchive, hire, reopen) writes exactly one event. Point-in-time reporting depends on it.
5. **History survives deletion.** Use `ON DELETE RESTRICT`, not cascade, from candidates and applications to stage events and audit logs. Deleting a candidate means **anonymization**: wipe the personal-data columns and keep the IDs, stage events and aggregate facts (§5).
6. **Integration logs must not copy PII bodies.** `integration_events` stores the operation, status, IDs and recipient domain only, never full email bodies or resumes.

## 5. Privacy & compliance invariants (PIPEDA, Quebec Law 25, CASL)

1. **Data residency:** every datastore, queue, file store, search index, log sink and AI endpoint runs in Azure Canada Central or Canada East.
2. **Consent:** a `consent_records` table records each grant or withdrawal: candidate, purpose (application processing, talent pool / future roles, marketing/CASL), policy version, language, source, timestamp, and expiry. Applying always captures consent. Outreach sequences require a valid CASL basis.
3. **Retention:** retention policies are configured by brand and record type. A scheduled worker job anonymizes candidates once their retention period passes, unless they have renewed consent or an active application. Every anonymization is audited.
4. **Data subject requests** (access, correction, deletion) are first-class records with a status and an SLA, and are fulfilled through the services so they are audited.
5. **AI features** (PRD §4.10) go through an AI gateway port that logs requests and keeps a human decision point. Candidate data is never used for model training. The automated-decision disclosure required by Law 25 must be in place before any AI scoring ships.

## 6. Identity & sessions

1. **Staff:** Entra ID OIDC (SSO and MFA via Conditional Access) plus SCIM provisioning. Roles map from Entra groups.
2. **Demo sign-in** (pick any user) is allowed only when `PATS_DEMO_AUTH=true` **and** `NODE_ENV !== "production"`. The app refuses to start in production if demo auth is enabled.
3. **No fallback secrets.** `SESSION_SECRET` and the other secrets are required and come from Key Vault in Azure. If one is missing, the app fails at boot.
4. **Candidates and agencies** use separate authentication (magic link or Entra External ID). Their sessions can never reach staff routes or staff server actions.

## 7. Domain model invariants

1. **Brand is a first-class dimension.** Jobs, email and offer templates, career sites, retention policies and approval chains are all scoped by brand. Whether candidates are shared across brands is an open question (PRD §12 Q4). Until it's decided, candidates are global and have no brand.
2. **Candidate-facing text is bilingual.** Postings, application forms, email templates and offer templates hold EN and FR-CA versions (`locale` column or translation table). Candidates have `preferredLocale` and `timezone`.
3. **Custom fields** use one generic definition table and one value table, attached to candidate, application, job, opening or offer, with field-level permission flags. Don't add one-off columns for things that should be custom fields.
4. **Approvals** use one generic approval-chain model, shared by job/requisition approvals (P0) and offer approvals (P0), and later usable from Teams Adaptive Cards.
5. **@mentions store user IDs** in structured note content, never names matched against text.
6. **Money:** integer minor units or whole dollars plus an ISO currency code, used consistently. No floats.
7. **Time:** store UTC `timestamptz`. Show times in the viewer's time zone, and in the candidate's time zone on anything candidate-facing.

## 8. Microsoft 365 rules (PRD §6)

1. **Delegated permissions** when PATS acts as the user (sending mail from their mailbox, creating events on their calendar). **Application permissions**, scoped with an Application Access Policy or RBAC for Applications, only for shared mailboxes (careers@) and background sync.
2. **Graph change notifications (webhooks) instead of polling.** Subscription renewal runs as a worker job.
3. **Every Graph call respects `429`/`503` `Retry-After`** with backoff, and uses `$batch` and delta queries where available.
4. **Long or retryable Graph work runs in the worker,** not inside a user request.

## 9. Engineering baseline

- Strict TypeScript, ESLint, `npm run typecheck && npm run lint && npm test` all passing before every push.
- **Tests are required** for the policy layer (visibility matrix per role) and for every service that writes data (asserting the stage-event and audit-row side effects).
- **GitHub Actions CI:** typecheck, lint, tests, migration check (generated migrations match the schema), and dependency scanning.
- Seed data is synthetic only. Never load real candidate data into dev or demo databases.

## 10. Phase ordering (aligned to PRD §9)

The PRD's MVP (Phase 1) includes SSO/SCIM, RBAC, audit, retention and consent. These are **foundations, not a late phase**. Before more feature phases continue:

1. **Foundation hardening (now):** service and policy layers, authorization fixes, audit (including view logging), immutable history, versioned migrations, the demo-auth guard, the consent/retention schema, a test harness and CI.
2. Then continue with feature phases (scheduling and feedback, offers and approvals, career sites…). Entra SSO can go live whenever tenant consent is ready, but the code paths must already assume it.

## 11. Decision log

| Date | Decision | By |
|---|---|---|
| 2026-10-02 | **PROPOSED, pending Kian:** an approver named on an approval request may see that request's summary in the Approvals inbox and decide their step, even if they can't see the job. The summary is the job title, brand and department, the candidate's name, and the offer terms, subject to the compensation rule (§3.5). It grants no other access: the job, the candidate profile and the offers list still follow §3.1. **Why:** chains name approvers (e.g. a CFO) who are not on the hiring team. Implemented in `services/approval-inbox.ts` and `services/approval-decisions.ts`. | Claude (Phase 3), awaiting approval |
| 2026-10-02 | **PROPOSED, pending Kian:** when no active chain applies, a job opens or an offer is approved without approval. Reopening a job that was open before doesn't need approval again. | Claude (Phase 3), awaiting approval |
| 2026-10-01 | D11 added: UI built on `brand/tokens.css` and `brand/BRAND.md`. | Kian Chen |
| 2026-10-01 | D1–D10 locked. Next.js full-stack TypeScript kept, with a mandatory service/policy layer, versioned migrations, and a worker plus REST API reusing the services. | Kian Chen |
