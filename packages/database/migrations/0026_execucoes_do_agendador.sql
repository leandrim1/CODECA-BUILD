-- Registro das passagens do agendador de sincronizacao.
--
-- ## Por que uma tabela nova
--
-- A sincronizacao ja roda por dois agendamentos da Vercel. Esta migracao
-- prepara o terceiro caminho -- um agendador externo (cron-job.org e afins)
-- chamando `/api/sync/run` de 6 em 6 horas -- e resolve os tres problemas que
-- so aparecem quando existe mais de um disparador:
--
-- 1. **Duas passagens ao mesmo tempo.** A Vercel as 17:47 e o cron externo as
--    18:00 podem se cruzar quando a primeira atrasa. Sem trava, as duas
--    percorrem a fila juntas.
-- 2. **A mesma entrega duas vezes.** Agendador externo repete a chamada
--    quando nao recebe resposta a tempo -- e a resposta pode ter se perdido
--    depois de o trabalho ter sido feito.
-- 3. **Nao saber se o agendador externo existe.** Configuracao nao e
--    funcionamento. A tela so pode anunciar cadencia de 6 horas depois de ver
--    6 horas acontecer, e para ver e preciso registrar.
--
-- ## Por que sem `tenant_id`
--
-- Uma passagem percorre a fila de todas as empresas; ela nao pertence a
-- nenhuma. O recorte por empresa continua em `sync_checks`, que grava a
-- verificacao de cada fonte. Pendurar um tenant aqui inventaria um dono.
--
-- ## O que NAO muda
--
-- Nenhuma tabela existente e alterada. A reconciliacao de cobranca, as cinco
-- tabelas da sincronizacao e as duas da importacao ficam como estao.

CREATE TABLE IF NOT EXISTS "sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "origin" text NOT NULL,
  "state" text DEFAULT 'executando' NOT NULL,
  "idempotency_key" text DEFAULT '' NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "duration_ms" integer,
  "sources_claimed" integer DEFAULT 0 NOT NULL,
  "sources_checked" integer DEFAULT 0 NOT NULL,
  "sources_failed" integer DEFAULT 0 NOT NULL,
  "changes_found" integer DEFAULT 0 NOT NULL,
  "auto_paused" integer DEFAULT 0 NOT NULL,
  "budget_exhausted" boolean DEFAULT false NOT NULL,
  "error" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
-- Uma passagem por vez, decidido pelo banco.
--
-- O indice e parcial sobre `state`: so linhas `executando` entram nele, e
-- como todas teriam o mesmo valor, a unicidade significa "no maximo uma
-- passagem em andamento". Duas chamadas simultaneas viram uma execucao e uma
-- recusa -- garantia que uma checagem em memoria nao da, porque duas
-- instancias da funcao fariam a checagem ao mesmo tempo e as duas passariam.
CREATE UNIQUE INDEX IF NOT EXISTS "sync_runs_uma_execucao"
  ON "sync_runs" ("state") WHERE "state" = 'executando';

--> statement-breakpoint
-- A mesma entrega nunca roda duas vezes.
--
-- Parcial porque chave vazia e o caso comum -- agendador que nao manda
-- nenhuma -- e nao pode colidir consigo mesma.
CREATE UNIQUE INDEX IF NOT EXISTS "sync_runs_idempotencia"
  ON "sync_runs" ("idempotency_key") WHERE "idempotency_key" <> '';

--> statement-breakpoint
-- Historico da tela e apuracao da cadencia observada.
CREATE INDEX IF NOT EXISTS "sync_runs_started_idx" ON "sync_runs" ("started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_runs_origin_started_idx" ON "sync_runs" ("origin", "started_at");
