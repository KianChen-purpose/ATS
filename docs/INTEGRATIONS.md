# Microsoft 365 integration

All M365 calls go through `src/server/integrations/m365`. `m365()` returns the **live** Microsoft Graph client when Entra credentials are set and the **mock** client otherwise. Both log every call to the `integration_events` table, shown under **Settings → Integrations**.

## Going live

1. In the Entra admin center, create an app registration, for example "PATS".
2. Add a client secret (or certificate).
3. Add Microsoft Graph permissions following [ARCHITECTURE.md](ARCHITECTURE.md) §8:
   - **Delegated** permissions whenever PATS acts as the signed-in user (sending from their mailbox, creating events on their calendar):
     - `Mail.Send`: candidate email from the recruiter's own mailbox
     - `Calendars.ReadWrite`: interview events on the organiser's calendar (Teams links via `isOnlineMeeting`)
     - `Calendars.Read.Shared` or `getSchedule` access: interviewer free/busy
     - `User.Read`, `User.ReadBasic.All`: profile and people lookup
   - **Application** permissions only for the shared mailbox (`careers@`) and background sync run by the worker:
     - `Mail.Send` / `Mail.Read`: sending from and syncing replies into `careers@`
     - `Calendars.Read`: free/busy lookups made through `careers@`
     - `TeamsActivity.Send`: Teams notifications (requires the PATS Teams app, Phase 6)
4. Scope every application permission with an Exchange **Application Access Policy** or **RBAC for Applications**, limited to `careers@` and the sync mailboxes. Never grant tenant-wide mailbox access.
5. Set these variables in `.env`:

```
M365_TENANT_ID=<directory (tenant) id>
M365_CLIENT_ID=<application (client) id>
M365_CLIENT_SECRET=<secret>
M365_SENDER_MAILBOX=careers@purpose.ca
```

Restart the app. Settings → Integrations will show **Live · Microsoft Graph**.

## Microsoft sign-in (Entra ID SSO, Phase 6)

Setting the three `M365_*` credentials also turns on **Sign in with Microsoft** (OpenID Connect authorization code flow with PKCE, state and nonce; ID tokens verified against the tenant's signing keys).

1. On the app registration, add the web redirect URI `<APP_URL>/auth/callback` (and `<APP_URL>/login` as the front-channel logout URL).
2. Add **delegated** Graph permissions `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Mail.Send`, `Calendars.ReadWrite`, and grant admin consent. PATS then sends candidate email and creates interview events **as the signed-in user**, from their own mailbox. Each user's refresh token is stored encrypted (AES-256-GCM, `TOKEN_ENCRYPTION_KEY` from Key Vault) and is dropped automatically if consent is revoked.
3. Define **app roles** `PATS.Admin`, `PATS.Recruiter`, `PATS.Coordinator`, `PATS.Executive`, `PATS.HiringManager`, `PATS.Interviewer` and assign Entra groups to them. The role in the token updates the user's PATS role at each sign-in (highest role wins).
4. Enforce MFA and device rules with **Conditional Access** on the PATS enterprise app; PATS doesn't implement its own MFA.
5. Accounts come from SCIM provisioning (below). People without a PATS account are refused unless `ENTRA_ALLOW_JIT=true`. Deactivated users can't sign in and their sessions stop working on the next request.

Demo sign-in stays available only with `PATS_DEMO_AUTH=true` outside production.

## Reliability rules

- Every Graph call honours `429`/`503` responses and their `Retry-After` header, with exponential backoff.
- Use `$batch` and delta queries where Graph supports them, and change notifications (webhooks) instead of polling. Subscription renewal runs as a worker job.
- Long or retryable Graph work (mail sync, webhook handling, reminders) runs in the worker process, not inside a user request.
- `integration_events` records the operation, status, IDs and recipient domain only, never email bodies or resumes.

## What's covered by phase

| Capability | Phase | Graph API |
|---|---|---|
| Send candidate email | 1–2 | `POST /users/{id}/messages` + `/send` |
| Free/busy | 2 | `POST /users/{id}/calendar/getSchedule` |
| Interview events + Teams links | 2 | `POST /users/{id}/events` (`isOnlineMeeting`) |
| Cancel/reschedule | 2 | `POST /events/{id}/cancel`, `PATCH /events/{id}` |
| Teams notifications & approvals | 3, 6 | `sendActivityNotification`, Bot Framework + Adaptive Cards |
| Reply sync into candidate timeline | 6 | Mail change notifications (webhooks) |
| Entra SSO + SCIM | 6 | OIDC, SCIM provisioning |
| SharePoint documents / Word offers | 3 | `/sites/{id}/drives` |
| Scheduled report email (Excel/CSV attached) | 5 | `POST /users/{careers@}/sendMail` from the worker |
| Power BI / Excel | 5 | PATS OData v4 feed (below), not a Graph API |

## Power BI and Excel (Phase 5)

PATS publishes a read-only **OData v4 feed** at `/api/odata` for Power BI Desktop/Service and Excel ("Get data → OData feed"). Each person creates a **feed token** under **Reports → Power BI**; it's shown once and stored only as a SHA-256 hash.

- **Sign-in:** choose *Basic* in the connector, any user name, the token as the password (or send `Authorization: Bearer <token>`). Entra ID ("Organizational account") sign-in for the feed comes with Entra SSO in Phase 6.
- **Runs as the token's owner,** under their current role and job access, exactly like the screens. Deactivating the user, revoking the token or letting it expire (30–365 days) stops it.
- **Tables:** Jobs, Openings, Applications, StageEvents, Interviews, Offers; plus InterviewerAssignments and People for roles with team analytics. Compensation columns appear only for roles that can see pay. No candidate names or contact details: candidates appear as `CandidateId` only.
- **Query options:** `$top`, `$skip`, `$select`, `$count`. Server-driven paging returns 2,000 rows per page with `@odata.nextLink`. `$filter`, `$orderby` and `$expand` return **501** rather than unfiltered data, so filter in Power Query.
- **Limits and audit:** 300 requests a minute per token; repeated bad tokens from one IP are throttled. Every page read writes a `report.exported` audit row (entity set, row count, token id).
- **Store:** the feed reads through the reporting connection (`REPORTING_DATABASE_URL`, ARCHITECTURE.md D10).

For a governed enterprise model, point a Fabric/Power BI dataflow at the feed (or at the reporting replica directly) and publish a shared semantic model; individual feed tokens then belong to the service account that owns the refresh.

## Scheduled reports

Saved reports can be emailed daily, weekly or monthly as Excel or CSV. The **worker** (`npm run worker`) sends them; web requests never send scheduled mail. Each recipient gets their own copy, run under their own access, from `M365_SENDER_MAILBOX`. Recipients who can no longer open the report are skipped. Each delivery writes a `report.delivered` audit row; `integration_events` records the send without the subject, body or attachment. Teams delivery arrives with the Teams app (Phase 6).
