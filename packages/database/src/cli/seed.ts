import { createNeonDatabase } from '../client.js';
import { seedDatabase } from '../seed.js';

/**
 * Popula o banco com os planos padrao e, quando configurado, com o
 * administrador da plataforma e uma construtora de demonstracao.
 *
 * Variaveis reconhecidas:
 *   PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD
 *   SEED_DEMO=true + SEED_DEMO_EMAIL / SEED_DEMO_PASSWORD
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL nao configurada.');
    process.exit(1);
  }

  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
  const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
  if (adminEmail && !adminPassword) {
    console.error('PLATFORM_ADMIN_PASSWORD e obrigatoria quando PLATFORM_ADMIN_EMAIL esta definida.');
    process.exit(1);
  }

  const demoEnabled = process.env.SEED_DEMO === 'true';
  const demoEmail = process.env.SEED_DEMO_EMAIL ?? 'demo@construtorahorizonte.com.br';
  const demoPassword = process.env.SEED_DEMO_PASSWORD;
  if (demoEnabled && !demoPassword) {
    console.error('SEED_DEMO_PASSWORD e obrigatoria quando SEED_DEMO=true.');
    process.exit(1);
  }

  const handle = createNeonDatabase(url);
  try {
    const result = await seedDatabase(handle.db, {
      platformAdmin: adminEmail && adminPassword ? { email: adminEmail, password: adminPassword } : null,
      demo: demoEnabled && demoPassword ? { email: demoEmail, password: demoPassword } : null,
      log: (message) => console.log(message),
    });
    console.log(
      `Seed concluido. Planos: ${result.plans}; admin: ${result.platformAdminId ? 'sim' : 'nao'}; `
        + `demo: ${result.demoTenantId ? 'sim' : 'nao'}.`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('Falha no seed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
