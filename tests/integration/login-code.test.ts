import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, schema } from '@codeca/database';
import type { MailMessage, Mailer } from '@codeca/api';
import {
  createTestApi,
  registerAccount,
  type RegisteredAccount,
  type TestApi,
  type TestClient,
} from '../helpers/api.js';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, createFakeGoogle, signInWithGoogle } from '../helpers/google.js';

/**
 * Verificacao por e-mail em duas etapas: e-mail + senha, e DEPOIS o codigo.
 *
 * O que se quer provar: o codigo NUNCA e uma porta de entrada (sem a senha, ou o
 * Google, nao existe como pedi-lo nem usa-lo); vale uma vez, por 10 minutos, com
 * poucas tentativas; nada o entrega fora do e-mail; e a sessao so nasce depois
 * dele.
 */

let clock = new Date('2026-06-01T12:00:00Z');
let api: TestApi;
const google = createFakeGoogle({ now: () => clock });

const SENHA = 'senhaSegura123';

beforeAll(async () => {
  api = await createTestApi({
    now: () => clock,
    fetch: google.fetch,
    env: { RESEND_API_KEY: 'chave-de-teste', GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET },
  });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  clock = new Date('2026-06-01T12:00:00Z');
  await api.reset();
});

const advance = (seconds: number) => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

const CODE = '/api/auth/code';
const login = (client: TestClient, email: string, password = SENHA, rememberMe = false) =>
  client.post('/api/auth/login', { email, password, rememberMe });
const verify = (client: TestClient, code: string) => client.post(`${CODE}/verify`, { code });
const resend = (client: TestClient) => client.post(`${CODE}/resend`);

function codeSentTo(email: string): string {
  const message = [...api.outbox].reverse().find((m) => m.kind === 'login_code' && m.to === email);
  expect(message, `nenhum e-mail de codigo para ${email}`).toBeDefined();
  const match = message!.text.match(/\n(\d{6})\n/);
  expect(match, 'o e-mail nao traz um codigo de 6 digitos').not.toBeNull();
  return match![1]!;
}
const mailsTo = (email: string) => api.outbox.filter((m) => m.kind === 'login_code' && m.to === email);
const wrongCodeFor = (right: string) => (right === '000000' ? '111111' : '000000');
const usersCount = async () => (await api.db.select({ id: schema.users.id }).from(schema.users)).length;
const audit = (action: string) => api.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, action));
const sessionOf = async (client: TestClient) =>
  (await client.get('/api/auth/session')).body.session as {
    user: { id: string; email: string; emailVerified: boolean; platformRole: string };
    memberships: Array<{ tenantId: string; role: string }>;
  } | null;

/** Em instalacao nova a PRIMEIRA conta vira administradora (regra existente). */
const instalador = () => registerAccount(api, { email: 'instalador@codeca.test', companyName: 'Instalador' });

/** Conta de cliente comum, ja criada (o cadastro continua devolvendo sessao). */
async function cliente(email = 'cliente@empresa.com.br', companyName = 'Empresa Cliente'): Promise<RegisteredAccount> {
  await instalador().catch(() => undefined);
  return registerAccount(api, { email, companyName });
}

/** Senha certa -> codigo certo: o login completo, em duas etapas. */
async function signIn(client: TestClient, email: string) {
  const first = await login(client, email);
  expect(first.status, first.errorMessage ?? '').toBe(200);
  expect(first.body.status).toBe('code_required');
  return verify(client, codeSentTo(email));
}

