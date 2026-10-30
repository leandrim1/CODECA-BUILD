-- Remove as tabelas do renderizador e do editor visual.
--
-- Segundo dos dois deploys que a secao 5 do `docs/vercel.md` exige: o deploy
-- que parou de usar estas tabelas e a Etapa 0, ja no ar. Nenhuma delas e
-- declarada no schema Drizzle nem lida por qualquer rota desde entao.
--
-- `pages` e `page_versions` guardavam as paginas por blocos; `site_settings`,
-- o tema, as secoes e o SEO; `navigation_menus`, o menu; `redirects`, as
-- rotas antigas. No modelo novo quem renderiza e o projeto da CODECA IA, e o
-- conteudo editavel vive em `content_documents` e nas tabelas de colecao.
--
-- **Isto nao tem volta.** Por isso a migracao confere primeiro se as tabelas
-- estao vazias e **interrompe** quando nao estao. Um banco com linhas aqui
-- guarda conteudo que alguem escreveu no editor antigo, e nenhuma migracao
-- deveria decidir sozinha jogar isso fora. O deploy falha com a instrucao e a
-- versao no ar continua servindo -- nada depende destas tabelas.

DO $$
DECLARE
  tabela text;
  linhas bigint;
  achadas text := '';
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'pages', 'page_versions', 'navigation_menus', 'redirects', 'site_settings'
  ] LOOP
    -- `to_regclass` em vez de um `IF EXISTS`: num banco criado depois desta
    -- migracao as tabelas nunca existiram, e isso nao e erro.
    IF to_regclass('public.' || tabela) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', tabela) INTO linhas;
      IF linhas > 0 THEN
        achadas := achadas || format('%s (%s linha(s)); ', tabela, linhas);
      END IF;
    END IF;
  END LOOP;

  IF achadas <> '' THEN
    RAISE EXCEPTION
      'Migracao 0007 interrompida: ainda ha conteudo do editor antigo em %', achadas
      USING HINT =
        'Exporte o que interessa (pg_dump -t pages -t page_versions -t site_settings '
        || '-t navigation_menus -t redirects) e depois esvazie as tabelas com TRUNCATE '
        || 'para liberar esta migracao. Nenhum codigo no ar le estas tabelas.';
  END IF;
END $$;--> statement-breakpoint

-- Ordem de dependencia: `page_versions` referencia `pages`. Sem CASCADE, de
-- proposito -- se alguma coisa que nao conhecemos apontar para ca, e melhor a
-- migracao falhar do que levar essa coisa junto.
DROP TABLE IF EXISTS "page_versions";--> statement-breakpoint
DROP TABLE IF EXISTS "pages";--> statement-breakpoint
DROP TABLE IF EXISTS "navigation_menus";--> statement-breakpoint
DROP TABLE IF EXISTS "redirects";--> statement-breakpoint
DROP TABLE IF EXISTS "site_settings";
