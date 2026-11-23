# O limite de conteúdos aguenta criações simultâneas?

```bash
# 1. um Postgres de verdade (a suíte usa PGlite, que não serve aqui)
node /tmp/criadb.mjs            # ou crie o banco à mão
VN=$(ls -d node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs | head -1)
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/codeca_corrida \
  node "$VN" --config vitest.config.ts scripts/loadtest/ui-import-server.ts
```

```bash
node scripts/limites/corrida.mjs 20
```

Leva a empresa a **uma vaga** do teto do plano e dispara N criações no mesmo
instante. Passa quando exatamente uma é aceita e o total final é igual ao teto.

## Por que não é um teste da suíte

Os testes de integração rodam sobre PGlite, que tem **uma conexão**: duas
requisições "paralelas" ali acontecem em fila. O teste passaria com o defeito
no lugar — e um teste que não sabe falhar não prova nada.

Medido nos dois estados, contra PostgreSQL 16 real:

| Código | Disparos | Aceitas | Total final |
| --- | --- | --- | --- |
| antes de `comVagaDeConteudo` | 12 | **2** | **101** (teto 100) |
| depois | 12 | 1 | 100 |
| depois | 20 | 1 | 100 |

O banco é recriado a cada execução: rodar duas vezes seguidas sem recriar
encontra a empresa já no teto e para com essa mensagem.
