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
| Power BI / Excel | 5 | OData feed |
