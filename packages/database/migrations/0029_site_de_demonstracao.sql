-- Site de demonstracao da avaliacao.
--
-- Quem se cadastra sozinho recebia um painel sem site nenhum ligado a ele: o
-- conteudo cadastrado nao aparecia em lugar algum, e os 14 dias corriam sem
-- resultado visivel. O site da empresa passa a nascer como demonstracao, com
-- conteudo de exemplo e um endereco onde ve-lo.
--
-- Duas colunas, as duas aditivas:
--
-- - `is_demo`: a marca inequivoca. Site existente continua `false` -- nenhum
--   site de cliente real vira demonstracao por causa desta migracao.
-- - `demo_seed`: quais registros foram criados como exemplo. E o que permite,
--   na hora de ligar o site real, separar o que e ficticio do que o cliente
--   criou. Nulo em todo site que nao e (ou nunca foi) demonstracao.
--
-- Reversivel: `ALTER TABLE "sites" DROP COLUMN "is_demo", DROP COLUMN "demo_seed";`
-- Nenhum dado existente e alterado.

ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "is_demo" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "demo_seed" jsonb;
