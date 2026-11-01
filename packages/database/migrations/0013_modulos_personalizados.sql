-- Modulos personalizados: a existencia do modulo passa a ser dado.
--
-- A etapa F deu campos novos a um modulo que ja existia. Esta da um tipo de
-- conteudo inteiro -- "Cardapio", "Turmas", "Processos" -- que nenhum modulo
-- do registro cobre e que nao justifica entrar no registro, porque vale para
-- um cliente so.
--
-- ## Por que NAO criar uma tabela por modulo
--
-- Seria o espelho do que os modulos tipados fazem, e seria `CREATE TABLE` em
-- tempo de execucao. Isso significa: o schema passa a diferir entre
-- instalacoes, nenhuma migracao futura pode mais ser raciocinada sobre o banco
-- inteiro, o backup e a restauracao viram caso a caso, e um erro na chave do
-- modulo deixa de ser uma linha errada para virar DDL errado -- com `DROP` ao
-- alcance de um bug. Uma tabela generica com `data` em JSONB troca indice por
-- campo (que estes modulos nao usam: nao ha busca por preco num cardapio) por
-- um schema que continua sendo um so.
--
-- ## Por que NAO reaproveitar `content_documents`
--
-- Ali o `data` e validado por schema tipado do registro, e a chave do modulo
-- precisa existir em `MODULE_REGISTRY`. Misturar os dois faria o modulo
-- personalizado depender de afrouxar a validacao do conteudo tipado.

CREATE TABLE IF NOT EXISTS "site_custom_modules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  /** Chave do modulo. Formato de identificador, conferida na escrita. */
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  /** `collection` ou `document`. Ver a nota do indice de slug abaixo. */
  "kind" text NOT NULL,
  "icon" text DEFAULT '' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  /**
   * `false` esconde o modulo do painel e da API publica sem apagar registro.
   *
   * E o caminho para "tirar do ar": nenhum caminho desta plataforma apaga
   * conteudo de cliente, e apagar a definicao e recusado enquanto houver
   * registro.
   */
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "site_custom_modules" ADD CONSTRAINT "site_custom_modules_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "site_custom_modules" ADD CONSTRAINT "site_custom_modules_site_tenant_fk"
  FOREIGN KEY ("site_id", "tenant_id") REFERENCES "public"."sites"("id", "tenant_id") ON DELETE cascade;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "site_custom_modules_key"
  ON "site_custom_modules" USING btree ("site_id", "key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_custom_modules_ordem_idx"
  ON "site_custom_modules" USING btree ("site_id", "sort_order");--> statement-breakpoint

-- Registros de todos os modulos personalizados, numa tabela.
--
-- As colunas fora de `data` sao as que a plataforma precisa conhecer para
-- listar, ordenar, publicar e entregar. Sem `title` a lista do painel nao tem
-- o que mostrar; sem `slug` a rota publica de um registro so nao existe.
CREATE TABLE IF NOT EXISTS "custom_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "module_key" text NOT NULL,
  "title" text NOT NULL,
  /**
   * Vazio no registro de um `document`.
   *
   * E o que mantem o documento unico: o indice unico abaixo cobre
   * `(site_id, module_key, slug)`, entao duas linhas com slug vazio no mesmo
   * modulo nao entram. Um documento e uma colecao de um registro, e nao um
   * segundo mecanismo.
   */
  "slug" text DEFAULT '' NOT NULL,
  /** Valores dos campos definidos para o modulo. */
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "publication_status" text DEFAULT 'draft' NOT NULL,
  "featured" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "custom_records" ADD CONSTRAINT "custom_records_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;--> statement-breakpoint
-- A mesma chave estrangeira composta de todo conteudo: o banco, e nao a
-- aplicacao, garante que um registro nao pode pertencer ao site de outra
-- empresa.
ALTER TABLE "custom_records" ADD CONSTRAINT "custom_records_site_tenant_fk"
  FOREIGN KEY ("site_id", "tenant_id") REFERENCES "public"."sites"("id", "tenant_id") ON DELETE cascade;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "custom_records_slug"
  ON "custom_records" USING btree ("site_id", "module_key", "slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_records_listagem_idx"
  ON "custom_records" USING btree ("site_id", "module_key", "publication_status", "sort_order");
