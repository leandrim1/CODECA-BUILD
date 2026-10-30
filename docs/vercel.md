# Vercel

Um unico projeto hospeda o painel da plataforma, a API e todos os sites dos
clientes. O que diferencia um do outro e o host da requisicao.

## 1. Importar o repositorio

Em <https://vercel.com/new>, importe o repositorio. O `vercel.json` na raiz ja
traz tudo:

| Chave | Valor | Por que |
| --- | --- | --- |
| `buildCommand` | `pnpm run build` | Compila os pacotes internos e depois o painel |
| `installCommand` | `pnpm install --frozen-lockfile` | Falha se o lockfile estiver desatualizado |
| `outputDirectory` | `apps/web/dist` | Saida estatica do Vite |
| `functions` | `api/*.ts` em `@vercel/node@5.1.11` | 1024 MB, 30 s |
| `framework` | `null` | O roteamento e nosso, nao de um preset |

Nao defina um *Root Directory* no painel da Vercel: o build sai da raiz do
monorepo, porque as funcoes em `api/` importam `@codeca/api` pelo workspace.

As duas funcoes:

- `api/index.ts` — a API (`createApp`), servida em `/api/*`
- `api/site.ts` — os sites publicos (`createSiteApp`), renderizados no servidor

## 2. Ajustar a reescrita por host — passo obrigatorio

Em `vercel.json`:

```json
{
  "source": "/(.*)",
  "destination": "/api/site",
  "missing": [
    {
      "type": "host",
      "value": "(?:app\\.codecabuild\\.com|[^.]+\\.vercel\\.app|localhost(?::\\d+)?|127\\.0\\.0\\.1(?::\\d+)?)"
    }
  ]
}
```

Leia como: *"todo caminho vai para o renderizador dos sites, exceto quando o
host for um host da plataforma"*. Troque `app\.codecabuild\.com` pelo dominio do
seu painel, escapando os pontos. Para mais de um host da plataforma, separe com
`|`:

```
(?:app\.seudominio\.com|admin\.seudominio\.com|[^.]+\.vercel\.app|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)
```

Se esquecer esse ajuste, o dominio do painel passa a ser tratado como site de
cliente e responde 404 — e o sintoma mais comum de uma primeira implantacao.

Mantenha a entrada `*.vercel.app`: e o que faz os deploys de previa abrirem o
painel.

A ordem das reescritas importa: `/api/*` primeiro, os sites publicos depois e,
por fim, `/index.html` para o painel (SPA).

A mesma lista tambem precisa estar em `PLATFORM_HOSTS`, que e o que a API usa
para nao resolver um host da plataforma como site de cliente. O host de
`APP_URL` e os `*.vercel.app` entram automaticamente (ver
`platformHosts()` em `apps/api/src/env.ts`).

## 3. Variaveis de ambiente

Em **Project Settings > Environment Variables**, cadastre as variaveis de
`.env.example` para *Production* e *Preview*. Todas sao lidas somente no
servidor; nenhuma e exposta ao navegador (nao existe nenhuma variavel
`VITE_*` com segredo no projeto).

Obrigatorias:

| Variavel | Observacao |
| --- | --- |
| `DATABASE_URL` | Conexao *pooled* do Neon |
| `AUTH_SECRET` | 32+ caracteres; trocar invalida todas as sessoes e links de e-mail |
| `APP_URL` | `https://app.seudominio.com` — usado nos links de e-mail e no CORS |
| `PLATFORM_HOSTS` | Os mesmos hosts da reescrita, separados por virgula |

Opcionais; cada uma desliga um recurso de forma explicita quando ausente:

| Variavel | Sem ela |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | A biblioteca de imagens informa que o envio esta indisponivel |
| `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID` (+ `VERCEL_TEAM_ID`) | Dominios ficam aguardando configuracao externa e nunca sao marcados como ativos |
| `RESEND_API_KEY` + `MAIL_FROM` | Confirmacao, redefinicao de senha e convites vao para o log do servidor |
| `VALIDAPAY_CLIENT_ID` + `VALIDAPAY_CLIENT_SECRET` (+ `VALIDAPAY_BASE_URL`) | A contratacao de planos e recusada com mensagem explicita |
| `VALIDAPAY_WEBHOOK_SECRET` | Os webhooks de pagamento sao recusados (401) |
| `BILLING_RECONCILIATION_SECRET` | O job de reconciliacao responde 501 e nao roda |

`GET /api/health` devolve esses tres indicadores em `features`, o que permite
conferir o que esta ativo em um deploy sem abrir o painel.

Em producao, `NODE_ENV` ja vem como `production`, o que liga `Secure` nos
cookies. `COOKIE_SECURE=false` serve apenas para desenvolvimento local em HTTP.

## 4. Dominio do painel

Em **Project Settings > Domains**, adicione `app.seudominio.com` e siga as
instrucoes de DNS da Vercel. Depois:

1. Ajuste `APP_URL` e `PLATFORM_HOSTS`.
2. Confirme que o host aparece na reescrita do `vercel.json`.
3. Faca um novo deploy — `vercel.json` so vale a partir do deploy que o contem.

