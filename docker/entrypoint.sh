#!/bin/sh
# Container start: apply committed migrations, load demo data into an empty demo database, then
# run the given command (the web app by default, or `npm run worker`).
set -e
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  npm run -s db:migrate
fi
if [ "$PATS_ENV" = "demo" ] && [ "${DEMO_SEED_ON_EMPTY:-true}" = "true" ]; then
  users=$(node -e "new (require('pg').Pool)({connectionString:process.env.DATABASE_URL}).query('select count(*)::int n from users').then(r=>{console.log(r.rows[0].n);process.exit(0)},()=>{console.log(-1);process.exit(0)})")
  if [ "$users" = "0" ]; then
    echo "Empty demo database: loading synthetic demo data…"
    npm run -s db:seed
  fi
fi
exec "$@"
