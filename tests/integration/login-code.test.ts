import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, schema } from '@codeca/database';
import type { MailMessage, Mailer } from '@codeca/api';
import {
  createTestApi,
  extractToken,
  registerAccount,
  verifyEmail,
  type TestApi,
  type TestClient,
} from '../helpers/api.js';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, createFakeGoogle, signInWithGoogle } from '../helpers/google.js';

/**
 * Login por codigo de verificacao enviado por e-mail.
 *
 * O que se quer provar: o codigo e a UNICA coisa que abre a conta; ele vale
 * uma vez, por 10 minutos, com poucas tentativas; nada na resposta, no log ou
 * no banco o entrega; e nenhuma resposta revela se um e-mail tem cadastro.
 */

let clock = new Date('2026-06-01T12:00:00Z');
let api: TestApi;
const google = createFakeGoogle({ now: () => clock });

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

/**
 * Em instalacao nova a PRIMEIRA conta vira administradora da plataforma e ja nasce
 * com o e-mail verificado (regra existente, so do cadastro por senha). Os testes
 * que querem um cliente comum abrem antes uma conta qualquer.
 */
const primeiraContaDaInstalacao = () =>
  registerAccount(api, { email: 'instalador@codeca.test', companyName: 'Instalador' });

const advance = (seconds: number) => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

const CODE = '/api/auth/code';
const request = (client: TestClient, email: string) => client.post(`${CODE}/request`, { email });
const verify = (client: TestClient, email: string, code: string) => client.post(`${CODE}/verify`, { email, code });

/** O codigo que a pessoa leria no e-mail. So os testes olham a caixa de saida. */
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
const tenantsCount = async () => (await api.db.select({ id: schema.tenants.id }).from(schema.tenants)).length;
const audit = (action: string) => api.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, action));
const sessionOf = async (client: TestClient) =>
  (await client.get('/api/auth/session')).body.session as {
    user: { id: string; email: string; emailVerified: boolean; hasPassword: boolean; platformRole: string };
    memberships: Array<{ tenantId: string; role: string }>;
  } | null;

/** Pede, le o codigo e o valida: devolve o resultado da verificacao. */
async function signIn(client: TestClient, email: string) {
  const sent = await request(client, email);
  expect(sent.status, sent.errorMessage ?? '').toBe(200);
  return verify(client, email, codeSentTo(email));
}

