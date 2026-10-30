import { createNeonDatabase } from '../client.js';
import { ensureBaselinePlans } from '../baseline.js';
import { runMigrations } from '../migrator.js';

/**
 * Preparacao do banco durante o deploy.
 *
 * Roda no build da Vercel, antes de compilar o painel: aplica as migracoes
 * pendentes e, numa instalacao vazia, cria os planos padrao. Com isso um deploy
 * novo sobe pronto para uso -- a primeira conta cadastrada assume o painel
 * mestre e nao sobra passo manual nenhum.
 *
 * Tres limites deliberados:
 *
 * 1. **So em producao.** Em Preview e Development o passo e pulado: varios
 *    ambientes costumam apontar para o mesmo banco, e um preview com schema
 *    diferente alteraria a producao.
 * 2. **Sem DATABASE_URL, nao falha o build.** A aplicacao sobe e informa o que
 *    falta em `/api/health`, em vez de deixar quem opera sem nenhum deploy.
 * 3. **Migracao que falha derruba o build.** Publicar codigo que espera um
 *    schema que nao existe seria pior do que nao publicar.
 *
 * Migracao destrutiva (remover coluna ou tabela ainda usada pelo codigo no ar)
 * continua exigindo cuidado: aplique-a em um deploy posterior ao que para de
 * usar o que sera removido.
 */
async function main(): Promise<void> {
  const ambiente = process.env.VERCEL_ENV;
  if (ambiente && ambiente !== 'production') {
    console.log(`[deploy] ambiente "${ambiente}": preparacao do banco pulada.`);
    return;
  }
  if (!ambiente) {
    console.log('[deploy] fora da Vercel: use "pnpm db:migrate" para aplicar as migracoes.');
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn(
      '[deploy] DATABASE_URL ausente: migracoes nao aplicadas. '
        + 'A aplicacao vai indicar a configuracao que falta em /api/health.',
    );
    return;
  }

  const handle = createNeonDatabase(url);
  try {
    const { applied, skipped } = await runMigrations(handle.db);
    console.log(
      applied.length > 0
        ? `[deploy] migracoes aplicadas: ${applied.join(', ')}`
        : `[deploy] banco ja atualizado (${skipped.length} migracao(oes) ja aplicadas).`,
    );

    const baseline = await ensureBaselinePlans(handle.db);
    console.log(
      baseline.skipped
        ? '[deploy] planos ja existem: nada alterado.'
        : `[deploy] planos padrao criados: ${baseline.plansCreated}.`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  // Falhar aqui derruba o build de proposito: melhor nao publicar do que
  // publicar codigo que espera um schema inexistente.
  console.error(
    '[deploy] falha ao preparar o banco:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
