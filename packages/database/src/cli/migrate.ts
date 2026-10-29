import { createNeonDatabase } from '../client.js';
import { runMigrations } from '../migrator.js';

/** Aplica as migracoes pendentes no banco apontado por DATABASE_URL. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL nao configurada. Copie .env.example para .env e informe a conexao do Neon.');
    process.exit(1);
  }
  const handle = createNeonDatabase(url);
  try {
    const result = await runMigrations(handle.db);
    if (result.applied.length === 0) {
      console.log(`Nenhuma migracao pendente (${result.skipped.length} ja aplicada(s)).`);
    } else {
      console.log(`Migracoes aplicadas: ${result.applied.join(', ')}`);
    }
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('Falha ao aplicar migracoes:', error instanceof Error ? error.message : error);
  process.exit(1);
});
