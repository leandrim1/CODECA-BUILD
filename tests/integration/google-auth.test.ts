import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  extractToken,
  registerAccount,
  verifyEmail,
  TEST_APP_ORIGIN,
  type TestApi,
  type TestClient,
} from '../helpers/api.js';
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  callbackOf,
  createFakeGoogle,
  signInWithGoogle,
  type FakeGoogle,
  type GoogleIdentity,
} from '../helpers/google.js';

/**
 * Login com Google.
 *
 * O Google aqui e falso, mas fiel no que importa: valida o PKCE de ponta a
 * ponta, trata o codigo como de uso unico e assina o `id_token` com RS256. O
 * que se quer provar e o que a API faz com cada resposta -- principalmente que
 * nenhuma delas entrega uma conta a quem nao a controla.
 */

let clock = new Date('2026-06-01T12:00:00Z');
let google: FakeGoogle;
let api: TestApi;

const MARIA: GoogleIdentity = { sub: 'google-sub-maria', email: 'maria@gmail.com', name: 'Maria Souza' };

beforeAll(async () => {
  google = createFakeGoogle({ now: () => clock });
  api = await createTestApi({
    now: () => clock,
    fetch: google.fetch,
    env: { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET },
  });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  clock = new Date('2026-06-01T12:00:00Z');
  await api.reset();
  google.state.failToken = false;
  google.state.failCerts = false;
  google.calls.length = 0;
});

const usersCount = async () => (await api.db.select({ id: schema.users.id }).from(schema.users)).length;
const identities = () => api.db.select().from(schema.userIdentities);
const audit = (action: string) =>
  api.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, action));
const sessionOf = async (client: TestClient) =>
  (await client.get('/api/auth/session')).body.session as {
    user: { id: string; email: string; hasPassword: boolean; google: { email: string } | null; platformRole: string };
    memberships: Array<{ tenantId: string; role: string }>;
  } | null;

/** Cria a conta Google da Maria e devolve o cliente ja logado. */
async function googleUser(identity: GoogleIdentity = MARIA) {
  const client = api.client();
  const result = await signInWithGoogle(client, google, identity);
  expect(result.location).toBe('/criar-empresa');
  return client;
}

