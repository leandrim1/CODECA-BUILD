/**
 * Validador do envio de e-mail contra o provedor de VERDADE.
 *
 * ## Por que existe
 *
 * Os testes automatizados do envio substituem a rede: eles provam o prazo, o
 * disjuntor e o tratamento de erro, mas nao provam que a chave desta instalacao
 * vale, nem que o dominio do remetente esta verificado. Essas duas coisas so o
 * provedor responde -- e sao justamente as que fazem "o e-mail nao chega" em
 * producao.
 *
 * ## Como usar
 *
 *   RESEND_API_KEY=... MAIL_FROM='CODECA Build <nao-responda@seu-dominio>' \
 *     node scripts/validate/email.mjs
 *
 * Acrescente um destinatario para enviar uma mensagem de teste de verdade:
 *
 *   ... node scripts/validate/email.mjs voce@seu-dominio.com
 *
 * Sem destinatario nada e enviado: so a leitura dos dominios.
 *
 * Sai com codigo 0 quando tudo que foi pedido passou, e 1 quando nao.
 * A chave nunca e impressa.
 */

const API = 'https://api.resend.com';
const TIMEOUT_MS = 10_000;

const apiKey = process.env.RESEND_API_KEY?.trim();
const from = process.env.MAIL_FROM?.trim();
const destino = process.argv[2]?.trim();

const problemas = [];
const avisos = [];

function linha(simbolo, texto) {
  console.log(`${simbolo} ${texto}`);
}

/** Dominio de `Nome <conta@dominio>` ou de `conta@dominio`. */
function dominioDoRemetente(valor) {
  const entre = valor.match(/<([^>]+)>/);
  const endereco = (entre?.[1] ?? valor).trim();
  return endereco.split('@')[1]?.trim().toLowerCase() ?? null;
}

async function pedir(caminho, init = {}) {
  const response = await fetch(`${API}${caminho}`, {
    ...init,
    headers: { authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const texto = await response.text();
  let corpo = null;
  try {
    corpo = texto.length > 0 ? JSON.parse(texto) : null;
  } catch {
    corpo = null;
  }
  return { status: response.status, ok: response.ok, corpo, texto };
}

if (!apiKey) {
  linha('x', 'RESEND_API_KEY não está definida. Nada a validar.');
  process.exit(1);
}
if (!from) {
  linha('x', 'MAIL_FROM não está definida: o provedor recusa envio sem remetente conhecido.');
  process.exit(1);
}

const dominio = dominioDoRemetente(from);
linha('-', `Remetente: ${from}`);
linha('-', `Domínio do remetente: ${dominio ?? '(não foi possível extrair)'}`);

// 1. A chave vale? -----------------------------------------------------------
let dominios = [];
try {
  const resposta = await pedir('/domains');
  if (resposta.status === 401 || resposta.status === 403) {
    problemas.push(`O provedor recusou a chave (${resposta.status}). Gere outra e atualize RESEND_API_KEY.`);
  } else if (!resposta.ok) {
    problemas.push(`O provedor respondeu ${resposta.status} ao listar domínios.`);
  } else {
    linha('ok', 'A chave foi aceita pelo provedor.');
    dominios = Array.isArray(resposta.corpo?.data) ? resposta.corpo.data : [];
  }
} catch (error) {
  problemas.push(
    error?.name === 'TimeoutError'
      ? `O provedor não respondeu em ${TIMEOUT_MS / 1000}s.`
      : `Não foi possível contatar o provedor: ${error?.message ?? error}`,
  );
}

// 2. O dominio do remetente esta verificado? ---------------------------------
if (problemas.length === 0) {
  if (dominios.length === 0) {
    problemas.push(
      'Nenhum domínio cadastrado no provedor. Sem domínio verificado o envio é recusado, '
        + 'exceto para o e-mail do dono da conta no provedor.',
    );
  } else {
    for (const item of dominios) {
      const verificado = String(item.status ?? '').toLowerCase() === 'verified';
      linha(verificado ? 'ok' : '!', `Domínio ${item.name}: ${item.status}`);
    }
    const remetente = dominios.find((item) => String(item.name).toLowerCase() === dominio);
    if (!remetente) {
      problemas.push(`O domínio ${dominio} não está cadastrado no provedor; o envio será recusado.`);
    } else if (String(remetente.status).toLowerCase() !== 'verified') {
      problemas.push(
        `O domínio ${dominio} está "${remetente.status}": conclua os registros DNS no provedor. `
          + 'Enquanto isso o envio é recusado.',
      );
    } else {
      linha('ok', `O domínio do remetente (${dominio}) está verificado.`);
    }
  }
}

// 3. Envio de verdade, se pedido ---------------------------------------------
if (!destino) {
  avisos.push('Nenhum destinatário informado: nenhuma mensagem foi enviada. '
    + 'Passe um e-mail como argumento para fazer o envio de ponta a ponta.');
} else if (problemas.length > 0) {
  avisos.push('Envio não tentado: resolva os problemas acima primeiro.');
} else {
  try {
    const resposta = await pedir('/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [destino],
        subject: 'Validação do envio - CODECA Build',
        text:
          'Esta mensagem foi enviada pelo validador de e-mail do CODECA Build.\n\n'
          + 'Se você a recebeu, o caminho usado por recuperação de senha, convites '
          + 'e código de acesso está funcionando nesta instalação.\n',
      }),
    });
    if (resposta.ok) {
      linha('ok', `Mensagem aceita pelo provedor para ${destino} (id ${resposta.corpo?.id ?? 'sem id'}).`);
      avisos.push('Aceita pelo provedor não é o mesmo que entregue: confira a caixa de entrada e o spam.');
    } else {
      problemas.push(`O provedor recusou o envio (${resposta.status}): ${resposta.texto.slice(0, 300)}`);
    }
  } catch (error) {
    problemas.push(`Falha de rede ao enviar: ${error?.message ?? error}`);
  }
}

// Veredito -------------------------------------------------------------------
console.log('');
for (const aviso of avisos) linha('!', aviso);
if (problemas.length > 0) {
  for (const problema of problemas) linha('x', problema);
  console.log('');
  linha('x', 'O envio de e-mail NÃO está pronto nesta configuração.');
  process.exit(1);
}
linha('ok', destino ? 'Envio validado de ponta a ponta.' : 'Chave e domínio validados (sem envio).');