describe('1a etapa: a senha nao abre a conta sozinha', () => {
  it('senha correta: envia o codigo e NAO cria sessao', async () => {
    await cliente();
    const client = api.client();

    const response = await login(client, 'cliente@empresa.com.br');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'code_required',
      email: 'cliente@empresa.com.br',
      resendAfterSeconds: 60,
      expiresInSeconds: 600,
    });
    expect(client.sessionCookie).toBeNull();
    expect(await sessionOf(client)).toBeNull();
    expect(mailsTo('cliente@empresa.com.br')).toHaveLength(1);
    // Nenhuma rota protegida abre so com a senha.
    expect((await client.get('/api/auth/sessions')).status).toBe(401);
  });

  it('o e-mail tem o assunto e o texto combinados, e a resposta nunca traz o codigo', async () => {
    await cliente();
    const response = await login(api.client(), 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');
    const [mail] = mailsTo('cliente@empresa.com.br');

    expect(mail?.subject).toBe('Seu código de acesso ao CODECA Build');
    expect(mail?.text).toBe(
      'Olá!\n\n'
        + 'Você solicitou um código para acessar sua conta no CODECA Build.\n\n'
        + 'Seu código de verificação é:\n\n'
        + `${code}\n\n`
        + 'Esse código expira em 10 minutos e só pode ser utilizado uma vez.\n\n'
        + 'Se você não solicitou esse acesso, ignore esta mensagem.\n\n'
        + 'CODECA Build\n'
        + 'Tecnologia desenvolvida pela CODECA IA.\n',
    );
    expect(JSON.stringify(response.body) + JSON.stringify([...response.headers.entries()])).not.toContain(code);
  });

  it('senha errada: nenhum e-mail e nenhuma etapa; mesma mensagem para e-mail inexistente', async () => {
    await cliente();

    const errada = await login(api.client(), 'cliente@empresa.com.br', 'senha-errada-123');
    const inexistente = await login(api.client(), 'ninguem@empresa.com.br');

    expect(errada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(errada.errorMessage).toBe(inexistente.errorMessage);
    expect(errada.headers.getSetCookie().some((c) => c.startsWith('codeca_login_pending='))).toBe(false);
    expect(api.outbox.filter((m) => m.kind === 'login_code')).toHaveLength(0);
  });

  it('conta sem senha (so Google) nao entra por e-mail e senha, e nao recebe codigo', async () => {
    await instalador();
    await signInWithGoogle(api.client(), google, { sub: 'g-1', email: 'maria@gmail.com' });
    // O unico e-mail ate aqui e o da 2a etapa do proprio Google.
    const antes = mailsTo('maria@gmail.com').length;

    advance(61);
    const response = await login(api.client(), 'maria@gmail.com', 'qualquer-coisa-123');

    expect(response.status).toBe(401);
    expect(mailsTo('maria@gmail.com')).toHaveLength(antes);
  });

  it('o bloqueio por senhas erradas continua valendo (5 tentativas)', async () => {
    await cliente();
    for (let i = 0; i < 5; i += 1) await login(api.client(), 'cliente@empresa.com.br', 'errada-123456');
    const bloqueada = await login(api.client(), 'cliente@empresa.com.br');
    expect(bloqueada.status).toBe(429);
    expect(api.outbox.filter((m) => m.kind === 'login_code')).toHaveLength(0);
  });

  it('as rotas publicas de "codigo por e-mail sem senha" deixaram de existir', async () => {
    const client = api.client();
    expect((await client.post(`${CODE}/request`, { email: 'cliente@empresa.com.br' })).status).toBe(404);
    expect((await client.post(`${CODE}/register`, { name: 'X Y', companyName: 'Empresa', acceptedTerms: true })).status).toBe(404);
    expect(api.outbox).toHaveLength(0);
  });
});

describe('2a etapa: so o comprovante da senha libera o codigo', () => {
  it('"e-mail + codigo" nunca autentica: sem o comprovante, nao ha como validar nem reenviar', async () => {
    await cliente();
    await login(api.client(), 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');

    // Outro navegador, que sabe o e-mail e ate o codigo, mas nao passou pela senha.
    const outro = api.client();
    const tentativa = await outro.post(`${CODE}/verify`, { email: 'cliente@empresa.com.br', code });
    expect(tentativa.status).toBe(401);
    expect(outro.sessionCookie).toBeNull();
    expect((await resend(outro)).status).toBe(401);
    expect((await outro.get(`${CODE}/pending`)).status).toBe(401);
    expect(mailsTo('cliente@empresa.com.br')).toHaveLength(1);
  });

  it('comprovante falso, adulterado ou vencido nao vale', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');

    const falso = api.client();
    falso.setCookie('codeca_login_pending', 'eyJlbWFpbCI6ImNsaWVudGVAZW1wcmVzYS5jb20uYnIifQ.assinatura-falsa');
    expect((await verify(falso, code)).status).toBe(401);

    advance(16 * 60);
    expect((await verify(client, code)).status).toBe(401);
    expect(await sessionOf(client)).toBeNull();
  });

  it('o e-mail do codigo vem do comprovante: o corpo da requisicao e ignorado', async () => {
    await cliente();
    await cliente('outra@empresa.com.br', 'Empresa Outra');
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');

    const response = await client.post(`${CODE}/verify`, { code, email: 'outra@empresa.com.br' });

    expect(response.status).toBe(200);
    expect((await sessionOf(client))!.user.email).toBe('cliente@empresa.com.br');
  });

  it('o comprovante e HttpOnly, restrito a rota do codigo e de vida curta', async () => {
    await cliente();
    const response = await login(api.client(), 'cliente@empresa.com.br');
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith('codeca_login_pending='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/code/);
    expect(cookie).toMatch(/Max-Age=900/);
  });

  it('GET /pending diz o e-mail e quanto falta para reenviar (para a tela que chega do Google)', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    advance(25);

    const response = await client.get(`${CODE}/pending`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ email: 'cliente@empresa.com.br', resendAfterSeconds: 35, expiresInSeconds: 600 });
  });

  it('cancelar descarta a primeira etapa', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');

    expect((await client.post(`${CODE}/cancel`)).status).toBe(204);

    expect((await verify(client, code)).status).toBe(401);
    expect(await sessionOf(client)).toBeNull();
  });

  it('pedidos vindos de outra origem sao recusados', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    expect((await client.post(`${CODE}/verify`, { code: '123456' }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await client.post(`${CODE}/resend`, undefined, { origin: 'https://evil.test' })).status).toBe(403);
  });
});

