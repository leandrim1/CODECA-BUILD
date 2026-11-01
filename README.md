# Codeca Build

Plataforma SaaS multiempresa em que cada construtora cria, edita e publica o
proprio site institucional — com imoveis, obras, servicos, galerias e captacao
de interessados — a partir de um unico deploy compartilhado.

O painel roda em um dominio da plataforma (`app.seudominio.com`). Os sites dos
clientes sao servidos pelo mesmo projeto, identificados pelo dominio da
requisicao e renderizados no servidor.

- **Dados**: Neon PostgreSQL e a fonte de verdade. Nada de dados de negocio em
  `localStorage`/`sessionStorage`.
- **Arquivos**: Vercel Blob, com o token de escrita somente no servidor.
- **Pagamentos**: ValidaPay, com as credenciais somente no servidor e o cartao
  tokenizado na pagina do provedor.
- **Operacoes sensiveis**: todas no backend. O navegador nunca recebe credencial
  nem decide autorizacao.

## Sumario

- [Stack](#stack)
- [Estrutura do repositorio](#estrutura-do-repositorio)
- [Como funciona o multiempresa](#como-funciona-o-multiempresa)
- [Instalacao local](#instalacao-local)
- [Scripts](#scripts)
- [Testes](#testes)
- [Implantacao](#implantacao)
- [Cobranca e assinaturas](#cobranca-e-assinaturas)
- [Guias detalhados](#guias-detalhados)

## Stack

| Camada | Tecnologia |
| --- | --- |
| Interface | React 19, TypeScript, Vite, Tailwind CSS 4, Lucide React |
| API | Hono sobre funcao Node da Vercel (`api/index.ts`) |
| Banco | Neon PostgreSQL + Drizzle ORM (driver `neon-serverless`, com transacoes) |
| Arquivos | Vercel Blob |
| Pagamentos | ValidaPay (OAuth2 client_credentials, webhooks com HMAC) |
| Validacao | Zod 4, compartilhada entre cliente e servidor |
| Testes | Vitest + PGlite (Postgres real em processo) |
| Hospedagem | Vercel |

## Estrutura do repositorio

```
api/                      funcao da Vercel (entrada da API)
apps/
  api/                    aplicacao HTTP: rotas, autenticacao, autorizacao, regras
  web/                    painel da construtora e painel mestre
packages/
  database/               schema Drizzle, migracoes versionadas, publicacao, seed
  shared/                 contratos Zod, catalogo de blocos, papeis, planos, tema
  ui/                     componentes de interface do painel
tests/
  integration/            API inteira contra Postgres real (PGlite)
  unit/                   blocos, tema, slugs, helpers
  web/                    descritores do editor e geracao de CSS
docs/                     guias de Neon, Vercel, Blob, DNS, seguranca e status
```

`packages/shared` e o contrato: um campo de imovel, um estado de cobranca ou um
papel de usuario sao definidos ali uma vez e reutilizados pela API e pelo
painel. E tambem onde os modulos editaveis de cada site serao declarados --
ver `docs/arquitetura-build.md`.

## Como funciona o multiempresa

1. **Painel** — a sessao do usuario e resolvida por cookie HttpOnly. A empresa
   vem do caminho da rota (`/api/tenants/:tenantId/...`) e e conferida contra a
   tabela `memberships`. Sem vinculo, a API responde 404 (nao 403) para nao
   revelar que o registro existe.
2. **Site publico** — o host da requisicao e normalizado e procurado em
   `domains`. So resolve se o dominio estiver `active`, com propriedade
   verificada, e a empresa em `trialing` ou `active`.
3. **Isolamento** — toda tabela de conteudo tem `tenant_id` com chave
   estrangeira, e todas as consultas filtram por ele no servidor. O `tenant_id`
   enviado pelo navegador nunca e aceito como prova de acesso.
4. **Suporte** — `platform_admin` nao ve dados de empresa automaticamente: e
   preciso um registro em `support_access_grants` (motivo, validade, somente
   leitura), e o acesso fica no log de auditoria.

## Cobranca e assinaturas

Cada construtora escolhe um plano mensal e paga uma assinatura para manter o
site publicado. O detalhe que define o desenho: **a ValidaPay nao cria
assinaturas por API** -- elas nascem quando uma cobranca recorrente e paga.
Por isso:

1. o plano cadastrado no painel mestre e sincronizado como produto + preco
   recorrente (`POST /v1/products`);
2. a contratacao cria uma sessao de checkout hospedada
   (`POST /v1/checkout-sessions`) e o cliente paga na pagina da ValidaPay --
   dados de cartao nunca passam por este servidor;
3. os webhooks confirmam o pagamento e a plataforma libera a publicacao.

Uma assinatura criada **nao** e uma assinatura paga: enquanto o pagamento nao
e confirmado ela fica `pending` e o site nao vai ao ar.

| Garantia | Onde |
| --- | --- |
| Preco sempre do banco, nunca do navegador | `startSubscriptionSchema` aceita apenas plano e forma de pagamento |
| Webhook verificado antes de ser lido | HMAC sobre `<t>.<corpo bruto>`, com janela de tolerancia |
| Evento repetido nao cobra duas vezes | id do evento e id da cobranca unicos, estados monotonicos |
| Site publicado so com pagamento confirmado | `decidePublication`, uma funcao pura usada pelo webhook, pelo job e pelo painel |
| Inadimplencia nao apaga nada | suspensao afeta a publicacao; conteudo e painel permanecem |
| Divergencia se resolve sozinha | job de reconciliacao (Vercel Cron) |

Renovacao automatica existe em **cartao de credito** e **Pix Automatico** (este
exige conta ValidaPay PJ e minimo de R$ 4,99). Pix comum e boleto emitem uma
cobranca por ciclo com **pagamento manual**, e a interface diz isso.

Passo a passo, contratos, eventos e checklists: [docs/validapay.md](docs/validapay.md).

## Instalacao local

Pre-requisitos: Node 20.9+ e pnpm 10.

```bash
pnpm install
```

```bash
cp .env.example .env
```

Preencha no minimo `DATABASE_URL` (ver [docs/neon.md](docs/neon.md)) e
`AUTH_SECRET`:

```bash
openssl rand -base64 48
```

Aplique as migracoes e crie os planos padrao:

```bash
pnpm db:migrate && pnpm db:seed
```

Na Vercel isso e automatico: o build aplica as migracoes pendentes e, numa
instalacao vazia, cria os planos padrao. Ver [docs/vercel.md](docs/vercel.md#5-migracoes-no-deploy).

O painel mestre nao precisa de passo manual: em uma instalacao nova, **a
primeira conta cadastrada pela tela assume o papel de administrador da
plataforma** -- e somente a primeira. Para reservar esse papel a um endereco
especifico, defina `PLATFORM_ADMIN_EMAIL` (so um e-mail, nunca uma senha).
Para criar o administrador sem passar pela tela, defina tambem
`PLATFORM_ADMIN_PASSWORD` antes do seed. Para uma construtora de demonstracao
com site publicado, defina `SEED_DEMO=true` e `SEED_DEMO_PASSWORD`.

Suba tudo com um unico processo:

```bash
pnpm dev
```

- Painel: <http://localhost:5173>
- API: <http://localhost:5173/api/health>

O plugin `codecaDevServer` em `apps/web/vite.config.ts` monta a API dentro do
servidor do Vite, por isso nao ha um segundo processo para iniciar. Sem
`DATABASE_URL`, o Vite avisa e sobe apenas a interface.

## Scripts

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | Painel + API no servidor do Vite |
| `pnpm build` | Compila os pacotes e gera `apps/web/dist` |
| `pnpm typecheck` | Compila os pacotes e roda o TypeScript em todo o repositorio |
| `pnpm test` | Suite completa do Vitest |
| `pnpm check` | `typecheck` + `test` (use antes de abrir um PR) |
| `pnpm db:generate` | Gera uma migracao a partir do schema Drizzle |
| `pnpm db:migrate` | Aplica as migracoes pendentes |
| `pnpm db:seed` | Planos padrao, admin da plataforma e demonstracao opcional |
| `pnpm db:studio` | Drizzle Studio sobre o banco configurado |

## Testes

```bash
pnpm test
```

Os testes de integracao sobem um PostgreSQL real em processo
([PGlite](https://pglite.dev)) e aplicam **o mesmo SQL de migracao** enviado ao
Neon, de modo que restricoes, chaves estrangeiras e indices unicos parciais
valem nos testes. Nenhum servico externo e necessario: e-mail, Blob e a API de
dominios da Vercel sao substituidos por implementacoes de memoria.

Cobertura por arquivo:

| Arquivo | Assunto |
| --- | --- |
| `tests/integration/flow.test.ts` | Jornada completa: cadastro da empresa -> conteudo -> editor -> publicacao -> dominio -> site no ar -> interessado -> restauracao |
| `tests/integration/billing-subscriptions.test.ts` | Contratacao, plano inativo, tentativa de manipular o preco, idempotencia, falha da API |
| `tests/integration/billing-webhooks.test.ts` | Assinatura HMAC, timestamp, reentrega, eventos fora de ordem, estornos, reprocessamento |
| `tests/integration/billing-isolation.test.ts` | Cobranca entre empresas e publicacao conforme a assinatura |
| `tests/integration/billing-reconcile.test.ts` | Pagamento sem webhook, divergencias, passagem do tempo, job protegido |
| `tests/integration/billing-platform.test.ts` | Painel mestre: suspensao com justificativa, tolerancia, sincronizacao de planos |
| `tests/unit/billing.test.ts` | Conversao de valores, estados, decisao de publicacao, assinatura de webhook |
| `tests/integration/schema.test.ts` | Migracoes, restricoes, indices unicos parciais |
| `tests/integration/auth.test.ts` | Cadastro, login, verificacao, recuperacao, sessoes, CSRF |
| `tests/integration/isolation.test.ts` | Acesso cruzado entre empresas trocando IDs na API |
| `tests/integration/rbac.test.ts` | Papeis, hierarquia de convites e painel mestre |
| `tests/integration/content.test.ts` | CRUD de imoveis, obras, servicos, rascunho/publicacao/restauracao |
| `tests/integration/media-domains.test.ts` | Upload, limites de plano, estados de dominio |
| `tests/integration/public-content.test.ts` | `/api/v1` com escopo por chave, origem e previa |
| `tests/integration/catalog.test.ts` | Produtos, categorias e galerias |
| `tests/integration/custom-fields.test.ts` | Campos personalizados: definicao, gravacao, entrega e isolamento |
| `tests/integration/openapi.test.ts` | O documento OpenAPI cobre `/api/v1` nos dois sentidos |
| `tests/integration/plan-panel.test.ts` | Plano sem painel, e a diferenca dele com a suspensao |
| `tests/unit/*` | Cobranca, chaves, modulos, suspensao, contrato do SDK e utilitarios |

## Implantacao

Resumo; o passo a passo esta em [docs/vercel.md](docs/vercel.md).

1. Crie o banco no Neon e aplique as migracoes ([docs/neon.md](docs/neon.md)).
2. Importe o repositorio na Vercel. O `vercel.json` ja define build, funcoes,
   cabecalhos e as reescritas por host.
3. **Edite a reescrita por host em `vercel.json`**, trocando
   `app.codecabuild.com` pelo dominio do seu painel. Essa unica linha decide o
   que e painel e o que e site de cliente.
4. Configure as variaveis de ambiente do projeto (todas as de `.env.example`).
5. Crie o store do Vercel Blob ([docs/blob.md](docs/blob.md)).
6. Configure a ValidaPay: credenciais, webhook e segredo da reconciliacao
   ([docs/validapay.md](docs/validapay.md)).
7. Aponte o dominio do painel e configure os alvos de DNS que serao mostrados
   aos clientes ([docs/dominios.md](docs/dominios.md)).
8. Rode o seed uma vez contra o banco de producao para criar os planos e o
   administrador da plataforma.
9. No painel mestre, em **Cobranca**, sincronize os planos com a ValidaPay.

## Guias detalhados

- [docs/neon.md](docs/neon.md) — banco, migracoes, backup e restauracao
- [docs/vercel.md](docs/vercel.md) — build, funcoes, variaveis e reescritas por host
- [docs/blob.md](docs/blob.md) — armazenamento de arquivos e biblioteca de midia
- [docs/dominios.md](docs/dominios.md) — dominios proprios, DNS e estados de verificacao
- [docs/validapay.md](docs/validapay.md) — pagamentos, assinaturas, webhooks e reconciliacao
- [docs/seguranca.md](docs/seguranca.md) — autenticacao, isolamento, auditoria e segredos
- [docs/status.md](docs/status.md) — o que esta implementado e o que depende de configuracao externa
