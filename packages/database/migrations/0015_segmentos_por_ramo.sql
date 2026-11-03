-- Segmentos de outros ramos, para quem ja tinha instalacao.
--
-- `ensureBaselineSegments` so semeia **com a tabela vazia** -- de proposito,
-- para um segmento removido a mao nao voltar no proximo deploy. A
-- consequencia e que acrescentar entradas em `DEFAULT_SEGMENTS` nao muda nada
-- num banco que ja existe. Esta migracao e quem leva os novos para la.
--
-- O catalogo tinha tres segmentos, e os tres do ramo imobiliario -- de onde a
-- plataforma nasceu. O efeito era pratico, nao cosmetico: um restaurante que
-- se cadastrasse caia em "Construtora" por omissao e abria o painel com
-- Imoveis e Obras ligados.
--
-- Nada e removido nem renomeado: Construtora, Imobiliaria e Corretor autonomo
-- seguem exatamente como estavam, com os sites que ja os usam.

INSERT INTO "segments" ("code", "name", "description", "default_modules", "is_active", "is_default")
VALUES
  (
    'institucional',
    'Site institucional',
    'Apresentacao, servicos e contato. Ponto de partida para qualquer ramo.',
    '["institucional","banners","contato","servicos","depoimentos","equipe","faq","galerias"]'::jsonb,
    true,
    false
  ),
  (
    'restaurante',
    'Restaurante ou bar',
    'Cardapio por categoria, ambiente e equipe.',
    '["institucional","banners","contato","produtos","categorias","galerias","depoimentos","equipe","faq"]'::jsonb,
    true,
    false
  ),
  (
    'clinica',
    'Clinica ou consultorio',
    'Especialidades, corpo clinico e agendamento por contato.',
    '["institucional","banners","contato","servicos","equipe","depoimentos","faq","galerias"]'::jsonb,
    true,
    false
  ),
  (
    'escola',
    'Escola ou curso',
    'Cursos, corpo docente e estrutura.',
    '["institucional","banners","contato","servicos","equipe","depoimentos","faq","galerias"]'::jsonb,
    true,
    false
  ),
  (
    'varejo',
    'Loja ou varejo',
    'Catalogo de produtos por categoria, com vitrine.',
    '["institucional","banners","contato","produtos","categorias","galerias","depoimentos","faq"]'::jsonb,
    true,
    false
  ),
  (
    'prestador',
    'Prestador de servicos',
    'Servicos oferecidos, portfolio e equipe.',
    '["institucional","banners","contato","servicos","equipe","galerias","depoimentos","faq"]'::jsonb,
    true,
    false
  )
-- Reaplicar nao duplica, e um segmento que a CODECA IA tenha editado depois
-- fica como ela o deixou: a migracao nao atualiza, so acrescenta o que falta.
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- O padrao sai de "Construtora" e vai para o segmento neutro.
--
-- Somente quando o padrao ainda e `construtora`, que e o valor semeado. Se a
-- CODECA IA ja escolheu outro no painel mestre, essa escolha e deliberada e
-- fica. A troca tambem exige que o neutro exista -- num banco onde alguem o
-- removeu a mao, nada acontece.
--
-- Um indice unico parcial garante no maximo um padrao, entao a ordem importa:
-- tira o antigo antes de por o novo.
UPDATE "segments" SET "is_default" = false
WHERE "code" = 'construtora'
  AND "is_default" = true
  AND EXISTS (SELECT 1 FROM "segments" WHERE "code" = 'institucional');--> statement-breakpoint

UPDATE "segments" SET "is_default" = true
WHERE "code" = 'institucional'
  AND NOT EXISTS (SELECT 1 FROM "segments" WHERE "is_default" = true);
