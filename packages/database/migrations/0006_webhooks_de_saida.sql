-- Webhooks que a plataforma envia ao site do cliente.
--
-- Duas tabelas, e a segunda e a que faz o recurso ser confiavel. Numa funcao
-- serverless nao existe fila em memoria: o processo que atende a requisicao
-- pode morrer no instante seguinte. Entao a entrega e **gravada** antes de
-- ser tentada, e o que falhou volta na proxima passagem do cron. Sem a
-- tabela, um webhook perdido ficaria perdido, e um aviso que as vezes nao
-- chega e pior do que nenhum: o site do cliente passaria a confiar nele.

CREATE TABLE IF NOT EXISTS "site_webhooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "url" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  -- Guardado em claro, ao contrario das chaves de integracao: assinar exige o
  -- segredo a cada entrega, e um hash nao serve para isso. A contrapartida e
  -- que ele nunca aparece em log, em auditoria nem numa leitura posterior.
  "secret" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_status" integer,
  "last_attempt_at" timestamp with time zone,
  "last_error" text DEFAULT '' NOT NULL,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "webhook_id" uuid NOT NULL,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_status" integer,
  "last_error" text DEFAULT '' NOT NULL,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "site_webhooks"
  ADD CONSTRAINT "site_webhooks_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "site_webhooks"
  ADD CONSTRAINT "site_webhooks_created_by_user_id_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
-- O par (site, empresa) e conferido pelo banco, como em toda tabela de site.
ALTER TABLE "site_webhooks"
  ADD CONSTRAINT "site_webhooks_site_tenant_fk"
  FOREIGN KEY ("site_id", "tenant_id") REFERENCES "public"."sites"("id", "tenant_id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_webhook_id_site_webhooks_id_fk"
  FOREIGN KEY ("webhook_id") REFERENCES "public"."site_webhooks"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_site_tenant_fk"
  FOREIGN KEY ("site_id", "tenant_id") REFERENCES "public"."sites"("id", "tenant_id") ON DELETE cascade;--> statement-breakpoint

-- Um endereco por site: cadastrar o mesmo duas vezes dobraria as entregas.
CREATE UNIQUE INDEX "site_webhooks_site_url_key" ON "site_webhooks" USING btree ("site_id", "url");--> statement-breakpoint
CREATE INDEX "site_webhooks_site_idx" ON "site_webhooks" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_site_idx" ON "webhook_deliveries" USING btree ("site_id");--> statement-breakpoint
-- O cron busca exatamente por isto: o que ainda deve ser tentado, e quando.
CREATE INDEX "webhook_deliveries_pending_idx"
  ON "webhook_deliveries" USING btree ("next_attempt_at")
  WHERE "webhook_deliveries"."status" in ('pending', 'failed');
