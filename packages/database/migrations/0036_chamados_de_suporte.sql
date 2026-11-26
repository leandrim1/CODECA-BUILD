-- Chamados de suporte: o lugar onde pedir ajuda vira registro.
--
-- Ate aqui o suporte da plataforma era um `mailto:` no menu da conta. Um
-- endereco de e-mail nao tem situacao, nao tem historico e nao deixa quem
-- pediu ajuda saber se alguem leu -- e do lado de ca nao havia nada para
-- priorizar nem para consultar depois. Estas duas tabelas trocam isso por um
-- chamado com numero, dono, situacao e conversa.
--
-- O ASSISTENTE DE IA NAO ENTRA AQUI. O chamado e deliberadamente independente
-- dele: a IA pode estar fora do ar, sem chave configurada ou desligada, e
-- abrir chamado continua funcionando. A coluna `conversa_id` e `ticket_messages.author
-- = 'ia'` existem porque a etapa seguinte vai ANEXAR a conversa do assistente
-- a um chamado -- o banco precisa aceitar isso antes, nao depois.
--
-- Aditivo: nenhuma tabela existente e tocada. Derrubar as duas devolve a
-- plataforma ao estado anterior sem efeito em mais nada.

CREATE TABLE IF NOT EXISTS "tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- O site a que a duvida se refere, quando ha um. `set null` porque o chamado
  -- sobrevive ao site: "voces apagaram meu site" precisa continuar legivel.
  "site_id" uuid REFERENCES "sites"("id") ON DELETE SET NULL,
  -- Quem abriu. `set null` na exclusao da pessoa: o chamado e da EMPRESA, e
  -- apagar um usuario nao pode apagar o historico de atendimento dela.
  "opened_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  -- Numero legivel, sequencial DENTRO da empresa: o cliente cita "chamado 12",
  -- nao um uuid. Nao e global de proposito -- um numero global contaria a
  -- concorrencia quantos chamados a plataforma recebe.
  "numero" integer NOT NULL,
  "assunto" text NOT NULL,
  "categoria" text NOT NULL,
  "status" text DEFAULT 'aberto' NOT NULL,
  "prioridade" text DEFAULT 'normal' NOT NULL,
  -- Resumo gerado pelo assistente, quando houver. Vazio enquanto nao ha IA.
  "resumo" text DEFAULT '' NOT NULL,
  -- Retrato do momento da abertura: empresa, plano, uso, usuario. Montado no
  -- SERVIDOR a partir da sessao -- ver `lib/suporte/contexto.ts`.
  "contexto" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- De qual tela do painel a pessoa chamou. Caminho, nao endereco completo.
  "origem_url" text DEFAULT '' NOT NULL,
  -- Conversa com o assistente que originou o chamado (etapa seguinte).
  "conversa_id" uuid,
  "primeira_resposta_em" timestamp with time zone,
  "resolvido_em" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A caixa de entrada da empresa e a tela da plataforma leem por data.
CREATE INDEX IF NOT EXISTS "tickets_tenant_idx" ON "tickets" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
-- A fila de atendimento ordena por situacao e prioridade.
CREATE INDEX IF NOT EXISTS "tickets_fila_idx" ON "tickets" ("status", "prioridade", "created_at");
--> statement-breakpoint
-- O numero e unico POR EMPRESA. Este indice nao e so busca: e ele que impede
-- duas aberturas simultaneas de receberem o mesmo numero -- a segunda falha e
-- a rota tenta de novo.
CREATE UNIQUE INDEX IF NOT EXISTS "tickets_numero_key" ON "tickets" ("tenant_id", "numero");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ticket_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE,
  -- Repetido do chamado de proposito: toda consulta do painel filtra por
  -- empresa, e sem esta coluna isso exigiria juntar com `tickets` em todas
  -- elas. Uma juncao a mais por consulta e uma chance a mais de alguem
  -- esquece-la.
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "author" text NOT NULL,
  "author_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_messages_ticket_idx" ON "ticket_messages" ("ticket_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_messages_tenant_idx" ON "ticket_messages" ("tenant_id", "created_at" DESC);
