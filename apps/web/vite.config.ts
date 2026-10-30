import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Durante o desenvolvimento, a propria API e o renderizador dos sites publicos
 * rodam dentro do servidor do Vite. Assim `pnpm dev` sobe a plataforma inteira,
 * sem precisar de um segundo processo.
 *
 * O roteamento segue o mesmo criterio da producao: `/api/*` vai para a API;
 * hosts que nao pertencem a plataforma (por exemplo `minha-construtora.localhost`)
 * recebem o site publico renderizado no servidor; o restante recebe o painel.
 */
function codecaDevServer(env: Record<string, string>): Plugin {
  return {
    name: 'codeca-dev-server',
    apply: 'serve',
    async configureServer(server: ViteDevServer) {
      if (!env.DATABASE_URL) {
        server.config.logger.warn(
          '\n[codeca] DATABASE_URL nao definida: a API nao sera iniciada no modo de desenvolvimento.\n'
            + '          Copie .env.example para .env e informe a conexao do Neon.\n',
        );
        return;
      }

      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }

      const { getRequestListener } = await import('@hono/node-server');
      const apiModule = (await server.ssrLoadModule(resolvePath('../api/src/index.ts'))) as typeof import('@codeca/api');

      const context = apiModule.createContext();
      const apiListener = getRequestListener(apiModule.createApp({ context }).fetch);

      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '/').startsWith('/api/')) {
          apiListener(req, res);
          return;
        }
        next();
      });

      server.config.logger.info('\n  [codeca] API em /api ativa neste servidor.\n');
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolvePath('../..'), '');

  return {
    plugins: [react(), tailwindcss(), codecaDevServer(env)],
    resolve: {
      alias: {
        // Os pacotes internos sao consumidos a partir do codigo-fonte, o que
        // mantem o recarregamento rapido e evita artefatos desatualizados.
        '@codeca/shared': resolvePath('../../packages/shared/src/index.ts'),
        '@codeca/ui': resolvePath('../../packages/ui/src/index.ts'),
        '@codeca/site-renderer': resolvePath('../../packages/site-renderer/src/index.ts'),
        '@': resolvePath('./src'),
      },
    },
    server: {
      port: 5173,
      host: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            // O renderizador e o motor de arrastar ficam fora do carregamento
            // inicial do painel: so o editor depende deles.
            editor: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/modifiers'],
            vendor: ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
  };
});
