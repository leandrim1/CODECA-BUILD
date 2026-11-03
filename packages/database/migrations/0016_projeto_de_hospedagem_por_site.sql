-- O projeto de hospedagem passa a ser do SITE, e nao um valor unico do ambiente.
--
-- Ate aqui a plataforma anexava o dominio de todo cliente ao projeto Vercel
-- apontado por `VERCEL_PROJECT_ID`. Esse projeto e o da propria plataforma --
-- o que serve o painel e a API --, entao o dominio do cliente passaria a abrir
-- o login do painel. Isso vinha do renderizador removido na etapa 0, que era
-- quem de fato respondia por aqueles dominios.
--
-- O site de um cliente e um projeto Vercel proprio, e so a CODECA IA sabe qual.
-- Esta coluna guarda esse identificador. Ele so e usado quando o plano do
-- cliente inclui hospedagem (`included_hosting`); sem ele, ou sem o recurso, a
-- plataforma apenas REGISTRA o dominio e nao toca na Vercel.
--
-- Nulo e o padrao e o caso comum: Essencial e Profissional nao incluem
-- hospedagem, entao a maioria dos sites nunca tera valor aqui.

ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "hosting_project_id" text;--> statement-breakpoint

-- Um projeto de hospedagem pertence a UM site.
--
-- Nao e detalhe: dois sites apontando para o mesmo projeto anexariam o
-- dominio de uma empresa ao site de outra -- o endereco do cliente B passaria
-- a servir o conteudo do cliente A. A chave estrangeira composta garante o
-- isolamento do dado; este indice garante o isolamento da hospedagem, e um erro
-- de copia-e-cola no painel mestre deixa de ser possivel.
CREATE UNIQUE INDEX IF NOT EXISTS "sites_hosting_project_key"
  ON "sites" USING btree ("hosting_project_id")
  WHERE "hosting_project_id" IS NOT NULL;--> statement-breakpoint

-- Estado de um dominio que a plataforma nao gerencia.
--
-- `awaiting_dns` diria "falta apontar o DNS", e nao falta nada a plataforma
-- cobrar: ela nao hospeda aquele site. `pending` diria "aguardando", e nada
-- vai acontecer. O estado honesto e "registrado" -- o endereco pertence a este
-- site na plataforma, e so isso.
--
-- Apenas acrescenta o valor; nenhuma linha existente muda de estado.
ALTER TYPE "domain_status" ADD VALUE IF NOT EXISTS 'registered';
