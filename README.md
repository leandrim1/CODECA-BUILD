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
- [Guias detalhados](#guias-detalhados)

## Stack

| Camada | Tecnologia |
| --- | --- |
| Interface | React 19, TypeScript, Vite, Tailwind CSS 4, Lucide React |
| API | Hono sobre funcoes Node da Vercel (`api/index.ts`, `api/site.ts`) |
| Banco | Neon PostgreSQL + Drizzle ORM (driver `neon-serverless`, com transacoes) |
| Arquivos | Vercel Blob |
| Validacao | Zod 4, compartilhada entre cliente e servidor |
| Testes | Vitest + PGlite (Postgres real em processo) |
| Hospedagem | Vercel |

## Estrutura do repositorio

```
api/                      funcoes da Vercel (entrada da API e dos sites publicos)
apps/
  api/                    aplicacao HTTP: rotas, autenticacao, autorizacao, regras
  web/                    painel da construtora, painel mestre e editor visual
packages/
  database/               schema Drizzle, migracoes versionadas, publicacao, seed
  shared/                 contratos Zod, catalogo de blocos, papeis, planos, tema
  site-renderer/          componentes e CSS dos sites publicos (SSR e previa)
  ui/                     componentes de interface do painel
tests/
  integration/            API inteira contra Postgres real (PGlite)
  unit/                   blocos, tema, slugs, helpers
  web/                    descritores do editor e geracao de CSS
docs/                     guias de Neon, Vercel, Blob, DNS, seguranca e status
```

`packages/shared` e o contrato: um bloco do editor, um campo de imovel ou um
papel de usuario sao definidos ali uma vez e reutilizados pela API, pelo painel
e pelo renderizador. Alterar o schema de um bloco invalida automaticamente os
conteudos que deixariam de ser validos.

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

Para ja ter um administrador da plataforma, defina `PLATFORM_ADMIN_EMAIL` e
`PLATFORM_ADMIN_PASSWORD` antes do seed. Para uma construtora de demonstracao
com site publicado, defina `SEED_DEMO=true` e `SEED_DEMO_PASSWORD`.

Suba tudo com um unico processo:

```bash
pnpm dev
```

- Painel: <http://localhost:5173>
- API: <http://localhost:5173/api/health>
- Site de uma construtora: `http://<slug>.localhost:5173`

O plugin `codecaDevServer` em `apps/web/vite.config.ts` monta a API e o
renderizador dentro do servidor do Vite usando o mesmo criterio de host da
producao, por isso nao ha um segundo processo para iniciar. Sem
`DATABASE_URL`, o Vite avisa e sobe apenas a interface.

## Scripts

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | Painel + API + sites publicos no servidor do Vite |
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
| `tests/integration/schema.test.ts` | Migracoes, restricoes, indices unicos parciais |
| `tests/integration/auth.test.ts` | Cadastro, login, verificacao, recuperacao, sessoes, CSRF |
| `tests/integration/isolation.test.ts` | Acesso cruzado entre empresas trocando IDs na API |
| `tests/integration/rbac.test.ts` | Papeis, hierarquia de convites e painel mestre |
| `tests/integration/content.test.ts` | CRUD de imoveis, obras, servicos, rascunho/publicacao/restauracao |
| `tests/integration/media-domains.test.ts` | Upload, limites de plano, estados de dominio |
| `tests/integration/public-site.test.ts` | Resolucao por dominio, dados publicos, formularios |
| `tests/integration/ssr.test.ts` | HTML do site, SEO, sitemap, robots, cache e 404 |
| `tests/unit/*` | Catalogo de blocos, tema, slugs e utilitarios |
| `tests/web/editor-fields.test.ts` | Descritores do editor e CSS responsivo gerado |

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
6. Aponte o dominio do painel e configure os alvos de DNS que serao mostrados
   aos clientes ([docs/dominios.md](docs/dominios.md)).
7. Rode o seed uma vez contra o banco de producao para criar os planos e o
   administrador da plataforma.

## Guias detalhados

- [docs/neon.md](docs/neon.md) — banco, migracoes, backup e restauracao
- [docs/vercel.md](docs/vercel.md) — build, funcoes, variaveis e reescritas por host
- [docs/blob.md](docs/blob.md) — armazenamento de arquivos e biblioteca de midia
- [docs/dominios.md](docs/dominios.md) — dominios proprios, DNS e estados de verificacao
- [docs/seguranca.md](docs/seguranca.md) — autenticacao, isolamento, auditoria e segredos
- [docs/status.md](docs/status.md) — o que esta implementado e o que depende de configuracao externa
