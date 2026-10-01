# PATS — Purpose Applicant Tracking System
### Product Requirements Document (Brainstorm Draft v0.1)

| | |
|---|---|
| **Owner** | Kian Chen |
| **Org** | Purpose Unlimited |
| **Status** | Brainstorm / Discovery |
| **Last updated** | 2026-10-01 |

---

## 1. Vision

Build **PATS**, a proprietary, all-in-one recruiting platform for Purpose Unlimited and its brands (Purpose Investments, Purpose Advisor Solutions, Steadyhand, Harness, Driven, Foundation Wealth Partners, etc.). It should match Ashby's feature set and its fast, dense, keyboard-friendly UI, and **sit inside Microsoft 365**. That means Entra ID identity, Outlook mail and calendar, Teams meetings and notifications, SharePoint document storage, and Power BI / Excel reporting.

**One-liner:** *Ashby-grade recruiting, built for Purpose, running on Microsoft.*

### 1.1 Why build instead of buy

| Driver | Notes |
|---|---|
| Cost | Ashby pricing scales per employee or seat. Compare against build cost plus run cost over 3 to 5 years (see §11). |
| M365-native | Ashby is Google-first. Its Microsoft support works but is shallower. PATS treats M365 as the main platform. |
| Data ownership & residency | Candidate PII stays in Purpose's Azure tenant (Canada Central / Canada East). This supports PIPEDA and Quebec Law 25. |
| Multi-brand | One platform with brand-specific career sites, templates, and permissions. |
| Proprietary reporting | Join recruiting data with HRIS, finance, and headcount data in Purpose's own warehouse. |
| Extensibility | Custom workflows for financial services, e.g. registration checks and compliance attestations. |

### 1.2 Risks of building (be honest)
- Ashby took years and a large engineering team. Matching it fully is a **multi-year roadmap**, not one release.
- We become responsible for ongoing maintenance, security, uptime, and compliance (SOC 2-like controls, pen tests).
- Job board syndication (LinkedIn, Indeed) needs partner agreements and API access.
- Adoption risk: recruiters will compare PATS to a mature product every day.

> **Recommendation for discovery:** first define the **MVP feature set needed to switch off the current tool**. Then plan Ashby feature parity in phases (see §9).

---

## 2. Goals & Non-Goals

### Goals
1. Feature parity with Ashby's core modules: ATS, CRM/Sourcing, Scheduling, Analytics, Offers, Career Site, and AI assist.
2. UI/UX close to Ashby's: dense tables, side-panel candidate profiles, command palette, keyboard shortcuts, and fast navigation that feels instant.
3. Deep, two-way Microsoft 365 integration (§6).
4. Robust self-serve reporting with a custom report builder, dashboards, scheduled reports, and Power BI export.
5. Enterprise-grade security, auditability, and Canadian privacy compliance.

### Non-Goals (for now)
- Selling PATS externally as SaaS. The architecture shouldn't rule it out, but it's not a goal.
- Replacing the HRIS. PATS hands off to the HRIS at hire.
- Full onboarding suite. Light pre-boarding only, unless we decide otherwise.

---

## 3. Users & Personas

| Persona | Primary jobs-to-be-done |
|---|---|
| **Recruiter** | Manage pipelines, screen, move stages, email candidates, schedule, run offers |
| **Sourcer** | Find passive talent, run outreach sequences, build talent pools |
| **Recruiting Coordinator** | Schedule complex interview loops, book rooms, handle reschedules |
| **Hiring Manager** | Approve reqs, review candidates, give feedback, make decisions, see their own pipeline |
| **Interviewer** | See their upcoming interviews, prep with interview kits, submit scorecards fast (in Teams or Outlook) |
| **Recruiting Ops / Admin** | Configure jobs, stages, templates, permissions, fields, automations |
| **Executive / Finance / P&C Leadership** | Headcount plans, approvals, dashboards, cost-per-hire |
| **Candidate** | Find and apply for jobs, self-schedule, get timely updates, sign offers |
| **Referrer (any employee)** | Submit referrals and track their status |
| **Agency** | Submit candidates to assigned jobs via a portal |

