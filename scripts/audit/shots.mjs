/**
 * Capturas das telas que precisam de olho humano.
 *
 * A varredura automatica mede o que da para medir: rolagem horizontal,
 * elemento fora da borda, erro de console. Ela **nao** ve desalinhamento,
 * espacamento irregular nem card com altura esquisita -- e foi justamente
 * isso que motivou a auditoria.
 *
 * Entao: pagina inteira, nas larguras em que os problemas costumam
 * aparecer, para serem olhadas uma a uma.
 */
const PLAYWRIGHT = process.env.AUDIT_PLAYWRIGHT ?? 'playwright';
const pw = await import(PLAYWRIGHT);
const chromium = pw.chromium ?? pw.default?.chromium;

import { mkdirSync } from 'node:fs';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:4010';
const SAIDA = process.env.AUDIT_SHOTS ?? '/tmp/shots';
mkdirSync(SAIDA, { recursive: true });

const ROTAS = (process.env.AUDIT_ROTAS ?? '/painel/contato,/painel/banners,/painel/dominio')
  .split(',')
  .map((r) => r.trim())
  .filter((r) => r !== '');

const LARGURAS = (process.env.AUDIT_LARGURAS ?? '1366,768,390')
  .split(',')
  .map((n) => Number(n.trim()));

const navegador = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexto = await navegador.newContext({ locale: 'pt-BR', deviceScaleFactor: 2 });

const entrada = await contexto.newPage();
await entrada.goto(`${BASE}/__entrar`, { waitUntil: 'domcontentloaded' });
await entrada.close();

for (const rota of ROTAS) {
  for (const largura of LARGURAS) {
    const pagina = await contexto.newPage();
    await pagina.setViewportSize({ width: largura, height: largura < 500 ? 844 : 900 });
    await pagina.goto(`${BASE}${rota}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await pagina.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
    await pagina.waitForTimeout(1200);
    const arquivo = `${SAIDA}/${rota.replace(/\//g, '_')}@${largura}.png`;
    await pagina.screenshot({ path: arquivo, fullPage: true });
    console.log(arquivo);
    await pagina.close();
  }
}

await contexto.close();
await navegador.close();
