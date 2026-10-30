CREATE TYPE "public"."api_key_kind" AS ENUM('publishable', 'secret');--> statement-breakpoint
CREATE TABLE "site_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" "api_key_kind" NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"lookup" text NOT NULL,
	"secret_hash" text NOT NULL,
	"token" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade,
	CONSTRAINT "site_api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null,
	CONSTRAINT "site_api_keys_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "site_api_keys_lookup_key" ON "site_api_keys" USING btree ("lookup");--> statement-breakpoint
CREATE INDEX "site_api_keys_site_idx" ON "site_api_keys" USING btree ("site_id");--> statement-breakpoint
CREATE TABLE "site_origins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_origins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade,
	CONSTRAINT "site_origins_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "site_origins_site_origin_key" ON "site_origins" USING btree ("site_id","origin");