---

## 4. Feature Inventory (Ashby parity map)

Priority key: **P0** = MVP / needed to switch off the current tool · **P1** = parity · **P2** = differentiator / later

### 4.1 Core ATS
| Feature | Description | Pri |
|---|---|---|
| Jobs | Create, edit, and clone jobs. Department, location, brand, employment type, remote policy, comp range, confidential flag | P0 |
| Openings / Requisitions | Multiple openings per job, each with an opening ID, target start date, and status | P0 |
| Interview Plans / Pipelines | Configurable stages per job (Application Review → Screen → Onsite → Offer → Hired), plus stage templates | P0 |
| Candidate profiles | Unified person record across applications: contact info, resume, links, tags, source, history | P0 |
| Applications | Candidate × job, with current stage, status, credited-to, and source | P0 |
| Activity feed | Timeline of emails, notes, stage moves, feedback, and events with @mentions | P0 |
| Notes & @mentions | Rich-text notes with @mentions that notify users (Teams, email, in-app) | P0 |
| Resume parsing | Auto-extract contact details, work history, education, and skills from PDF/DOCX | P0 |
| Duplicate detection & merge | Match on email, phone, or LinkedIn and merge records | P0 |
| Archive / rejection reasons | Structured reasons with optional automatic rejection emails | P0 |
| Bulk actions | Bulk move, reject, email, tag, or add to project | P0 |
| Custom fields | On candidates, applications, jobs, openings, and offers, with field-level permissions | P0 |
| Global search | Full-text and boolean search across candidates, resumes, notes, and jobs | P0 |
| Command palette & shortcuts | Cmd/Ctrl+K, j/k navigation, single-key stage moves | P1 |
| Saved views / filters | Personal and shared pipeline views | P1 |
| Application review mode | Fast swipe-style review queue for inbound applicants | P1 |
| Auto-advance / automations | Rules such as "when scorecards complete → move to debrief" or "if knockout question fails → archive" | P1 |
| Confidential jobs | Restricted visibility for exec or sensitive roles | P0 |
| Candidate tasks / to-dos | Follow-ups assigned to users | P1 |

### 4.2 Sourcing & CRM
| Feature | Description | Pri |
|---|---|---|
| Browser extension | Add candidates from LinkedIn, GitHub, or any web page into PATS (Edge/Chrome) | P1 |
| Talent pools / Projects | Lists of prospects not tied to a job | P1 |
| Email sequences / campaigns | Multi-step outreach sent from the user's Outlook mailbox, with auto-stop on reply | P1 |
| Engagement tracking | Opens, clicks, replies, and sequence analytics | P1 |
| Prospect stages | Contacted → Interested → Applied | P1 |
| Re-engagement / silver medalists | Surface past finalists for new roles | P2 |
| Nurture campaigns | Newsletters to talent pools | P2 |
| AI sourcing search | Natural-language search over the internal talent database | P2 |

### 4.3 Interview Scheduling
| Feature | Description | Pri |
|---|---|---|
| Availability from Outlook | Microsoft Graph free/busy and `findMeetingTimes` | P0 |
| One-click scheduling | Recruiter picks interviewers and duration, system proposes times | P0 |
| Candidate self-scheduling | Candidate picks from live slots via a link | P0 |
| Auto Teams meeting links | Generate a Teams meeting on each event | P0 |
| Multi-interview loops / panels | Back-to-back loops, panels, and multi-day onsites | P1 |
| Interviewer pools | Pools by skill or role with load balancing and weekly caps | P1 |
| Interviewer training | Shadow and reverse-shadow tracking toward qualification | P2 |
| Room booking | Outlook room resource mailboxes | P1 |
| Reschedule / cancel flows | Candidate and interviewer initiated, with change notifications | P0 |
| Time zone handling | Candidate-local display everywhere | P0 |
| Debrief scheduling | Auto-schedule the debrief after the loop | P1 |
| Interviewer preferences | Working hours, max interviews per day or week, keyword blocks | P1 |
| Availability requests | Ask the candidate for their availability when self-scheduling isn't used | P1 |

