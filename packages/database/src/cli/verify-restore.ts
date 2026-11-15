import { createNeonDatabase } from '../client.js';
import { formatDatabaseFailure } from '../diagnose.js';
import { verifyRestoredDatabase } from '../verify-restore.js';

/**
 * Confere um banco restaurado. Somente leitura.
 *
 * Le a conexao de `RESTORE_CHECK_DATABASE_URL`, e NAO de `DATABASE_URL`, de
 * proposito: o ensaio de restauracao acontece num ramo separado, e uma
 * variavel propria impede que alguem rode isto achando que conferiu o ramo
 * restaurado quando conferiu o banco de sempre.
 *
 * A conexao nunca e impressa.
 */
async function main(): Promise<void> {
  const url = process.env.RESTORE_CHECK_DATABASE_URL;
  if (!url) {
    console.error(
      'RESTORE_CHECK_DATABASE_URL não definida. Informe a conexão do banco RESTAURADO '
        + '(o ramo de ensaio), não a de produção. Veja docs/continuidade-operacional.md, seção 8.',
    );
    process.exit(1);
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
    console.warn(
      'Aviso: a conexão informada é a mesma de DATABASE_URL. A conferência é somente leitura e '
        + 'vai rodar, mas isto não é um ensaio de restauração: é o banco em uso.',
    );
  }

  const handle = createNeonDatabase(url);
  try {
    const relatorio = await verifyRestoredDatabase(handle.db);
    for (const check of relatorio.checks) {
      console.log(`${check.ok ? 'ok   ' : 'FALHA'}  ${check.nome}: ${check.detalhe}`);
    }
    console.log('\nLinhas por tabela (confira contra o esperado):');
    for (const [tabela, total] of Object.entries(relatorio.contagens)) {
      console.log(`  ${tabela.padEnd(16)} ${total}`);
    }
    console.log(`\nConferência em ${relatorio.duracaoMs} ms. Nada foi alterado.`);
    console.log(relatorio.ok ? 'Resultado: APROVADO.' : 'Resultado: REPROVADO. Não aponte a aplicação para este banco.');
    if (!relatorio.ok) process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(formatDatabaseFailure(error));
  process.exit(1);
});