describe('validar o codigo', () => {
  it('codigo certo: cria a sessao (cookie HttpOnly) e entra na conta, sem duplicar nada', async () => {
    const dono = await cliente();
    const antes = {
      users: await usersCount(),
      tenants: (await api.db.select().from(schema.tenants)).length,
      sites: await api.db.select().from(schema.sites),
      subs: await api.db.select().from(schema.subscriptions),
      members: await api.db.select().from(schema.memberships),
    };

    const client = api.client();
    const response = await signIn(client, 'cliente@empresa.com.br');

    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.status).toBe('authenticated');
    expect(response.body.session.user.id).toBe(dono.userId);
    expect(response.body.csrfToken).toBeTruthy();
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith('codeca_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    // O comprovante e apagado depois de usado.
    expect(response.headers.getSetCookie().find((c) => c.startsWith('codeca_login_pending='))).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect(await usersCount()).toBe(antes.users);
    expect((await api.db.select().from(schema.tenants)).length).toBe(antes.tenants);
    expect(await api.db.select().from(schema.sites)).toEqual(antes.sites);
    expect(await api.db.select().from(schema.subscriptions)).toEqual(antes.subs);
    expect(await api.db.select().from(schema.memberships)).toEqual(antes.members);
    expect((await audit('user.code_logged_in'))[0]?.metadata).toMatchObject({ method: 'password' });
  });

  it('codigo incorreto', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    const certo = codeSentTo('cliente@empresa.com.br');

    const response = await verify(client, wrongCodeFor(certo));

    expect(response.status).toBe(401);
    expect(response.errorMessage).toBe('Código incorreto ou expirado. Confira os números ou peça um novo código.');
    expect(await sessionOf(client)).toBeNull();
  });

  it('codigo expirado (10 minutos), mas ainda vale no ultimo instante', async () => {
    await cliente();
    const tarde = api.client();
    await login(tarde, 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');
    advance(10 * 60 - 1);
    // Dentro dos 10 minutos: entra.
    expect((await verify(tarde, code)).status).toBe(200);

    advance(61);
    const vencido = api.client();
    await login(vencido, 'cliente@empresa.com.br');
    const code2 = codeSentTo('cliente@empresa.com.br');
    advance(10 * 60 + 1);
    expect((await verify(vencido, code2)).status).toBe(401);
    expect(await sessionOf(vencido)).toBeNull();
  });

  it('codigo ja utilizado', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');
    expect((await verify(client, code)).status).toBe(200);

    // Mesmo com um comprovante novo (nova senha), o codigo gasto nao serve.
    advance(61);
    const segundo = api.client();
    await login(segundo, 'cliente@empresa.com.br');
    const novo = codeSentTo('cliente@empresa.com.br');
    if (novo !== code) expect((await verify(segundo, code)).status).toBe(401);
  });

  it('uso unico tambem sob concorrencia: de varias validacoes simultaneas, so uma entra', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');

    const results = await Promise.all(Array.from({ length: 6 }, () => verify(client, code)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
  });

  it('formato invalido e recusado antes de qualquer conferencia', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    for (const code of ['', '12345', '1234567', 'abcdef', '12 456', '１２３４５６']) {
      expect((await verify(client, code)).status, code).toBe(422);
    }
    const [row] = await api.db.select().from(schema.loginCodes).where(eq(schema.loginCodes.email, 'cliente@empresa.com.br'));
    expect(row?.attempts).toBe(0);
  });

  it('guarda so o hash: o codigo nao aparece no banco', async () => {
    await cliente();
    await login(api.client(), 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');
    const [row] = await api.db.select().from(schema.loginCodes).where(eq(schema.loginCodes.email, 'cliente@empresa.com.br'));
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row!.expiresAt.getTime() - clock.getTime()).toBe(10 * 60_000);
  });

  it('o e-mail so e verificado depois do codigo', async () => {
    await instalador();
    const conta = await registerAccount(api, { email: 'novo@empresa.com.br', companyName: 'Empresa Nova' });
    expect((await sessionOf(conta.client))?.user.emailVerified).toBe(false);

    const client = api.client();
    const response = await signIn(client, 'novo@empresa.com.br');

    expect(response.body.session.user.emailVerified).toBe(true);
    expect((await audit('user.email_verified')).some((l) => (l.metadata as { via?: string }).via === 'login_code')).toBe(true);
  });

  it('manter conectado (marcado na senha) vale para a sessao criada pelo codigo', async () => {
    await cliente();
    const curto = api.client();
    await login(curto, 'cliente@empresa.com.br', SENHA, false);
    await verify(curto, codeSentTo('cliente@empresa.com.br'));
    advance(61);
    const longo = api.client();
    await login(longo, 'cliente@empresa.com.br', SENHA, true);
    await verify(longo, codeSentTo('cliente@empresa.com.br'));

    advance(13 * 3600);
    expect(await sessionOf(curto)).toBeNull();
    expect(await sessionOf(longo)).not.toBeNull();
  });
});

