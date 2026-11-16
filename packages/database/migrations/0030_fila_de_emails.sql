-- Fila de e-mails e enderecos que nao devem mais receber avisos.
--
-- Ate aqui cada e-mail era uma chamada direta ao provedor, sem registro: se a
-- chamada falhava, o aviso se perdia, e nada impedia o mesmo aviso de sair
-- duas vezes quando um evento era reprocessado.
--
-- `email_outbox`: um registro por e-mail a enviar. A chave `dedupe_key` e
-- unica -- o mesmo evento (o mesmo pagamento, o mesmo fim de avaliacao) so
-- consegue gerar um registro, venha de webhook repetido, da conciliacao ou da
-- tarefa agendada. `tenant_id` fica nulo quando a empresa e excluida, para o
-- aviso de exclusao concluida sobreviver a ela.
--
-- `email_suppressions`: enderecos que devolveram de forma definitiva ou
-- marcaram como spam. Guarda so o resumo criptografico do endereco.
--
-- As duas sao novas: nenhum dado existente e alterado.
-- Reversivel: DROP TABLE "email_outbox"; DROP TABLE "email_suppressions";

CREATE TABLE IF NOT EXISTS "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"recipient" text,
	"recipient_hash" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"provider" text DEFAULT '' NOT NULL,
	"provider_message_id" text,
	"last_error" text DEFAULT '' NOT NULL,
	"delivery_status" text DEFAULT '' NOT NULL,
	"delivery_updated_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_outbox_dedupe_key" ON "email_outbox" ("dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_queue_idx" ON "email_outbox" ("status","next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_provider_message_idx" ON "email_outbox" ("provider_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_tenant_idx" ON "email_outbox" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_suppressions" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