describe('configuracao do fluxo', () => {
  it('monta a URL do Google com PKCE, state e nonce, sem expor o segredo', async () => {
    const client = api.client();
    const response = await client.post('/api/auth/google/start', { intent: 'continue' });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body)).toEqual(['authorizationUrl']);
    const url = new URL(response.body.authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(GOOGLE_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(`${TEST_APP_ORIGIN}/api/auth/google/callback`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(response.body.authorizationUrl).not.toContain(GOOGLE_CLIENT_SECRET);
    // O verifier do PKCE nunca vai na URL: so o desafio.
    expect(url.searchParams.get('code_verifier')).toBeNull();
  });

  it('o cookie do state e HttpOnly, Lax, restrito ao fluxo e de vida curta', async () => {
    const response = await api.client().post('/api/auth/google/start', { intent: 'continue' });
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith('codeca_oauth_state='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/google/);
    expect(cookie).toMatch(/Max-Age=600/);
  });

  it('o state fica no banco so como hash', async () => {
    const response = await api.client().post('/api/auth/google/start', { intent: 'continue' });
    const state = new URL(response.body.authorizationUrl).searchParams.get('state')!;
    const rows = await api.db.select().from(schema.oauthStates);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(state);
  });

  it('recusa o inicio vindo de outra origem', async () => {
    const response = await api.client().post('/api/auth/google/start', { intent: 'continue' }, { origin: 'https://evil.test' });
    expect(response.status).toBe(403);
    expect(await api.db.select().from(schema.oauthStates)).toHaveLength(0);
  });

  it('informa na sessao que o login com Google esta disponivel', async () => {
    const response = await api.client().get('/api/auth/session');
    expect(response.body.features.googleAuth).toBe(true);
  });
});

describe('usuario novo', () => {
  it('cria so o usuario: sem senha, e-mail confirmado, sem empresa e sem papel de plataforma', async () => {
    const client = api.client();
    const result = await signInWithGoogle(client, google, MARIA);

    expect(result.status).toBe(302);
    expect(result.location).toBe('/criar-empresa');

    const [user] = await api.db.select().from(schema.users).where(eq(schema.users.email, 'maria@gmail.com'));
    expect(user?.passwordHash).toBeNull();
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(user?.name).toBe('Maria Souza');
    // Instalacao sem administrador: o Google NUNCA concede o painel mestre.
    expect(user?.platformRole).toBe('none');

    expect(await api.db.select().from(schema.memberships)).toHaveLength(0);
    expect(await api.db.select().from(schema.tenants)).toHaveLength(0);
    const [identity] = await identities();
    expect(identity).toMatchObject({ userId: user!.id, provider: 'google', providerSubject: MARIA.sub });

    const session = await sessionOf(client);
    expect(session?.user).toMatchObject({ email: 'maria@gmail.com', hasPassword: false, google: { email: 'maria@gmail.com' } });
    expect(session?.memberships).toEqual([]);
    expect(await audit('user.google_registered')).toHaveLength(1);
  });

  it('a sessao e cookie HttpOnly e o retorno nao carrega token algum', async () => {
    const client = api.client();
    const result = await signInWithGoogle(client, google, MARIA);

    const cookies = result.headers.getSetCookie();
    const sessionCookie = cookies.find((c) => c.startsWith('codeca_session='))!;
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);
    expect(sessionCookie).toMatch(/Path=\//);
    // O cookie do state e apagado depois de usado.
    expect(cookies.find((c) => c.startsWith('codeca_oauth_state='))).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    // Nada do Google viaja para o navegador: so um destino interno.
    expect(result.location).not.toMatch(/token|code=|ya29|id_token/);
    expect(result.location.startsWith('/')).toBe(true);
  });

  it('nenhum token do Google e guardado em lugar algum', async () => {
    await googleUser();
    const dump = JSON.stringify({
      users: await api.db.select().from(schema.users),
      identities: await identities(),
      sessions: await api.db.select().from(schema.sessions),
      states: await api.db.select().from(schema.oauthStates),
      audit: await api.db.select().from(schema.auditLogs),
    });
    expect(dump).not.toContain('ya29');
    expect(dump).not.toContain(GOOGLE_CLIENT_SECRET);
    expect(dump).not.toContain('id_token');
  });

  it('a empresa nasce pelo mesmo cadastro do e-mail e senha, depois de informada', async () => {
    const client = await googleUser();

    const response = await client.post('/api/auth/company', {
      companyName: 'Clinica Bem Viver',
      phone: '(19) 98888-0000',
      acceptedTerms: true,
    });

    expect(response.status, response.errorMessage ?? '').toBe(201);
    const [tenant] = await api.db.select().from(schema.tenants);
    expect(tenant).toMatchObject({ displayName: 'Clinica Bem Viver', status: 'trialing', contactEmail: 'maria@gmail.com' });
    const [membership] = await api.db.select().from(schema.memberships);
    expect(membership).toMatchObject({ tenantId: tenant!.id, role: 'owner', status: 'active' });
    const [subscription] = await api.db.select().from(schema.subscriptions);
    expect(subscription).toMatchObject({ tenantId: tenant!.id, status: 'trialing' });
    expect(await api.db.select().from(schema.sites)).toHaveLength(1);

    const session = await sessionOf(client);
    expect(session?.memberships).toHaveLength(1);
    expect(session?.memberships[0]).toMatchObject({ role: 'owner' });
    expect(session?.user.platformRole).toBe('none');
  });

  it('exige aceitar os termos e nao cria uma segunda empresa', async () => {
    const client = await googleUser();
    const semTermos = await client.post('/api/auth/company', { companyName: 'Empresa Um', acceptedTerms: false });
    expect(semTermos.status).toBe(422);
    expect(await api.db.select().from(schema.tenants)).toHaveLength(0);

    await client.post('/api/auth/company', { companyName: 'Empresa Um', acceptedTerms: true });
    const segunda = await client.post('/api/auth/company', { companyName: 'Empresa Dois', acceptedTerms: true });
    expect(segunda.status).toBe(409);
    expect(await api.db.select().from(schema.tenants)).toHaveLength(1);
  });

  it('o cadastro de empresa exige estar logado', async () => {
    const response = await api.client().post('/api/auth/company', { companyName: 'Empresa Um', acceptedTerms: true });
    expect(response.status).toBe(401);
  });

  it('sem empresa, nao enxerga a empresa de ninguem', async () => {
    const client = await googleUser();
    const outro = await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Alpha' });

    const detalhe = await client.get(`/api/tenants/${outro.tenantId}`);
    const conteudo = await client.get(`/api/tenants/${outro.tenantId}/properties`);

    expect([403, 404]).toContain(detalhe.status);
    expect([403, 404]).toContain(conteudo.status);
  });
});

describe('usuario que ja entra pelo Google', () => {
  it('entra de novo no mesmo usuario, sem duplicar nada', async () => {
    const primeiro = await googleUser();
    await primeiro.post('/api/auth/company', { companyName: 'Clinica Bem Viver', acceptedTerms: true });
    const idAntes = (await sessionOf(primeiro))!.user.id;
    const usuarios = await usersCount();
    const empresas = (await api.db.select().from(schema.tenants)).length;

    const segundo = api.client();
    const result = await signInWithGoogle(segundo, google, MARIA);

    expect(result.location).toBe('/painel');
    expect((await sessionOf(segundo))!.user.id).toBe(idAntes);
    expect(await usersCount()).toBe(usuarios);
    expect((await api.db.select().from(schema.tenants)).length).toBe(empresas);
    expect(await identities()).toHaveLength(1);
    expect(await audit('user.google_logged_in')).toHaveLength(1);
  });

  it('respeita o destino pedido, mas so se for interno', async () => {
    const primeiro = await googleUser();
    await primeiro.post('/api/auth/company', { companyName: 'Clinica Bem Viver', acceptedTerms: true });

    const interno = await signInWithGoogle(api.client(), google, MARIA, { next: '/painel/imoveis' });
    expect(interno.location).toBe('/painel/imoveis');

    for (const next of ['https://evil.test/x', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '/outra-area']) {
      const result = await signInWithGoogle(api.client(), google, MARIA, { next });
      expect(result.location, next).toBe('/painel');
    }
  });

  it('continua entrando mesmo que o e-mail da conta Google tenha mudado', async () => {
    const primeiro = await googleUser();
    const id = (await sessionOf(primeiro))!.user.id;

    const result = await signInWithGoogle(api.client(), google, { ...MARIA, email: 'maria.nova@gmail.com' });

    expect(result.status).toBe(302);
    expect(result.location).not.toContain('google=');
    const [user] = await api.db.select().from(schema.users).where(eq(schema.users.id, id));
    // O e-mail da conta da plataforma nao muda sozinho; so o do vinculo (informativo).
    expect(user?.email).toBe('maria@gmail.com');
    expect((await identities())[0]?.email).toBe('maria.nova@gmail.com');
    expect(await usersCount()).toBe(1);
  });

  it('preserva todas as empresas e papeis de quem tem mais de uma', async () => {
    const maria = await googleUser();
    await maria.post('/api/auth/company', { companyName: 'Empresa Um', acceptedTerms: true });
    const outra = await registerAccount(api, { email: 'dono@beta.com.br', companyName: 'Beta' });
    const mariaId = (await sessionOf(maria))!.user.id;
    await api.db.insert(schema.memberships).values({
      tenantId: outra.tenantId,
      userId: mariaId,
      role: 'editor',
      status: 'active',
      acceptedAt: clock,
    });

    const nova = api.client();
    await signInWithGoogle(nova, google, MARIA);
    const session = await sessionOf(nova);

    expect(session?.memberships).toHaveLength(2);
    expect(session!.memberships.map((m) => m.role).sort()).toEqual(['editor', 'owner']);
    // O papel de editor continua sendo de editor: Google nao promove ninguem.
    const proibido = await nova.post(`/api/tenants/${outra.tenantId}/members/invite`, {
      email: 'alguem@beta.com.br',
      role: 'viewer',
    });
    expect(proibido.status).toBe(403);
  });

  it('quem nao tem empresa volta para o cadastro dela', async () => {
    await googleUser();
    const result = await signInWithGoogle(api.client(), google, MARIA);
    expect(result.location).toBe('/criar-empresa');
  });
});

describe('e-mail que ja existe', () => {
  it('nao entra nem vincula so porque o e-mail e igual', async () => {
    const dono = await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Alpha' });
    const usuarios = await usersCount();

    const client = api.client();
    const result = await signInWithGoogle(client, google, { sub: 'sub-outra-pessoa', email: 'dono@alpha.com.br' });

    expect(result.status).toBe(302);
    expect(result.location).toBe('/entrar?google=email_in_use');
    expect(client.sessionCookie).toBeNull();
    expect(await sessionOf(client)).toBeNull();
    expect(await usersCount()).toBe(usuarios);
    expect(await identities()).toHaveLength(0);
    expect(await api.db.select().from(schema.tenants)).toHaveLength(1);

    const [bloqueio] = await audit('user.google_login_blocked');
    expect(bloqueio?.metadata).toMatchObject({ reason: 'email_in_use' });
    expect(bloqueio?.actorUserId).toBe(dono.userId);
  });

  it('o login com e-mail e senha continua funcionando depois da tentativa', async () => {
    await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Alpha', password: 'senhaSegura123' });
    await signInWithGoogle(api.client(), google, { sub: 'sub-x', email: 'dono@alpha.com.br' });

    const client = api.client();
    const login = await client.post('/api/auth/login', { email: 'dono@alpha.com.br', password: 'senhaSegura123' });
    expect(login.status).toBe(200);
    expect(login.body.session.memberships).toHaveLength(1);
  });

  it('o e-mail e comparado sem diferenca de maiusculas', async () => {
    await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Alpha' });
    const result = await signInWithGoogle(api.client(), google, { sub: 'sub-y', email: 'Dono@Alpha.com.BR' });
    expect(result.location).toBe('/entrar?google=email_in_use');
    expect(await identities()).toHaveLength(0);
  });

  it('respeita o convite pendente: nao cria usuario, nao ativa o vinculo e o convite segue valido', async () => {
    const dono = await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Alpha' });
    await verifyEmail(api, dono);
    const convite = await dono.client.post(`/api/tenants/${dono.tenantId}/members/invite`, {
      email: 'convidado@gmail.com',
      role: 'editor',
      name: 'Convidado',
    });
    expect(convite.status, convite.errorMessage ?? '').toBe(201);
    const usuarios = await usersCount();

    const client = api.client();
    const result = await signInWithGoogle(client, google, { sub: 'sub-convidado', email: 'convidado@gmail.com' });

    expect(result.location).toBe('/entrar?google=email_in_use');
    expect(client.sessionCookie).toBeNull();
    expect(await usersCount()).toBe(usuarios);
    expect(await identities()).toHaveLength(0);
    const [vinculo] = await api.db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.status, 'invited'));
    expect(vinculo).toMatchObject({ tenantId: dono.tenantId, role: 'editor', status: 'invited' });

    // O caminho do convite continua intacto.
    const mensagem = [...api.outbox].reverse().find((m) => m.kind === 'invitation' && m.to === 'convidado@gmail.com');
    const aceite = await api.client().post('/api/auth/accept-invite', {
      token: extractToken(mensagem!.text),
      name: 'Convidado',
      password: 'senhaSegura123',
    });
    expect(aceite.status, aceite.errorMessage ?? '').toBe(200);
    expect(aceite.body.session.memberships[0]).toMatchObject({ tenantId: dono.tenantId, role: 'editor' });
  });

  it('e-mail nao verificado pelo Google nao cria conta', async () => {
    const usuarios = await usersCount();
    const result = await signInWithGoogle(api.client(), google, { ...MARIA, emailVerified: false });
    expect(result.location).toBe('/entrar?google=unverified_email');
    expect(await usersCount()).toBe(usuarios);
    expect(await identities()).toHaveLength(0);
  });

  it('o e-mail verificado em forma de texto ("true") tambem vale', async () => {
    const result = await signInWithGoogle(api.client(), google, { ...MARIA, emailVerified: 'true' });
    expect(result.location).toBe('/criar-empresa');
  });
});

