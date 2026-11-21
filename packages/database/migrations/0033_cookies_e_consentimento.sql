-- Cookies e consentimento nos sites dos clientes.
--
-- Duas tabelas e um indice. Nada existente e alterado ou removido.
--
-- `site_cookie_settings` guarda QUEM responde pelos dados de cada site e O QUE
-- aquele site declara carregar. Fica por site, e nao por empresa, porque uma
-- agencia atende varios clientes na mesma conta: o controlador dos dados do
-- visitante e o dono daquele site -- nunca a agencia e nunca a CODECA.
--
-- `site_consent_records` guarda a escolha do visitante para a empresa poder
-- demonstrar o consentimento que praticou. O que NAO esta na tabela e a parte
-- importante: nao ha IP, nao ha agente de navegador e nao ha identificador de
-- visitante. `consent_id` e sorteado no navegador e serve apenas para o
-- reenvio da mesma decisao nao virar duas linhas.
--
-- O indice em `site_origins(origin)` e o que permite a rota publica descobrir
-- de que site veio um registro a partir da origem que o navegador declara --
-- sem exigir credencial, que o `sendBeacon` nao sabe enviar.

CREATE TABLE IF NOT EXISTS "site_cookie_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "controller_name" text DEFAULT '' NOT NULL,
  "controller_document" text DEFAULT '' NOT NULL,
  "controller_contact" text DEFAULT '' NOT NULL,
  "privacy_policy_url" text DEFAULT '' NOT NULL,
  "cookie_policy_url" text DEFAULT '' NOT NULL,
  "policy_version" text DEFAULT '1' NOT NULL,
  "banner_enabled" boolean DEFAULT true NOT NULL,
  "record_consent" boolean DEFAULT true NOT NULL,
  "tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_consent_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "consent_id" text NOT NULL,
  "decided_at" timestamp with time zone NOT NULL,
  "domain" text NOT NULL,
  "granted" jsonb NOT NULL,
  "denied" jsonb NOT NULL,
  "policy_version" text NOT NULL,
  "engine_version" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "site_cookie_settings" ADD CONSTRAINT "site_cookie_settings_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "site_cookie_settings" ADD CONSTRAINT "site_cookie_settings_updated_by_user_id_users_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "site_cookie_settings" ADD CONSTRAINT "site_cookie_settings_site_tenant_fk"
    FOREIGN KEY ("site_id", "tenant_id") REFERENCES "sites"("id", "tenant_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "site_consent_records" ADD CONSTRAINT "site_consent_records_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "site_consent_records" ADD CONSTRAINT "site_consent_records_site_tenant_fk"
    FOREIGN KEY ("site_id", "tenant_id") REFERENCES "sites"("id", "tenant_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_cookie_settings_site_key" ON "site_cookie_settings" ("site_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_consent_records_site_consent_key" ON "site_consent_records" ("site_id","consent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_consent_records_site_created_idx" ON "site_consent_records" ("site_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_origins_origin_idx" ON "site_origins" ("origin");
