import { defineConfig } from 'drizzle-kit';

/**
 * Configuracao das migracoes versionadas do Neon PostgreSQL.
 * Use `pnpm db:generate` para gerar o SQL e `pnpm db:migrate` para aplicar.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://user:password@localhost:5432/codeca',
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
