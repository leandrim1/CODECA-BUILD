/**
 * O caminho da demonstracao, num navegador de verdade.
 *
 * ## O que ela responde
 *
 * O criterio de sucesso da Fase 3, passo a passo: uma pessoa que nunca viu a
 * plataforma consegue criar a conta, achar o site de demonstracao, saber onde
 * editar, fazer uma alteracao, ve-la no site e entender como ter o site de
 * verdade -- lendo so o que a tela diz?
 *
 * Como `onboarding.mjs`, cada passo so e `ok` se a pessoa conseguiria faze-lo
 * a partir do que esta escrito na tela. Nenhuma rota e digitada a mao, exceto
 * a pagina inicial.
 *
 * ## Como rodar
 *
 *   # com o servidor de conferencia visual no ar (porta 4010)
 *   node scripts/audit/demonstracao.mjs
 *
 * Sai com 0 quando o caminho inteiro e percorrivel, e 1 quando trava.
 *
 * Isto prova o fluxo no ambiente local. Nao prova nada sobre producao.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:4010';
const SAIDA = process.env.AUDIT_OUT ?? '/tmp/demonstracao';
mkdirSync(SAIDA, { recursive: true });

const carimbo = Date.now();
const EMAIL = `padaria.${carimbo}@exemplo.com.br`;
const EMPRESA = `Padaria Central ${String(carimbo).slice(-4)}`;
const NOVO_TITULO = `Pão francês quentinho ${String(carimbo).slice(-4)}`;

const passos = [];
const erros = [];
const registrar = (nome, veredito, detalhe = '') => {
  passos.push({ nome, veredito, detalhe });
  console.log(`${veredito === 'ok' ? 'ok' : ' x'}  ${nome}${detalhe ? ` -- ${detalhe}` : ''}`);
};

const navegador = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexto = await navegador.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const pagina = await contexto.newPage();
pagina.on('response', (r) => {
  if (r.status() >= 500) erros.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
});
pagina.on('pageerror', (e) => erros.push(`erro de pagina: ${String(e).slice(0, 160)}`));
const capturar = (nome, alvo = pagina) => alvo.screenshot({ path: `${SAIDA}/${nome}.png`, fullPage: true });

try {
  // 1. criar a conta
  await pagina.goto(`${BASE}/criar-conta`, { waitUntil: 'domcontentloaded' });
  await pagina.getByLabel('Nome da empresa').fill(EMPRESA);
  await pagina.getByLabel('Seu nome').fill('Marina da Padaria');
  await pagina.getByLabel('E-mail').fill(EMAIL);
  await pagina.getByLabel('Telefone').fill('(41) 99999-0000');
  await pagina.getByLabel('Senha').fill('senhaSegura123');
  await pagina.getByRole('checkbox').check();
  await pagina.getByRole('button', { name: 'Criar conta' }).click();
  await pagina.waitForURL(/\/painel/, { timeout: 20_000 }).catch(() => undefined);
  registrar('1. Criar uma conta', pagina.url().includes('/painel') ? 'ok' : 'falha', new URL(pagina.url()).pathname);

  // 2 e 3. entrar no painel e encontrar o site de demonstracao ja conectado
  const cartao = pagina.getByText('Seu ambiente de demonstração está pronto!');
  await cartao.waitFor({ timeout: 15_000 }).catch(() => undefined);
  const botaoSite = pagina.getByRole('link', { name: /ver meu site de demonstração/i });
  const achou = (await cartao.count()) > 0 && (await botaoSite.count()) > 0;
  await capturar('1-boas-vindas');
  registrar('2. Entrar no painel', 'ok');
  registrar('3. Encontrar o site de demonstração já conectado', achou ? 'ok' : 'falha');

  // 4. identificar onde editar
  const tela = await pagina.evaluate(() => document.body.innerText);
  const dizOnde = /Edite um conteúdo/.test(tela) && /Serviços/.test(tela);
  const dizPrazo = /avaliação gratuita vai até daqui a 14 dias|avaliação gratuita vai até daqui a 13 dias/.test(tela);
  const dizProximo = /Quando quiser o seu site de verdade/.test(tela) && /Essencial/.test(tela);
  registrar('4. Identificar onde editar os conteúdos', dizOnde ? 'ok' : 'falha');
  registrar('   A tela informa a duração da avaliação', dizPrazo ? 'ok' : 'falha');

  // abrir o site ANTES de editar
  const [site] = await Promise.all([contexto.waitForEvent('page'), botaoSite.click()]);
  await site.waitForLoadState('domcontentloaded');
  await site.getByText('Site de demonstração.').waitFor({ timeout: 15_000 }).catch(() => undefined);
  await site.getByRole('heading', { name: 'Serviço de exemplo', exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  const antes = await site.evaluate(() => document.body.innerText);
  await capturar('2-site-antes', site);
  registrar(
    '   O site abre com o conteúdo de exemplo e a faixa de demonstração',
    /Site de demonstração\./.test(antes) && /Serviço de exemplo/.test(antes) && antes.includes(EMPRESA) ? 'ok' : 'falha',
  );

  // 5. fazer uma alteracao, pelo caminho que o cartao indica
  await pagina.bringToFront();
  await pagina.getByRole('link', { name: 'Serviços', exact: true }).first().click();
  await pagina.waitForURL(/\/painel\/servicos/, { timeout: 10_000 });
  const linha = pagina.locator('li, tr, article, div').filter({ hasText: /^Serviço de exemplo/ }).first();
  await pagina.getByText('Serviço de exemplo', { exact: true }).first().waitFor({ timeout: 15_000 });
  void linha;
  await pagina.getByRole('button', { name: 'Editar' }).first().click();
  const campo = pagina.getByLabel('Nome do serviço');
  await campo.waitFor({ timeout: 10_000 });
  const eraOExemplo = (await campo.inputValue()) !== '';
  await campo.fill(NOVO_TITULO);
  await capturar('3-editando');
  await pagina.getByRole('button', { name: 'Salvar' }).click();
  await pagina.getByText(NOVO_TITULO).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  const salvou = (await pagina.getByText(NOVO_TITULO).count()) > 0;
  registrar('5. Fazer uma alteração', salvou && eraOExemplo ? 'ok' : 'falha', NOVO_TITULO);

  // 6. ver a alteracao no site
  await site.bringToFront();
  await site.getByRole('button', { name: /atualizar/i }).click();
  await site.getByText(NOVO_TITULO).waitFor({ timeout: 15_000 }).catch(() => undefined);
  const depois = await site.evaluate(() => document.body.innerText);
  await capturar('4-site-depois', site);
  registrar('6. Visualizar a alteração no site', depois.includes(NOVO_TITULO) ? 'ok' : 'falha');

  // 7. entender como iniciar o projeto real
  registrar('7. Entender como iniciar o projeto real', dizProximo ? 'ok' : 'falha');

  // de celular, o site continua legivel
  const celular = await navegador.newContext({ locale: 'pt-BR', viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  const movel = await celular.newPage();
  await movel.goto(site.url(), { waitUntil: 'domcontentloaded' });
  await movel.getByText(NOVO_TITULO).waitFor({ timeout: 15_000 }).catch(() => undefined);
  const transborda = await movel.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await movel.screenshot({ path: `${SAIDA}/5-site-celular.png`, fullPage: true });
  registrar('   O site cabe na tela de um celular', transborda ? 'falha' : 'ok');
} catch (erro) {
  registrar('Roteiro interrompido', 'falha', String(erro).slice(0, 200));
  await capturar('erro').catch(() => undefined);
} finally {
  await navegador.close();
}

if (erros.length > 0) console.log(`\nErros observados:\n${[...new Set(erros)].join('\n')}`);
const falhas = passos.filter((p) => p.veredito !== 'ok');
console.log(`\n${passos.length - falhas.length} de ${passos.length} passos percorridos. Capturas em ${SAIDA}`);
process.exit(falhas.length > 0 || erros.length > 0 ? 1 : 0);