describe('reenvio e limites', () => {
  it('antes de 60 segundos nao reenvia e diz quanto falta', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    advance(20);

    const cedo = await resend(client);

    expect(cedo.status).toBe(429);
    expect(cedo.errorMessage).toMatch(/40 segundo/);
    expect(mailsTo('cliente@empresa.com.br')).toHaveLength(1);
  });

  it('depois de 60 segundos reenvia, e o codigo anterior deixa de valer', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    const antigo = codeSentTo('cliente@empresa.com.br');
    advance(61);

    const reenvio = await resend(client);

    expect(reenvio.status).toBe(200);
    expect(reenvio.body).toEqual({ sent: true, resendAfterSeconds: 60, expiresInSeconds: 600 });
    expect(mailsTo('cliente@empresa.com.br')).toHaveLength(2);
    const novo = codeSentTo('cliente@empresa.com.br');
    if (antigo !== novo) expect((await verify(client, antigo)).status).toBe(401);
    const rows = await api.db.select().from(schema.loginCodes).where(eq(schema.loginCodes.email, 'cliente@empresa.com.br'));
    expect(rows.filter((r) => r.usedAt === null)).toHaveLength(1);
    expect((await verify(client, novo)).status).toBe(200);
  });

  it('entrar duas vezes seguidas nao reenvia: o codigo anterior ainda vale', async () => {
    await cliente();
    await login(api.client(), 'cliente@empresa.com.br');
    const second = api.client();
    const response = await login(second, 'cliente@empresa.com.br');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('code_required');
    expect(mailsTo('cliente@empresa.com.br')).toHaveLength(1);
    expect((await verify(second, codeSentTo('cliente@empresa.com.br'))).status).toBe(200);
  });

  it('limita os envios por e-mail a 5 por hora, mesmo respeitando os 60 segundos', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    for (let i = 0; i < 4; i += 1) {
      advance(61);
      expect((await resend(client)).status, `reenvio ${i + 1}`).toBe(200);
    }
    advance(61);
    const sexto = await resend(client);
    expect(sexto.status).toBe(429);
    expect(sexto.errorCode).toBe('rate_limited');
    expect(mailsTo('cliente@empresa.com.br')).toHaveLength(5);
  });

  it('depois de uma hora a cota volta', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    for (let i = 0; i < 4; i += 1) {
      advance(61);
      await resend(client);
    }
    advance(61);
    expect((await resend(client)).status).toBe(429);
    advance(3600);
    // O comprovante vale 15 minutos: a pessoa entra de novo com a senha e a cota voltou.
    const novo = api.client();
    expect((await login(novo, 'cliente@empresa.com.br')).status).toBe(200);
    expect(mailsTo('cliente@empresa.com.br')).toHaveLength(6);
    advance(61);
    expect((await resend(novo)).status).toBe(200);
  });
});