describe('pedir o codigo', () => {
  it('envia o e-mail com o assunto e o texto combinados, e um codigo de 6 digitos', async () => {
    const response = await request(api.client(), 'cliente@empresa.com.br');

    expect(response.status).toBe(200);
    const [mail] = mailsTo('cliente@empresa.com.br');
    expect(mail?.subject).toBe('Seu código de acesso ao CODECA Build');
    const code = codeSentTo('cliente@empresa.com.br');
    expect(code).toMatch(/^\d{6}$/);
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
  });

  it('a resposta nunca traz o codigo', async () => {
    const response = await request(api.client(), 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');
    expect(Object.keys(response.body).sort()).toEqual(['expiresInSeconds', 'resendAfterSeconds', 'sent']);
    expect(response.body).toEqual({ sent: true, resendAfterSeconds: 60, expiresInSeconds: 600 });
    expect(JSON.stringify(response.body) + JSON.stringify([...response.headers.entries()])).not.toContain(code);
  });

  it('cada pedido gera um codigo diferente', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 4; i += 1) {
      await request(api.client(), 'cliente@empresa.com.br');
      codes.add(codeSentTo('cliente@empresa.com.br'));
      advance(61);
    }
    expect(codes.size).toBeGreaterThan(1);
  });

  it('guarda so o hash: o codigo nao aparece no banco', async () => {
    await request(api.client(), 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');
    const [row] = await api.db.select().from(schema.loginCodes);

    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row?.email).toBe('cliente@empresa.com.br');
    expect(row?.attempts).toBe(0);
    expect(row?.usedAt).toBeNull();
    // 10 minutos de validade.
    expect(row!.expiresAt.getTime() - clock.getTime()).toBe(10 * 60_000);
    // O IP so entra como hash.
    expect(row?.requestIpHash).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('responde igual para e-mail com e sem conta (nao revela cadastros)', async () => {
    await registerAccount(api, { email: 'existe@empresa.com.br', companyName: 'Empresa Existente' });

    const com = await request(api.client(), 'existe@empresa.com.br');
    const sem = await request(api.client(), 'nao.existe@empresa.com.br');

    expect(com.status).toBe(sem.status);
    expect(com.body).toEqual(sem.body);
    expect(mailsTo('existe@empresa.com.br')).toHaveLength(1);
    expect(mailsTo('nao.existe@empresa.com.br')).toHaveLength(1);
    expect(mailsTo('existe@empresa.com.br')[0]?.text).toBe(
      mailsTo('nao.existe@empresa.com.br')[0]?.text.replace(codeSentTo('nao.existe@empresa.com.br'), codeSentTo('existe@empresa.com.br')),
    );
  });

  it('recusa e-mail invalido sem enviar nada', async () => {
    for (const email of ['', 'sem-arroba', 'a@b', '@empresa.com.br', 'dois@@empresa.com.br', 'espaco @empresa.com.br']) {
      const response = await request(api.client(), email);
      expect(response.status, email).toBe(422);
    }
    expect(api.outbox).toHaveLength(0);
    expect(await api.db.select().from(schema.loginCodes)).toHaveLength(0);
  });

  it('normaliza o e-mail: maiusculas e espacos nao criam outro destinatario', async () => {
    await request(api.client(), '  Cliente@Empresa.COM.br ');
    expect(mailsTo('cliente@empresa.com.br')).toHaveLength(1);
  });

  it('recusa o pedido vindo de outra origem', async () => {
    const response = await api.client().post(`${CODE}/request`, { email: 'cliente@empresa.com.br' }, { origin: 'https://evil.test' });
    expect(response.status).toBe(403);
    expect(api.outbox).toHaveLength(0);
  });

  it('informa na sessao que o login por codigo esta disponivel', async () => {
    expect((await api.client().get('/api/auth/session')).body.features.emailCodeAuth).toBe(true);
  });
});

describe('reenvio e limites de pedido', () => {
  it('antes de 60 segundos nao reenvia e diz quanto falta', async () => {
    await request(api.client(), 'cliente@empresa.com.br');
    advance(20);

    const cedo = await request(api.client(), 'cliente@empresa.com.br');

    expect(cedo.status).toBe(429);
    expect(cedo.errorCode).toBe('rate_limited');
    expect(cedo.errorMessage).toMatch(/40 segundo/);
    expect(mailsTo('cliente@empresa.com.br')).toHaveLength(1);
  });

  it('depois de 60 segundos reenvia, e o codigo anterior deixa de valer', async () => {
    await request(api.client(), 'cliente@empresa.com.br');
    const antigo = codeSentTo('cliente@empresa.com.br');
    advance(61);

    const reenvio = await request(api.client(), 'cliente@empresa.com.br');
    expect(reenvio.status).toBe(200);
    const novo = codeSentTo('cliente@empresa.com.br');
    expect(mailsTo('cliente@empresa.com.br')).toHaveLength(2);

    // Mesmo no caso (raro) de os dois codigos coincidirem, so o ultimo emitido vale.
    if (antigo !== novo) {
      const comAntigo = await verify(api.client(), 'cliente@empresa.com.br', antigo);
      expect(comAntigo.status).toBe(401);
    }
    const rows = await api.db.select().from(schema.loginCodes).where(eq(schema.loginCodes.email, 'cliente@empresa.com.br'));
    expect(rows.filter((r) => r.usedAt === null)).toHaveLength(1);
    expect((await verify(api.client(), 'cliente@empresa.com.br', novo)).status).toBe(200);
  });

  it('limita os pedidos por e-mail a 5 por hora, mesmo respeitando os 60 segundos', async () => {
    for (let i = 0; i < 5; i += 1) {
      const ok = await request(api.client(), 'cliente@empresa.com.br');
      expect(ok.status, `pedido ${i + 1}`).toBe(200);
      advance(61);
    }
    const sexto = await request(api.client(), 'cliente@empresa.com.br');
    expect(sexto.status).toBe(429);
    expect(sexto.errorCode).toBe('rate_limited');
    expect(mailsTo('cliente@empresa.com.br')).toHaveLength(5);

    // Outro e-mail nao e afetado pela cota deste.
    expect((await request(api.client(), 'outra.pessoa@empresa.com.br')).status).toBe(200);
  });

  it('limita os pedidos por IP, mesmo para e-mails diferentes', async () => {
    for (let i = 0; i < 15; i += 1) {
      expect((await request(api.client(), `pessoa${i}@empresa.com.br`)).status, `pedido ${i + 1}`).toBe(200);
    }
    const excesso = await request(api.client(), 'pessoa99@empresa.com.br');
    expect(excesso.status).toBe(429);
    expect(mailsTo('pessoa99@empresa.com.br')).toHaveLength(0);
  });

  it('depois de uma hora a cota volta', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(api.client(), 'cliente@empresa.com.br');
      advance(61);
    }
    expect((await request(api.client(), 'cliente@empresa.com.br')).status).toBe(429);
    advance(3600);
    expect((await request(api.client(), 'cliente@empresa.com.br')).status).toBe(200);
  });
});