### 4.4 Interview Feedback & Decisioning
| Feature | Description | Pri |
|---|---|---|
| Scorecards / feedback forms | Per-stage templates with attributes, ratings, and an overall recommendation | P0 |
| Interview kits / guides | Questions and focus areas for each interviewer | P1 |
| Feedback reminders | Escalating reminders via Teams and email | P0 |
| Blind feedback | Hide others' feedback until you submit yours | P1 |
| Debrief view | Side-by-side scorecards and a decision log | P1 |
| Feedback in Teams | Submit a scorecard from an Adaptive Card or Teams tab | P2 |
| AI interview notetaker | Teams meeting transcript → structured notes and draft scorecard | P2 |
| AI feedback summary | Summarize all feedback for the debrief | P2 |

### 4.5 Offers
| Feature | Description | Pri |
|---|---|---|
| Offer forms | Structured comp: base, bonus, equity/LTIP, start date, and custom fields | P0 |
| Offer approval chains | Configurable approvers by brand, level, or comp band, with approve/reject in Teams | P0 |
| Offer letter templates | Word templates with merge fields, stored in SharePoint | P0 |
| E-signature | DocuSign or Adobe Sign integration, or a built-in signature | P1 |
| Candidate offer portal | Candidate views, accepts, or declines online | P1 |
| Comp band guardrails | Warn or block when an offer is outside the band | P1 |
| Offer versions | Track revisions and counter-offers | P1 |

### 4.6 Headcount Planning & Job Approvals
| Feature | Description | Pri |
|---|---|---|
| Headcount plans | Planned positions by brand, department, and quarter, with budget | P1 |
| Job / requisition approvals | Approval workflows before a job opens | P0 |
| Backfill vs. new headcount | Track reason and linked departing employee | P1 |
| Plan vs. actual | Hired, open, and planned against budget | P1 |
| Finance sync | Import or export with the finance planning tool | P2 |

### 4.7 Career Site & Job Postings
| Feature | Description | Pri |
|---|---|---|
| Hosted career sites | **One per brand**, using that brand's theme and domain (e.g. careers.purposeinvest.com) | P0 |
| Embeddable job board | Widget or API for existing brand websites | P0 |
| Bilingual (EN / FR-CA) | Postings and application forms in both languages (Quebec Law 25 / Charter of the French Language) | P0 |
| Application forms | Configurable questions, file uploads, and knockout questions | P0 |
| Voluntary self-ID / diversity surveys | Kept separate from the application and access-restricted (Canadian Employment Equity categories) | P1 |
| Job board syndication | LinkedIn, Indeed, Glassdoor, Workopolis, Job Bank Canada | P1 |
| SEO / Google for Jobs | Structured data (JobPosting schema) | P0 |
| Accessibility | WCAG 2.1 AA and AODA compliance | P0 |
| Spam / bot protection | CAPTCHA and rate limiting | P0 |
| Pay transparency | Show salary ranges where required by law (e.g. Ontario, BC) | P0 |

### 4.8 Referrals & Agencies
| Feature | Description | Pri |
|---|---|---|
| Referral portal | Any employee (signed in via Entra SSO) can refer a candidate and track their status | P1 |
| Referral bonuses | Eligibility and payout tracking | P2 |
| Agency portal | External agencies submit to assigned jobs, with duplicate and ownership rules | P1 |
| Agency fee tracking | Terms and invoices | P2 |

