#!/usr/bin/env bash
# Reinicia o alvo de carga (semeia o banco do zero). Uso: scripts/loadtest/restart-server.sh [pool-max]
cd "$(dirname "$0")/../.."
kill $(lsof -ti:3999) 2>/dev/null
sleep 1
VN=$(ls -d node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs | head -1)
DB_POOL_MAX="${1:-10}" nohup node "$VN" --config vitest.config.ts scripts/loadtest/server.ts > /tmp/lt-server.log 2>&1 &
for i in $(seq 1 90); do
  grep -q "API em" /tmp/lt-server.log 2>/dev/null && { tail -1 /tmp/lt-server.log; exit 0; }
  sleep 1
done
echo "servidor nao subiu"; tail -5 /tmp/lt-server.log; exit 1
