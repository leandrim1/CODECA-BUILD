-- Campos personalizados por site.
--
-- O caso do pedido: um cliente tem "CRECI", outro tem "Registro
-- profissional", e nenhum dos dois precisa da estrutura do outro.
--
-- Duas pecas. As **definicoes** ficam em tabela propria, por site e por
-- modulo -- quem as cria e a CODECA IA no painel mestre. Os **valores** ficam
-- numa coluna `custom_fields` em JSONB na propria tabela do conteudo, ao lado
-- das colunas tipadas.
--
-- Por que nao uma tabela de valores (`entity_id`, `field_key`, `value`):
-- cada leitura de imovel passaria a ser uma juncao extra, e a listagem do
-- painel faria uma consulta por linha. JSONB na mesma linha vem junto com o
-- registro, de graca.
--
-- Por que nao reaproveitar o `data` dos documentos: ali o schema tipado
-- recusa chave desconhecida, e misturar os dois faria o campo personalizado
-- depender de afrouxar a validacao do campo tipado.

CREATE TABLE IF NOT EXISTS "site_custom_fields" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "module_key" text NOT NULL,
  /** Chave no JSONB. Formato de identificador, conferido na escrita. */
  "field_key" text NOT NULL,
  "label" text NOT NULL,
  "type" text NOT NULL,
  "required" boolean DEFAULT false NOT NULL,
  "help" text DEFAULT '' NOT NULL,
  /** Opcoes de um campo de escolha. Vazio nos outros tipos. */
  "options" jsonb DEFAULT '[]'::jsonb NOT NULL,
  /** `false` quando a CODECA IA preenche e o cliente so consulta. */
  "editable" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "site_custom_fields" ADD CONSTRAINT "site_custom_fields_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "site_custom_fields" ADD CONSTRAINT "site_custom_fields_site_tenant_fk"
  FOREIGN KEY ("site_id", "tenant_id") REFERENCES "public"."sites"("id", "tenant_id") ON DELETE cascade;--> statement-breakpoint

-- Uma definicao por chave, dentro do modulo e do site. E o que impede dois
-- campos com o mesmo nome no mesmo formulario.
CREATE UNIQUE INDEX IF NOT EXISTS "site_custom_fields_key"
  ON "site_custom_fields" USING btree ("site_id", "module_key", "field_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_custom_fields_module_idx"
  ON "site_custom_fields" USING btree ("site_id", "module_key", "sort_order");--> statement-breakpoint

-- Valores, ao lado das colunas tipadas. `{}` como padrao para nenhuma leitura
-- precisar tratar `null`.
--
-- A coluna existe somente nas tabelas dos modulos que aceitam campo
-- personalizado (`customFields` no registro). `banners`, `faqs`, `categories`
-- e `galleries` ficam de fora: uma coluna que nenhum caminho escreve e nenhuma
-- leitura entrega so levaria alguem a achar que o recurso existe ali. Ligar o
-- recurso num desses modulos e um `ALTER TABLE` de uma linha.
ALTER TABLE "content_documents" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "testimonials" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
