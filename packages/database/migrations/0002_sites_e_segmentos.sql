CREATE TYPE "public"."segment_code" AS ENUM('construtora', 'imobiliaria', 'corretor');--> statement-breakpoint
CREATE TYPE "public"."site_status" AS ENUM('draft', 'active', 'suspended', 'archived');--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "segment_code" NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"default_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "segments_code_key" ON "segments" USING btree ("code");--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"segment_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "site_status" DEFAULT 'draft' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"internal_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade,
	CONSTRAINT "sites_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX "sites_id_tenant_key" ON "sites" USING btree ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_tenant_slug_key" ON "sites" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_primary_per_tenant_key" ON "sites" USING btree ("tenant_id") WHERE "sites"."is_primary";--> statement-breakpoint
CREATE INDEX "sites_tenant_idx" ON "sites" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sites_status_idx" ON "sites" USING btree ("status");--> statement-breakpoint
INSERT INTO "segments" ("code", "name", "description", "default_modules") VALUES
  ('construtora', 'Construtora', 'Obras, imoveis e institucional.', '["institucional","banners","imoveis","obras","servicos","contato"]'::jsonb),
  ('imobiliaria', 'Imobiliaria', 'Carteira de imoveis e servicos.', '["institucional","banners","imoveis","servicos","contato"]'::jsonb),
  ('corretor', 'Corretor autonomo', 'Carteira enxuta e contato direto.', '["institucional","banners","imoveis","contato"]'::jsonb);--> statement-breakpoint
INSERT INTO "sites" ("tenant_id", "segment_id", "name", "slug", "status", "is_primary")
SELECT
  t."id",
  (SELECT s."id" FROM "segments" s WHERE s."code" = 'construtora'),
  t."display_name",
  'principal',
  (CASE WHEN t."status" IN ('trialing', 'active') THEN 'active' ELSE 'draft' END)::"site_status",
  true
FROM "tenants" t;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "testimonials" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "faqs" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "site_id" uuid;--> statement-breakpoint
UPDATE "properties" c SET "site_id" = s."id" FROM "sites" s WHERE s."tenant_id" = c."tenant_id" AND s."is_primary";--> statement-breakpoint
UPDATE "projects" c SET "site_id" = s."id" FROM "sites" s WHERE s."tenant_id" = c."tenant_id" AND s."is_primary";--> statement-breakpoint
UPDATE "services" c SET "site_id" = s."id" FROM "sites" s WHERE s."tenant_id" = c."tenant_id" AND s."is_primary";--> statement-breakpoint
UPDATE "testimonials" c SET "site_id" = s."id" FROM "sites" s WHERE s."tenant_id" = c."tenant_id" AND s."is_primary";--> statement-breakpoint
UPDATE "team_members" c SET "site_id" = s."id" FROM "sites" s WHERE s."tenant_id" = c."tenant_id" AND s."is_primary";--> statement-breakpoint
UPDATE "faqs" c SET "site_id" = s."id" FROM "sites" s WHERE s."tenant_id" = c."tenant_id" AND s."is_primary";--> statement-breakpoint
UPDATE "leads" c SET "site_id" = s."id" FROM "sites" s WHERE s."tenant_id" = c."tenant_id" AND s."is_primary";--> statement-breakpoint
UPDATE "media_assets" c SET "site_id" = s."id" FROM "sites" s WHERE s."tenant_id" = c."tenant_id" AND s."is_primary";--> statement-breakpoint
UPDATE "domains" c SET "site_id" = s."id" FROM "sites" s WHERE s."tenant_id" = c."tenant_id" AND s."is_primary";--> statement-breakpoint
UPDATE "subscriptions" c SET "site_id" = s."id" FROM "sites" s WHERE s."tenant_id" = c."tenant_id" AND s."is_primary";--> statement-breakpoint
UPDATE "charges" c SET "site_id" = s."id" FROM "sites" s WHERE s."tenant_id" = c."tenant_id" AND s."is_primary";--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "testimonials" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "faqs" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "charges" ALTER COLUMN "site_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "properties_site_idx" ON "properties" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "projects_site_idx" ON "projects" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "services_site_idx" ON "services" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "testimonials_site_idx" ON "testimonials" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "team_members_site_idx" ON "team_members" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "faqs_site_idx" ON "faqs" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "leads_site_idx" ON "leads" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "media_assets_site_idx" ON "media_assets" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "domains_site_idx" ON "domains" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "subscriptions_site_idx" ON "subscriptions" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "charges_site_idx" ON "charges" USING btree ("site_id");
