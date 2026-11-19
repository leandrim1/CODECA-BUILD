-- Guia de primeiro acesso: o que a pessoa ja dispensou.
--
-- Duas datas, e nao dois booleanos. A data responde as duas perguntas -- se
-- aconteceu (nao e nulo) e quando -- enquanto o par booleano+data pode
-- divergir, e divergindo nao ha como saber qual dos dois esta certo.
--
-- Fica em `users` e nao em `memberships` porque isto e da PESSOA: quem ja fez
-- o tour nao precisa refaze-lo ao entrar na segunda empresa. O que a pessoa
-- ainda nao fez NO SITE continua vindo dos dados reais, calculado a cada
-- carregamento -- aqui nao se guarda progresso, so o que foi dispensado.
--
-- Aditivo: nenhuma coluna existente e alterada ou removida.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_tour_done_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_checklist_dismissed_at" timestamp with time zone;
