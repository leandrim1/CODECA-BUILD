-- Importacao automatica de sites: registro da analise e dos candidatos.
--
-- ## O que muda, e o que NAO muda
--
-- So acrescenta duas tabelas. Nenhuma coluna de conteudo e alterada, nenhum
-- modulo e criado e nenhuma permissao muda. O conteudo importado vai para as
-- tabelas que o painel ja usa -- `content_documents`, `services`, `faqs`,
-- `testimonials`, `team_members`, `banners`, `galleries`, `media_assets` -- e
-- passa pelos mesmos schemas de validacao. Nao existe segunda estrutura de
-- conteudo, e nada aqui e lido pela API publica.
--
-- ## site_imports
--
-- Uma linha por analise: de onde veio, quem pediu, em que estado esta, quais
-- paginas foram visitadas e os numeros do resumo.
--
-- `cursor` existe por causa do ambiente: a funcao da Vercel para em 60 s
-- (`vercel.json`), entao a analise avanca em fatias e precisa lembrar onde
-- parou. Em memoria nao serve -- a fatia seguinte pode cair em outra
-- instancia.
--
-- ## site_import_items
--
-- Uma linha por candidato. Guarda o valor proposto, o valor que estava no
-- painel (`previous_value`) e o que foi criado (`created_entity_id`). Os tres
-- juntos sustentam as duas garantias do produto: nada entra sem confirmacao, e
-- toda importacao pode ser desfeita.
--
-- ## Isolamento
--
-- As duas tabelas carregam `tenant_id` e `site_id` com a chave estrangeira
-- composta para `sites(id, tenant_id)`, como toda tabela de conteudo da
-- plataforma. Com ela, uma linha de analise de uma empresa nao consegue
-- apontar para o site de outra -- a garantia e do banco, nao da aplicacao.
--
-- Reaplicar e seguro (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "site_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "source_url" text NOT NULL,
  "source_host" text NOT NULL,
  "state" text DEFAULT 'validando' NOT NULL,
  "message" text DEFAULT '' NOT NULL,
  "pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "requested_by_user_id" uuid,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "analyzed_at" timestamp with time zone,
  "imported_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "site_import_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "import_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "target" text NOT NULL,
  "field_key" text DEFAULT '' NOT NULL,
  "label" text DEFAULT '' NOT NULL,
  "value" jsonb NOT NULL,
  "previous_value" jsonb,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "decision" text DEFAULT 'selecionado' NOT NULL,
  "resolution" text DEFAULT 'manter' NOT NULL,
  "outcome" text DEFAULT 'pendente' NOT NULL,
  "conflict" boolean DEFAULT false NOT NULL,
  "duplicate" boolean DEFAULT false NOT NULL,
  "target_disabled" boolean DEFAULT false NOT NULL,
  "created_entity_id" uuid,
  "error" text DEFAULT '' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "site_imports"
    ADD CONSTRAINT "site_imports_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "site_imports"
    ADD CONSTRAINT "site_imports_requested_by_user_id_users_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "site_imports"
    ADD CONSTRAINT "site_imports_site_tenant_fk"
    FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "site_import_items"
    ADD CONSTRAINT "site_import_items_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "site_import_items"
    ADD CONSTRAINT "site_import_items_import_id_site_imports_id_fk"
    FOREIGN KEY ("import_id") REFERENCES "public"."site_imports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "site_import_items"
    ADD CONSTRAINT "site_import_items_site_tenant_fk"
    FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "site_imports_site_created_idx" ON "site_imports" ("site_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_imports_tenant_created_idx" ON "site_imports" ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_imports_state_idx" ON "site_imports" ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_import_items_import_idx" ON "site_import_items" ("import_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_import_items_tenant_idx" ON "site_import_items" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_import_items_target_idx" ON "site_import_items" ("import_id","target");