describe('vincular o Google a uma conta que ja existe', () => {
  const startLink = (client: TestClient, password: string) =>
    client.post('/api/auth/google/start', { intent: 'link', password });

  async function completeLink(client: TestClient, identity: GoogleIdentity) {
    const start = await startLink(client, 'senhaSegura123');
    expect(start.status, start.errorMessage ?? '').toBe(200);
    const url = start.body.authorizationUrl as string;
    const code = google.authorize(url, identity);
    return callbackOf(client, { code, state: new URL(url).searchParams.get('state')! });
  }

  it('exige estar logado', async () => {
    const response = await api.client().post('/api/auth/google/start', { intent: 'link', password: 'senhaSegura123' });
    expect(response.status).toBe(401);
  });

  it('exige a senha da conta: senha errada nao abre o fluxo', async () => {
    const dono = await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Alpha' });
    const errada = await startLink(dono.client, 'senha-errada-123');
    const semSenha = await dono.client.post('/api/auth/google/start', { intent: 'link' });

    expect(errada.status).toBe(422);
    expect(semSenha.status).toBe(422);
    expect(await api.db.select().from(schema.oauthStates)).toHaveLength(0);
  });

  it('quem prova a senha e o Google vincula; depois entra por ele no mesmo usuario', async () => {
    const dono = await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Alpha' });
    const usuarios = await usersCount();

    // O e-mail do Google pode ser diferente do da conta: o que prova e a senha.
    const result = await completeLink(dono.client, { sub: 'google-do-dono', email: 'dono.pessoal@gmail.com' });

    expect(result.location).toBe('/painel/empresa?google=linked');
    expect(await usersCount()).toBe(usuarios);
    const [identity] = await identities();
    expect(identity).toMatchObject({ userId: dono.userId, providerSubject: 'google-do-dono' });
    expect((await sessionOf(dono.client))!.user.google).toEqual({ email: 'dono.pessoal@gmail.com' });
    expect(await audit('user.google_linked')).toHaveLength(1);

    const outro = api.client();
    const login = await signInWithGoogle(outro, google, { sub: 'google-do-dono', email: 'dono.pessoal@gmail.com' });
    expect(login.location).toBe('/painel');
    const session = await sessionOf(outro);
    expect(session!.user.id).toBe(dono.userId);
    expect(session!.memberships).toHaveLength(1);
    expect(session!.memberships[0]).toMatchObject({ tenantId: dono.tenantId, role: 'owner' });
  });

  it('uma conta Google ja vinculada a outro usuario nao e vinculada de novo', async () => {
    const a = await registerAccount(api, { email: 'a@alpha.com.br', companyName: 'Alpha' });
    const b = await registerAccount(api, { email: 'b@beta.com.br', companyName: 'Beta' });
    await completeLink(a.client, { sub: 'google-compartilhado', email: 'a@gmail.com' });

    const result = await completeLink(b.client, { sub: 'google-compartilhado', email: 'a@gmail.com' });

    expect(result.location).toBe('/painel/empresa?google=already_linked');
    const todas = await identities();
    expect(todas).toHaveLength(1);
    expect(todas[0]?.userId).toBe(a.userId);
    expect((await audit('user.google_login_blocked')).some((l) => (l.metadata as { reason?: string }).reason === 'already_linked')).toBe(true);
  });

  it('uma conta que ja tem Google nao vincula um segundo', async () => {
    const dono = await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Alpha' });
    await completeLink(dono.client, { sub: 'google-1', email: 'um@gmail.com' });

    const segundo = await startLink(dono.client, 'senhaSegura123');

    expect(segundo.status).toBe(409);
    expect(await identities()).toHaveLength(1);
  });

  it('o fluxo de vinculo nao termina em outra pessoa', async () => {
    const a = await registerAccount(api, { email: 'a@alpha.com.br', companyName: 'Alpha' });
    const b = await registerAccount(api, { email: 'b@beta.com.br', companyName: 'Beta' });
    const start = await startLink(a.client, 'senhaSegura123');
    const url = start.body.authorizationUrl as string;
    const state = new URL(url).searchParams.get('state')!;
    const code = google.authorize(url, { sub: 'google-de-a', email: 'a@gmail.com' });

    // O retorno chega ao navegador de B (com o cookie do state, mas outra sessao).
    b.client.setCookie('codeca_oauth_state', state);
    const result = await callbackOf(b.client, { code, state });

    expect(result.location).toBe('/painel/empresa?google=session_mismatch');
    expect(await identities()).toHaveLength(0);
  });

  it('um vinculo sem sessao no retorno nao vincula', async () => {
    const a = await registerAccount(api, { email: 'a@alpha.com.br', companyName: 'Alpha' });
    const start = await startLink(a.client, 'senhaSegura123');
    const url = start.body.authorizationUrl as string;
    const state = new URL(url).searchParams.get('state')!;
    const code = google.authorize(url, { sub: 'google-de-a', email: 'a@gmail.com' });

    const anonimo = api.client();
    anonimo.setCookie('codeca_oauth_state', state);
    const result = await callbackOf(anonimo, { code, state });

    expect(result.location).toBe('/painel/empresa?google=session_mismatch');
    expect(await identities()).toHaveLength(0);
  });

  it('desvincular exige a senha e deixa a conta entrando por senha', async () => {
    const dono = await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Alpha' });
    await completeLink(dono.client, { sub: 'google-1', email: 'dono@gmail.com' });

    const errada = await dono.client.post('/api/auth/google/unlink', { password: 'errada-12345' });
    expect(errada.status).toBe(422);
    expect(await identities()).toHaveLength(1);

    const certa = await dono.client.post('/api/auth/google/unlink', { password: 'senhaSegura123' });
    expect(certa.status).toBe(204);
    expect(await identities()).toHaveLength(0);
    expect(await audit('user.google_unlinked')).toHaveLength(1);

    // Sem vinculo, o mesmo Google nao entra na conta: o e-mail ja existe.
    const tentativa = await signInWithGoogle(api.client(), google, { sub: 'google-1', email: 'dono@alpha.com.br' });
    expect(tentativa.location).toBe('/entrar?google=email_in_use');
    const senha = await api.client().post('/api/auth/login', { email: 'dono@alpha.com.br', password: 'senhaSegura123' });
    expect(senha.status).toBe(200);
  });

  it('quem so tem o Google (sem senha) nao consegue desvincular e ficar sem acesso', async () => {
    const maria = await googleUser();
    const response = await maria.post('/api/auth/google/unlink', { password: 'qualquer-coisa-123' });
    expect(response.status).toBe(422);
    expect(await identities()).toHaveLength(1);
  });
});

