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
-- **Isto nao tem volta**, entao a migracao confere primeiro se as tabelas
-- estao vazias. Com linhas dentro, ela **avisa e nao apaga nada** -- esse
-- conteudo foi escrito por alguem no editor antigo, e nenhuma migracao
-- deveria decidir sozinha joga-lo fora.
--
-- ## Por que avisa, e nao interrompe
--
-- Ate 03/11/2026 ela interrompia, e o efeito foi pior do que o problema que
-- evitava: `prepare-db` roda **dentro do build**, entao a migracao barrada
-- derrubava o deploy inteiro. A plataforma ficou sem publicar nada por dias
-- -- painel, API, correcoes -- e o unico sinal era um X vermelho na lista de
-- commits. O diagnostico custou caro porque o sintoma (painel em branco) nao
-- se parecia nem um pouco com a causa (tabela antiga com conteudo).
--
-- Interromper so se justifica quando o codigo que vai subir depende do schema
-- que nao foi aplicado. Aqui e o contrario: **nada** depende destas tabelas
-- sumirem. Elas nao estao no schema Drizzle, nenhuma rota as le, e deixa-las
-- de pe nao custa nada alem de espaco. Falhar o build por causa delas
-- protegia zero e bloqueava tudo.
--
-- O dado continua intocado nos dois caminhos. O que muda e so quem espera:
-- antes, a plataforma inteira; agora, a limpeza.
--
-- Para concluir a limpeza quando quiser, exporte e esvazie:
--
--   pg_dump -t pages -t page_versions -t site_settings \
--           -t navigation_menus -t redirects "$DATABASE_URL" > editor-antigo.sql
--   psql "$DATABASE_URL" -c 'TRUNCATE pages, page_versions, site_settings,
--                             navigation_menus, redirects CASCADE'
--
-- As tabelas somem no deploy seguinte, pela migracao 0014.

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
    RAISE WARNING
      'Migracao 0007: conteudo do editor antigo encontrado em %. As tabelas '
      'foram MANTIDAS e nada foi apagado. Nenhum codigo no ar as le, entao o '
      'deploy segue normalmente. Para concluir a limpeza, exporte com pg_dump '
      'e esvazie com TRUNCATE -- a migracao 0014 derruba o que sobrar.',
      achadas;
    RETURN;
  END IF;

  -- Vazias: a limpeza acontece agora.
  --
  -- Ordem de dependencia: `page_versions` referencia `pages`. Sem CASCADE, de
  -- proposito -- se alguma coisa que nao conhecemos apontar para ca, e melhor
  -- a migracao falhar do que levar essa coisa junto.
  DROP TABLE IF EXISTS "page_versions";
  DROP TABLE IF EXISTS "pages";
  DROP TABLE IF EXISTS "navigation_menus";
  DROP TABLE IF EXISTS "redirects";
  DROP TABLE IF EXISTS "site_settings";
END $$;
