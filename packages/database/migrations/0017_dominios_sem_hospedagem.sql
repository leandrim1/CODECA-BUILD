-- Dominios que nunca chegaram a Vercel passam a ser "registrados".
--
-- Antes da 0016 todo dominio nascia esperando a Vercel. Sem credenciais, a
-- plataforma devolvia "aguardando DNS" e o dominio ficava assim para sempre:
-- nada ia mudar o estado dele. Com a regra nova a plataforma so afirma algo
-- sobre DNS quando hospeda o site -- e para estes dominios isso nunca foi
-- verdade. Deixa-los em "Aguardando DNS" contradiria a propria explicacao da
-- tela, que diz que a verificacao nao e feita pela plataforma.
--
-- Fica em arquivo proprio, e nao na 0016, por uma restricao do Postgres: um
-- valor de enum acrescentado numa transacao nao pode ser usado nela, e cada
-- migracao roda inteira dentro de uma.
--
-- ## O que NAO muda
--
-- O discriminador e `vercel_domain_id IS NULL`: so o que **nunca** foi aceito
-- pelo provedor. Dominio com id da Vercel -- ativo, com erro de configuracao,
-- verificando propriedade -- esta la de verdade, e reescrever o estado dele
-- seria afirmar que a plataforma deixou de saber o que sabe.
--
-- Tambem nao toca em dominio de site que ja tenha projeto de hospedagem: esse
-- e gerenciado, e o proximo "verificar" o anexa e traz o estado real.
--
-- Reaplicar e seguro: depois da primeira vez nenhuma linha casa com o filtro.

UPDATE "domains" AS d
SET "status" = 'registered',
    "updated_at" = now()
WHERE d."vercel_domain_id" IS NULL
  AND d."status" IN ('pending', 'awaiting_dns', 'verifying_ownership')
  AND NOT EXISTS (
    SELECT 1 FROM "sites" AS s
    WHERE s."id" = d."site_id" AND s."hosting_project_id" IS NOT NULL
  );