describe('cancelamento e retorno invalido', () => {
  async function startOnly(client: TestClient) {
    const start = await client.post('/api/auth/google/start', { intent: 'continue' });
    const url = start.body.authorizationUrl as string;
    return { url, state: new URL(url).searchParams.get('state')! };
  }

  it('cancelar na tela do Google volta ao login sem criar nada', async () => {
    const client = api.client();
    const { state } = await startOnly(client);

    const result = await callbackOf(client, { error: 'access_denied', state });

    expect(result.location).toBe('/entrar?google=cancelled');
    expect(client.sessionCookie).toBeNull();
    expect(await usersCount()).toBe(0);
    // O state foi gasto: o mesmo retorno nao serve de novo.
    const reuso = await callbackOf(client, { error: 'access_denied', state });
    expect(reuso.location).toBe('/entrar?google=invalid_state');
  });

  it('outro erro do Google vira falha generica, sem repassar o texto dele', async () => {
    const client = api.client();
    const { state } = await startOnly(client);
    const result = await callbackOf(client, { error: 'server_error', error_description: '<script>x</script>', state });
    expect(result.location).toBe('/entrar?google=failed');
  });

  it('retorno sem codigo e falha', async () => {
    const client = api.client();
    const { state } = await startOnly(client);
    expect((await callbackOf(client, { state })).location).toBe('/entrar?google=failed');
  });

  it('retorno sem o cookie do navegador que comecou e recusado (login CSRF)', async () => {
    const client = api.client();
    const { url, state } = await startOnly(client);
    const code = google.authorize(url, MARIA);

    const outroNavegador = api.client();
    const result = await callbackOf(outroNavegador, { code, state });

    expect(result.location).toBe('/entrar?google=invalid_state');
    expect(outroNavegador.sessionCookie).toBeNull();
    expect(await usersCount()).toBe(0);
  });

  it('state diferente do cookie e recusado', async () => {
    const client = api.client();
    const { url } = await startOnly(client);
    const code = google.authorize(url, MARIA);
    const result = await callbackOf(client, { code, state: 'state-forjado-que-nao-existe-1234567890' });
    expect(result.location).toBe('/entrar?google=invalid_state');
    expect(await usersCount()).toBe(0);
  });

  it('state inventado, ate com cookie igual, nao existe no banco e e recusado', async () => {
    const client = api.client();
    client.setCookie('codeca_oauth_state', 'inventado-por-quem-ataca-1234567890abcdef');
    const code = google.authorize('https://x.test/?nonce=n&code_challenge=c&redirect_uri=r', MARIA);
    const result = await callbackOf(client, { code, state: 'inventado-por-quem-ataca-1234567890abcdef' });
    expect(result.location).toBe('/entrar?google=invalid_state');
  });

  it('repetir o mesmo retorno nao cria sessao duas vezes', async () => {
    const client = api.client();
    const { url, state } = await startOnly(client);
    const code = google.authorize(url, MARIA);

    const primeira = await callbackOf(client, { code, state });
    expect(primeira.location).toBe('/criar-empresa');
    const sessoes = (await api.db.select().from(schema.sessions)).length;

    const outro = api.client();
    outro.setCookie('codeca_oauth_state', state);
    const segunda = await callbackOf(outro, { code, state });
    expect(segunda.location).toBe('/entrar?google=invalid_state');
    expect((await api.db.select().from(schema.sessions)).length).toBe(sessoes);
  });

  it('o state vence em 10 minutos', async () => {
    const client = api.client();
    const { url, state } = await startOnly(client);
    const code = google.authorize(url, MARIA);

    clock = new Date(clock.getTime() + 11 * 60_000);
    const result = await callbackOf(client, { code, state });

    expect(result.location).toBe('/entrar?google=invalid_state');
    expect(await usersCount()).toBe(0);
  });

  it('um codigo ja usado no Google nao vira login', async () => {
    const client = api.client();
    const { url, state } = await startOnly(client);
    const code = google.authorize(url, MARIA);
    // Alguem gasta o codigo antes (o Google o trata como de uso unico).
    await google.fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code }).toString() });

    const result = await callbackOf(client, { code, state });
    expect(result.location).toBe('/entrar?google=invalid_token');
    expect(await usersCount()).toBe(0);
  });
});

