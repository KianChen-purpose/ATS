# CLAUDE.md — rules for every session working on PATS

Read [PRD.md](PRD.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before you write any code, and [brand/BRAND.md](brand/BRAND.md) before you build any UI. Everything in ARCHITECTURE.md marked **LOCKED** is binding. If a task seems to need something different, stop and ask Kian. Do not work around it.

## Non-negotiables (check every change against these)

1. **Layering:** UI and server actions never write to the database directly. Business logic, authorization and audit logging live in `src/server/services` and `src/server/policy`. Service functions take an explicit `actor` argument.
2. **Authorization:** every server action, route handler and query does both of these:
   - Authenticates the caller.
   - Validates input with zod and runs the policy check against the target record, not just the caller's role.

   Lists and search results are filtered by job visibility, and confidential jobs must never leak. Remember that a server action is a public endpoint.
3. **Audit:** every view of personal data, every export and every change is audit-logged in the same transaction as the change. `audit_logs` and `application_stage_events` are append-only. Every stage or status change writes exactly one stage event.
4. **Privacy:**
   - No cascade deletes of history. Deleting a candidate means anonymizing them.
   - Capture consent on apply.
   - Never put PII bodies (emails, resumes) in logs or `integration_events`.
   - All resources live in Canadian regions.
5. **Schema changes:** run `npm run db:generate` and commit the SQL migration. Never use `drizzle-kit push --force` against shared or production databases.
6. **Auth:** demo sign-in only with `PATS_DEMO_AUTH=true` outside production. No fallback secrets.
7. **Bilingual and brand-aware:** candidate-facing content supports EN and FR-CA. Templates, career sites and approval chains are scoped by brand.
8. **Integrations go only through the ports:** `m365()`, search, file store, queue and AI gateway. Long or retryable work goes to the worker. Graph calls respect `Retry-After`.
9. **Tests:** cover every new policy rule and every service that writes data, asserting the audit and stage-event side effects. Run `npm run typecheck && npm run lint && npm test` before you push.
10. **Brand and design system:** every UI, module and career site follows `brand/BRAND.md` and uses the tokens in `brand/tokens.css` (Ivory / Warm Neutral / Black, Season Mix headings, Inter body). Don't hardcode colours or fonts in components; map them to the tokens. Accessibility (WCAG 2.1 AA) wins if a brand choice conflicts with it.
11. **Scope:** finish P0 foundations before P1/P2 features. Don't build HRIS replacement or full onboarding (PRD non-goals).

## Before each commit, ask yourself

- Can a user without access to this job read or change this record through my code path, including ⌘K search, bulk actions and direct POSTs?
- Is the change audited, and is the stage history intact?
- Did I add personal data somewhere that retention and anonymization won't reach?
- Did I make an architecture decision that isn't in ARCHITECTURE.md? If so, ask Kian and add it to the decision log.

@AGENTS.md
