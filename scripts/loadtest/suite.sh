#!/usr/bin/env bash
# Roda a bateria progressiva (10, 50, 100, 500, 1000 usuarios) contra um alvo.
#
#   scripts/loadtest/suite.sh <rotulo> <diretorio-do-codigo> [pool-max]
#
# Reinicia (e semeia do zero) o servidor entre os niveis: cada nivel parte do
# mesmo banco, sem contadores de limite de taxa nem caches herdados do anterior.
# Variaveis uteis: LT_ENV_JSON (ex.: '{"AUTH_CACHE_TTL_SECONDS":"10"}'), LEVELS, DURATION.
set -u
LABEL="$1"; CODE_DIR="$2"; POOL="${3:-10}"
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
LEVELS="${LEVELS:-10 50 100 500 1000}"
DURATION="${DURATION:-30}"
mkdir -p /tmp/lt-results
VN="$(ls -d "$HERE"/node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs | head -1)"
for N in $LEVELS; do
  TENANTS=60; [ "$N" -ge 1000 ] && TENANTS=120
  echo "### $LABEL $N usuarios (empresas=$TENANTS)"
  ( cd "$CODE_DIR" && LT_TENANTS=$TENANTS bash scripts/loadtest/restart-server.sh "$POOL" >/dev/null ) || { echo "servidor nao subiu"; continue; }
  ( cd "$HERE" && node "$VN" --config vitest.config.ts scripts/loadtest/run.ts -- \
      --vus "$N" --duration "$DURATION" --label "$LABEL-$N" --json "/tmp/lt-results/$LABEL-$N.json" 2>&1 | tail -32 )
  curl -s localhost:3999/api/metrics -H 'authorization: Bearer segredo-de-metricas-da-carga' | head -c 900; echo
done
kill $(lsof -ti:3999) 2>/dev/null
echo "### fim $LABEL"
