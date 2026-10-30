import { createNeonDatabase } from '../client.js';
import { formatDatabaseFailure } from '../diagnose.js';
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
  // O mesmo bloco do deploy: `error.message` sozinho e o `Failed query:` do
  // Drizzle com o SQL inteiro, e a linha que explica a falha fica escondida
  // em `cause`.
  console.error(formatDatabaseFailure(error));
  process.exit(1);
});
