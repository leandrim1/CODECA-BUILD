/**
 * Simulacao do onboarding de quem NUNCA viu a plataforma.
 *
 * ## O que ela responde
 *
 * "Uma agencia consegue criar uma conta, cadastrar a empresa e importar um
 * site sozinha?" -- a pergunta do item 7 do plano, e a unica forma honesta de
 * responde-la e percorrendo o caminho como essa pessoa percorreria: a partir
 * da pagina inicial, sem atalho, sem conhecer rota, lendo so o que a tela diz.
 *
 * ## Como ela julga
 *
 * Cada passo registra um veredito e, quando falha, uma captura. Um passo so e
 * `ok` se a pessoa conseguiria faze-lo **lendo a tela**: um botao que existe
 * mas nao e alcancavel a partir de onde ela esta conta como obstaculo, nao
 * como sucesso.
 *
 * ## Como rodar
 *
 *   # com o servidor de conferencia visual no ar (porta 4010)
 *   node scripts/audit/onboarding.mjs
 *
 * Sai com 0 quando o caminho inteiro e percorrivel, e 1 quando trava.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:4010';
const SAIDA = process.env.AUDIT_OUT ?? '/tmp/onboarding';
mkdirSync(SAIDA, { recursive: true });

const SITE_PARA_IMPORTAR = process.env.ONBOARDING_SITE ?? 'https://clinicasorriso.com.br/';
const carimbo = Date.now();
const EMAIL = `agencia.${carimbo}@exemplo.com.br`;
const SENHA = 'senhaSegura123';
const EMPRESA = `Agência Teste ${carimbo}`;

const passos = [];
const erros = { console: [], rede: [] };

function registrar(nome, veredito, detalhe = '') {
  passos.push({ nome, veredito, detalhe });
  const simbolo = veredito === 'ok' ? 'ok' : veredito === 'obstaculo' ? ' !' : ' x';
  console.log(`${simbolo}  ${nome}${detalhe ? ` -- ${detalhe}` : ''}`);
}

const navegador = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexto = await navegador.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 900 } });
const pagina = await contexto.newPage();

pagina.on('console', (m) => {
  if (m.type() === 'error') erros.console.push(m.text().slice(0, 200));
});
pagina.on('requestfailed', (r) => {
  const motivo = r.failure()?.errorText ?? '';
  if (!motivo.includes('ERR_ABORTED')) erros.rede.push(`${r.method()} ${r.url().slice(0, 120)}`);
});
pagina.on('response', (r) => {
  if (r.status() >= 500) erros.rede.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
});

const capturar = async (nome) => {
  await pagina.screenshot({ path: `${SAIDA}/${nome}.png`, fullPage: false });
};

/**
 * Tudo o que a pessoa realmente le na tela.
 *
 * `innerText` **nao** inclui o valor de campo de formulario, e o painel mostra
 * o conteudo importado dentro de `input` e `textarea`. Conferir so o texto
 * acusaria "a tela nao mostra nada" com a tela cheia -- foi o que aconteceu na
 * primeira versao deste roteiro.
 */
const textoDaTela = () =>
  pagina.evaluate(() => {
    const campos = Array.from(document.querySelectorAll('input, textarea'))
      .map((el) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : ''))
      .join('\n');
    return `${document.body.innerText}\n${campos}`;
  });

