-- Por que uma passagem do agendador processou zero fontes.
--
-- ## O problema que isto resolve
--
-- A passagem gravava quantas fontes **reservou**, e nada mais. Com a
-- frequencia padrao sendo semanal e o agendamento sendo diario, seis de cada
-- sete passagens reservam zero -- o que esta correto, mas no historico fica
-- indistinguivel de uma falha. Quem opera ve "concluida, 0 sites" tendo sites
-- conectados e conclui, razoavelmente, que a sincronizacao esta quebrada.
--
-- Com estas tres colunas a mesma linha passa a responder a pergunta seguinte:
-- *zero de quantos?* "0 vencidas de 3 conectadas" e funcionamento normal;
-- "0 verificadas de 3 vencidas" e problema.
--
-- ## O que NAO muda
--
-- Apenas acrescenta colunas, com valor padrao, a uma tabela criada na
-- migracao 0026. Nenhum dado existente e alterado ou removido, e linhas
-- antigas ficam com zero -- que e a leitura honesta: naquela epoca o numero
-- nao era medido.

ALTER TABLE "sync_runs" ADD COLUMN IF NOT EXISTS "sources_connected" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN IF NOT EXISTS "sources_paused" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN IF NOT EXISTS "sources_due" integer DEFAULT 0 NOT NULL;
