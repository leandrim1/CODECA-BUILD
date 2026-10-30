import { Hono } from 'hono';
import { EnvError } from './env.js';
import { deploymentInfo } from './lib/deployment.js';

/**
 * Aplicacao de contingencia para ambiente mal configurado.
 *
 * O contexto da API e montado quando o modulo carrega. Se faltar uma variavel
 * obrigatoria, esse carregamento falha e a funcao da Vercel morre antes de
 * qualquer rota existir -- o navegador recebe a pagina de erro da plataforma,
 * sem corpo JSON, e o painel so consegue dizer "nao foi possivel concluir a
 * operacao". Quem opera fica sem pista nenhuma.
 *
 * Esta aplicacao assume o lugar da API nesse caso e responde com o envelope de
 * erro de sempre, nomeando exatamente o que falta. Sao **nomes** de variaveis e
 * mensagens de validacao, nunca valores: nenhum segredo e exposto.
 */

export function configurationIssues(error: unknown): string[] {
  if (error instanceof EnvError) return error.issues;
  return [error instanceof Error ? error.message : String(error)];
}

/** API indisponivel por configuracao: todo caminho responde 501 explicando. */
export function createConfigErrorApp(error: unknown, basePath = '/api') {
  const issues = configurationIssues(error);
  console.error(
    `[config] a API nao pode iniciar. Corrija as variaveis de ambiente:\n- ${issues.join('\n- ')}`,
  );

  const app = new Hono().basePath(basePath);

  // O health continua respondendo: e por ele que se descobre o que falta sem
  // precisar abrir os logs da Vercel.
  app.get('/health', (c) =>
    c.json(
      {
        data: {
          status: 'misconfigured',
          issues,
          // Aqui a identidade do deploy importa ainda mais: uma variavel
          // adicionada depois do ultimo build so vale no proximo deploy, e e
          // por este commit que se percebe que o build e antigo.
          deployment: deploymentInfo(),
          hint: 'Defina as variaveis no projeto da Vercel e faca um novo deploy.',
        },
      },
      503,
    ),
  );

  app.all('*', (c) =>
    c.json(
      {
        error: {
          code: 'integration_not_configured',
          message:
            'O servidor esta sem a configuracao necessaria para atender esta operacao. '
            + 'Consulte /api/health para ver o que falta.',
          details: { issues },
        },
      },
      501,
    ),
  );

  return app;
}

/**
 * Sites publicos com o servidor mal configurado.
 *
 * Aqui quem le e um visitante, nao quem opera: a pagina nao nomeia variavel
 * alguma. O detalhe fica no log do servidor.
 */
export function createSiteConfigErrorApp(error: unknown) {
  const issues = configurationIssues(error);
  console.error(
    `[config] o renderizador dos sites nao pode iniciar. Corrija as variaveis de ambiente:\n- ${issues.join('\n- ')}`,
  );

  const app = new Hono();
  app.all('*', (c) =>
    c.html(
      `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Site temporariamente indisponivel</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background:#f8fafc; color:#0f172a; }
  main { max-width:32rem; text-align:center; }
  h1 { font-size:1.25rem; margin:0 0 .5rem; }
  p { margin:0; color:#475569; line-height:1.6; }
</style>
</head>
<body>
  <main>
    <h1>Site temporariamente indisponivel</h1>
    <p>Estamos resolvendo um problema tecnico. Tente novamente em alguns instantes.</p>
  </main>
</body>
</html>`,
      503,
    ),
  );

  return app;
}
