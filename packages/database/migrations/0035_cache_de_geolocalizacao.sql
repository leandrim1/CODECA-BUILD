-- Cache das respostas de geolocalizacao (CEP, geocodificacao e busca).
--
-- Duas razoes, nesta ordem. A primeira e a politica de uso do provedor
-- padrao: o Nominatim e gratuito e compartilhado, e repetir a mesma pergunta
-- a cada abertura de tela e exatamente o que eles pedem que nao se faca. A
-- segunda e a resposta -- CEP e endereco de um ponto nao mudam de um dia para
-- o outro, e ler do banco troca uma ida a internet por uma consulta local.
--
-- A chave carrega o TIPO (`cep:13010000`, `rev:-22.90710,-47.06320`,
-- `busca:rua x campinas`), entao uma tabela so atende os tres casos. O valor e
-- o JSON ja NORMALIZADO, nunca a resposta crua: trocar de provedor nao
-- invalida o que esta guardado aqui.
--
-- `provider` e auditoria -- saber de onde veio a resposta quando ela estiver
-- errada --, e nao chave de leitura.
--
-- Aditivo e reversivel: nenhuma coluna existente e tocada, e derrubar esta
-- tabela (`DROP TABLE geo_cache`) so faz o sistema voltar a perguntar ao
-- provedor a cada consulta.

CREATE TABLE IF NOT EXISTS "geo_cache" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "provider" text DEFAULT '' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A limpeza do que venceu varre por data, nao por chave.
CREATE INDEX IF NOT EXISTS "geo_cache_expira_idx" ON "geo_cache" ("expires_at");
