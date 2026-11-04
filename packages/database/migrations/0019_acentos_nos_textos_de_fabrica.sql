-- Acentos nos textos de fabrica ja gravados no banco.
--
-- Os nomes e descricoes de planos e segmentos de fabrica nasceram sem acento e
-- ficaram assim em todo banco que ja rodou o seed. O seed so cria o que falta
-- (nunca sobrescreve), entao sem esta migracao o painel mostraria "Avaliacao"
-- ao lado de "Essencial" para sempre nas instalacoes existentes.
--
-- Cada UPDATE troca o texto **somente se ele ainda for exatamente o de
-- fabrica**: um nome ou uma descricao que o painel mestre tenha editado nao e
-- tocado. Segura de reaplicar: na segunda vez nada casa mais.

UPDATE "plans"
SET "name" = 'Avaliação'
WHERE "code" = 'trial' AND "name" = 'Avaliacao';--> statement-breakpoint

UPDATE "segments"
SET "name" = CASE WHEN "name" = 'Site institucional' THEN 'Site institucional' ELSE "name" END,
    "description" = CASE WHEN "description" = 'Apresentacao, servicos e contato. Ponto de partida para qualquer ramo.' THEN 'Apresentação, serviços e contato. Ponto de partida para qualquer ramo.' ELSE "description" END
WHERE "code" = 'institucional';--> statement-breakpoint

UPDATE "segments"
SET "name" = CASE WHEN "name" = 'Restaurante ou bar' THEN 'Restaurante ou bar' ELSE "name" END,
    "description" = CASE WHEN "description" = 'Cardapio por categoria, ambiente e equipe.' THEN 'Cardápio por categoria, ambiente e equipe.' ELSE "description" END
WHERE "code" = 'restaurante';--> statement-breakpoint

UPDATE "segments"
SET "name" = CASE WHEN "name" = 'Clinica ou consultorio' THEN 'Clínica ou consultório' ELSE "name" END,
    "description" = CASE WHEN "description" = 'Especialidades, corpo clinico e agendamento por contato.' THEN 'Especialidades, corpo clínico e agendamento por contato.' ELSE "description" END
WHERE "code" = 'clinica';--> statement-breakpoint

UPDATE "segments"
SET "name" = CASE WHEN "name" = 'Loja ou varejo' THEN 'Loja ou varejo' ELSE "name" END,
    "description" = CASE WHEN "description" = 'Catalogo de produtos por categoria, com vitrine.' THEN 'Catálogo de produtos por categoria, com vitrine.' ELSE "description" END
WHERE "code" = 'varejo';--> statement-breakpoint

UPDATE "segments"
SET "name" = CASE WHEN "name" = 'Prestador de servicos' THEN 'Prestador de serviços' ELSE "name" END,
    "description" = CASE WHEN "description" = 'Servicos oferecidos, portfolio e equipe.' THEN 'Serviços oferecidos, portfólio e equipe.' ELSE "description" END
WHERE "code" = 'prestador';--> statement-breakpoint

UPDATE "segments"
SET "name" = CASE WHEN "name" = 'Construtora' THEN 'Construtora' ELSE "name" END,
    "description" = CASE WHEN "description" = 'Obras, imoveis e institucional.' THEN 'Obras, imóveis e institucional.' ELSE "description" END
WHERE "code" = 'construtora';--> statement-breakpoint

UPDATE "segments"
SET "name" = CASE WHEN "name" = 'Imobiliaria' THEN 'Imobiliária' ELSE "name" END,
    "description" = CASE WHEN "description" = 'Carteira de imoveis e servicos.' THEN 'Carteira de imóveis e serviços.' ELSE "description" END
WHERE "code" = 'imobiliaria';--> statement-breakpoint

UPDATE "segments"
SET "name" = CASE WHEN "name" = 'Corretor autonomo' THEN 'Corretor autônomo' ELSE "name" END,
    "description" = CASE WHEN "description" = 'Carteira enxuta e contato direto.' THEN 'Carteira enxuta e contato direto.' ELSE "description" END
WHERE "code" = 'corretor';