try {
  // ------------------------------------------------- 1. chegar e achar a porta
  await pagina.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pagina.waitForTimeout(800);
  const entradas = pagina.getByRole('link', { name: /criar conta|comec|começar|experimente|teste gr/i });
  const quantas = await entradas.count();
  if (quantas === 0) {
    registrar('Achar como criar conta na página inicial', 'falha', 'nenhum link de cadastro visível');
    await capturar('1-landing');
  } else {
    registrar('Achar como criar conta na página inicial', 'ok', `${quantas} chamada(s) para cadastro`);
    await entradas.first().click();
    await pagina.waitForURL(/criar-conta/, { timeout: 10_000 });
  }

  // ------------------------------------------------------------ 2. criar conta
  if (!pagina.url().includes('criar-conta')) {
    await pagina.goto(`${BASE}/criar-conta`, { waitUntil: 'domcontentloaded' });
  }
  await pagina.waitForTimeout(500);
  await pagina.getByLabel('Nome da empresa').fill(EMPRESA);
  await pagina.getByLabel('Seu nome').fill('Marina da Agência');
  await pagina.getByLabel('E-mail').fill(EMAIL);
  await pagina.getByLabel('Telefone').fill('(41) 99999-0000');
  await pagina.getByLabel('Senha').fill(SENHA);
  await pagina.getByRole('checkbox').check();
  await capturar('2-cadastro-preenchido');
  await pagina.getByRole('button', { name: 'Criar conta' }).click();

  await pagina.waitForURL(/painel|criar-empresa/, { timeout: 20_000 }).catch(() => undefined);
  await pagina.waitForTimeout(1500);
  if (/painel|criar-empresa/.test(pagina.url())) {
    registrar('Criar a conta e a empresa', 'ok', `caiu em ${new URL(pagina.url()).pathname}`);
  } else {
    registrar('Criar a conta e a empresa', 'falha', `ficou em ${pagina.url()}`);
    await capturar('2-cadastro-falhou');
  }

  // ------------------------------- 3. a primeira tela diz o que fazer primeiro?
  const textoPainel = await textoDaTela();
  const falaEmImportar = /importar/i.test(textoPainel);
  await capturar('3-primeira-tela');
  registrar(
    'A primeira tela indica o próximo passo',
    falaEmImportar ? 'ok' : 'obstaculo',
    falaEmImportar ? 'a palavra "importar" aparece na tela' : 'nada na tela sugere importar um site',
  );

  // --------------------------------------- 4. chegar na importacao pelo menu
  const linkImportar = pagina.getByRole('link', { name: /importar/i }).first();
  if ((await linkImportar.count()) > 0) {
    await linkImportar.click();
    await pagina.waitForTimeout(1200);
    registrar('Chegar na importação pelo menu', 'ok');
  } else {
    await pagina.goto(`${BASE}/painel/importar`, { waitUntil: 'domcontentloaded' });
    await pagina.waitForTimeout(1200);
    registrar('Chegar na importação pelo menu', 'obstaculo', 'sem link no menu; precisei digitar o endereço');
  }
  await capturar('4-importar-vazio');

  // ------------------------------------------------------- 5. analisar o site
  const campoUrl = pagina.locator('input[type="url"], input[name*="url" i], input[placeholder*="site" i]').first();
  if ((await campoUrl.count()) === 0) {
    registrar('Informar o endereço do site', 'falha', 'campo de endereço não encontrado');
    await capturar('5-sem-campo');
  } else {
    await campoUrl.fill(SITE_PARA_IMPORTAR);
    const analisar = pagina.getByRole('button', { name: /analisar/i }).first();
    const habilitado = (await analisar.count()) > 0 && (await analisar.isEnabled());
    if (!habilitado) {
      registrar('Iniciar a análise', 'falha', 'botão de analisar ausente ou desabilitado');
      await capturar('5-botao-travado');
    } else {
      await analisar.click();
      // A analise avanca em fatias; a tela consulta sozinha.
      let concluiu = false;
      for (let i = 0; i < 60; i += 1) {
        await pagina.waitForTimeout(1000);
        const texto = await textoDaTela();
        if (/revis|confirmar importa|encontramos/i.test(texto)) {
          concluiu = true;
          break;
        }
        if (/não foi possível|erro ao analisar|falhou/i.test(texto)) break;
      }
      await capturar('5-analise');
      registrar(
        'Analisar o site e ver o resultado',
        concluiu ? 'ok' : 'falha',
        concluiu ? '' : 'a análise não chegou à revisão em 60s',
      );

      // --------------------------------------------- 6. confirmar a importacao
      if (concluiu) {
        const confirmar = pagina.getByRole('button', { name: /importar/i }).first();
        if ((await confirmar.count()) > 0 && (await confirmar.isEnabled())) {
          await confirmar.click();
          await pagina.waitForTimeout(700);

          /*
           * A acao abre uma confirmacao antes de gravar -- e correto que
           * abra: a tela avisa quantos itens entram e que da para desfazer.
           * O roteiro tem que clicar DENTRO dela, senao conta como importado
           * algo que ficou parado no dialogo.
           */
          const dialogo = pagina.getByRole('dialog');
          if ((await dialogo.count()) > 0) {
            await capturar('6-confirmacao');
            await dialogo.getByRole('button', { name: /^importar$/i }).first().click();
          }

          await pagina.waitForTimeout(4000);
          const texto = await textoDaTela();
          const importou = /importad|desfazer|revertida/i.test(texto) && !/será|serão/i.test(texto);
          await capturar('6-importado');
          registrar(
            'Confirmar a importação',
            importou ? 'ok' : 'obstaculo',
            importou ? '' : 'a tela não confirma que o conteúdo foi gravado',
          );
        } else {
          registrar('Confirmar a importação', 'falha', 'botão de confirmar ausente ou desabilitado');
          await capturar('6-sem-confirmar');
        }
      }
    }
  }

  // ------------------------------------------- 7. encontrar o conteudo trazido
  await pagina.goto(`${BASE}/painel/institucional`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForTimeout(2000);
  const institucional = await textoDaTela();
  const temConteudo = /clínica|clinica|sorriso/i.test(institucional);
  await capturar('7-institucional');
  registrar(
    'Ver o conteúdo importado no painel',
    temConteudo ? 'ok' : 'obstaculo',
    temConteudo ? '' : 'a tela institucional não mostra o que foi importado',
  );
  // --------------------------- 8. o que ainda trava, e a tela avisa a tempo?
  await pagina.goto(`${BASE}/painel/plano`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForTimeout(2000);
  const plano = await textoDaTela();
  await capturar('8-plano');
  /*
   * A contratacao exige e-mail confirmado. O que se mede aqui nao e se o
   * bloqueio existe -- ele existe de proposito --, e sim se a tela AVISA antes
   * de a pessoa escolher plano e forma de pagamento e levar um erro no fim.
   */
  const avisaAntes = /confirme seu e-mail/i.test(plano);
  registrar(
    'A tela de plano avisa sobre o e-mail antes de a pessoa tentar contratar',
    avisaAntes ? 'ok' : 'obstaculo',
    avisaAntes ? '' : 'nada avisa; o erro só aparece depois de escolher o plano',
  );
} catch (erro) {
  registrar('Execução do roteiro', 'falha', erro?.message ?? String(erro));
  await capturar('erro');
} finally {
  await navegador.close();
}

// ------------------------------------------------------------------ veredito
console.log('');
if (erros.console.length > 0) {
  console.log(`!  ${erros.console.length} erro(s) de console: ${erros.console.slice(0, 3).join(' | ')}`);
}
if (erros.rede.length > 0) {
  console.log(`!  ${erros.rede.length} requisição(ões) com falha: ${erros.rede.slice(0, 3).join(' | ')}`);
}

const falhas = passos.filter((p) => p.veredito === 'falha');
const obstaculos = passos.filter((p) => p.veredito === 'obstaculo');
console.log(
  `passos: ${passos.length} | ok: ${passos.length - falhas.length - obstaculos.length}`
    + ` | obstáculos: ${obstaculos.length} | travou: ${falhas.length}`,
);
console.log(`capturas em ${SAIDA}`);
process.exit(falhas.length > 0 ? 1 : 0);
