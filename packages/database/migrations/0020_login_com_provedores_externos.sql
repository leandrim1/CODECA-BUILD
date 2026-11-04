-- Login com provedores externos (Google): identidades e estados do OAuth.
--
-- ## O que muda, e o que NAO muda
--
-- So acrescenta duas tabelas. Nenhuma coluna de `users` e alterada, nenhuma
-- linha existente e tocada: quem ja tem conta continua entrando com e-mail e
-- senha exatamente como antes. `users.password_hash` ja aceitava nulo (e o caso
-- do convite ainda nao aceito), entao uma conta criada pelo Google, sem senha,
-- cabe no modelo atual sem mexer nele.
--
-- ## user_identities
--
-- A identidade interna continua sendo `users.id`. Esta tabela diz que um
-- usuario TAMBEM entra por um provedor. A chave do provedor e o `sub` (estavel),
-- nunca o e-mail (que pode mudar e ser reaproveitado).
--
--   * (provider, provider_subject) unico: uma conta Google = um usuario.
--   * (user_id, provider) unico: um usuario = uma conta Google.
--
-- ON DELETE CASCADE: apagar o usuario apaga os vinculos; nada fica orfao.
--
-- ## oauth_states
--
-- O `state` do fluxo OAuth, so como hash, de uso unico e com validade curta.
-- `user_id` preenchido amarra um fluxo de VINCULACAO a quem estava logado.
-- Linhas vencidas sao apagadas pela propria aplicacao a cada novo fluxo.
--
-- Reaplicar e seguro (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_identities_provider_subject_key" ON "user_identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_identities_user_provider_key" ON "user_identities" USING btree ("user_id","provider");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"provider" text NOT NULL,
	"intent" text NOT NULL,
	"user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
	"next_path" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_states_hash_key" ON "oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_states_expires_idx" ON "oauth_states" USING btree ("expires_at");
