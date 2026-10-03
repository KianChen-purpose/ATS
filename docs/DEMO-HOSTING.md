# Hosting the PATS demo (Azure Canada Central)

A shareable demo of PATS with **synthetic data only** and "sign in as anyone". It runs as a demo environment (`PATS_ENV=demo`, ARCHITECTURE.md §6.2), which means:

- demo sign-in works in the production build;
- the app **refuses to start** if Microsoft 365, Teams bot or reporting-store credentials are set, so it can't email, invite or message real people;
- every page shows a "Demo environment · synthetic data only" banner, and search engines are told not to index it (`noindex`, `robots.txt`);
- on first start the empty database is loaded with the demo data.

Anyone with the link can sign in as any demo user, so share it only with people who should see the demo, and never type real candidate information into it.

## What gets created

All in one resource group in **Canada Central**:

| Resource | Size | Why |
|---|---|---|
| Container Apps environment + Log Analytics | consumption | runs the app |
| Container App `patsdemo-web` | 0.5 vCPU / 1 GiB, always 1 replica | the web app (public https URL) |
| Container App `patsdemo-worker` | 0.25 vCPU / 0.5 GiB | background jobs, scheduled reports |
| Azure Database for PostgreSQL Flexible Server 16 | Burstable B1ms, 32 GB | the database |
| Container Registry (Basic) | | the image, built in Azure |

Rough cost: about **US$70–90 a month** left running (Container Apps around US$50, Postgres around US$20, registry US$5). Delete the resource group to stop all charges.

Files uploaded in the demo (offer letters, resumes) live on the container's disk and disappear when it restarts; that's fine for a demo. Production uses Azure Blob / SharePoint (D9).

## One-time setup (about 10 minutes)

You need **Owner** on an Azure subscription (to create the deploy identity and its role assignments) and admin on the GitHub repo.

1. Open **Azure Cloud Shell** (Bash) in that subscription and run:
   ```bash
   curl -sL https://raw.githubusercontent.com/KianChen-purpose/ATS/claude/friendly-wozniak-5ytmww/infra/demo/setup-azure.sh | bash
   ```
   (or upload `infra/demo/setup-azure.sh` and run it). It creates the resource group `pats-demo-rg` and a deploy identity that GitHub signs in as through OIDC: no Azure password stored in GitHub, and it can only touch that resource group.
2. In GitHub → **Settings → Environments → New environment** named `demo`, add the five secrets the script prints (it also prints `gh secret set …` commands).
3. GitHub → **Actions → Deploy demo → Run workflow**, choose the branch. The first run takes about 15 minutes (Postgres is the slow part); later runs about 5. The run summary shows the URL, like `https://patsdemo-web.<random>.canadacentral.azurecontainerapps.io`.

## Day to day

- **Update the demo:** run the workflow again; it builds the current branch and rolls out a new revision.
- **Reset the demo data:** in the Azure portal, open `patsdemo-web` → Console, and run `npm run db:seed`.
- **Pause it:** set both container apps' minimum replicas to 0 (the web app then cold-starts on the first visit), or stop the Postgres server.
- **Remove it:** `az group delete --name pats-demo-rg`.
