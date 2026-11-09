/**
 * Varredura visual e funcional de todas as rotas do painel.
 *
 * ## O que ela procura
 *
 * Problemas que uma pessoa so acha abrindo pagina por pagina em cada
 * tamanho de tela -- e que por isso raramente sao achados:
 *
 * - **rolagem horizontal da pagina inteira**, o sintoma classico de texto
 *   longo sem quebra (URL, e-mail, endereco) empurrando o layout;
 * - **elementos que passam da borda** direita da janela;
 * - **erro no console** e **requisicao que falhou**, que denunciam pagina
 *   quebrada mesmo quando ela "parece" certa;
 * - **tela em branco**, quando a rota carrega mas nao renderiza nada.
 *
 * Ela nao julga estetica. Julga o que e mensuravel, e deixa o resto para os
 * olhos -- por isso guarda uma captura de cada falha.
 */
// O Playwright e CommonJS: por `import()` os exports caem em `default`
// quando o modulo e resolvido por caminho. Aceitar as duas formas evita
// depender de como a instalacao o expoe.
const PLAYWRIGHT = process.env.AUDIT_PLAYWRIGHT ?? 'playwright';
const pw = await import(PLAYWRIGHT);
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error(`Playwright nao encontrado em "${PLAYWRIGHT}".`);
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:4010';
const SAIDA = process.env.AUDIT_OUT ?? '/tmp/audit';
mkdirSync(SAIDA, { recursive: true });

const VIEWPORTS = [
  { nome: '1920', w: 1920, h: 1080 },
  { nome: '1600', w: 1600, h: 900 },
  { nome: '1366', w: 1366, h: 768 },
  { nome: '1280', w: 1280, h: 720 },
  { nome: '1024', w: 1024, h: 768 },
  { nome: '768', w: 768, h: 1024 },
  { nome: '430', w: 430, h: 932 },
  { nome: '390', w: 390, h: 844 },
  { nome: '360', w: 360, h: 800 },
];

const PUBLICAS = ['/', '/termos', '/privacidade'];
const AUTENTICACAO = [
  '/entrar', '/criar-conta', '/recuperar-senha', '/redefinir-senha',
  '/confirmar-email', '/aceitar-convite', '/criar-empresa',
];
const PAINEL = [
  '/painel', '/painel/midia', '/painel/importar', '/painel/sincronizacao',
  '/painel/institucional', '/painel/contato', '/painel/banners', '/painel/imoveis',
  '/painel/obras', '/painel/servicos', '/painel/produtos', '/painel/categorias',
  '/painel/galerias', '/painel/depoimentos', '/painel/equipe', '/painel/perguntas',
  '/painel/interessados', '/painel/estatisticas', '/painel/dominio', '/painel/usuarios',
  '/painel/plano', '/painel/empresa',
];
const PLATAFORMA = [
  '/plataforma', '/plataforma/empresas', '/plataforma/sites', '/plataforma/segmentos',
  '/plataforma/planos', '/plataforma/cobranca', '/plataforma/dominios',
  '/plataforma/suporte', '/plataforma/auditoria',
];
const OUTRAS = ['/rota-que-nao-existe'];

const ROTAS = [...PUBLICAS, ...AUTENTICACAO, ...PAINEL, ...PLATAFORMA, ...OUTRAS];

const navegador = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexto = await navegador.newContext({ locale: 'pt-BR' });

// Entra uma vez: o cookie vale para todas as rotas protegidas.
const entrada = await contexto.newPage();
await entrada.goto(`${BASE}/__entrar`, { waitUntil: 'domcontentloaded' });
await entrada.close();

const achados = [];
let verificadas = 0;

for (const rota of ROTAS) {
  for (const vp of VIEWPORTS) {
    const pagina = await contexto.newPage();
    await pagina.setViewportSize({ width: vp.w, height: vp.h });

    const consoleErros = [];
    const redeErros = [];
    pagina.on('console', (m) => {
      if (m.type() === 'error') consoleErros.push(m.text().slice(0, 300));
    });
    pagina.on('requestfailed', (r) => {
      const motivo = r.failure()?.errorText ?? '';
      // Cancelamento proprio da navegacao nao e falha da pagina.
      if (motivo.includes('ERR_ABORTED')) return;
      redeErros.push(`${r.method()} ${r.url().slice(0, 160)} (${motivo})`);
    });
    pagina.on('response', (r) => {
      if (r.status() >= 500) redeErros.push(`HTTP ${r.status()} ${r.url().slice(0, 160)}`);
    });

    try {
      await pagina.goto(`${BASE}${rota}`, { waitUntil: 'networkidle', timeout: 25_000 });
      await pagina.waitForTimeout(350);

      const medida = await pagina.evaluate(() => {
        const de = document.documentElement;
        const largura = de.clientWidth;
        const transborda = de.scrollWidth > largura + 1;

        /** Elementos que passam da borda direita, ignorando os que rolam de propósito. */
        const fora = [];
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right <= largura + 1) continue;
          // Um ancestral com rolagem propria torna o transbordo intencional.
          let pai = el.parentElement;
          let dentroDeRolagem = false;
          while (pai) {
            const ov = getComputedStyle(pai).overflowX;
            if (ov === 'auto' || ov === 'scroll') { dentroDeRolagem = true; break; }
            pai = pai.parentElement;
          }
          if (dentroDeRolagem) continue;
          fora.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''} (${Math.round(r.right - largura)}px)`);
          if (fora.length >= 5) break;
        }

        const texto = (document.body.innerText ?? '').trim();
        return { transborda, excesso: de.scrollWidth - largura, fora, vazia: texto.length < 20 };
      });

      const problemas = [];
      if (medida.transborda) problemas.push(`rolagem horizontal (+${medida.excesso}px)`);
      if (medida.fora.length > 0) problemas.push(`fora da viewport: ${medida.fora.join('; ')}`);
      if (medida.vazia) problemas.push('página sem conteúdo visível');
      if (consoleErros.length > 0) problemas.push(`console: ${consoleErros.slice(0, 2).join(' | ')}`);
      if (redeErros.length > 0) problemas.push(`rede: ${redeErros.slice(0, 2).join(' | ')}`);

      if (problemas.length > 0) {
        const arquivo = `${SAIDA}/${rota.replace(/\//g, '_') || '_raiz'}@${vp.nome}.png`;
        await pagina.screenshot({ path: arquivo, fullPage: false });
        achados.push({ rota, vp: vp.nome, problemas, captura: arquivo });
      }
    } catch (erro) {
      achados.push({ rota, vp: vp.nome, problemas: [`não carregou: ${String(erro).slice(0, 160)}`] });
    }

    verificadas += 1;
    await pagina.close();
  }
}

await contexto.close();
await navegador.close();

writeFileSync(`${SAIDA}/achados.json`, JSON.stringify(achados, null, 2));
console.log(`rotas: ${ROTAS.length} | combinações verificadas: ${verificadas} | com problema: ${achados.length}`);

const porRota = new Map();
for (const a of achados) {
  const atual = porRota.get(a.rota) ?? [];
  atual.push(a);
  porRota.set(a.rota, atual);
}
for (const [rota, lista] of [...porRota.entries()].sort()) {
  console.log(`\n### ${rota}  (${lista.length} resoluções)`);
  const vistos = new Set();
  for (const a of lista) {
    for (const p of a.problemas) {
      const chave = p.slice(0, 90);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      console.log(`  [${a.vp}] ${p}`);
    }
  }
}
