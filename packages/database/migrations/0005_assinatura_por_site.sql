-- Assinatura por site e politica de suspensao por plano.
--
-- Duas mudancas, pela mesma razao: no modelo novo o que se contrata e um
-- *site*, nao a empresa. Uma construtora pode ter o institucional em um plano
-- e o portal de lancamentos em outro, e a chave unica por empresa impedia
-- justamente isso.
--
-- A politica de suspensao entra no plano, e nao na assinatura: o que acontece
-- ao atrasar e caracteristica comercial do plano, igual para todos os clientes
-- que o assinam. Guardada em JSONB, como `billing`, para acrescentar um eixo
-- novo sem migracao.

-- 1. A unicidade passa a ser por site.
--
-- Hoje toda empresa tem exatamente um site principal, entao a troca nao muda
-- nenhuma linha existente -- os dados ja satisfazem a chave nova.
DROP INDEX IF EXISTS "subscriptions_tenant_key";--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_site_key" ON "subscriptions" USING btree ("site_id");--> statement-breakpoint

-- O indice por empresa continua existindo, agora sem unicidade: as consultas
-- do painel mestre filtram por empresa.
CREATE INDEX IF NOT EXISTS "subscriptions_tenant_idx" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint

-- 2. Politica de suspensao do plano.
--
-- O padrao reproduz o que a plataforma ja fazia de mais conservador: o site
-- continua no ar e o painel fica em somente leitura. Nenhum eixo apaga dado --
-- isso nao e configuravel e nao tem coluna.
ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "suspension" jsonb NOT NULL
  DEFAULT '{"publicSite":"serve","panel":"read_only"}'::jsonb;
