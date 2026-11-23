/**
 * O limite de conteudos aguenta criacoes simultaneas?
 *
 * Este percurso existe porque a suite nao consegue responder isso. Os testes
 * de integracao rodam sobre PGlite, que tem **uma conexao**: duas requisicoes
 * "paralelas" ali acontecem em fila, e o teste passaria mesmo com o defeito no
 * lugar. Um teste que nao sabe falhar nao prova nada.
 *
 * Aqui a API roda contra um PostgreSQL de verdade, com conexoes de verdade, e
 * N criacoes partem no mesmo instante com a empresa a uma vaga do teto.
 *
 *   node scripts/limites/corrida.mjs [concorrencia]
 *
 * Exige o servidor local apontado para Postgres:
 *
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/codeca_corrida \
 *     node <vite-node> --config vitest.config.ts scripts/loadtest/ui-import-server.ts
 */
const API = process.env.API ?? 'http://localhost:4010';
const CONCORRENCIA = Number(process.argv[2] ?? 12);

const cookies = new Map();
function guardarCookies(resposta) {
  for (const bruto of resposta.headers.getSetCookie?.() ?? []) {
    const [par] = bruto.split(';');
    const i = par.indexOf('=');
    if (i > 0) cookies.set(par.slice(0, i), decodeURIComponent(par.slice(i + 1)));
  }
}
const cabecalhoDeCookie = () => [...cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');

async function chamar(metodo, caminho, corpo) {
  const headers = { cookie: cabecalhoDeCookie(), origin: API };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  const csrf = cookies.get('codeca_csrf');
  if (csrf) headers['x-csrf-token'] = csrf;
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers,
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  guardarCookies(r);
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* resposta sem envelope */ }
  return { status: r.status, body: json?.data ?? json };
}

// --- entrar e descobrir a empresa -------------------------------------------
guardarCookies(await fetch(`${API}/__entrar`, { redirect: 'manual' }));
const sessao = await chamar('GET', '/api/auth/session');
const tenantId = sessao.body?.session?.memberships?.[0]?.tenantId;
if (!tenantId) {
  console.error('nao consegui entrar no painel local. O servidor esta no ar?');
  process.exit(1);
}

const antes = await chamar('GET', `/api/tenants/${tenantId}/overview`);
const plano = await chamar('GET', `/api/tenants/${tenantId}/plan`);
const limite = plano.body?.plan?.limits?.maxContentRecords ?? plano.body?.limits?.maxContentRecords;
const usado = plano.body?.usage?.contentRecords;
if (typeof limite !== 'number' || typeof usado !== 'number') {
  console.error('nao consegui ler limite/uso:', JSON.stringify(plano.body).slice(0, 300));
  process.exit(1);
}
void antes;

console.log(`empresa ${tenantId}`);
console.log(`limite do plano: ${limite} conteudos; em uso: ${usado}`);

// --- encher ate faltar UMA vaga ---------------------------------------------
const faltam = limite - usado - 1;
if (faltam < 0) {
  console.error(`a empresa ja esta no teto (${usado}/${limite}); recrie o banco e rode de novo.`);
  process.exit(1);
}
for (let i = 0; i < faltam; i += 1) {
  const r = await chamar('POST', `/api/tenants/${tenantId}/faqs`, {
    question: `Pergunta de enchimento ${i}`,
    answer: 'Conteudo criado para levar a empresa a uma vaga do teto.',
    publicationStatus: 'draft',
    sortOrder: i,
  });
  if (r.status !== 201) {
    console.error('falha ao encher:', r.status, JSON.stringify(r.body).slice(0, 200));
    process.exit(1);
  }
}
console.log(`preenchido ate ${limite - 1}/${limite}: resta exatamente UMA vaga.`);

// --- a corrida ---------------------------------------------------------------
console.log(`\ndisparando ${CONCORRENCIA} criacoes no mesmo instante...`);
const resultados = await Promise.all(
  Array.from({ length: CONCORRENCIA }, (_, i) =>
    chamar('POST', `/api/tenants/${tenantId}/faqs`, {
      question: `Corrida ${i}`,
      answer: 'Disparada em paralelo para disputar a ultima vaga.',
      publicationStatus: 'draft',
      sortOrder: 100 + i,
    }),
  ),
);

const criados = resultados.filter((r) => r.status === 201).length;
const recusados = resultados.filter((r) => r.status === 402 || r.status === 409).length;
const outros = resultados.filter((r) => r.status !== 201 && r.status !== 402 && r.status !== 409);

const depois = await chamar('GET', `/api/tenants/${tenantId}/plan`);
const totalFinal = depois.body?.usage?.contentRecords;

console.log(`\naceitas: ${criados}`);
console.log(`recusadas pelo limite: ${recusados}`);
if (outros.length) console.log('outras respostas:', outros.map((o) => o.status).join(', '));
console.log(`total apos a corrida: ${totalFinal} (teto ${limite})`);

const ok = criados === 1 && totalFinal === limite;
console.log(
  ok
    ? '\n=== OK: exatamente uma criacao passou; o teto do plano foi respeitado ==='
    : `\n=== FALHA: ${criados} criacoes passaram para UMA vaga; total ${totalFinal} contra teto ${limite} ===`,
);
process.exit(ok ? 0 : 1);
