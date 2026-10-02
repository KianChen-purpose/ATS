#!/usr/bin/env bash
# Each time the Codespace starts: run the app and the background worker.
cd "$(dirname "$0")/.."
nohup npm run dev > /tmp/pats-dev.log 2>&1 &
nohup npm run worker > /tmp/pats-worker.log 2>&1 &
echo "PATS is starting on port 3000 (logs: /tmp/pats-dev.log, /tmp/pats-worker.log)."