describe('validar o codigo: o que NAO entra', () => {
  it('codigo incorreto', async () => {
    await request(api.client(), 'cliente@empresa.com.br');
    const certo = codeSentTo('cliente@empresa.com.br');

    const client = api.client();
    const response = await verify(client, 'cliente@empresa.com.br', wrongCodeFor(certo));

    expect(response.status).toBe(401);
    expect(response.errorMessage).toBe('Código incorreto ou expirado. Confira os números ou peça um novo código.');
    expect(client.sessionCookie).toBeNull();
    expect(await usersCount()).toBe(0);
  });

  it('codigo expirado (10 minutos)', async () => {
    await request(api.client(), 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');

    advance(10 * 60 + 1);
    const tarde = await verify(api.client(), 'cliente@empresa.com.br', code);

    expect(tarde.status).toBe(401);
    expect(await usersCount()).toBe(0);
  });

  it('ainda vale no ultimo instante dos 10 minutos', async () => {
    await request(api.client(), 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');
    advance(10 * 60 - 1);
    expect((await verify(api.client(), 'cliente@empresa.com.br', code)).status).toBe(200);
  });

  it('codigo ja utilizado', async () => {
    await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    await request(api.client(), 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');

    expect((await verify(api.client(), 'cliente@empresa.com.br', code)).status).toBe(200);
    const segunda = await verify(api.client(), 'cliente@empresa.com.br', code);

    expect(segunda.status).toBe(401);
    expect(segunda.errorMessage).toBe('Código incorreto ou expirado. Confira os números ou peça um novo código.');
  });

  it('uso unico tambem sob concorrencia: de varias validacoes simultaneas, so uma entra', async () => {
    await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    await request(api.client(), 'cliente@empresa.com.br');
    const code = codeSentTo('cliente@empresa.com.br');

    const results = await Promise.all(
      Array.from({ length: 6 }, () => verify(api.client(), 'cliente@empresa.com.br', code)),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
    expect(await api.db.select().from(schema.sessions)).toHaveLength(1 + 1); // cadastro + este login
  });

  it('o mesmo texto para qualquer falha, existindo ou nao a conta e o codigo', async () => {
    await registerAccount(api, { email: 'existe@empresa.com.br', companyName: 'Empresa' });
    await request(api.client(), 'existe@empresa.com.br');
    const certo = codeSentTo('existe@empresa.com.br');

    const mensagens = new Set<string | null>([
      (await verify(api.client(), 'existe@empresa.com.br', wrongCodeFor(certo))).errorMessage,
      (await verify(api.client(), 'nunca.pediu@empresa.com.br', '123456')).errorMessage,
    ]);
    advance(11 * 60);
    mensagens.add((await verify(api.client(), 'existe@empresa.com.br', certo)).errorMessage);

    expect(mensagens.size).toBe(1);
  });

  it('o codigo de um e-mail nao vale para outro', async () => {
    await request(api.client(), 'a@empresa.com.br');
    await request(api.client(), 'b@empresa.com.br');
    const codigoDeA = codeSentTo('a@empresa.com.br');
    if (codigoDeA === codeSentTo('b@empresa.com.br')) return; // coincidencia: nada a provar aqui

    const response = await verify(api.client(), 'b@empresa.com.br', codigoDeA);
    expect(response.status).toBe(401);
  });

  it('formato invalido do codigo e recusado antes de qualquer conferencia', async () => {
    await request(api.client(), 'cliente@empresa.com.br');
    for (const code of ['', '12345', '1234567', 'abcdef', '12 456', '１２３４５６']) {
      expect((await verify(api.client(), 'cliente@empresa.com.br', code)).status, code).toBe(422);
    }
    const [row] = await api.db.select().from(schema.loginCodes);
    expect(row?.attempts).toBe(0);
  });

  it('o e-mail sozinho nunca autentica', async () => {
    await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    const client = api.client();
    expect((await client.post(`${CODE}/verify`, { email: 'cliente@empresa.com.br' })).status).toBe(422);
    expect((await client.post(`${CODE}/verify`, { email: 'cliente@empresa.com.br', code: '' })).status).toBe(422);
    expect((await client.post(`${CODE}/register`, { name: 'X Y', companyName: 'Empresa Nova', acceptedTerms: true })).status).toBe(401);
    expect(client.sessionCookie).toBeNull();
    expect(await sessionOf(client)).toBeNull();
  });
});

describe('forca bruta', () => {
  it('cinco tentativas por codigo: ao errar a quinta, o codigo morre (mesmo o certo)', async () => {
    await request(api.client(), 'cliente@empresa.com.br');
    const certo = codeSentTo('cliente@empresa.com.br');
    const errado = wrongCodeFor(certo);

    for (let i = 0; i < 5; i += 1) {
      expect((await verify(api.client(), 'cliente@empresa.com.br', errado)).status, `tentativa ${i + 1}`).toBe(401);
    }
    const certoTarde = await verify(api.client(), 'cliente@empresa.com.br', certo);

    expect(certoTarde.status).toBe(401);
    expect(await usersCount()).toBe(0);
    const [row] = await api.db.select().from(schema.loginCodes);
    expect(row?.attempts).toBe(5);
    expect(row?.usedAt).not.toBeNull();
    expect(await audit('user.code_blocked')).toHaveLength(1);
  });

  it('quatro erros nao queimam o codigo: a quinta tentativa, certa, entra', async () => {
    await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    await request(api.client(), 'cliente@empresa.com.br');
    const certo = codeSentTo('cliente@empresa.com.br');
    for (let i = 0; i < 4; i += 1) await verify(api.client(), 'cliente@empresa.com.br', wrongCodeFor(certo));

    expect((await verify(api.client(), 'cliente@empresa.com.br', certo)).status).toBe(200);
  });

  it('tentativas simultaneas tambem contam: nao passa de 5 conferencias', async () => {
    await request(api.client(), 'cliente@empresa.com.br');
    const certo = codeSentTo('cliente@empresa.com.br');
    const errado = wrongCodeFor(certo);

    await Promise.all(Array.from({ length: 14 }, () => verify(api.client(), 'cliente@empresa.com.br', errado)));

    const [row] = await api.db.select().from(schema.loginCodes);
    expect(row!.attempts).toBeLessThanOrEqual(5);
    expect((await verify(api.client(), 'cliente@empresa.com.br', certo)).status).toBe(401);
  });

  it('pedir codigo novo nao zera a cota de validacoes por e-mail', async () => {
    await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    // 3 rodadas de 5 tentativas = 15 validacoes na hora; a 16a e barrada pela cota.
    for (let rodada = 0; rodada < 3; rodada += 1) {
      await request(api.client(), 'cliente@empresa.com.br');
      const certo = codeSentTo('cliente@empresa.com.br');
      for (let i = 0; i < 5; i += 1) await verify(api.client(), 'cliente@empresa.com.br', wrongCodeFor(certo));
      advance(61);
    }
    await request(api.client(), 'cliente@empresa.com.br');
    const certo = codeSentTo('cliente@empresa.com.br');

    const barrado = await verify(api.client(), 'cliente@empresa.com.br', certo);

    expect(barrado.status).toBe(429);
    expect(barrado.errorCode).toBe('rate_limited');
  });

  it('limita as validacoes por IP', async () => {
    let barrado = 0;
    for (let i = 0; i < 40; i += 1) {
      const response = await verify(api.client(), `pessoa${i}@empresa.com.br`, '123456');
      if (response.status === 429) barrado += 1;
    }
    expect(barrado).toBeGreaterThan(0);
  });
});

describe('cliente que ja tem conta', () => {
  it('entra na conta existente, sem duplicar usuario, empresa, site nem assinatura', async () => {
    const dono = await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa Existente' });
    await verifyEmail(api, dono);
    const antes = {
      users: await usersCount(),
      tenants: await tenantsCount(),
      sites: await api.db.select().from(schema.sites),
      subs: await api.db.select().from(schema.subscriptions),
      members: await api.db.select().from(schema.memberships),
    };

    const client = api.client();
    const response = await signIn(client, 'cliente@empresa.com.br');

    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.status).toBe('authenticated');
    expect(response.body.session.user.id).toBe(dono.userId);
    expect(response.body.session.memberships).toEqual([
      expect.objectContaining({ tenantId: dono.tenantId, role: 'owner' }),
    ]);
    expect(response.body).not.toHaveProperty('code');
    expect(await usersCount()).toBe(antes.users);
    expect(await tenantsCount()).toBe(antes.tenants);
    expect(await api.db.select().from(schema.sites)).toEqual(antes.sites);
    expect(await api.db.select().from(schema.subscriptions)).toEqual(antes.subs);
    expect(await api.db.select().from(schema.memberships)).toEqual(antes.members);
    expect(await audit('user.code_logged_in')).toHaveLength(1);
  });

  it('o cookie da sessao e HttpOnly e Lax, e vem o token anti-CSRF', async () => {
    await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    const client = api.client();
    const response = await signIn(client, 'cliente@empresa.com.br');

    const cookie = response.headers.getSetCookie().find((c) => c.startsWith('codeca_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(response.body.csrfToken).toBeTruthy();
    // O cookie anti-CSRF e legivel de proposito (double submit); o da sessao, nao.
    expect(response.headers.getSetCookie().find((c) => c.startsWith('codeca_csrf='))).not.toMatch(/HttpOnly/i);
  });

  it('preserva todos os dados e papeis de quem pertence a varias empresas', async () => {
    const dono = await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa Um' });
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

    expect(session!.memberships).toHaveLength(2);
    expect(Object.fromEntries(session!.memberships.map((m) => [m.tenantId, m.role]))).toEqual({
      [dono.tenantId]: 'owner',
      [outra.tenantId]: 'editor',
    });
    // Entrar por codigo nao promove ninguem: editor segue sem poder convidar.
    expect((await client.post(`/api/tenants/${outra.tenantId}/members/invite`, { email: 'x@y.com.br', role: 'viewer' })).status).toBe(403);
    // E a empresa de outra pessoa continua fechada.
    const estranha = await registerAccount(api, { email: 'estranha@z.com.br', companyName: 'Empresa Tres' });
    expect([403, 404]).toContain((await client.get(`/api/tenants/${estranha.tenantId}`)).status);
  });

  it('preserva a assinatura e o plano', async () => {
    const dono = await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    await api.db.update(schema.subscriptions).set({ status: 'active', providerStatus: 'ACTIVE' }).where(eq(schema.subscriptions.tenantId, dono.tenantId));
    const [antes] = await api.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, dono.tenantId));

    await signIn(api.client(), 'cliente@empresa.com.br');

    const [depois] = await api.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, dono.tenantId));
    expect(depois).toEqual(antes);
  });

  it('nao concede o painel mestre: o papel de plataforma fica como estava', async () => {
    await primeiraContaDaInstalacao();
    await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    const client = api.client();
    await signIn(client, 'cliente@empresa.com.br');
    expect((await sessionOf(client))!.user.platformRole).toBe('none');

    await api.db.update(schema.users).set({ platformRole: 'platform_admin' }).where(eq(schema.users.email, 'cliente@empresa.com.br'));
    advance(61);
    const admin = api.client();
    await signIn(admin, 'cliente@empresa.com.br');
    expect((await sessionOf(admin))!.user.platformRole).toBe('platform_admin');
  });

  it('o e-mail so e verificado depois do codigo, e o login por senha segue valendo se ja estava verificado', async () => {
    const dono = await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    await verifyEmail(api, dono);

    await signIn(api.client(), 'cliente@empresa.com.br');

    const login = await api.client().post('/api/auth/login', { email: 'cliente@empresa.com.br', password: dono.password });
    expect(login.status).toBe(200);
  });

  it('conta que nunca teve o e-mail verificado: o codigo o verifica, remove a senha antiga e encerra as sessoes antigas', async () => {
    await primeiraContaDaInstalacao();
    // Alguem abriu a conta com este e-mail e uma senha; o e-mail nunca foi confirmado.
    const intruso = await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa Aberta Por Outro' });
    expect((await sessionOf(intruso.client))?.user.emailVerified).toBe(false);
    expect(await sessionOf(intruso.client)).not.toBeNull();

    // A dona do e-mail entra pelo codigo.
    const dona = api.client();
    const response = await signIn(dona, 'cliente@empresa.com.br');

    expect(response.status).toBe(200);
    expect(response.body.session.user.emailVerified).toBe(true);
    expect(response.body.notice).toMatch(/senha antiga/);
    // A senha plantada nao abre mais a conta, e a sessao do intruso caiu.
    const tentativa = await api.client().post('/api/auth/login', { email: 'cliente@empresa.com.br', password: intruso.password });
    expect(tentativa.status).toBe(401);
    expect(await sessionOf(intruso.client)).toBeNull();
    // Os dados da conta seguem la.
    expect((await sessionOf(dona))!.memberships).toHaveLength(1);
    expect(await tenantsCount()).toBe(2); // a do instalador e a desta conta: nada foi criado ou apagado
    expect((await audit('user.email_verified')).some((l) => (l.metadata as { via?: string }).via === 'login_code')).toBe(true);
  });

  it('respeita o convite pendente: entra, mas nao ativa o vinculo nem cria usuario', async () => {
    const dono = await registerAccount(api, { email: 'dono@empresa.com.br', companyName: 'Empresa' });
    await verifyEmail(api, dono);
    await dono.client.post(`/api/tenants/${dono.tenantId}/members/invite`, { email: 'convidado@gmail.com', role: 'editor', name: 'Convidado' });
    const usuarios = await usersCount();

    const client = api.client();
    const response = await signIn(client, 'convidado@gmail.com');

    expect(response.body.status).toBe('authenticated');
    expect(response.body.session.memberships).toEqual([]);
    expect(await usersCount()).toBe(usuarios);
    const [vinculo] = await api.db.select().from(schema.memberships).where(eq(schema.memberships.status, 'invited'));
    expect(vinculo).toMatchObject({ tenantId: dono.tenantId, role: 'editor' });

    // O convite continua valido pelo seu proprio caminho.
    const mensagem = [...api.outbox].reverse().find((m) => m.kind === 'invitation' && m.to === 'convidado@gmail.com');
    const aceite = await api.client().post('/api/auth/accept-invite', { token: extractToken(mensagem!.text), name: 'Convidado', password: 'senhaSegura123' });
    expect(aceite.status, aceite.errorMessage ?? '').toBe(200);
  });
});

describe('cliente novo', () => {
  async function prove(client: TestClient, email: string) {
    const response = await signIn(client, email);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    return response;
  }

  it('provar o codigo nao cria conta: pede o cadastro', async () => {
    const client = api.client();
    const response = await prove(client, 'novo@empresa.com.br');

    expect(response.body).toEqual({ status: 'registration_required', email: 'novo@empresa.com.br' });
    expect(client.sessionCookie).toBeNull();
    expect(await usersCount()).toBe(0);
    expect(await tenantsCount()).toBe(0);
    const proof = response.headers.getSetCookie().find((c) => c.startsWith('codeca_signup_proof='))!;
    expect(proof).toMatch(/HttpOnly/i);
    expect(proof).toMatch(/Path=\/api\/auth\/code/);
  });

  it('conclui o cadastro: conta (e-mail verificado, sem senha), empresa, vinculo, site e avaliacao', async () => {
    const client = api.client();
    await prove(client, 'novo@empresa.com.br');

    const response = await client.post(`${CODE}/register`, {
      name: 'Joana Prado',
      companyName: 'Clinica Bem Viver',
      phone: '(19) 98888-0000',
      acceptedTerms: true,
    });

    expect(response.status, response.errorMessage ?? '').toBe(201);
    const [user] = await api.db.select().from(schema.users).where(eq(schema.users.email, 'novo@empresa.com.br'));
    expect(user).toMatchObject({ name: 'Joana Prado', passwordHash: null, phone: '(19) 98888-0000', platformRole: 'none' });
    expect(user?.emailVerifiedAt).not.toBeNull();
    const [tenant] = await api.db.select().from(schema.tenants);
    expect(tenant).toMatchObject({ displayName: 'Clinica Bem Viver', status: 'trialing', contactEmail: 'novo@empresa.com.br' });
    expect(await api.db.select().from(schema.memberships)).toEqual([
      expect.objectContaining({ tenantId: tenant!.id, userId: user!.id, role: 'owner', status: 'active' }),
    ]);
    expect(await api.db.select().from(schema.sites)).toHaveLength(1);
    expect(await api.db.select().from(schema.subscriptions)).toEqual([expect.objectContaining({ status: 'trialing' })]);

    const session = await sessionOf(client);
    expect(session?.user).toMatchObject({ email: 'novo@empresa.com.br', emailVerified: true, hasPassword: false, platformRole: 'none' });
    expect(session?.memberships).toHaveLength(1);
    expect(await audit('user.code_registered')).toHaveLength(1);
  });

  it('nunca concede o painel mestre, nem em instalacao sem administrador', async () => {
    const client = api.client();
    await prove(client, 'novo@empresa.com.br');
    await client.post(`${CODE}/register`, { name: 'Joana Prado', companyName: 'Empresa Nova', acceptedTerms: true });

    const admins = await api.db.select().from(schema.users).where(eq(schema.users.platformRole, 'platform_admin'));
    expect(admins).toHaveLength(0);
  });

  it('exige os termos e o nome, e nao cria nada quando faltam', async () => {
    const client = api.client();
    await prove(client, 'novo@empresa.com.br');

    expect((await client.post(`${CODE}/register`, { name: 'Joana Prado', companyName: 'Empresa Nova', acceptedTerms: false })).status).toBe(422);
    expect((await client.post(`${CODE}/register`, { name: '', companyName: 'Empresa Nova', acceptedTerms: true })).status).toBe(422);
    expect((await client.post(`${CODE}/register`, { name: 'Joana Prado', companyName: '', acceptedTerms: true })).status).toBe(422);
    expect(await usersCount()).toBe(0);
    expect(await tenantsCount()).toBe(0);
  });

  it('o e-mail do cadastro e o provado: o corpo da requisicao nao o muda', async () => {
    const client = api.client();
    await prove(client, 'novo@empresa.com.br');

    await client.post(`${CODE}/register`, {
      name: 'Joana Prado',
      companyName: 'Empresa Nova',
      acceptedTerms: true,
      email: 'vitima@outra.com.br',
    });

    const emails = (await api.db.select().from(schema.users)).map((u) => u.email);
    expect(emails).toEqual(['novo@empresa.com.br']);
  });

  it('sem o comprovante (ou com um falso ou vencido), nao cadastra', async () => {
    const corpo = { name: 'Joana Prado', companyName: 'Empresa Nova', acceptedTerms: true };

    expect((await api.client().post(`${CODE}/register`, corpo)).status).toBe(401);

    const falso = api.client();
    falso.setCookie('codeca_signup_proof', 'eyJlIjoidml0aW1hQG91dHJhLmNvbS5iciIsIngiOjk5OTk5OTk5OTk5OTl9.assinatura-falsa');
    expect((await falso.post(`${CODE}/register`, corpo)).status).toBe(401);

    const vencido = api.client();
    await prove(vencido, 'novo@empresa.com.br');
    advance(21 * 60);
    expect((await vencido.post(`${CODE}/register`, corpo)).status).toBe(401);

    expect(await usersCount()).toBe(0);
    expect(await tenantsCount()).toBe(0);
  });

  it('o comprovante de um e-mail nao serve para outro (adulterado)', async () => {
    const client = api.client();
    await prove(client, 'novo@empresa.com.br');
    // Troca o e-mail dentro do comprovante, mantendo a assinatura antiga.
    const adulterado = api.client();
    const payload = Buffer.from(JSON.stringify({ e: 'outra.pessoa@empresa.com.br', x: clock.getTime() + 600_000 })).toString('base64url');
    adulterado.setCookie('codeca_signup_proof', `${payload}.assinatura-de-outro-payload`);
    const response = await adulterado.post(`${CODE}/register`, { name: 'Joana Prado', companyName: 'Empresa Nova', acceptedTerms: true });
    expect(response.status).toBe(401);
    expect(await usersCount()).toBe(0);
  });

  it('o comprovante vale uma vez: repetir o cadastro nao duplica conta nem empresa', async () => {
    const client = api.client();
    await prove(client, 'novo@empresa.com.br');
    const corpo = { name: 'Joana Prado', companyName: 'Empresa Nova', acceptedTerms: true };

    expect((await client.post(`${CODE}/register`, corpo)).status).toBe(201);
    const segunda = await client.post(`${CODE}/register`, corpo);

    expect(segunda.status).toBe(401);
    expect(await usersCount()).toBe(1);
    expect(await tenantsCount()).toBe(1);
  });

  it('se a conta passou a existir entre a prova e o cadastro, nao duplica', async () => {
    const client = api.client();
    await prove(client, 'novo@empresa.com.br');
    await registerAccount(api, { email: 'novo@empresa.com.br', companyName: 'Empresa Aberta No Meio' });

    const response = await client.post(`${CODE}/register`, { name: 'Joana Prado', companyName: 'Empresa Nova', acceptedTerms: true });

    expect(response.status).toBe(409);
    expect(await usersCount()).toBe(1);
    expect(await tenantsCount()).toBe(1);
  });

  it('a mesma pessoa nao fica com duas empresas ao repetir o fluxo: na segunda vez entra na conta', async () => {
    const primeiro = api.client();
    await prove(primeiro, 'novo@empresa.com.br');
    await primeiro.post(`${CODE}/register`, { name: 'Joana Prado', companyName: 'Empresa Nova', acceptedTerms: true });
    advance(61);

    const segundo = api.client();
    const response = await signIn(segundo, 'novo@empresa.com.br');

    expect(response.body.status).toBe('authenticated');
    expect(await tenantsCount()).toBe(1);
    expect(await usersCount()).toBe(1);
  });
});

describe('sessao, atualizar a pagina e sair', () => {
  it('a sessao persiste ao recarregar e o logout a encerra no banco', async () => {
    await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    const client = api.client();
    await signIn(client, 'cliente@empresa.com.br');
    const cookie = client.sessionCookie!;

    // "Atualizar a pagina": o painel pergunta a sessao de novo, so com o cookie.
    for (let i = 0; i < 3; i += 1) expect((await sessionOf(client))?.user.email).toBe('cliente@empresa.com.br');

    expect((await client.post('/api/auth/logout')).status).toBe(204);
    expect(await sessionOf(client)).toBeNull();
    const reusado = api.client();
    reusado.setCookie('codeca_session', cookie);
    expect(await sessionOf(reusado)).toBeNull();
  });

  it('a sessao expira como qualquer outra', async () => {
    await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    const client = api.client();
    await signIn(client, 'cliente@empresa.com.br');
    advance(13 * 3600);
    expect(await sessionOf(client)).toBeNull();
  });

  it('operacoes que alteram estado continuam exigindo o token anti-CSRF', async () => {
    const dono = await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    const client = api.client();
    await signIn(client, 'cliente@empresa.com.br');
    const response = await client.patch(`/api/tenants/${dono.tenantId}`, { displayName: 'Outro Nome' }, { omitCsrf: true });
    expect(response.status).toBe(403);
  });

  it('o login por codigo e o do Google usam a mesma sessao e a mesma conta', async () => {
    // Maria entra pelo Google (conta nova, e-mail confirmado pelo Google).
    const pelaGoogle = api.client();
    const maria = { sub: 'google-sub-maria', email: 'maria@gmail.com', name: 'Maria Souza' };
    await signInWithGoogle(pelaGoogle, google, maria);
    const idGoogle = (await sessionOf(pelaGoogle))!.user.id;
    await pelaGoogle.post('/api/auth/logout');
    advance(61);

    // Depois entra pelo codigo, com o mesmo e-mail: e a MESMA conta.
    const pelaCodigo = api.client();
    const response = await signIn(pelaCodigo, 'maria@gmail.com');

    expect(response.body.status).toBe('authenticated');
    expect(response.body.session.user.id).toBe(idGoogle);
    expect(await usersCount()).toBe(1);
    // Os dois metodos coexistem: o Google continua vinculado e entrando.
    const denovo = api.client();
    const result = await signInWithGoogle(denovo, google, maria);
    expect(result.location).not.toContain('google=');
    expect((await sessionOf(denovo))!.user.id).toBe(idGoogle);
    // Mesmo sistema de sessao: as tres entradas geraram linhas em `sessions`, com o mesmo cookie.
    expect((await api.db.select().from(schema.sessions)).length).toBe(3);
    expect(denovo.sessionCookie).toBeTruthy();
    expect(pelaCodigo.sessionCookie).toBeTruthy();
  });

  it('o login com e-mail e senha continua funcionando', async () => {
    const dono = await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });
    await verifyEmail(api, dono);
    const login = await api.client().post('/api/auth/login', { email: dono.email, password: dono.password });
    expect(login.status).toBe(200);
  });
});

