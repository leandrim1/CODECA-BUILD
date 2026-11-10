/**
 * Validador da integracao com a ValidaPay contra a API de VERDADE.
 *
 * ## Por que existe
 *
 * Os testes de cobranca substituem a rede: provam a assinatura HMAC, a
 * deduplicacao, a ordem dos eventos e o efeito de cada um na assinatura. O que
 * eles nao podem provar e se ESTA instalacao tem credencial valida, com os
 * escopos certos, apontando para o ambiente certo -- e se o webhook cadastrado
 * no painel da ValidaPay alcanca a nossa rota e passa pela verificacao de
 * assinatura. Isso so a propria ValidaPay responde.
 *
 * ## Como usar
 *
 *   VALIDAPAY_CLIENT_ID=... VALIDAPAY_CLIENT_SECRET=... \
 *   VALIDAPAY_BASE_URL=https://sandbox.validapay.com.br \
 *     node scripts/validate/validapay.mjs
 *
 * Comece pelo SANDBOX. Com a credencial de producao, nada aqui cria cobranca
 * nem assinatura: a checagem padrao e so a troca de credencial por token.
 *
 * Para disparar uma entrega de teste ate a nossa rota (exige o id do webhook,
 * que aparece no painel da ValidaPay):
 *
 *   ... node scripts/validate/validapay.mjs --webhook uwh_123 --evento subscription.created
 *
 * Com `--webhook`, a ValidaPay assina a entrega igual a uma real -- e e isso
 * que valida a verificacao de assinatura de ponta a ponta. Depois, confira a
 * lista de eventos em Plataforma > Cobranca.
 *
 * Sai com 0 quando tudo que foi pedido passou, e 1 quando nao. Nem o segredo
 * nem o token sao impressos.
 */

const HOSTS = {
  'https://api.validapay.com.br': 'https://oauth2.validapay.com.br',
  'https://sandbox.validapay.com.br': 'https://oauth2-sandbox.validapay.com.br',
};
const TIMEOUT_MS = 15_000;

const clientId = process.env.VALIDAPAY_CLIENT_ID?.trim();
const clientSecret = process.env.VALIDAPAY_CLIENT_SECRET?.trim();
const baseUrl = (process.env.VALIDAPAY_BASE_URL ?? 'https://api.validapay.com.br').replace(/\/$/, '');
const authUrl = (process.env.VALIDAPAY_AUTH_URL ?? HOSTS[baseUrl] ?? '').replace(/\/$/, '');

const argumentos = process.argv.slice(2);
const valorDe = (nome) => {
  const i = argumentos.indexOf(nome);
  return i >= 0 ? argumentos[i + 1] : undefined;
};
const webhookId = valorDe('--webhook');
const evento = valorDe('--evento') ?? 'subscription.created';

const problemas = [];
const avisos = [];
const linha = (simbolo, texto) => console.log(`${simbolo} ${texto}`);

if (!clientId || !clientSecret) {
  linha('x', 'VALIDAPAY_CLIENT_ID e VALIDAPAY_CLIENT_SECRET são obrigatórios. Nada a validar.');
  process.exit(1);
}
if (!authUrl) {
  linha('x', `VALIDAPAY_BASE_URL aponta para ${baseUrl}: defina também VALIDAPAY_AUTH_URL.`);
  process.exit(1);
}

const ambiente =
  baseUrl === 'https://sandbox.validapay.com.br'
    ? 'sandbox'
    : baseUrl === 'https://api.validapay.com.br'
      ? 'PRODUÇÃO'
      : 'personalizado';
linha('-', `API: ${baseUrl} (${ambiente})`);
linha('-', `OAuth2: ${authUrl}`);

/** Troca a credencial por um token do escopo pedido. */
async function token(scope) {
  const corpo = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });
  const response = await fetch(`${authUrl}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: corpo.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    // O corpo pode ecoar a credencial enviada: nunca imprimir.
    throw new Error(`o provedor respondeu ${response.status} ao emitir o token do escopo ${scope}`);
  }
  const dados = await response.json();
  if (!dados.access_token) throw new Error('a resposta do OAuth2 não trouxe access_token');
  return dados.access_token;
}

// 1. A credencial vale, e com os escopos que a plataforma usa? ---------------
const ESCOPOS = ['products/write', 'checkouts/write', 'checkouts/read', 'subscriptions/read'];
const concedidos = [];
for (const escopo of ESCOPOS) {
  try {
    await token(escopo);
    concedidos.push(escopo);
    linha('ok', `Escopo ${escopo}: concedido.`);
  } catch (erro) {
    problemas.push(`Escopo ${escopo}: ${erro?.message ?? erro}`);
  }
}

// 2. Entrega de teste ate a nossa rota ---------------------------------------
if (!webhookId) {
  avisos.push(
    'Nenhuma entrega de teste foi disparada. Passe --webhook <id do webhook no painel da ValidaPay> '
      + 'para validar a verificação de assinatura de ponta a ponta.',
  );
} else if (concedidos.length === 0) {
  avisos.push('Entrega de teste não tentada: a credencial não foi aceita.');
} else {
  try {
    const acesso = await token('subscriptions/read');
    const response = await fetch(`${baseUrl}/v1/users/webhooks/test`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${acesso}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ webhookId, entity: evento }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const texto = await response.text();
    if (response.ok) {
      linha('ok', `Entrega de teste de "${evento}" enviada ao webhook ${webhookId}.`);
      avisos.push(
        'A ValidaPay aceitou o disparo. Confira agora em Plataforma > Cobrança se o evento aparece '
          + 'na lista: se aparecer, a assinatura foi verificada e o corpo foi gravado. '
          + 'O corpo de teste é fictício e pode diferir do de produção.',
      );
    } else {
      problemas.push(`A rota de teste respondeu ${response.status}: ${texto.slice(0, 300)}`);
    }
  } catch (erro) {
    problemas.push(`Falha ao disparar a entrega de teste: ${erro?.message ?? erro}`);
  }
}

// Veredito -------------------------------------------------------------------
console.log('');
for (const aviso of avisos) linha('!', aviso);
if (problemas.length > 0) {
  for (const problema of problemas) linha('x', problema);
  console.log('');
  linha('x', 'A integração com a ValidaPay NÃO está pronta nesta configuração.');
  process.exit(1);
}
linha('ok', webhookId ? 'Credencial e entrega de teste validadas.' : 'Credencial validada (sem entrega de teste).');
