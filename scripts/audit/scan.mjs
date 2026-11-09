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

/**
 * `AUDIT_ROUTES` limita a varredura a rotas especificas (separadas por virgula),
 * para reconferir so o que mudou sem pagar as 378 combinacoes inteiras.
 */
const ROTAS = process.env.AUDIT_ROUTES
  ? process.env.AUDIT_ROUTES.split(',').map((rota) => rota.trim()).filter(Boolean)
  : [...PUBLICAS, ...AUTENTICACAO, ...PAINEL, ...PLATAFORMA, ...OUTRAS];

const navegador = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexto = await navegador.newContext({ locale: 'pt-BR' });

/**
 * Duas sessoes, trocadas conforme a rota.
 *
 * As telas `/plataforma/*` exigem o papel de administrador da plataforma. Com a
 * conta do cliente elas respondem "Area restrita" -- e a varredura aprovaria
 * nove rotas sem nunca ter visto o conteudo delas.
 */
let papelAtual = null;
async function entrarComo(papel) {
  if (papelAtual === papel) return;
  const entrada = await contexto.newPage();
  const alvo = papel === 'plataforma' ? `${BASE}/__entrar?plataforma=1` : `${BASE}/__entrar`;
  await entrada.goto(alvo, { waitUntil: 'domcontentloaded' });
  await entrada.close();
  papelAtual = papel;
}

const papelDaRota = (rota) => (rota.startsWith('/plataforma') ? 'plataforma' : 'cliente');

const achados = [];
let verificadas = 0;

