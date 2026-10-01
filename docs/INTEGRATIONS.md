# Microsoft 365 integration

All M365 calls go through `src/server/integrations/m365`. `m365()` returns the **live** Microsoft Graph client when Entra credentials are set and the **mock** client otherwise. Both log every call to the `integration_events` table, shown under **Settings → Integrations**.

## Going live

1. In the Entra admin center, create an app registration, for example "PATS".
2. Add a client secret (or certificate).
3. Add these **application** permissions for Microsoft Graph and grant admin consent:
   - `Mail.Send` — candidate email from user or shared mailboxes
   - `Calendars.ReadWrite` — free/busy and interview events (Teams links via `isOnlineMeeting`)
   - `User.Read.All` — directory lookup
   - `TeamsActivity.Send` — Teams notifications (requires the PATS Teams app, Phase 6)
4. Restrict mailbox access with an Exchange **Application Access Policy** or **RBAC for Applications**, scoped to a mail-enabled security group of recruiting staff plus `careers@`.
5. Set these variables in `.env`:

```
M365_TENANT_ID=<directory (tenant) id>
M365_CLIENT_ID=<application (client) id>
M365_CLIENT_SECRET=<secret>
M365_SENDER_MAILBOX=careers@purpose.ca
```

Restart the app. Settings → Integrations will show **Live · Microsoft Graph**.

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
