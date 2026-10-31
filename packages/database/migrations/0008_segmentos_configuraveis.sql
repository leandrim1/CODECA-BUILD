-- Segmentos deixam de ser uma lista fechada no schema.
--
-- A arquitetura sempre afirmou que "adicionar um segmento e declarar um
-- conjunto, nao alterar o schema", mas `segments.code` era um enum
-- (`segment_code`) com tres valores, todos do ramo imobiliario. Criar
-- "Restaurante" exigia ALTER TYPE e deploy -- exatamente o que o produto diz
-- que a plataforma nao pode ter, ja que ela precisa atender qualquer ramo.
--
-- Mesma razao pela qual `site_modules.module_key` ja e texto: o conjunto
-- cresce por cadastro, nao por migracao. O indice unico sobre o codigo
-- continua, entao duplicata segue impossivel.

ALTER TABLE "segments" ALTER COLUMN "code" TYPE text;--> statement-breakpoint
DROP TYPE IF EXISTS "segment_code";--> statement-breakpoint

-- Segmento de um cliente recem-cadastrado.
--
-- Antes o codigo trazia `'construtora'` fixo: uma empresa de qualquer ramo
-- nascia com os modulos de construtora. Qual segmento e o padrao passa a ser
-- decisao da CODECA IA, no painel, e nao uma constante no codigo.
ALTER TABLE "segments" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Um padrao por instalacao. Indice parcial, como o do site principal por
-- empresa: marcar outro exige desmarcar o atual, e o banco recusa o empate.
CREATE UNIQUE INDEX IF NOT EXISTS "segments_default_key"
  ON "segments" USING btree ("is_default") WHERE "is_default";--> statement-breakpoint

-- Mantem o comportamento que estava no codigo: construtora era o padrao.
-- Em instalacao nova a migracao 0002 cria os tres, e este UPDATE escolhe um.
UPDATE "segments" SET "is_default" = true
WHERE "code" = 'construtora'
  AND NOT EXISTS (SELECT 1 FROM "segments" WHERE "is_default");