describe('forca bruta', () => {
  it('cinco tentativas por codigo: ao errar a quinta, o codigo morre (mesmo o certo)', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    const certo = codeSentTo('cliente@empresa.com.br');
    const errado = wrongCodeFor(certo);

    for (let i = 0; i < 5; i += 1) expect((await verify(client, errado)).status, `tentativa ${i + 1}`).toBe(401);
    const certoTarde = await verify(client, certo);

    expect(certoTarde.status).toBe(401);
    expect(await sessionOf(client)).toBeNull();
    const [row] = await api.db.select().from(schema.loginCodes).where(eq(schema.loginCodes.email, 'cliente@empresa.com.br'));
    expect(row?.attempts).toBe(5);
    expect(row?.usedAt).not.toBeNull();
    expect(await audit('user.code_blocked')).toHaveLength(1);
  });

  it('quatro erros nao queimam o codigo: a quinta tentativa, certa, entra', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    const certo = codeSentTo('cliente@empresa.com.br');
    for (let i = 0; i < 4; i += 1) await verify(client, wrongCodeFor(certo));
    expect((await verify(client, certo)).status).toBe(200);
  });

  it('tentativas simultaneas tambem contam: nao passa de 5 conferencias', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    const certo = codeSentTo('cliente@empresa.com.br');

    await Promise.all(Array.from({ length: 14 }, () => verify(client, wrongCodeFor(certo))));

    const [row] = await api.db.select().from(schema.loginCodes).where(eq(schema.loginCodes.email, 'cliente@empresa.com.br'));
    expect(row!.attempts).toBeLessThanOrEqual(5);
    expect((await verify(client, certo)).status).toBe(401);
  });

  it('pedir codigo novo nao zera a cota de validacoes por e-mail', async () => {
    await cliente();
    const client = api.client();
    await login(client, 'cliente@empresa.com.br');
    for (let rodada = 0; rodada < 3; rodada += 1) {
      const certo = codeSentTo('cliente@empresa.com.br');
      for (let i = 0; i < 5; i += 1) await verify(client, wrongCodeFor(certo));
      advance(61);
      await resend(client);
    }
    const certo = codeSentTo('cliente@empresa.com.br');

    const barrado = await verify(client, certo);

    expect(barrado.status).toBe(429);
    expect(barrado.errorCode).toBe('rate_limited');
  });
});

describe('cliente com varias empresas, permissoes e assinatura', () => {
  it('preserva todas as empresas e papeis, e entrar nao promove ninguem', async () => {
    const dono = await cliente('cliente@empresa.com.br', 'Empresa Um');
    const outra = await registerAccount(api, { email: 'dono@outra.com.br', companyName: 'Empresa Dois' });
    await api.db.insert(schema.memberships).values({
      tenantId: outra.tenantId,
      userId: dono.userId,
      role: 'editor',
      status: 'active',
      acceptedAt: clock,
    });

    const client = api.client();
    await signIn(client, 'cliente@empresa.com.br');
    const session = await sessionOf(client);

    expect(Object.fromEntries(session!.memberships.map((m) => [m.tenantId, m.role]))).toEqual({
      [dono.tenantId]: 'owner',
      [outra.tenantId]: 'editor',
    });
    expect((await client.post(`/api/tenants/${outra.tenantId}/members/invite`, { email: 'x@y.com.br', role: 'viewer' })).status).toBe(403);
    const estranha = await registerAccount(api, { email: 'estranha@z.com.br', companyName: 'Empresa Tres' });
    expect([403, 404]).toContain((await client.get(`/api/tenants/${estranha.tenantId}`)).status);
  });

  it('preserva a assinatura e o plano', async () => {
    const dono = await cliente();
    await api.db.update(schema.subscriptions).set({ status: 'active', providerStatus: 'ACTIVE' }).where(eq(schema.subscriptions.tenantId, dono.tenantId));
    const [antes] = await api.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, dono.tenantId));

    await signIn(api.client(), 'cliente@empresa.com.br');

    const [depois] = await api.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, dono.tenantId));
    expect(depois).toEqual(antes);
  });

  it('o administrador da plataforma tambem passa pelas duas etapas e mantem o papel', async () => {
    const admin = await instalador();
    const client = api.client();
    const first = await login(client, admin.email);
    expect(first.body.status).toBe('code_required');
    expect(await sessionOf(client)).toBeNull();
    await verify(client, codeSentTo(admin.email));
    expect((await sessionOf(client))!.user.platformRole).toBe('platform_admin');
  });
});

