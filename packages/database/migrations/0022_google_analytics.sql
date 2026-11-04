-- Integracao com o Google Analytics 4: conexao por site e `state` do OAuth.
--
-- ## O que muda, e o que NAO muda
--
-- So acrescenta duas tabelas. O login com Google (`user_identities`,
-- `oauth_states`) nao e tocado: a integracao tem fluxo, `state`, escopo e
-- callback proprios.
--
-- ## analytics_connections
--
-- Uma conexao por site. `refresh_token_enc` guarda o token de renovacao
-- CIFRADO (AES-256-GCM, com empresa e site como dado autenticado). O token de
-- acesso nunca e gravado. O par (site, empresa) e conferido pelo banco.
--
-- ## analytics_oauth_states
--
-- Hash do `state`, uso unico, 10 minutos, amarrado a empresa/site/usuario que
-- clicou em "Conectar Google Analytics". A aplicacao apaga os vencidos.
--
-- Reaplicar e seguro (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "analytics_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "status" text DEFAULT 'pending_property' NOT NULL,
  "refresh_token_enc" text NOT NULL,
  "scope" text DEFAULT '' NOT NULL,
  "property_id" text,
  "property_name" text DEFAULT '' NOT NULL,
  "account_name" text DEFAULT '' NOT NULL,
  "connected_by_user_id" uuid,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_refresh_at" timestamp with time zone,
  "last_error" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "analytics_oauth_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state_hash" text NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "analytics_connections"
  ADD CONSTRAINT "analytics_connections_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "analytics_connections"
  ADD CONSTRAINT "analytics_connections_connected_by_user_id_users_id_fk"
  FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "analytics_connections"
  ADD CONSTRAINT "analytics_connections_site_tenant_fk"
  FOREIGN KEY ("site_id", "tenant_id") REFERENCES "public"."sites"("id", "tenant_id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "analytics_oauth_states"
  ADD CONSTRAINT "analytics_oauth_states_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "analytics_oauth_states"
  ADD CONSTRAINT "analytics_oauth_states_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "analytics_oauth_states"
  ADD CONSTRAINT "analytics_oauth_states_site_tenant_fk"
  FOREIGN KEY ("site_id", "tenant_id") REFERENCES "public"."sites"("id", "tenant_id") ON DELETE cascade;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "analytics_connections_site_key" ON "analytics_connections" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_connections_tenant_idx" ON "analytics_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_oauth_states_hash_key" ON "analytics_oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_oauth_states_expires_idx" ON "analytics_oauth_states" USING btree ("expires_at");
