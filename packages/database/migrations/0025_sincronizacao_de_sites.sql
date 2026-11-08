-- Sincronizacao inteligente com o site de origem.
--
-- ## O que muda, e o que NAO muda
--
-- So acrescenta cinco tabelas. Nenhuma coluna de conteudo e alterada, nenhum
-- modulo e criado e nenhuma permissao muda. O conteudo sincronizado continua
-- indo para as tabelas que o painel ja usa, pelos mesmos schemas de validacao
-- -- exatamente como na importacao (migracao 0024).
--
-- ## Por que cinco tabelas, e nao uma
--
-- Cada uma guarda um fato de natureza diferente, com ciclo de vida proprio:
--
-- - `sync_sources`: o **estado** da ligacao (frequencia, quando vence, falhas).
--   A importacao era um evento; a fonte e algo que continua existindo.
-- - `sync_page_states`: ETag e Last-Modified por pagina, para a verificacao
--   seguinte usar requisicao condicional. Uma pagina que nao mudou responde
--   304 sem corpo -- barato para a plataforma e, sobretudo, para o site do
--   cliente, que sera visitado toda semana para sempre.
-- - `sync_baseline`: o que a origem dizia na ULTIMA sincronizacao. E a peca
--   que permite distinguir "a origem mudou" de "o cliente editou no painel".
--   Sem ela so daria para comparar origem com CODECA, e toda edicao do cliente
--   voltaria como alteracao a desfazer.
-- - `sync_checks`: o historico das verificacoes.
-- - `sync_changes`: as alteracoes encontradas, com as TRES versoes do
--   conteudo, esperando a decisao do cliente.
--
-- ## Isolamento
--
-- As cinco carregam `tenant_id` e `site_id` com a chave estrangeira composta
-- para `sites(id, tenant_id)`, como toda tabela de conteudo da plataforma. Com
-- ela, uma linha de uma empresa nao consegue apontar para o site de outra --
-- a garantia e do banco, nao da aplicacao.
--
-- ## Dois indices que merecem explicacao
--
-- `sync_sources_due_idx` e parcial: fonte pausada ou manual tem
-- `next_check_at` nulo e nem entra no indice. Pausar passa a ser literalmente
-- sair da fila, e a consulta quente do agendador nao precisa filtrar estado.
--
-- `sync_changes_pending_key` e unico e parcial sobre as pendentes: impede a
-- verificacao seguinte de empilhar a mesma alteracao de novo, sem travar o
-- historico de alteracoes ja decididas sobre o mesmo campo.
--
-- Reaplicar e seguro (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "sync_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "source_url" text NOT NULL,
  "source_host" text NOT NULL,
  "state" text DEFAULT 'ativa' NOT NULL,
  "frequency" text DEFAULT 'semanal' NOT NULL,
  "last_checked_at" timestamp with time zone,
  "last_synced_at" timestamp with time zone,
  "next_check_at" timestamp with time zone,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "last_error" text DEFAULT '' NOT NULL,
  "import_id" uuid,
  "connected_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sync_page_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "url" text NOT NULL,
  "content_hash" text DEFAULT '' NOT NULL,
  "etag" text DEFAULT '' NOT NULL,
  "last_modified" text DEFAULT '' NOT NULL,
  "status" integer DEFAULT 0 NOT NULL,
  "last_seen_at" timestamp with time zone,
  "missing_since" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sync_baseline" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "content_key" text NOT NULL,
  "target" text NOT NULL,
  "field_key" text DEFAULT '' NOT NULL,
  "label" text DEFAULT '' NOT NULL,
  "source_value" jsonb,
  "source_fingerprint" text DEFAULT '' NOT NULL,
  "codeca_fingerprint" text DEFAULT '' NOT NULL,
  "entity_id" uuid,
  "page_url" text DEFAULT '' NOT NULL,
  "last_seen_at" timestamp with time zone,
  "missing_since" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sync_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "state" text DEFAULT 'verificando' NOT NULL,
  "trigger" text DEFAULT 'agendada' NOT NULL,
  "pages_checked" integer DEFAULT 0 NOT NULL,
  "pages_unchanged" integer DEFAULT 0 NOT NULL,
  "pages_failed" integer DEFAULT 0 NOT NULL,
  "changes_found" integer DEFAULT 0 NOT NULL,
  "conflicts" integer DEFAULT 0 NOT NULL,
  "message" text DEFAULT '' NOT NULL,
  "cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "triggered_by_user_id" uuid,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sync_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "check_id" uuid NOT NULL,
  "content_key" text NOT NULL,
  "target" text NOT NULL,
  "field_key" text DEFAULT '' NOT NULL,
  "label" text DEFAULT '' NOT NULL,
  "change_type" text NOT NULL,
  "page_url" text DEFAULT '' NOT NULL,
  "baseline_value" jsonb,
  "source_value" jsonb,
  "codeca_value" jsonb,
  "conflict" boolean DEFAULT false NOT NULL,
  "target_disabled" boolean DEFAULT false NOT NULL,
  "decision" text DEFAULT 'pendente' NOT NULL,
  "conflict_choice" text,
  "removal_action" text,
  "outcome" text DEFAULT 'pendente' NOT NULL,
  "revert_value" jsonb,
  "entity_id" uuid,
  "approved_by_user_id" uuid,
  "applied_at" timestamp with time zone,
  "error" text DEFAULT '' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ------------------------------------------------------ chaves estrangeiras

DO $$ BEGIN
  ALTER TABLE "sync_sources" ADD CONSTRAINT "sync_sources_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_sources" ADD CONSTRAINT "sync_sources_site_tenant_fk"
    FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_sources" ADD CONSTRAINT "sync_sources_import_id_site_imports_id_fk"
    FOREIGN KEY ("import_id") REFERENCES "public"."site_imports"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_sources" ADD CONSTRAINT "sync_sources_connected_by_user_id_users_id_fk"
    FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sync_page_states" ADD CONSTRAINT "sync_page_states_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_page_states" ADD CONSTRAINT "sync_page_states_source_id_sync_sources_id_fk"
    FOREIGN KEY ("source_id") REFERENCES "public"."sync_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_page_states" ADD CONSTRAINT "sync_page_states_site_tenant_fk"
    FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sync_baseline" ADD CONSTRAINT "sync_baseline_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_baseline" ADD CONSTRAINT "sync_baseline_source_id_sync_sources_id_fk"
    FOREIGN KEY ("source_id") REFERENCES "public"."sync_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_baseline" ADD CONSTRAINT "sync_baseline_site_tenant_fk"
    FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sync_checks" ADD CONSTRAINT "sync_checks_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_checks" ADD CONSTRAINT "sync_checks_source_id_sync_sources_id_fk"
    FOREIGN KEY ("source_id") REFERENCES "public"."sync_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_checks" ADD CONSTRAINT "sync_checks_triggered_by_user_id_users_id_fk"
    FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_checks" ADD CONSTRAINT "sync_checks_site_tenant_fk"
    FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_source_id_sync_sources_id_fk"
    FOREIGN KEY ("source_id") REFERENCES "public"."sync_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_check_id_sync_checks_id_fk"
    FOREIGN KEY ("check_id") REFERENCES "public"."sync_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_approved_by_user_id_users_id_fk"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_site_tenant_fk"
    FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- ------------------------------------------------------------------ indices

CREATE UNIQUE INDEX IF NOT EXISTS "sync_sources_site_key" ON "sync_sources" ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_sources_tenant_idx" ON "sync_sources" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_sources_due_idx" ON "sync_sources" ("next_check_at") WHERE "next_check_at" is not null;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "sync_page_states_source_url_key" ON "sync_page_states" ("source_id","url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_page_states_tenant_idx" ON "sync_page_states" ("tenant_id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "sync_baseline_source_key" ON "sync_baseline" ("source_id","content_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_baseline_tenant_idx" ON "sync_baseline" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_baseline_target_idx" ON "sync_baseline" ("source_id","target");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sync_checks_source_created_idx" ON "sync_checks" ("source_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_checks_tenant_idx" ON "sync_checks" ("tenant_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sync_changes_source_decision_idx" ON "sync_changes" ("source_id","decision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_changes_check_idx" ON "sync_changes" ("check_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_changes_tenant_idx" ON "sync_changes" ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_changes_pending_key" ON "sync_changes" ("source_id","content_key") WHERE "decision" = 'pendente';