describe('sessao, atualizar a pagina e sair', () => {
  it('a sessao persiste ao recarregar e o logout a encerra no banco', async () => {
    await cliente();
    const client = api.client();
    await signIn(client, 'cliente@empresa.com.br');
    const cookie = client.sessionCookie!;

    for (let i = 0; i < 3; i += 1) expect((await sessionOf(client))?.user.email).toBe('cliente@empresa.com.br');

    expect((await client.post('/api/auth/logout')).status).toBe(204);
    expect(await sessionOf(client)).toBeNull();
    const reusado = api.client();
    reusado.setCookie('codeca_session', cookie);
    expect(await sessionOf(reusado)).toBeNull();
  });

  it('a sessao expira como qualquer outra', async () => {
    await cliente();
    const client = api.client();
    await signIn(client, 'cliente@empresa.com.br');
    advance(13 * 3600);
    expect(await sessionOf(client)).toBeNull();
  });

  it('operacoes que alteram estado continuam exigindo o token anti-CSRF', async () => {
    const dono = await cliente();
    const client = api.client();
    await signIn(client, 'cliente@empresa.com.br');
    const response = await client.patch(`/api/tenants/${dono.tenantId}`, { displayName: 'Outro' }, { omitCsrf: true });
    expect(response.status).toBe(403);
  });
});

describe('Google tambem passa pelo codigo', () => {
  const MARIA = { sub: 'google-sub-maria', email: 'maria@gmail.com', name: 'Maria Souza' };

  it('Google autorizado: envia o codigo, leva a tela do codigo e NAO cria sessao', async () => {
    await instalador();
    const client = api.client();

    const result = await signInWithGoogle(client, google, MARIA);

    expect(result.status).toBe(302);
    expect(result.location).toBe('/entrar?etapa=codigo');
    expect(client.sessionCookie).toBeNull();
    expect(await sessionOf(client)).toBeNull();
    expect(result.headers.getSetCookie().some((c) => c.startsWith('codeca_login_pending='))).toBe(true);
    expect(mailsTo('maria@gmail.com')).toHaveLength(1);
    // O usuario nasce (e-mail confirmado pelo Google), mas sem empresa e sem sessao.
    expect(await api.db.select().from(schema.tenants)).toHaveLength(1); // so a do instalador
  });

  it('digitando o codigo, a sessao nasce e a pessoa segue para cadastrar a empresa', async () => {
    await instalador();
    const client = api.client();
    await signInWithGoogle(client, google, MARIA);

    expect((await client.get(`${CODE}/pending`)).body.email).toBe('maria@gmail.com');
    const response = await verify(client, codeSentTo('maria@gmail.com'));

    expect(response.status).toBe(200);
    expect(response.body.session.user.email).toBe('maria@gmail.com');
    expect(response.body.session.memberships).toEqual([]);
    expect(response.body.session.user.platformRole).toBe('none');
    expect((await audit('user.code_logged_in'))[0]?.metadata).toMatchObject({ method: 'google' });
  });

  it('quem ja usa o Google tambem recebe o codigo, e o destino pedido e preservado', async () => {
    const dono = await cliente('maria@gmail.com', 'Empresa Da Maria');
    await api.db.insert(schema.userIdentities).values({ userId: dono.userId, provider: 'google', providerSubject: MARIA.sub });

    const client = api.client();
    const result = await signInWithGoogle(client, google, MARIA, { next: '/painel/imoveis' });
    expect(result.location).toBe('/entrar?etapa=codigo');
    expect(await sessionOf(client)).toBeNull();

    const response = await verify(client, codeSentTo('maria@gmail.com'));
    expect(response.body.next).toBe('/painel/imoveis');
    expect(response.body.session.user.id).toBe(dono.userId);
    expect(response.body.session.memberships).toHaveLength(1);
  });

  it('se o e-mail nao sai, o Google nao entra: volta ao login com a explicacao', async () => {
    const quebrado: Mailer = { configured: true, async send() { return { delivered: false, reason: 'falhou' }; } };
    const falho = await createTestApi({
      now: () => clock,
      fetch: google.fetch,
      mailer: quebrado,
      env: { RESEND_API_KEY: 'chave', GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET },
    });
    try {
      const client = falho.client();
      const result = await signInWithGoogle(client, google, MARIA);
      expect(result.location).toBe('/entrar?google=code_send_failed');
      expect(client.sessionCookie).toBeNull();
    } finally {
      await falho.close();
    }
  });
});

