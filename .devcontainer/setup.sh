#!/usr/bin/env bash
# First-time setup: dependencies, .env for this Codespace, database with demo data.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  # A fresh random session secret per Codespace (no shared example value).
  secret=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${secret}|" .env
  if [ -n "${CODESPACE_NAME:-}" ]; then
    sed -i "s|^APP_URL=.*|APP_URL=https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}|" .env
  fi
fi

npm ci
# Wait for Postgres, then build the schema and load the synthetic demo data.
for i in $(seq 1 30); do
  node -e "new (require('pg').Pool)({connectionString:'postgres://pats:pats@localhost:5432/postgres'}).query('select 1').then(()=>process.exit(0),()=>process.exit(1))" && break
  sleep 2
done
npm run db:reset
