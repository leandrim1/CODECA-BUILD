-- Conclui a limpeza que a 0007 adiou.
--
-- A 0007 derruba as tabelas do editor antigo quando estao vazias e, quando
-- tem conteudo, avisa e mantem tudo. Num banco onde ela avisou, as tabelas
-- continuam la depois de a migracao estar registrada como aplicada -- e
-- migracao aplicada nao roda de novo.
--
-- Esta migracao existe para esse caso: depois de o conteudo ser exportado e
-- esvaziado, ela termina o servico. Ela mesma segue a regra de sempre --
-- **nunca apaga tabela com linha dentro** --, entao e segura de aplicar
-- enquanto o conteudo ainda estiver la: simplesmente nao faz nada.
--
-- Num banco onde a 0007 ja derrubou tudo (o caso normal, e o de toda
-- instalacao nova), as tabelas nem existem e isto e uma operacao vazia.

DO $$
DECLARE
  tabela text;
  linhas bigint;
  mantidas text := '';
  removidas text := '';
BEGIN
  -- Ordem de dependencia: `page_versions` referencia `pages`.
  FOREACH tabela IN ARRAY ARRAY[
    'page_versions', 'pages', 'navigation_menus', 'redirects', 'site_settings'
  ] LOOP
    IF to_regclass('public.' || tabela) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I', tabela) INTO linhas;
    IF linhas > 0 THEN
      mantidas := mantidas || format('%s (%s linha(s)); ', tabela, linhas);
    ELSE
      EXECUTE format('DROP TABLE IF EXISTS public.%I', tabela);
      removidas := removidas || tabela || '; ';
    END IF;
  END LOOP;

  IF removidas <> '' THEN
    RAISE NOTICE 'Migracao 0014: tabelas do editor antigo removidas: %', removidas;
  END IF;

  IF mantidas <> '' THEN
    RAISE WARNING
      'Migracao 0014: ainda ha conteudo do editor antigo em %. Nada foi '
      'apagado e o deploy segue normalmente -- nenhum codigo no ar le estas '
      'tabelas. Exporte com pg_dump e esvazie com TRUNCATE quando decidir.',
      mantidas;
  END IF;
END $$;
