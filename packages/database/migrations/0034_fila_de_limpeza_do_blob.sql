-- Arquivos que precisam sair do Blob e ainda nao sairam.
--
-- A exclusao de midia apaga a linha do banco primeiro e so depois o arquivo.
-- A ordem esta certa -- se o banco caisse primeiro, perderiamos a URL e o
-- arquivo ficaria orfao para sempre --, mas a falha na segunda metade so ia
-- para o `console.error`. O arquivo continuava ocupando o balde e deixava de
-- ser cobrado: custo nosso, crescente e invisivel.
--
-- Agora a falha vira linha aqui, e o job diario tenta de novo.
--
-- Sem chave estrangeira para `tenants` de proposito: quando a empresa e
-- excluida, os arquivos dela precisam sair do Blob JUSTAMENTE nesse momento.
-- Um `on delete cascade` apagaria a tarefa junto com a empresa e deixaria o
-- arquivo la para sempre. `tenant_id` fica como dado solto, para agrupar.
--
-- Aditivo: nenhuma coluna existente e alterada ou removida.

CREATE TABLE IF NOT EXISTS "blob_cleanup_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid,
  "blob_url" text NOT NULL,
  "pathname" text DEFAULT '' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text DEFAULT '' NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- O mesmo arquivo pode falhar mais de uma vez; a tarefa e uma so.
CREATE UNIQUE INDEX IF NOT EXISTS "blob_cleanup_queue_url_key" ON "blob_cleanup_queue" ("blob_url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blob_cleanup_queue_pendente_idx" ON "blob_cleanup_queue" ("attempts","created_at");
