#!/usr/bin/env bash
# Prepara as dependencias SO do teste de carga, sem tocar no package.json nem no
# lockfile do projeto.
#
# Por que nao `pnpm add pg`? Porque o drizzle-orm tem `pg` como peer opcional: com
# `pg` visivel na raiz, o pnpm cria uma SEGUNDA copia do drizzle-orm e os tipos dos
# pacotes deixam de combinar (quebra o typecheck). `pg` e so desta ferramenta, e
# a aplicacao em producao usa o driver do Neon, nao o `pg`.
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-save --no-package-lock --prefix . pg >/dev/null
DRIZZLE_NM="$(ls -d ../../node_modules/.pnpm/drizzle-orm@*/node_modules | grep -v types+pg | head -1)"
ln -sfn "$(pwd)/node_modules/pg" "$DRIZZLE_NM/pg"
echo "ok: pg disponivel para o drizzle-orm em $DRIZZLE_NM"
