CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"image_id" uuid,
	"button_label" text DEFAULT '' NOT NULL,
	"button_url" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "banners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade,
	CONSTRAINT "banners_image_id_media_assets_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media_assets"("id") ON DELETE set null,
	CONSTRAINT "banners_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX "banners_site_order_idx" ON "banners" USING btree ("site_id","sort_order");--> statement-breakpoint
CREATE INDEX "banners_site_active_idx" ON "banners" USING btree ("site_id","is_active");--> statement-breakpoint
CREATE TABLE "site_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade,
	CONSTRAINT "site_modules_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "site_modules_site_key" ON "site_modules" USING btree ("site_id","module_key");--> statement-breakpoint
CREATE INDEX "site_modules_site_idx" ON "site_modules" USING btree ("site_id");--> statement-breakpoint
CREATE TABLE "site_field_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"field_key" text NOT NULL,
	"editable" boolean NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_field_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade,
	CONSTRAINT "site_field_policies_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "site_field_policies_key" ON "site_field_policies" USING btree ("site_id","module_key","field_key");--> statement-breakpoint
CREATE INDEX "site_field_policies_site_idx" ON "site_field_policies" USING btree ("site_id");--> statement-breakpoint
CREATE TABLE "content_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade,
	CONSTRAINT "content_documents_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null,
	CONSTRAINT "content_documents_site_tenant_fk" FOREIGN KEY ("site_id","tenant_id") REFERENCES "public"."sites"("id","tenant_id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "content_documents_site_key" ON "content_documents" USING btree ("site_id","module_key");--> statement-breakpoint
CREATE INDEX "content_documents_site_idx" ON "content_documents" USING btree ("site_id");--> statement-breakpoint
INSERT INTO "site_modules" ("tenant_id", "site_id", "module_key", "enabled")
SELECT s."tenant_id", s."id", m."key", true
FROM "sites" s
CROSS JOIN LATERAL (
  SELECT jsonb_array_elements_text(COALESCE(seg."default_modules", '["institucional","contato","banners","imoveis","obras","servicos"]'::jsonb)) AS "key"
  FROM "sites" s2 LEFT JOIN "segments" seg ON seg."id" = s2."segment_id"
  WHERE s2."id" = s."id"
) m
ON CONFLICT DO NOTHING;