describe('sem provedor de e-mail e com e-mail que falha', () => {
  it('sem RESEND_API_KEY a senha continua entrando direto (para a instalacao nao ficar trancada)', async () => {
    const semEmail = await createTestApi({ now: () => clock });
    try {
      const conta = await registerAccount(semEmail, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
      const client = semEmail.client();
      const response = await client.post('/api/auth/login', { email: conta.email, password: conta.password });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('authenticated');
      expect(response.body.session.user.email).toBe('cliente@empresa.com.br');
      expect((await semEmail.client().get('/api/auth/session')).body.features.emailCodeAuth).toBe(false);
    } finally {
      await semEmail.close();
    }
  });

  it('com LOGIN_CODE_REQUIRED=true e sem provedor, NINGUEM entra (501), em vez de entrar sem a 2a etapa', async () => {
    const exigido = await createTestApi({ now: () => clock, env: { LOGIN_CODE_REQUIRED: 'true' } });
    try {
      const conta = await registerAccount(exigido, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
      const client = exigido.client();
      const response = await client.post('/api/auth/login', { email: conta.email, password: conta.password });
      expect(response.status).toBe(501);
      expect(response.errorCode).toBe('integration_not_configured');
      expect(client.sessionCookie).toBeNull();
    } finally {
      await exigido.close();
    }
  });

  it('se o provedor falha, o login nao conclui e o codigo recem-criado nao fica valendo', async () => {
    const sent: MailMessage[] = [];
    const quebrado: Mailer = {
      configured: true,
      async send(message) {
        sent.push(message);
        return { delivered: false, reason: 'Provedor de e-mail respondeu 500.' };
      },
    };
    const falho = await createTestApi({ now: () => clock, mailer: quebrado, env: { RESEND_API_KEY: 'chave' } });
    try {
      const conta = await registerAccount(falho, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
      const client = falho.client();
      const response = await client.post('/api/auth/login', { email: conta.email, password: conta.password });
      expect(response.status).toBe(502);
      expect(response.errorMessage).toMatch(/Não foi possível enviar o e-mail/);
      expect(client.sessionCookie).toBeNull();
      expect(await falho.db.select().from(schema.loginCodes)).toHaveLength(0);
      // Nao ha sessao nem comprovante: o codigo que "saiu" nao abre nada.
      const code = sent.find((m) => m.kind === 'login_code')!.text.match(/\n(\d{6})\n/)![1]!;
      expect((await client.post(`${CODE}/verify`, { code })).status).toBe(401);
    } finally {
      await falho.close();
    }
  });
});

describe('o codigo nao vaza em lugar nenhum', () => {
  it('nem em log, nem em auditoria, nem na sessao, em um fluxo completo', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      await cliente();
      const client = api.client();
      await login(client, 'cliente@empresa.com.br');
      const certo = codeSentTo('cliente@empresa.com.br');
      for (let i = 0; i < 5; i += 1) await verify(client, wrongCodeFor(certo));
      advance(61);
      const outro = api.client();
      await login(outro, 'cliente@empresa.com.br');
      const novo = codeSentTo('cliente@empresa.com.br');
      const entrada = await verify(outro, novo);

      const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' '))).join('\n');
      expect(logged).not.toContain(certo);
      expect(logged).not.toContain(novo);
      const rows = JSON.stringify({
        audit: await api.db.select().from(schema.auditLogs),
        sessions: await api.db.select().from(schema.sessions),
        rate: await api.db.select().from(schema.rateLimits),
      });
      expect(rows).not.toContain(`"${certo}"`);
      expect(rows).not.toContain(`"${novo}"`);
      expect(JSON.stringify(entrada.body)).not.toContain(novo);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

