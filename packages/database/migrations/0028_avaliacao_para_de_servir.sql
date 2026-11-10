-- Vencida a avaliacao, o conteudo para de ser servido.
--
-- ## O que estava acontecendo
--
-- A politica de suspensao padrao e `publicSite: serve` + `panel: read_only`, e
-- ela esta certa para quem PAGA e atrasou: o site de um cliente adimplente nao
-- pode sair do ar por causa de um cartao recusado enquanto a cobranca se
-- resolve.
--
-- O plano de avaliacao herdava esse mesmo padrao. Resultado: passados os 14
-- dias, o painel ficava em leitura -- e a API publica seguia alimentando o site
-- do visitante **para sempre**. Quem nunca pagou ficava com o produto
-- funcionando por tempo ilimitado.
--
-- ## O que esta migracao faz
--
-- Troca a politica do plano `trial`, e so dele, para parar de servir o conteudo
-- publico quando a avaliacao vence. O painel continua em `read_only`, nao em
-- `blocked`: a pessoa precisa seguir vendo o que cadastrou para decidir se
-- contrata, e nada e apagado.
--
-- ## O que ela NAO faz
--
-- - Nao toca em assinatura nenhuma: so na configuracao do plano.
-- - Nao toca nos planos pagos.
-- - Nao sobrescreve uma politica ajustada a mao: o `WHERE` exige que o valor
--   ainda seja exatamente o padrao. Quem tiver editado no painel mestre
--   continua com a sua escolha.
--
-- Reversivel pelo painel mestre, sem migracao: a politica e campo editavel do
-- plano.

UPDATE "plans"
   SET "suspension" = '{"publicSite":"stop","panel":"read_only"}'::jsonb,
       "updated_at" = now()
 WHERE "code" = 'trial'
   AND "suspension" = '{"publicSite":"serve","panel":"read_only"}'::jsonb;
