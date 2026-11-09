/**
 * Povoa a conta de teste com conteudo **adversarial**.
 *
 * ## Por que isto precisou existir
 *
 * A primeira varredura deu 378 combinacoes sem um unico achado -- e o
 * resultado nao valia nada: a conta estava vazia, e toda tela de colecao
 * mostrava "nenhum registro cadastrado". Varrer estado vazio em nove
 * resolucoes prova apenas que o estado vazio esta bem feito.
 *
 * Os defeitos de layout nascem do **conteudo**: a URL de 180 caracteres que
 * estoura o card, o e-mail sem espaco que nao quebra, o endereco longo, o
 * titulo que ocupa tres linhas. E exatamente o que a captura da revisao
 * mostrava, e exatamente o que faltava aqui.
 *
 * Entao o conteudo daqui nao e "realista" no sentido de bonito: e o pior
 * caso plausivel, que e o que vale a pena testar.
 */
const BASE = process.env.AUDIT_BASE ?? 'http://localhost:4010';

/** Guarda os cookies entre as chamadas, como um navegador faria. */
const cookies = new Map();

function cookieHeader() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function guardarCookies(resposta) {
  for (const linha of resposta.headers.getSetCookie?.() ?? []) {
    const [par] = linha.split(';');
    const [nome, ...resto] = (par ?? '').split('=');
    if (nome) cookies.set(nome.trim(), resto.join('='));
  }
}

async function chamar(metodo, caminho, corpo) {
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      cookie: cookieHeader(),
      ...(cookies.has('codeca_csrf') ? { 'x-csrf-token': cookies.get('codeca_csrf') } : {}),
    },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  guardarCookies(resposta);
  const texto = await resposta.text();
  let dados;
  try { dados = JSON.parse(texto); } catch { dados = texto; }
  return { status: resposta.status, dados };
}

// Entra e descobre a empresa.
guardarCookies(await fetch(`${BASE}/__entrar`, { redirect: 'manual' }));
const sessao = await chamar('GET', '/api/auth/session');
const tenantId = sessao.dados?.data?.session?.memberships?.[0]?.tenantId;
if (!tenantId) {
  console.error('nao achei a empresa na sessao:', JSON.stringify(sessao.dados).slice(0, 500));
  process.exit(1);
}
const base = `/api/tenants/${tenantId}`;

/** O pior caso plausivel de cada forma de texto longo. */
const URL_GIGANTE =
  'https://www.clinicasorriso.com.br/campanhas/verao-2026/agendamento-online?utm_source=newsletter&utm_medium=email&utm_campaign=verao-2026-clareamento&utm_content=botao-principal-do-banner';
const EMAIL_LONGO = 'atendimento.agendamentos.clinicasorriso@clinicaodontologicasorrisoperfeito.com.br';
const TITULO_LONGO =
  'Clareamento dental com acompanhamento profissional e avaliação inicial sem compromisso para toda a família';
const TEXTO_LONGO =
  'Atendemos de segunda a sexta das 8h às 19h e aos sábados das 8h às 13h, com estacionamento conveniado no mesmo quarteirão e acessibilidade completa para cadeirantes em todas as salas de atendimento.';

const passos = [
  ['banner com URL gigante', 'POST', `${base}/banners`, {
    title: TITULO_LONGO,
    subtitle: TEXTO_LONGO,
    buttonLabel: 'Agendar minha avaliação agora mesmo',
    buttonUrl: URL_GIGANTE,
  }],
  ['banner curto', 'POST', `${base}/banners`, { title: 'Promoção de inverno' }],
  ['contato preenchido', 'PUT', `${base}/modules/contato/document`, {
    email: EMAIL_LONGO,
    phone: '(41) 3333-4444',
    whatsapp: '(41) 98888-2222',
    whatsappMessage: 'Olá! Vim pelo site e gostaria de agendar uma avaliação.',
    addressLine: 'Avenida Presidente Getúlio Vargas, 1478, sala 302, Edifício Centro Clínico Batel',
    city: 'Curitiba',
    state: 'PR',
    postalCode: '80240-040',
    businessHours: TEXTO_LONGO,
    serviceArea: 'Curitiba, São José dos Pinhais, Pinhais, Colombo e Araucária',
    mapUrl: URL_GIGANTE,
    social: {
      instagram: 'https://instagram.com/clinicasorrisoperfeitocuritiba',
      facebook: 'https://facebook.com/clinicasorrisoperfeitocuritiba',
    },
  }],
  ['institucional preenchido', 'PUT', `${base}/modules/institucional/document`, {
    companyName: 'Clínica Sorriso Perfeito Odontologia Integrada',
    tagline: TITULO_LONGO,
    shortDescription: TEXTO_LONGO,
    history: TEXTO_LONGO.repeat(2),
    mission: TEXTO_LONGO,
    vision: TEXTO_LONGO,
    values: ['Cuidado', 'Transparência', 'Pontualidade', 'Acolhimento', 'Responsabilidade técnica'],
    foundedYear: 1998,
  }],
  ['serviço', 'POST', `${base}/services`, { title: TITULO_LONGO, description: TEXTO_LONGO }],
  ['imóvel', 'POST', `${base}/properties`, { title: TITULO_LONGO, type: 'apartamento', purpose: 'venda', description: TEXTO_LONGO, price: 1250000 }],
  ['obra', 'POST', `${base}/projects`, { title: TITULO_LONGO, category: 'residencial', description: TEXTO_LONGO }],
  ['produto', 'POST', `${base}/products`, { title: TITULO_LONGO, description: TEXTO_LONGO, price: 349.9 }],
  /**
   * Categoria sem `moduleKey`: ele e campo travado.
   *
   * A tentativa de defini-lo devolve 403 -- a politica de campos fazendo o
   * trabalho dela. Fica aqui como registro de que a trava vale tambem na
   * criacao, nao so na edicao. O nome vai no limite de 80 do schema.
   */
  ['categoria', 'POST', `${base}/categories`, { name: TITULO_LONGO.slice(0, 80) }],
  ['galeria', 'POST', `${base}/galleries`, { title: TITULO_LONGO, description: TEXTO_LONGO }],
  ['depoimento', 'POST', `${base}/testimonials`, { authorName: 'Maria Aparecida dos Santos Figueiredo', content: TEXTO_LONGO, rating: 5 }],
  ['membro da equipe', 'POST', `${base}/team`, { name: 'Dra. Ana Carolina Figueiredo Nascimento', role: 'Cirurgiã-dentista especialista em implantodontia', bio: TEXTO_LONGO }],
  ['pergunta frequente', 'POST', `${base}/faqs`, { question: `${TITULO_LONGO}?`, answer: TEXTO_LONGO }],
  // Interessado entra pela API publica do site, nao pelo painel: sem chave
  // de integracao aqui, a tela fica no estado vazio e isso e registrado.

  ['domínio', 'POST', `${base}/domains`, { domain: 'agendamento.clinicasorrisoperfeitocuritiba.com.br' }],
];

let criados = 0;
for (const [nome, metodo, caminho, corpo] of passos) {
  const r = await chamar(metodo, caminho, corpo);
  const ok = r.status >= 200 && r.status < 300;
  if (ok) criados += 1;
  console.log(`${ok ? 'ok  ' : `FALHOU(${r.status})`} ${nome}${ok ? '' : ` -- ${JSON.stringify(r.dados).slice(0, 220)}`}`);
}
console.log(`\n${criados} de ${passos.length} criados.`);
