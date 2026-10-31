-- Produtos, categorias e galerias.
--
-- Abrem varejo, restaurante e clinica -- os ramos mais provaveis depois do
-- imobiliario. Tres modulos, cinco tabelas: produto e galeria tem lista de
-- imagens, no mesmo formato de `property_images`.
--
-- Decisoes registradas aqui porque o schema nao as explica sozinho:
--
-- * **Sem variacao de produto.** Tamanho e cor pediriam `product_variants`
--   com preco e disponibilidade por combinacao. Um cardapio e um catalogo de
--   servicos nao precisam, e a variante entra depois como tabela filha sem
--   mexer em `products`.
-- * **Categoria em tabela compartilhada**, com `module_key`. Duas tabelas
--   especificas dariam relacionamento mais firme, mas cada modulo novo que
--   quisesse agrupar conteudo pediria migracao.
-- * **Sem aninhamento de categoria.** `parent_id` traria ciclo, profundidade
--   e arvore no painel; o cardapio que motivou isto e plano.
-- * **`price` em `NUMERIC(14,2)`**, como em `properties` -- nunca ponto
--   flutuante. Nao sao centavos inteiros como `plans.price_cents` porque este
--   preco e de exibicao, nao valor cobrado: centavos inteiros existem lá para
--   conversar com a ValidaPay.

CREATE TABLE IF NOT EXISTS "categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "module_key" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "publication_status" "publication_status" DEFAULT 'published' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "category_id" uuid,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "code" text DEFAULT '' NOT NULL,
  "price" numeric(14, 2),
  "price_on_request" boolean DEFAULT false NOT NULL,
  "currency" "currency" DEFAULT 'BRL' NOT NULL,
  "unit" text DEFAULT '' NOT NULL,
  "is_available" boolean DEFAULT true NOT NULL,
  "cover_image_id" uuid,
  "publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "seo_title" text DEFAULT '' NOT NULL,
  "seo_description" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "product_images" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "media_asset_id" uuid NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "galleries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "publication_status" "publication_status" DEFAULT 'published' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "gallery_images" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "gallery_id" uuid NOT NULL,
  "media_asset_id" uuid NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Empresa
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "galleries" ADD CONSTRAINT "galleries_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "gallery_images" ADD CONSTRAINT "gallery_images_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;--> statement-breakpoint

-- O par (site, empresa) conferido pelo banco, como em toda tabela de site: o
-- isolamento nao depende de a consulta lembrar do filtro.
ALTER TABLE "categories" ADD CONSTRAINT "categories_site_tenant_fk"
  FOREIGN KEY ("site_id", "tenant_id") REFERENCES "public"."sites"("id", "tenant_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_site_tenant_fk"
  FOREIGN KEY ("site_id", "tenant_id") REFERENCES "public"."sites"("id", "tenant_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "galleries" ADD CONSTRAINT "galleries_site_tenant_fk"
  FOREIGN KEY ("site_id", "tenant_id") REFERENCES "public"."sites"("id", "tenant_id") ON DELETE cascade;--> statement-breakpoint

-- Remover a categoria nao apaga o produto: ele fica sem agrupamento.
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk"
  FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_cover_image_id_media_assets_id_fk"
  FOREIGN KEY ("cover_image_id") REFERENCES "public"."media_assets"("id") ON DELETE set null;--> statement-breakpoint

ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_media_asset_id_media_assets_id_fk"
  FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "gallery_images" ADD CONSTRAINT "gallery_images_gallery_id_galleries_id_fk"
  FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "gallery_images" ADD CONSTRAINT "gallery_images_media_asset_id_media_assets_id_fk"
  FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade;--> statement-breakpoint

-- O slug da categoria e unico dentro do modulo, nao do site.
CREATE UNIQUE INDEX IF NOT EXISTS "categories_site_module_slug_key"
  ON "categories" USING btree ("site_id", "module_key", "slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "categories_site_module_idx"
  ON "categories" USING btree ("site_id", "module_key", "sort_order");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "products_tenant_slug_key"
  ON "products" USING btree ("tenant_id", "slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_site_status_idx"
  ON "products" USING btree ("site_id", "publication_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_site_category_idx"
  ON "products" USING btree ("site_id", "category_id", "sort_order");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "product_images_unique"
  ON "product_images" USING btree ("product_id", "media_asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_images_product_idx"
  ON "product_images" USING btree ("product_id", "sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_images_media_idx"
  ON "product_images" USING btree ("media_asset_id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "galleries_tenant_slug_key"
  ON "galleries" USING btree ("tenant_id", "slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "galleries_site_status_idx"
  ON "galleries" USING btree ("site_id", "publication_status");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "gallery_images_unique"
  ON "gallery_images" USING btree ("gallery_id", "media_asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gallery_images_gallery_idx"
  ON "gallery_images" USING btree ("gallery_id", "sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gallery_images_media_idx"
  ON "gallery_images" USING btree ("media_asset_id");
