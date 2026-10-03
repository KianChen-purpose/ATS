#!/usr/bin/env bash
# One-time setup for the PATS demo deployment. Run in Azure Cloud Shell (Bash), signed in to the
# subscription that should hold the demo. It creates the resource group in Canada Central and a
# deploy identity that GitHub Actions signs in as through OIDC (no stored Azure password), scoped
# to that resource group only. Then it prints the GitHub secrets to add.
set -euo pipefail

REPO="${REPO:-KianChen-purpose/ATS}"
RG="${RG:-pats-demo-rg}"
LOCATION="canadacentral"
SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)

echo "Subscription: $(az account show --query name -o tsv) ($SUB)"
az group create --name "$RG" --location "$LOCATION" --tags app=pats environment=demo data=synthetic-only --output none

for p in Microsoft.App Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL Microsoft.OperationalInsights Microsoft.ManagedIdentity; do
  az provider register --namespace "$p" --output none
done

APP_ID=$(az ad app create --display-name "pats-demo-github-deploy" --query appId -o tsv)
az ad sp create --id "$APP_ID" --output none 2>/dev/null || true
SP_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)

# GitHub Actions jobs in the repo's "demo" environment may sign in as this identity.
az ad app federated-credential create --id "$APP_ID" --parameters "{
  \"name\": \"github-demo-environment\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:${REPO}:environment:demo\",
  \"audiences\": [\"api://AzureADTokenExchange\"]
}" --output none

SCOPE="/subscriptions/$SUB/resourceGroups/$RG"
az role assignment create --assignee-object-id "$SP_ID" --assignee-principal-type ServicePrincipal --role Contributor --scope "$SCOPE" --output none
# Needed only to let the container apps pull from the registry (an AcrPull assignment inside this group).
az role assignment create --assignee-object-id "$SP_ID" --assignee-principal-type ServicePrincipal --role "User Access Administrator" --scope "$SCOPE" --output none

cat <<OUT

Done. In GitHub: ${REPO} → Settings → Environments → New environment "demo", then add these
environment secrets (or run the gh commands below):

  AZURE_CLIENT_ID          $APP_ID
  AZURE_TENANT_ID          $TENANT
  AZURE_SUBSCRIPTION_ID    $SUB
  DEMO_POSTGRES_PASSWORD   (a new random password)
  DEMO_SESSION_SECRET      (a new random string, 32+ characters)

  gh secret set AZURE_CLIENT_ID --env demo --repo ${REPO} --body "$APP_ID"
  gh secret set AZURE_TENANT_ID --env demo --repo ${REPO} --body "$TENANT"
  gh secret set AZURE_SUBSCRIPTION_ID --env demo --repo ${REPO} --body "$SUB"
  gh secret set DEMO_POSTGRES_PASSWORD --env demo --repo ${REPO} --body "\$(openssl rand -base64 24 | tr -d '/+=')Aa1!"
  gh secret set DEMO_SESSION_SECRET --env demo --repo ${REPO} --body "\$(openssl rand -base64 48)"

Then: Actions → "Deploy demo" → Run workflow (pick the branch). The run summary shows the URL.
OUT
