# Neon PostgreSQL

O Neon e a fonte de verdade da plataforma: contas, empresas, sites, paginas,
versoes publicadas, conteudos, midia, dominios, interessados e auditoria. Nada
de dado de negocio vive em armazenamento do navegador.

## 1. Criar o projeto

1. Em <https://console.neon.tech>, crie um projeto.
2. Escolha a regiao mais proxima dos visitantes (para o Brasil,
   `aws-sa-east-1`). A latencia entre a funcao da Vercel e o banco e o fator
   dominante no tempo de resposta dos sites.
3. Em **Connection Details**, copie a string **Pooled connection**.

```
postgresql://USUARIO:SENHA@ep-exemplo-123456-pooler.sa-east-1.aws.neon.tech/codeca?sslmode=require
```

Use sempre a conexao *pooled* (`-pooler` no host): funcoes serverless abrem
muitas conexoes curtas e o pooler do Neon existe para isso. Mantenha
`sslmode=require`.

Coloque o valor em `DATABASE_URL`, no `.env` local e nas variaveis do projeto
na Vercel.

## 2. Aplicar as migracoes

As migracoes sao arquivos SQL versionados em `packages/database/migrations`,
geradas pelo drizzle-kit a partir de `packages/database/src/schema.ts`.

```bash
pnpm db:migrate
```

O executor (`packages/database/src/migrator.ts`) registra cada arquivo aplicado
em `__drizzle_migrations` e e idempotente: rodar de novo nao repete nada. Os
mesmos arquivos sao aplicados pelos testes em um Postgres em processo, de modo
que uma migracao invalida quebra a suite antes de chegar a producao.

Para alterar o schema:

```bash
pnpm db:generate
```

Revise o SQL gerado, rode `pnpm test` e so entao aplique. Nao edite uma
migracao ja aplicada em producao — crie outra.

## 3. Seed

```bash
pnpm db:seed
```

Cria (ou confirma) os quatro planos padrao — Avaliacao, Essencial,
Profissional e Empresas, definidos em `packages/shared/src/plans.ts`. Variaveis
opcionais:

| Variavel | Efeito |
| --- | --- |
| `PLATFORM_ADMIN_EMAIL` + `PLATFORM_ADMIN_PASSWORD` | Cria o administrador da plataforma com e-mail ja verificado |
| `SEED_DEMO=true` + `SEED_DEMO_PASSWORD` | Cria a construtora de demonstracao com site publicado |

O seed e seguro de repetir: ele reconcilia os planos e nao duplica usuarios.
Nao defina `SEED_DEMO=true` em producao.

## 4. O que esta no banco

42 tabelas, todas com `id` UUID, `created_at` e `updated_at`:

- **Contas e empresas**: `users`, `tenants`, `memberships`, `sessions`,
  `user_tokens`, `plans`, `subscriptions`
- **Sites e configuracao**: `sites`, `segments`, `site_modules`,
  `site_field_policies`, `domains`
- **Integracao**: `site_api_keys`, `site_origins`, `site_webhooks`,
  `webhook_deliveries`
- **Conteudo**: `content_documents`, `banners`, `properties`,
  `property_images`, `projects`, `project_images`, `project_updates`,
  `project_update_images`, `services`, `testimonials`, `team_members`, `faqs`
- **Catalogo**: `categories`, `products`, `product_images`, `galleries`,
  `gallery_images`
- **Midia e captacao**: `media_assets`, `leads`, `lead_notes`
- **Cobranca**: `charges`, `webhook_events`, `billing_audit_logs`
- **Operacao**: `audit_logs`, `support_access_grants`, `rate_limits`

As tabelas do editor visual (`pages`, `page_versions`, `navigation_menus`,
`redirects`, `site_settings`) sairam na migracao
`0007_remove_tabelas_do_renderizador.sql`. Ela se recusa a rodar se encontrar
linhas nelas: um banco com conteudo do editor antigo interrompe o deploy com a
instrucao de como seguir, em vez de apagar.