describe('token invalido ou expirado', () => {
  const cases: Array<[string, Parameters<typeof signInWithGoogle>[3]]> = [
    ['emissor diferente do Google', { tamper: { iss: 'https://accounts.evil.test' } }],
    ['audiencia de outro cliente', { tamper: { aud: 'outro-cliente.apps.googleusercontent.com' } }],
    ['varias audiencias sem azp nosso', { tamper: { aud: [GOOGLE_CLIENT_ID, 'outro'], azp: 'outro' } }],
    ['token vencido', { tamper: { expiresInSeconds: -3600 } }],
    ['nonce de outra tentativa', { tamper: { nonce: 'nonce-de-outra-tentativa' } }],
    ['assinatura de outra chave', { tamper: { wrongKey: true } }],
    ['algoritmo none', { tamper: { alg: 'none' } }],
    ['algoritmo simetrico (HS256)', { tamper: { alg: 'HS256' } }],
    ['chave (kid) desconhecida', { tamper: { kid: 'chave-que-nao-existe' } }],
    ['sem sub', { tamper: { omitSub: true } }],
  ];

  for (const [name, options] of cases) {
    it(`recusa: ${name}`, async () => {
      const client = api.client();
      const result = await signInWithGoogle(client, google, MARIA, options);

      expect(result.location).toBe('/entrar?google=invalid_token');
      expect(client.sessionCookie).toBeNull();
      expect(await usersCount()).toBe(0);
      expect(await identities()).toHaveLength(0);
      expect((await audit('user.google_login_blocked')).length).toBeGreaterThan(0);
    });
  }

  it('aceita o emissor sem esquema ("accounts.google.com"), que o Google tambem usa', async () => {
    const result = await signInWithGoogle(api.client(), google, MARIA, { tamper: { iss: 'accounts.google.com' } });
    expect(result.location).toBe('/criar-empresa');
  });

  it('o Google fora do ar vira falha, sem login', async () => {
    google.state.failToken = true;
    const client = api.client();
    const result = await signInWithGoogle(client, google, MARIA);
    expect(result.location).toBe('/entrar?google=failed');
    expect(await usersCount()).toBe(0);
  });

  it('chaves do Google indisponiveis viram falha, sem login', async () => {
    google.state.failCerts = true;
    const result = await signInWithGoogle(api.client(), google, MARIA, { tamper: { kid: 'kid-novo-sem-cache' } });
    expect(result.location).toBe('/entrar?google=failed');
    expect(await usersCount()).toBe(0);
  });
});

