-- Fase 6: TOTP opcional, clientes da agencia e visibilidade da reducao de plano.
-- Tudo aditivo: nenhuma coluna ou tabela existente e alterada ou removida.

CREATE TABLE IF NOT EXISTS "user_totp" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_totp" ADD CONSTRAINT "user_totp_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_recovery_codes" ADD CONSTRAINT "user_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_clients" ADD CONSTRAINT "tenant_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_recovery_codes_user_idx" ON "user_recovery_codes" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_clients_tenant_idx" ON "tenant_clients" USING btree ("tenant_id");
--> statement-breakpoint
-- O par (id, empresa) permite que `sites` aponte para um cliente SEMPRE da
-- mesma empresa: o banco recusa um cliente de outra agencia.
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_clients_id_tenant_key" ON "tenant_clients" USING btree ("id","tenant_id");
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "client_id" uuid;
--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_client_tenant_fk" FOREIGN KEY ("client_id","tenant_id") REFERENCES "public"."tenant_clients"("id","tenant_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sites_client_idx" ON "sites" USING btree ("client_id");
--> statement-breakpoint
-- Visibilidade da troca de plano ja solicitada ao provedor. `pending_plan_id`
-- ja existia; faltava dizer QUANDO passa a valer e COMO o provedor tratou.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "pending_plan_requested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "pending_plan_effective_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "pending_plan_mode" text DEFAULT '' NOT NULL;
