-- Codigos de acesso por e-mail (login sem senha).
--
-- So acrescenta uma tabela. Nenhuma coluna ou linha existente e tocada: o login
-- por senha e o login com Google continuam exatamente como estavam.
--
-- ## Por que nao tem `user_id`
--
-- O codigo e pedido para um ENDERECO, exista conta ou nao. Se a linha dependesse
-- de um usuario, existir (ou nao) uma linha aqui revelaria se o e-mail esta
-- cadastrado -- e a resposta do pedido nao pode revelar isso. A tela decide
-- "entrar ou cadastrar" so depois de o codigo ser provado.
--
-- ## O que fica guardado
--
-- `code_hash` e um HMAC do codigo com o segredo do servidor (nunca o codigo).
-- Um codigo de 6 digitos tem so 1.000.000 de possibilidades: sem o segredo no
-- calculo, quem lesse a tabela recuperaria todos os codigos em milissegundos.
-- `request_ip_hash` e um hash, para investigar abuso sem guardar o IP.
--
-- ## Indices e limpeza
--
-- (email, created_at): achar o codigo mais recente de um e-mail e conferir o
-- intervalo entre pedidos. (expires_at): a limpeza. A aplicacao apaga as linhas
-- vencidas ha mais de um dia a cada novo pedido; nao depende de tarefa agendada.
--
-- Reaplicar e seguro (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"request_ip_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_codes_email_created_idx" ON "login_codes" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_codes_expires_idx" ON "login_codes" USING btree ("expires_at");
