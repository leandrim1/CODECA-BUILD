-- Limite geral de conteudos cadastrados, no lugar de "imoveis" e "obras".
--
-- Ate aqui o plano limitava dois tipos de registro -- imoveis publicados
-- (`maxPublishedProperties`) e obras (`maxProjects`) --, e todos os outros
-- modulos (produtos, servicos, equipe, galerias, registros dos modulos
-- personalizados...) nao tinham limite nenhum. Alem de incoerente, isso fazia a
-- plataforma parecer exclusiva de imobiliarias e construtoras.
--
-- Passa a existir UM limite, `maxContentRecords`: a soma dos registros de todos
-- os modulos de colecao do site. Como a contagem e feita esta documentado em
-- `apps/api/src/lib/content-usage.ts` e em `docs/limites-de-conteudo.md`.
--
-- ## Esta migracao e ADITIVA, de proposito
--
-- Ela **acrescenta** `maxContentRecords` e **nao remove** `maxPublishedProperties`
-- nem `maxProjects` do JSON. Duas razoes, e a primeira e a que importa:
--
-- 1. A Vercel executa a migracao **durante o build**, enquanto a versao
--    anterior do codigo continua no ar. A versao anterior faz
--    `planLimitsSchema.parse()` em praticamente toda requisicao do painel, e
--    esse schema EXIGE as duas chaves antigas. Remove-las agora derrubaria o
--    painel de todo cliente, com erro de validacao, ate a nova versao entrar no
--    ar. (Foi o que a migracao 0009 precisou evitar do outro lado.)
-- 2. Nada se perde: o dado antigo continua ali ate uma migracao futura, depois
--    que esta versao estiver no ar, retirar as duas chaves.
--
-- O schema novo (`z.object`) descarta chaves desconhecidas ao ler, entao as
-- antigas ficam inertes: ninguem mais as le.
--
-- ## Como o numero novo e escolhido
--
-- `maxContentRecords` recebe o valor que o plano ja tinha em
-- `maxPublishedProperties`. Nos planos de fabrica isso da exatamente a regra
-- comercial nova (Avaliacao 5, Essencial 20, Profissional 100, Empresas 400) e,
-- num plano que o painel mestre tenha editado ou criado, preserva a decisao de
-- quem editou em vez de impor numero de fabrica.
--
-- ATENCAO DE QUEM OPERA: a soma antiga (imoveis + obras) era maior que o
-- numero novo (ex.: Essencial 20 + 10 = 30 virou 20). Empresa que ja
-- cadastrou mais que o novo limite **nao perde nada**: continua editando e
-- excluindo, e so fica impedida de cadastrar novos ate voltar a ficar abaixo.

UPDATE "plans"
SET "limits" = "limits" || jsonb_build_object(
  'maxContentRecords',
  COALESCE(("limits" ->> 'maxPublishedProperties')::int, ("limits" ->> 'maxProjects')::int, 0)
)
WHERE NOT ("limits" ? 'maxContentRecords');--> statement-breakpoint

-- Ajustes individuais por empresa (`tenants.limit_overrides`).
--
-- Quem tinha um limite afrouxado para imoveis ou obras ganha o equivalente no
-- limite geral: o **maior** dos dois valores que existirem. Escolhe-se o maior
-- porque um acordo comercial ja feito nao pode encolher por causa de uma
-- mudanca de modelo; no pior caso a empresa fica com mais folga do que tinha em
-- um dos tipos, e o painel mestre ajusta.
UPDATE "tenants"
SET "limit_overrides" = "limit_overrides" || jsonb_build_object(
  'maxContentRecords',
  GREATEST(
    COALESCE(("limit_overrides" ->> 'maxPublishedProperties')::int, 0),
    COALESCE(("limit_overrides" ->> 'maxProjects')::int, 0)
  )
)
WHERE "limit_overrides" IS NOT NULL
  AND NOT ("limit_overrides" ? 'maxContentRecords')
  AND ("limit_overrides" ? 'maxPublishedProperties' OR "limit_overrides" ? 'maxProjects');--> statement-breakpoint

-- Descricoes comerciais, so onde ninguem mexeu.
--
-- Cada UPDATE compara com o texto de fabrica anterior: descricao editada no
-- painel mestre e decisao de quem opera, e uma migracao nao a desfaz -- a mesma
-- regra das correcoes de preco da 0009. Os textos novos nao citam imoveis nem
-- obras: valem para qualquer segmento.
UPDATE "plans"
SET "description" = 'Para conhecer o painel e visualizar o funcionamento da plataforma.'
WHERE "code" = 'trial'
  AND "description" = 'Para conhecer o painel antes de contratar.';--> statement-breakpoint

UPDATE "plans"
SET "description" = 'Site personalizado com domínio próprio e gestão de conteúdo realizada pela equipe CODECA IA.'
WHERE "code" = 'essencial'
  AND "description" = 'Site personalizado com dominio proprio. O conteudo e mantido pela CODECA IA.';--> statement-breakpoint

UPDATE "plans"
SET "description" = 'Mais autonomia para sua empresa administrar e atualizar o próprio site.'
WHERE "code" = 'profissional'
  AND "description" = 'Site personalizado com painel para a empresa gerenciar o proprio conteudo.';--> statement-breakpoint

UPDATE "plans"
SET "description" = 'Uma solução ampliada para empresas que precisam de gestão de conteúdo, equipe e hospedagem.'
WHERE "code" = 'empresas'
  AND "description" = 'Tudo do Profissional, com a hospedagem do site por conta da CODECA IA.';
