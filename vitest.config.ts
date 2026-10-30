import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Os testes rodam sobre o codigo-fonte dos pacotes (sem passo de build),
 * usando um Postgres real em processo (PGlite) para os testes de integracao.
 */
export default defineConfig({
  resolve: {
    alias: {
      // O alias mais especifico vem primeiro.
      '@codeca/shared/server': resolve('./packages/shared/src/server/index.ts'),
      '@codeca/shared': resolve('./packages/shared/src/index.ts'),
      '@codeca/sdk/server': resolve('./packages/sdk/src/server.ts'),
      '@codeca/sdk': resolve('./packages/sdk/src/index.ts'),
      '@codeca/database': resolve('./packages/database/src/index.ts'),
      '@codeca/ui': resolve('./packages/ui/src/index.ts'),
      '@codeca/api': resolve('./apps/api/src/index.ts'),
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ['./tests/setup.ts'],
  },
});