### 4.9 Communication
| Feature | Description | Pri |
|---|---|---|
| Email from PATS via Outlook | Send as the user or a shared mailbox through Graph, with threads synced back | P0 |
| Email templates | With merge fields, per brand, in EN/FR | P0 |
| Scheduled send | Send later | P1 |
| Candidate SMS | Optional, e.g. via Azure Communication Services | P2 |
| Candidate experience surveys | Post-interview and post-decision NPS | P1 |
| Notifications center | In-app, Teams, and email, configurable per user | P0 |

### 4.10 AI Assist (Ashby AI parity, plus our own)
| Feature | Description | Pri |
|---|---|---|
| AI application review | Score applicants against job criteria. Human-in-the-loop with explanations. Bias-audited | P2 |
| AI email drafting | Draft outreach, rejections, and updates | P1 |
| AI job description writer | Generate JDs from the req and comp band, in Purpose brand voice | P1 |
| AI interview notes | Teams transcript → notes → draft scorecard | P2 |
| AI search | "Find senior PMs in Toronto we interviewed in 2025" | P2 |
| AI report builder | Natural language → report | P2 |

> AI features need an **AI governance review**: model choice, data processing in Canada, no training on candidate data, an audit trail, and human final decision. Also review applicable rules on automated decision-making, e.g. Quebec Law 25's automated decision disclosure and Ontario's requirement to disclose AI use in job postings.

### 4.11 Analytics & Reporting (see §7)

### 4.12 Admin, Security & Compliance
| Feature | Description | Pri |
|---|---|---|
| SSO via Entra ID | OIDC/SAML with MFA enforced through Conditional Access | P0 |
| SCIM / user provisioning | Entra groups → PATS roles, with auto-deprovisioning | P0 |
| Role-based access control | Admin, Recruiter, Coordinator, Hiring Manager, Interviewer, plus custom roles | P0 |
| Job-level permissions | Hiring team membership grants access | P0 |
| Field-level permissions | e.g. hide compensation and self-ID data | P0 |
| Audit log | Every view, export, and change to PII, exportable to Microsoft Sentinel | P0 |
| Data retention policies | Auto-anonymize or delete after N months unless consent is renewed | P0 |
| Candidate data requests | Access, correction, and deletion requests (PIPEDA / Law 25) | P0 |
| Consent management | Consent capture on apply, renewal emails | P0 |
| Data residency | All data stored in Azure Canada regions | P0 |
| Encryption | At rest (customer-managed keys optional) and in transit | P0 |
| Brand / entity segregation | Data partitioned by legal entity where required | P1 |

### 4.13 Integrations & Platform
| Feature | Description | Pri |
|---|---|---|
| HRIS handoff | Push hired candidates to the HRIS (Workday / ADP / UKG? to be confirmed) | P0 |
| Background checks | e.g. Certn, Sterling. Includes credit/criminal checks typical for financial services | P1 |
| Assessments | e.g. Codility, HackerRank, TestGorilla, Criteria | P2 |
| Registration checks | CIRO / regulatory registration verification for advisory roles | P2 |
| Public REST API | Covers every object | P1 |
| Webhooks | Event-driven (application.created, stage.changed, offer.accepted…) | P1 |
| Power Automate connector | Custom connector so ops can build their own workflows | P2 |
| Slack | Only if some brands use Slack. Teams comes first | P2 |

---

## 5. UX / UI Principles (Ashby-like)

1. **Speed is a feature.** Target under 100ms perceived navigation, with optimistic updates, prefetching, and no full page reloads.
2. **Dense, scannable tables.** Pipeline and list views use resizable, sortable columns and inline editing.
3. **Side-panel profiles.** Open a candidate without losing your place in the list.
4. **Keyboard-first.** Cmd/Ctrl+K command palette, `j`/`k`, `e` to email, `a` to advance, `r` to reject.
5. **Consistent layout.** Left nav (Jobs, Candidates, Sourcing, Scheduling, Reports, Settings), main area in the center, contextual panel on the right.
6. **Views per role.** A hiring manager sees a simplified "My Jobs" home. An interviewer sees "My Interviews & Feedback Due".
7. **Design system.** Built on Purpose brand tokens, with light and dark modes and accessibility (WCAG 2.1 AA) built in from day one.
8. **Responsive.** Hiring managers can approve and give feedback on mobile, and through Teams mobile.