for (const rota of ROTAS) {
  await entrarComo(papelDaRota(rota));
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
      /**
       * `domcontentloaded`, e nao `networkidle`.
       *
       * O painel faz polling -- a tela de importacao consulta o progresso de
       * tempo em tempo -- e uma pagina que consulta sozinha **nunca** fica
       * ociosa. Com `networkidle` cada uma dessas gastava os 25 s inteiros do
       * timeout, e a varredura das 396 combinacoes nao terminava em tempo
       * nenhum. Aqui basta o DOM pronto mais uma pausa curta para o React
       * montar e o primeiro carregamento de dados chegar.
       */
      await pagina.goto(`${BASE}${rota}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await pagina.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
      await pagina.waitForTimeout(900);

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
          /**
           * Transbordo que um ancestral resolve nao e problema.
           *
           * Duas formas, e a segunda custou um falso positivo em todas as
           * paginas publicas: um ancestral que **rola** (`auto`/`scroll`),
           * como uma tabela larga de proposito; e um ancestral que
           * **recorta** (`hidden`/`clip`), que e como todo enfeite de fundo
           * -- aquele borrao com `pointer-events-none absolute` -- e mantido
           * maior que a tela sem vazar. Olhar so a rolagem acusava cada
           * enfeite como defeito, e a pagina nem tinha barra horizontal.
           */
          let pai = el.parentElement;
          let contido = false;
          while (pai) {
            const ov = getComputedStyle(pai).overflowX;
            if (ov === 'auto' || ov === 'scroll' || ov === 'hidden' || ov === 'clip') {
              contido = true;
              break;
            }
            pai = pai.parentElement;
          }
          if (contido) continue;
          fora.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''} (${Math.round(r.right - largura)}px)`);
          if (fora.length >= 5) break;
        }

        /**
         * Conteudo que transborda **por dentro** do proprio contêiner.
         *
         * Era o ponto cego do detector, e justamente o defeito mais comum:
         * um dominio ou uma URL sem espaco nao passa da borda da tela --
         * ela encolhe o elemento ate o limite e o texto vaza para dentro,
         * com `scrollWidth > clientWidth`. Olhar so a posicao da borda nao
         * via nada; a pagina rolava e o detector dizia que estava tudo bem.
         *
         * Reporta so a folha: o ancestral esticado e consequencia, nao causa.
         */
        /**
         * Um limiar, porque 2px nao e defeito.
         *
         * Layout fracionario arredonda: um `h3` com `scrollWidth` 2px maior
         * que o `clientWidth` e ruido de sub-pixel, nao texto cortado. Sem
         * limiar a lista vinha com 78 ocorrencias, quase todas de 2 a 6px, e
         * as poucas reais -- de 98px -- se perdiam no meio. 16px e cerca de
         * um caractere: abaixo disso ninguem ve.
         */
        const LIMIAR = 16;
        const vazando = [];
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          if (el.scrollWidth - el.clientWidth < LIMIAR) continue;
          if (el.clientWidth === 0) continue;
          /**
           * `hidden` e `clip` tambem sao contencao deliberada.
           *
           * Mesma licao que o detector de borda ja tinha aprendido, e que
           * esta checagem repetiu: quem recorta esta dizendo "contenho isto
           * de proposito". Sem o desvio, o atalho "Ir para o conteudo" --
           * que fica recortado ate receber foco -- e toda secao com enfeite
           * maior que ela apareciam como defeito.
           */
          /**
           * A contencao pode estar em **qualquer** ancestral.
           *
           * Quarta vez que o mesmo engano aparece, agora em tabela: uma
           * `td` nao declara overflow nenhum, mas o invólucro da tabela rola
           * -- que e o caso que o proprio pedido excetua ("tabelas
           * extensas"). Olhar so o elemento acusava 521px de transbordo numa
           * tabela que funciona exatamente como projetada.
           *
           * O detector de borda ja subia a arvore; este nao subia. Agora os
           * dois fazem a mesma pergunta: alguem acima resolve isto?
           */
          let contido = false;
          for (let no = el; no !== null; no = no.parentElement) {
            const ov = getComputedStyle(no).overflowX;
            if (ov === 'auto' || ov === 'scroll' || ov === 'hidden' || ov === 'clip') {
              contido = true;
              break;
            }
          }
          if (contido) continue;
          if (Array.from(el.children).some((f) => f.scrollWidth - f.clientWidth >= LIMIAR)) continue;
          /**
           * Rolador intencional dentro, ou sangria ate a borda.
           *
           * A faixa de abas da landing rola de proposito (`overflow-x-auto`)
           * e usa margem negativa para sangrar alem do pai. O pai, que nao
           * declara overflow nenhum, aparecia transbordando -- mas quem
           * decide ali e o filho, e a pagina nao rola. Terceiro caso da
           * mesma familia: conter de proposito nao e defeito.
           */
          if (
            Array.from(el.children).some((f) => {
              const ov = getComputedStyle(f).overflowX;
              return ov === 'auto' || ov === 'scroll';
            })
          ) continue;
          const trecho = (el.textContent ?? '').trim().slice(0, 45);
          vazando.push(`${el.tagName.toLowerCase()} +${el.scrollWidth - el.clientWidth}px "${trecho}"`);
          if (vazando.length >= 3) break;
        }

        const texto = (document.body.innerText ?? '').trim();
        return { transborda, excesso: de.scrollWidth - largura, fora, vazando, vazia: texto.length < 20 };
      });

      const problemas = [];
      if (medida.transborda) problemas.push(`rolagem horizontal (+${medida.excesso}px)`);
      if (medida.fora.length > 0) problemas.push(`fora da viewport: ${medida.fora.join('; ')}`);
      if (medida.vazando.length > 0) problemas.push(`texto sem quebra: ${medida.vazando.join('; ')}`);
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

  /**
   * Progresso por rota, e gravacao a cada rota.
   *
   * A primeira versao so imprimia no fim. Quando a varredura foi interrompida
   * pelo tempo, nao sobrou **nada** -- nem os achados das rotas ja
   * percorridas. Resultado parcial vale muito mais que resultado nenhum.
   */
  const comProblema = achados.filter((a) => a.rota === rota).length;
  console.log(`[${String(verificadas).padStart(3)}/${ROTAS.length * VIEWPORTS.length}] ${rota} -- ${comProblema > 0 ? `${comProblema} com problema` : 'ok'}`);
  writeFileSync(`${SAIDA}/achados.json`, JSON.stringify(achados, null, 2));
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
