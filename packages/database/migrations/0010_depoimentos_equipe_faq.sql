-- Depoimentos, equipe e perguntas frequentes passam a ser modulos.
--
-- As tres tinham tabela e tela no painel desde o inicio, mas nao existiam no
-- registro de modulos, em `/api/v1` nem no SDK: o cliente editava conteudo
-- que **nenhum site conseguia ler**. Agora sao modulos como os demais, com
-- rota publica e tipo no SDK.
--
-- O cuidado desta migracao e nao tirar nada de quem ja tem. Como as tres
-- valiam para todo site, virar modulo sem habilitar faria as telas
-- desaparecerem de todo cliente no ar -- o painel esconde o que nao esta
-- habilitado. Entao elas entram **habilitadas em todos os sites existentes**,
-- e o comportamento de hoje continua igual.

INSERT INTO "site_modules" ("tenant_id", "site_id", "module_key", "enabled")
SELECT s."tenant_id", s."id", m."key", true
FROM "sites" s
CROSS JOIN (VALUES ('depoimentos'), ('equipe'), ('faq')) AS m("key")
-- Idempotente pelo indice unico (site, modulo): reaplicar nao duplica, e um
-- site que ja tiver o modulo configurado mantem a escolha de quem configurou.
ON CONFLICT ("site_id", "module_key") DO NOTHING;--> statement-breakpoint

-- Os segmentos existentes tambem passam a trazer as tres, para um site novo
-- nascer como os de hoje. Instalacao vazia recebe isto de `DEFAULT_SEGMENTS`.
UPDATE "segments" SET "default_modules" = (
  SELECT jsonb_agg(DISTINCT valor)
  FROM jsonb_array_elements_text(
    "default_modules" || '["depoimentos","equipe","faq"]'::jsonb
  ) AS valor
)
-- Somente nos segmentos que ja declaram algum modulo. Um segmento com lista
-- vazia significa "todos os modulos" no provisionamento, e preencher a lista
-- mudaria esse significado.
WHERE jsonb_array_length("default_modules") > 0;