describe('sessao, logout e coexistencia com a senha', () => {
  it('a sessao persiste entre requisicoes e o logout a encerra de verdade', async () => {
    const client = await googleUser();
    const cookie = client.sessionCookie!;

    expect((await sessionOf(client))?.user.email).toBe('maria@gmail.com');
    expect((await sessionOf(client))?.user.email).toBe('maria@gmail.com');

    const logout = await client.post('/api/auth/logout');
    expect(logout.status).toBe(204);
    expect(await sessionOf(client)).toBeNull();

    // O cookie antigo, reapresentado, ja nao vale: a sessao foi revogada no banco.
    const reusado = api.client();
    reusado.setCookie('codeca_session', cookie);
    expect(await sessionOf(reusado)).toBeNull();
    expect(await audit('user.logged_out')).toHaveLength(1);
  });

  it('a sessao expira como qualquer outra', async () => {
    const client = await googleUser();
    expect(await sessionOf(client)).not.toBeNull();

    clock = new Date(clock.getTime() + 13 * 3600 * 1000);

    expect(await sessionOf(client)).toBeNull();
  });

  it('operacoes que alteram estado continuam exigindo o token anti-CSRF', async () => {
    const client = await googleUser();
    const response = await client.post('/api/auth/company', { companyName: 'Empresa Um', acceptedTerms: true }, { omitCsrf: true });
    expect(response.status).toBe(403);
    expect(await api.db.select().from(schema.tenants)).toHaveLength(0);
  });

  it('quem so tem o Google define uma senha pelo fluxo de recuperacao e passa a ter os dois metodos', async () => {
    await googleUser();
    const sem = await api.client().post('/api/auth/login', { email: 'maria@gmail.com', password: 'qualquer-coisa-123' });
    expect(sem.status).toBe(401);

    await api.client().post('/api/auth/forgot-password', { email: 'maria@gmail.com' });
    const mensagem = [...api.outbox].reverse().find((m) => m.kind === 'reset_password')!;
    const reset = await api.client().post('/api/auth/reset-password', {
      token: extractToken(mensagem.text),
      password: 'novaSenhaSegura123',
    });
    expect(reset.status).toBe(200);

    const com = api.client();
    const login = await com.post('/api/auth/login', { email: 'maria@gmail.com', password: 'novaSenhaSegura123' });
    expect(login.status).toBe(200);
    expect(login.body.session.user).toMatchObject({ hasPassword: true, google: { email: 'maria@gmail.com' } });
    expect(await usersCount()).toBe(1);
  });
});