**Key screens to design first:**
- Job pipeline (kanban and table views)
- Candidate profile (activity, feedback, emails, files, applications)
- Scheduling composer
- Scorecard form
- Offer form and approval
- Report builder and dashboard
- Career site (per brand)
- Settings: interview plans, templates, permissions

---

## 6. Microsoft 365 Integration (deep dive)

| M365 Service | PATS Integration | Graph / API |
|---|---|---|
| **Entra ID** | SSO, MFA, Conditional Access, SCIM provisioning, group-to-role mapping, manager hierarchy for approvals | OIDC, SCIM, `/users`, `/groups`, `/manager` |
| **Outlook Mail** | Send as the user or a shared mailbox (e.g. careers@). Sync replies into the candidate timeline. Track threads | `/sendMail`, mail subscriptions (webhooks), `/messages` |
| **Outlook Calendar** | Free/busy, suggested meeting times, create/update/cancel events, interviewer working hours | `getSchedule`, `findMeetingTimes`, `/events` |
| **Rooms** | Room lists and booking | `/places`, room mailboxes |
| **Teams Meetings** | Auto-create an online meeting per interview, with lobby settings for external candidates | `onlineMeetings` |
| **Teams Bot / App** | Notifications such as "feedback due", "offer needs approval", "new referral update". Adaptive Cards to approve, reject, or submit feedback inline. A personal tab for "My Interviews" | Bot Framework, Adaptive Cards |
| **Teams Message Extension** | Search candidates or jobs from any chat and share a profile card | Teams App manifest |
| **Teams Transcripts** | (Opt-in) Pull interview transcripts for AI notes | `callTranscripts` |
| **SharePoint / OneDrive** | Store resumes, offer letters, and signed docs in controlled libraries, with retention labels | `/drives`, `/sites` |
| **Word** | Offer letter and contract templates with merge fields | Word templates + generation service |
| **Excel** | Export any report. Live refreshable connection | OData feed |
| **Power BI** | Certified dataset / semantic model of PATS data, plus embedded Power BI dashboards in PATS (optional) | OData / Fabric / direct warehouse |
| **Power Automate** | Custom connector (triggers and actions) | OpenAPI custom connector |
| **Purview** | Data classification, DLP, retention, eDiscovery over PATS documents and audit | Retention labels, audit export |
| **Copilot (M365)** | Copilot agent / Graph connector so users can ask "status of the Senior PM search?" (permission-trimmed) | Copilot connectors / declarative agents |
| **Planner / To Do** | (Optional) Sync PATS tasks to a user's To Do | `/todo` |
| **Defender / Sentinel** | Stream security and audit logs | Log Analytics |

**Design considerations:**
- Use **delegated** permissions where acting as the user, e.g. sending mail. Use **application** permissions, scoped with Application Access Policies or RBAC for Applications, for background sync.
- Use Graph change notifications (webhooks) rather than polling, with renewal jobs.
- Handle throttling with backoff, batching, and delta queries.
- Get admin consent and run a security review with Purpose IT early.

---

## 7. Reporting & Analytics (deep dive)