Decisoes que valem conhecer:

- **`tenant_id` em toda tabela de conteudo**, com chave estrangeira e
  `on delete cascade`. Excluir uma empresa remove o que e dela, e nada mais.
- **`site_id` junto do `tenant_id`**, com restricao composta contra
  `sites (id, tenant_id)`. E o isolamento conferido pelo banco: uma linha nao
  pode apontar para um site de outra empresa nem por erro de programacao.
- **Tipos enumerados no banco** (`publication_status`, `domain_status`,
  `project_stage`, ...). Um valor fora da lista e rejeitado pelo Postgres, nao
  apenas pela aplicacao.
- **Indices unicos parciais**: um dominio primario por empresa
  (`domains_primary_per_tenant_key`), um site principal por empresa
  (`sites_primary_per_tenant_key`) e um dominio por host em toda a plataforma
  (`domains_hostname_key`, global de proposito — dois clientes nao podem
  reivindicar o mesmo dominio).
- **Slugs unicos por site**, nao globais: duas construtoras podem ter
  `/contato`.
- **Dinheiro nunca em ponto flutuante**, e duas representacoes com motivo:
  `plans.price_cents` em centavos inteiros, porque conversa com a ValidaPay e a
  conversao para reais acontece so na fronteira; `properties.price` e
  `products.price` em `NUMERIC(14,2)`, porque sao precos de **exibicao**, nao
  valores cobrados. A validacao de produto recusa mais de duas casas, senao
  `19.999` seria gravado como `20.00` em silencio.
- **Identificadores externos unicos**: `charges.external_charge_id` e
  `webhook_events.external_event_id`. Sao eles que tornam o processamento de
  webhooks idempotente -- a mesma cobranca ou o mesmo evento, chegando duas
  vezes, atualizam a mesma linha em vez de criar outra.

## 5. Transacoes

Varias operacoes precisam ser atomicas: cadastrar um site com os modulos do
segmento, trocar o conjunto de modulos de um site, emitir uma chave de
integracao, registrar um evento de cobranca, gravar um imovel com as imagens.
Por isso o acesso usa `drizzle-orm/neon-serverless` (WebSocket) e nao o driver
HTTP, que nao suporta transacoes.

## 6. Backup e restauracao

O Neon mantem historico continuo. O plano gratuito retem 24 horas; planos pagos,
7 dias ou mais. Confira em **Settings > History retention**.

- **Restaurar no tempo**: *Branches > main > Restore*, escolha o instante. O
  Neon cria um branch de backup antes de substituir, entao a operacao e
  reversivel.
- **Testar uma migracao com dados reais**: crie um branch (copia instantanea,
  sem copiar os bytes), aponte um `DATABASE_URL` para ele, rode `pnpm db:migrate`
  e descarte.
- **Copia fria** (recomendada antes de uma migracao destrutiva):

```bash
pg_dump "$DATABASE_URL" --no-owner --format=custom --file=codeca-$(date +%F).dump
```

```bash
pg_restore --no-owner --clean --if-exists --dbname="$DATABASE_URL_DESTINO" codeca-2026-01-31.dump
```

Guarde o dump fora da Vercel e do Neon. Ele contem dados pessoais de
interessados: trate conforme a LGPD, com acesso restrito e descarte quando nao
for mais necessario.

## 7. Problemas comuns

| Sintoma | Causa provavel |
| --- | --- |
| `DATABASE_URL e obrigatoria` ao subir a API | `.env` ausente ou variavel nao definida na Vercel |
| `password authentication failed` | String copiada sem a senha (o console do Neon a oculta apos a criacao); gere outra em *Roles* |
| `too many connections` | Conexao direta em vez da *pooled*; confira o `-pooler` no host |
| Timeout na primeira requisicao | Projeto gratuito suspenso por inatividade; a primeira consulta o acorda |
| `relation "..." does not exist` | `pnpm db:migrate` nao rodou no banco em uso |