Os dominios dos clientes **nao** sao adicionados a mao nesse painel: quem os
registra e a API, pelo backend, quando o cliente cadastra o dominio no painel
da empresa. Ver [dominios.md](dominios.md).

## 5. Migracoes no deploy

O build **nao** aplica migracoes: um deploy nao deve alterar o schema sem
alguem olhando. Rode a partir da sua maquina, com o `DATABASE_URL` de producao:

```bash
DATABASE_URL="postgresql://..." pnpm db:migrate
```

Aplique a migracao antes do deploy quando ela so adiciona (coluna nova,
tabela nova, indice novo) e depois do deploy quando ela remove algo que o
codigo antigo ainda usa.

## 6. Cron da reconciliacao de cobranca

O `vercel.json` ja agenda o job:

```json
"crons": [{ "path": "/api/billing/reconcile", "schedule": "23 */2 * * *" }]
```

A rota exige `Authorization: Bearer <segredo>`. A Vercel envia esse cabecalho
automaticamente quando a variavel `CRON_SECRET` existe no projeto, por isso
**defina `CRON_SECRET` com o mesmo valor de
`BILLING_RECONCILIATION_SECRET`**. Sem isso, o Cron dispara e recebe 401.

O job tem trabalho limitado por execucao (50 assinaturas e 50 cobrancas) para
caber no tempo da funcao; o que sobra fica para a passagem seguinte. Ele tambem
pode ser disparado a mao pelo painel mestre, em **Cobranca > Reconciliar agora**.

O webhook de pagamento chega em `/api/webhooks/validapay` e e servido pela mesma
funcao `api/index.ts`. Ele le o corpo bruto (`c.req.text()`) antes de qualquer
validacao, porque o HMAC cobre os bytes exatos -- nao ha configuracao adicional
a fazer na Vercel para isso.

## 7. Cache e invalidacao

As paginas publicas sao renderizadas no servidor e respondem com:

- `cache-control: public, max-age=0, s-maxage=..., stale-while-revalidate=...` —
  a borda da Vercel serve a copia pronta e revalida em segundo plano, enquanto o
  navegador sempre confere;
- `etag` derivado da versao publicada do site e do caminho, o que permite 304
  sem refazer o HTML.

Publicar incrementa `published_version` em `site_settings`, o que muda o ETag de
todas as paginas daquela empresa e invalida o cache sem tocar em nenhuma outra.
O painel (`/api/*` e a previa) responde `no-store`.

## 8. Limites a observar

| Limite | Valor configurado | Comentario |
| --- | --- | --- |
| Duracao da funcao | 30 s | Publicacao e verificacao de dominio ficam muito abaixo disso |
| Memoria | 1024 MB | Suficiente para o SSR do site inteiro |
| Corpo da requisicao | 4,5 MB (limite da plataforma) | O upload limita o arquivo a 4 MB |

## 9. Diagnostico rapido

Antes de investigar qualquer coisa, pergunte ao proprio deploy:

```bash
curl -s https://app.SEUDOMINIO.com.br/api/health | jq
```

| Resposta | Significado |
| --- | --- |
| `200` com `status: "ok"` e `features` | A API subiu. O problema e outro |
| `503` com `status: "misconfigured"` | Falta variavel de ambiente; `issues` lista quais |
| HTML da Vercel, ou `404` | A requisicao nem chegou a API: confira as reescritas por host |

Quando o cadastro falha com uma mensagem generica no painel, e quase sempre o
segundo caso: a funcao nao conseguiu iniciar por configuracao incompleta.

Com a API no ar e o cadastro ainda falhando, os dois suspeitos seguintes sao o
banco sem migracoes e o banco sem planos:

```bash
DATABASE_URL="postgresql://..." pnpm db:migrate
```

```bash
DATABASE_URL="postgresql://..." pnpm db:seed
```

Sem o seed nao existe o plano de avaliacao, e o cadastro responde
"Nenhum plano inicial configurado. Rode o seed de planos."

## 10. Problemas comuns

| Sintoma | Causa |
| --- | --- |
| Cadastro falha com mensagem generica | Variavel obrigatoria ausente; veja `/api/health` |
| `/api/health` responde 503 `misconfigured` | `DATABASE_URL` ausente ou `AUTH_SECRET` com menos de 32 caracteres |
| "Nenhum plano inicial configurado" | `pnpm db:seed` nunca rodou no banco de producao |
| `relation "users" does not exist` nos logs | `pnpm db:migrate` nunca rodou no banco de producao |
| Painel responde 404 | O dominio do painel nao esta na reescrita por host |
| Site do cliente mostra o painel | O host do cliente casa com a regex da plataforma (ou falta `\.` escapado) |
| `Configuracao de ambiente invalida` nos logs | Variavel obrigatoria ausente; a mensagem nomeia quais |
| 401 em toda chamada apos o login | `APP_URL` diferente do dominio acessado: o CORS e o cookie nao batem |
| `ERR_PNPM_OUTDATED_LOCKFILE` | `pnpm-lock.yaml` nao versionado junto com a mudanca de dependencia |
| Cron responde 401 | `CRON_SECRET` ausente ou diferente de `BILLING_RECONCILIATION_SECRET` |
| Webhook da ValidaPay responde 401 | Segredo diferente do cadastrado no painel do provedor |