### 7.1 Out-of-the-box reports
- **Pipeline / funnel:** conversion by stage, pass-through rates, drop-off
- **Velocity:** time-to-hire, time-to-fill, time-in-stage, time-to-first-touch
- **Source effectiveness:** applications, hires, and quality by source (referral, agency, LinkedIn, career site…)
- **Recruiter / team productivity:** activity, reqs per recruiter, hires
- **Interviewer analytics:** load, feedback timeliness, calibration (pass-rate variance)
- **Offer analytics:** acceptance rate, decline reasons, comp vs. band
- **Headcount:** plan vs. actual, open reqs, aging reqs
- **Diversity (aggregated, privacy-thresholded):** funnel by voluntary self-ID with minimum group sizes
- **Candidate experience:** survey NPS by stage, job, and interviewer
- **Agency spend / cost-per-hire**
- **Sourcing / outreach:** sequence open, reply, and conversion rates

### 7.2 Custom report builder
- Drag-and-drop: choose a dataset (Applications, Candidates, Interviews, Offers, Openings…), then group-by, filters, metrics, and a visualization
- Pivot tables, time series, cohort analysis, stage-transition (Sankey) views
- Historical point-in-time snapshots ("what did the pipeline look like on March 1?") → needs **event-sourced stage history**
- Drill-down from any number to the underlying records, permission-aware
- Saved reports, dashboards, and sharing with permission trimming

### 7.3 Distribution
- Scheduled email and Teams delivery (PDF, Excel)
- Excel / CSV export (audited)
- Power BI semantic model plus a refreshable OData feed
- Data warehouse sync (Fabric / Synapse / Snowflake?) for joining with HR and finance data

### 7.4 Data model implications
- Store every stage change as an immutable event (`application_stage_events`)
- Use a separate analytics store (read replica or columnar store) so reporting never slows the app
- Use a metrics layer with consistent definitions, e.g. how "time-to-hire" is measured

---

## 8. Proposed Technical Architecture (for discussion)

| Layer | Option(s) |
|---|---|
| Frontend | React + TypeScript (Next.js or Vite SPA), TanStack Query/Table, Radix/shadcn-style component library themed to the Purpose brand |
| Backend | TypeScript (NestJS / Fastify) **or** .NET 8, depending on Purpose engineering skills. .NET has the strongest Microsoft/Graph tooling |
| API | REST (OpenAPI) + webhooks. GraphQL optional for the UI |
| Database | PostgreSQL (Azure Database for PostgreSQL Flexible Server, Canada Central) |
| Search | Azure AI Search or OpenSearch (resumes, full text, semantic) |
| Queue / jobs | Azure Service Bus + workers (email sync, parsing, notifications, Graph webhooks) |
| Files | Azure Blob (encrypted) and/or SharePoint libraries |
| Analytics | Postgres read replica → Microsoft Fabric / warehouse. Power BI semantic model |
| AI | Azure OpenAI or Claude via an approved provider with Canadian processing, behind an AI gateway with logging |
| Auth | Entra ID (staff), passwordless magic links or Entra External ID (candidates, agencies) |
| Hosting | Azure App Service / Container Apps / AKS, Front Door + WAF |
| Observability | Application Insights, Log Analytics, Sentinel |
| CI/CD | GitHub Actions, IaC with Bicep/Terraform, staging and prod environments |

**Core domain objects:** Organization/Brand, User, Role, Department, Location, Job, Opening, InterviewPlan, Stage, Candidate, Application, StageEvent, Source, Interview, InterviewEvent, Scorecard, FeedbackForm, Offer, OfferApproval, Email/Thread, Template, Note, Task, Project/Pool, Sequence, Referral, Agency, CustomField, Report, Dashboard, AuditLog, ConsentRecord.

---

## 9. Phased Roadmap (draft)

