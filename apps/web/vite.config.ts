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

/**
 * Endereco publico do site, quando ele e conhecido.
 *
 * Tags como `og:image`, o canonico e o mapa do site exigem URL **absoluta**, e
 * escreve-la a mao seria apontar para um dominio que pode nao ser o real.
 * Entao vem do ambiente: `SITE_URL`, se alguem a definir, ou o dominio de
 * producao que a Vercel informa no build. Sem nenhum dos dois, essas tags
 * simplesmente nao sao emitidas -- melhor do que emitir uma errada.
 */
function enderecoPublico(env: Record<string, string>): string | null {
  const explicito = env.SITE_URL?.trim();
  if (explicito) return explicito.replace(/\/+$/, '');
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  return null;
}

/**
 * Metadados dependentes do endereco publico, mais `robots.txt` e `sitemap.xml`.
 *
 * O painel e a API ficam fora dos mecanismos de busca; a pagina inicial e as
 * paginas legais ficam dentro.
 */
function codecaSeo(env: Record<string, string>): Plugin {
  const site = enderecoPublico(env);
  const paginas = ['/', '/termos', '/privacidade'];

  return {
    name: 'codeca-seo',
    transformIndexHtml(html) {
      const tags = site
        ? [
            `<link rel="canonical" href="${site}/" />`,
            `<meta property="og:url" content="${site}/" />`,
            `<meta property="og:image" content="${site}/og-image.jpg" />`,
            '<meta property="og:image:width" content="1200" />',
            '<meta property="og:image:height" content="630" />',
            `<meta name="twitter:image" content="${site}/og-image.jpg" />`,
          ].join('\n    ')
        : '';
      return html.replace('<!--codeca:seo-url-->', tags);
    },
    generateBundle() {
      const robots = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /painel',
        'Disallow: /plataforma',
        'Disallow: /api/',
        ...(site ? ['', `Sitemap: ${site}/sitemap.xml`] : []),
        '',
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });

      if (site) {
        const itens = paginas.map((p) => `  <url><loc>${site}${p === '/' ? '/' : p}</loc></url>`).join('\n');
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${itens}\n</urlset>\n`;
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: xml });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolvePath('../..'), '');

  return {
    plugins: [react(), tailwindcss(), codecaSeo({ ...env, ...(process.env as Record<string, string>) }), codecaDevServer(env)],
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