describe('o codigo nao vaza em lugar nenhum', () => {
  it('nem em log, nem em auditoria, nem na sessao, em um fluxo completo', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      await registerAccount(api, { email: 'existe@empresa.com.br', companyName: 'Empresa' });
      await request(api.client(), 'existe@empresa.com.br');
      const certo = codeSentTo('existe@empresa.com.br');
      await verify(api.client(), 'existe@empresa.com.br', wrongCodeFor(certo));
      const entrada = await verify(api.client(), 'existe@empresa.com.br', certo);

      await request(api.client(), 'novo@empresa.com.br');
      const novo = codeSentTo('novo@empresa.com.br');
      for (let i = 0; i < 5; i += 1) await verify(api.client(), 'novo@empresa.com.br', wrongCodeFor(novo));
      await verify(api.client(), 'novo@empresa.com.br', novo);

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
      expect(JSON.stringify(entrada.body)).not.toContain(certo);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe('sem provedor de e-mail e com e-mail que falha', () => {
  it('sem RESEND_API_KEY o recurso aparece desligado e a rota recusa (sem simular envio)', async () => {
    const semEmail = await createTestApi({ now: () => clock });
    try {
      expect((await semEmail.client().get('/api/auth/session')).body.features.emailCodeAuth).toBe(false);
      const response = await semEmail.client().post(`${CODE}/request`, { email: 'cliente@empresa.com.br' });
      expect(response.status).toBe(501);
      expect(response.errorCode).toBe('integration_not_configured');
      expect(response.errorMessage).toMatch(/RESEND_API_KEY/);
      expect(await semEmail.db.select().from(schema.loginCodes)).toHaveLength(0);
    } finally {
      await semEmail.close();
    }
  });

  it('se o provedor falha, o codigo nao fica valendo e a pessoa e avisada', async () => {
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
      const response = await falho.client().post(`${CODE}/request`, { email: 'cliente@empresa.com.br' });
      expect(response.status).toBe(502);
      expect(response.errorMessage).toMatch(/Não foi possível enviar o e-mail/);
      expect(await falho.db.select().from(schema.loginCodes)).toHaveLength(0);

      // Tentou enviar o codigo certo (o de uma linha que acabou apagada): nao vale mais.
      const code = sent[0]!.text.match(/\n(\d{6})\n/)![1]!;
      const tentativa = await falho.client().post(`${CODE}/verify`, { email: 'cliente@empresa.com.br', code });
      expect(tentativa.status).toBe(401);
    } finally {
      await falho.close();
    }
  });
});