| Phase | Scope | Rough timing* |
|---|---|---|
| **0. Discovery** | Audit current tool and usage. Interview recruiters, HMs, and IT. Confirm HRIS. Get M365 admin consent. Design system and key screen prototypes. Build-vs-buy cost model | 4–6 wks |
| **1. MVP (switch-off-ready)** | Jobs/openings/approvals, interview plans, candidates/applications, resume parsing, Outlook email, scheduling with Teams links and self-schedule, scorecards, offers with approvals and Word templates, career sites (multi-brand, EN/FR), Entra SSO/SCIM, RBAC, audit, retention, core reports, data migration from the current ATS | 6–9 mo |
| **2. Parity** | CRM/sourcing and sequences, browser extension, referrals and agency portals, interviewer pools and load balancing, debriefs, custom report builder, scheduled reports, Power BI model, Teams bot and Adaptive Cards, e-sign, background checks, API and webhooks, headcount planning | +6 mo |
| **3. Differentiate** | AI suite (review, notetaker, summaries, search, report builder), Copilot agent, interviewer training, nurture campaigns, advanced analytics, Power Automate connector | +6 mo |

\*Timings depend heavily on team size. Assume 4–6 engineers, 1 designer, 1 PM, and part-time QA and security.

---

## 10. Non-Functional Requirements

- **Performance:** P95 page interaction under 300ms. Pipeline of 5k applicants renders under 1s.
- **Availability:** 99.9% during business hours (ET/PT). Defined RPO/RTO (e.g. RPO 15 min, RTO 4h).
- **Scale:** About X hires/year, Y applications/year, Z users. *(fill in during discovery)*
- **Security:** OWASP ASVS L2, annual pen test, dependency scanning, secrets in Key Vault, least privilege.
- **Privacy:** PIPEDA, Quebec Law 25 (privacy impact assessment, consent, automated-decision transparency), CASL for outreach emails, provincial pay-transparency and AI-disclosure rules.
- **Accessibility:** WCAG 2.1 AA (staff app and career sites), AODA.
- **Localization:** EN and FR-CA for candidate-facing surfaces. FR for the staff UI is P2.
- **Auditability:** Immutable audit trail retained for 7 years (confirm with Compliance).

---

## 11. Success Metrics

| Metric | Target (draft) |
|---|---|
| Adoption | 100% of reqs in PATS within 60 days of launch |
| Recruiter efficiency | -30% time on scheduling. -20% clicks per stage move vs. the current tool |
| Feedback timeliness | 85%+ scorecards submitted within 24h |
| Time-to-hire | -10% within 2 quarters |
| Candidate NPS | ≥ +50 |
| Hiring manager CSAT | ≥ 4.3 / 5 |
| TCO | 3-year TCO ≤ Ashby quote (or justified by strategic value) |
| Security | Zero critical findings at launch pen test |

---

## 12. Open Questions

1. What ATS does Purpose use today, and what has to be migrated (years of history, attachments)?
2. Which HRIS is the system of record (Workday, ADP, UKG, Dayforce…)?
3. Hiring volume: hires per year, applications per year, number of recruiters, HMs, and interviewers?
4. Which brands are in scope at launch? Shared talent pool across brands or separate?
5. Do any brands use Google Workspace or Slack, or is everyone on M365?
6. Engineering team: internal, contracted, or a mix? Preferred stack (.NET vs. TypeScript)?
7. Compliance requirements for financial services hiring: background checks, credit checks, registration?
8. AI appetite and policy: what's approved by Risk/Compliance?
9. E-signature vendor already in use (DocuSign / Adobe)?
10. Budget envelope and target go-live date?
11. Do we need SOC 2-like controls documented for internal audit?
12. Is a branded name/domain needed per brand for career sites?

---

## 13. Next Steps

- [ ] Validate this feature list with the Talent Acquisition team (priority ranking workshop)
- [ ] Get the current Ashby quote and current-tool costs for the build-vs-buy model
- [ ] Meet Purpose IT on M365 permissions, Entra app registration, and Azure landing zone
- [ ] Meet Privacy/Compliance on Law 25 PIA, retention, and AI usage
- [ ] Design sprint on the 6 key screens (§5)
- [ ] Turn P0 items into epics and user stories
- [ ] Choose the tech stack and set up the repo scaffolding
