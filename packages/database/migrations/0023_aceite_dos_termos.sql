-- Registro do aceite dos termos de uso e da politica de privacidade.
--
-- Guarda, no usuario, QUANDO aceitou e QUAL versao do texto (`LEGAL_VERSION`,
-- uma data AAAA-MM-DD). Sem isto o cadastro exigia a caixa marcada mas nao
-- deixava prova do que foi aceito.
--
-- So acrescenta duas colunas anulaveis: nenhuma linha existente e alterada.
-- Contas anteriores ficam com NULL (aceitaram antes de o registro existir).
--
-- Reaplicar e seguro (IF NOT EXISTS).

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_version" text;
