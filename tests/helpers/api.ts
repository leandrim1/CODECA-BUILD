import {
  createApp,
  createContext,
  createMemoryBillingProvider,
  createMemoryBlobStorage,
  createMemoryMailer,
  createMonitor,
  createUnconfiguredDomainProvider,
  parseEnv,
  type DomainProvider,
  type Env,
  type Mailer,
  type MailMessage,
  type MemoryBillingProvider,
  type SanitizedOpsEvent,
  type SiteFetcher,
} from '@codeca/api';
import { and, eq, provisionSiteModules, schema, seedDatabase, type Database } from '@codeca/database';
import { createTestDatabase, type TestDatabase } from './database.js';

/**
 * Sobe a API inteira sobre um Postgres real em processo.
 *
 * O cliente mantem cookies como um navegador e envia os cabecalhos de origem e
 * anti-CSRF, de modo que os testes exercitam exatamente o mesmo caminho de
 * autenticacao usado em producao.
 */

export const TEST_APP_ORIGIN = 'http://app.localhost:5173';

export interface TestApiOptions {
  domains?: DomainProvider;
  billing?: MemoryBillingProvider;
  now?: () => Date;
  /** Variaveis de ambiente acrescentadas ou sobrescritas neste cenario. */
  env?: Record<string, string>;
  /** Cliente HTTP da API (por exemplo, um Google falso). */
  fetch?: typeof globalThis.fetch;
  /**
   * Busca das paginas na importacao de site externo.
   *
   * Substituir aqui nao e um atalho: a implementacao de verdade **recusa**
   * `localhost` e qualquer IP privado, de proposito -- e a protecao contra
   * SSRF. Um teste de ponta a ponta com servidor local seria barrado por ela.
   * Com um conjunto de paginas em memoria os testes exercitam o rastreamento, a
   * extracao e a gravacao de verdade, e as barreiras de rede tem testes
   * proprios (`tests/unit/import-extract.test.ts` e `import-fetcher.test.ts`).
   */
  siteFetcher?: SiteFetcher;
  /** E-mail alternativo (por exemplo, um que falha). Sem ele, a caixa de saida em memoria. */
  mailer?: Mailer;
}

/** Uma requisicao que a plataforma enviou ao site do cliente. */
export interface WebhookCall {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/**
 * Site do cliente, substituindo a rede.
 *
 * Um teste que precisasse de um servidor HTTP de verdade para conferir a
 * assinatura verificaria a rede, nao a assinatura -- e ainda abriria porta em
 * ambiente de CI. Aqui a entrega e capturada e o corpo fica disponivel para o
 * teste conferir com o verificador do SDK, que e o que o site faria.
 */
export function createWebhookSink(options: { status?: number } = {}) {
  const calls: WebhookCall[] = [];
  let status = options.status ?? 200;

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({ url, body: String(init?.body ?? ''), headers });
    return new Response(null, { status });
  };

  return {
    calls,
    fetch,
    /** Muda a resposta do site a partir da proxima entrega. */
    respondWith: (proximo: number) => {
      status = proximo;
    },
    reset: () => {
      calls.length = 0;
    },
  };
}
export type WebhookSink = ReturnType<typeof createWebhookSink>;

/** Segredo do webhook usado nos testes; o mesmo que assina os corpos. */
export const TEST_WEBHOOK_SECRET = 'segredo-de-webhook-para-testes-com-32-caracteres';
/** Segredo do job de reconciliacao nos testes. */
export const TEST_JOB_SECRET = 'segredo-do-job-de-reconciliacao-de-teste';

export interface TestApi {
  db: Database;
  /** Configuracao efetiva deste cenario (AUTH_SECRET, flags, limites). */
  env: Env;
  /** Entregas de webhook capturadas no lugar da rede. */
  webhooks: WebhookSink;
  database: TestDatabase;
  app: ReturnType<typeof createApp>;
  outbox: MailMessage[];
  blobFiles: ReturnType<typeof createMemoryBlobStorage>['files'];
  /** Conteudo de cada arquivo gravado, por URL. */
  blobBodies: ReturnType<typeof createMemoryBlobStorage>['bodies'];
  /** Provedor de cobranca controlado pelo teste. Nenhuma cobranca real. */
  billing: MemoryBillingProvider;
  /** Tudo o que passou pelo monitor operacional, ja sem dado sensivel. */
  opsEvents: SanitizedOpsEvent[];
  /**
   * Alertas que sairiam por HTTP (so quando o cenario define
   * `OPS_ALERT_WEBHOOK_URL`). Nada vai para a rede.
   */
  alerts: Array<{ url: string; body: { text: string; content: string; event: SanitizedOpsEvent } }>;
  /** Faz o receptor de alertas responder este status (padrao 200). */
  alertReceiver: { status: number };
  /**
   * Espera o trabalho agendado para depois da resposta (o que em producao
   * roda sob `waitUntil`). Sem isto, um teste leria o banco antes de o
   * processamento em segundo plano terminar.
   */
  settle: () => Promise<void>;
  client: () => TestClient;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestApi(options: TestApiOptions = {}): Promise<TestApi> {
  const database = await createTestDatabase();
  const mailer = options.mailer ?? createMemoryMailer();
  const blob = createMemoryBlobStorage();
  const webhooks = createWebhookSink();
  const billing = options.billing ?? createMemoryBillingProvider(
    options.now ? { now: options.now } : {},
  );

  const env = parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://injected/test',
    AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
    APP_URL: TEST_APP_ORIGIN,
    PLATFORM_HOSTS: 'app.localhost,localhost',
    PLATFORM_NAME: 'Codeca Build',
    PLATFORM_URL: 'https://codecabuild.test',
    COOKIE_SECURE: 'false',
    // Credenciais ficticias: o provedor real nunca e chamado nos testes.
    VALIDAPAY_CLIENT_ID: 'client-de-teste',
    VALIDAPAY_CLIENT_SECRET: 'segredo-de-teste',
    VALIDAPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    VALIDAPAY_BASE_URL: 'https://sandbox.validapay.com.br',
    BILLING_RECONCILIATION_SECRET: TEST_JOB_SECRET,
    /*
     * Conta de teste nasce SEM os exemplos da demonstracao.
     *
     * Centenas de testes partem de "empresa nova, nenhum conteudo" para medir
     * limites, contagens e listas. Os exemplos mudariam esse ponto de partida
     * em todos eles sem que nenhum esteja testando a demonstracao. Quem testa a
     * demonstracao liga a variavel (`tests/integration/site-de-demonstracao`).
     * Em producao o padrao e ligado.
     */
    DEMO_SITE_ON_SIGNUP: 'false',
    ...(options.env ?? {}),
  });

  const opsEvents: SanitizedOpsEvent[] = [];
  const alerts: TestApi['alerts'] = [];
  const alertReceiver = { status: 200 };
  const alertEmail = env.OPS_ALERT_EMAIL;
  const monitor = createMonitor({
    alertWebhookUrl: env.OPS_ALERT_WEBHOOK_URL,
    sendAlertEmail: alertEmail
      ? async (alert) => {
          await mailer.send({ to: alertEmail, kind: 'ops_alert', ...alert });
        }
      : undefined,
    alertWindowSeconds: env.OPS_ALERT_WINDOW_MINUTES * 60,
    environment: 'test',
    // Receptor de alertas em memoria: o que sairia para o Slack fica aqui.
    fetch: (async (url: unknown, init?: RequestInit) => {
      alerts.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response('{}', { status: alertReceiver.status });
    }) as typeof globalThis.fetch,
    now: options.now ?? (() => new Date()),
    db: database.db,
    sinks: [(event) => void opsEvents.push(event)],
    // Os testes provocam falhas de proposito; o log delas e so ruido.
    log: () => undefined,
  });

  const backgroundTasks: Array<Promise<unknown>> = [];
  const settle = async () => {
    while (backgroundTasks.length > 0) {
      await backgroundTasks.shift()!.catch(() => undefined);
    }
  };

  const context = createContext({
    env,
    db: database.db,
    monitor,
    background: (task) => void backgroundTasks.push(task),
    mailer,
    blob,
    domains: options.domains ?? createUnconfiguredDomainProvider(),
    billing,
    // Webhooks de saida por padrao; o teste do login com Google injeta o seu.
    fetch: options.fetch ?? webhooks.fetch,
    ...(options.siteFetcher ? { siteFetcher: options.siteFetcher } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  const app = createApp({ context });
  await seedDatabase(database.db);

  return {
    db: database.db,
    env,
    database,
    webhooks,
    app,
    outbox: 'outbox' in mailer ? (mailer as { outbox: MailMessage[] }).outbox : [],
    blobFiles: blob.files,
    blobBodies: blob.bodies,
    billing,
    opsEvents,
    alerts,
    alertReceiver,
    settle,
    client: () => new TestClient(app),
    reset: async () => {
      // Nada em segundo plano pode atravessar para o proximo teste.
      await settle();
      opsEvents.length = 0;
      alerts.length = 0;
      alertReceiver.status = 200;
      await database.reset();
      webhooks.reset();
      if ('outbox' in mailer) (mailer as { outbox: MailMessage[] }).outbox.length = 0;
      blob.files.clear();
      blob.bodies.clear();
      billing.sessions.clear();
      billing.subscriptions.clear();
      billing.charges.clear();
      billing.calls.length = 0;
      await seedDatabase(database.db);
    },
    close: async () => {
      await settle();
      await database.close();
    },
  };
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  /** Codigo de erro padronizado, quando a resposta e um erro. */
  errorCode: string | null;
  errorMessage: string | null;
}

/** Cliente HTTP com cookies, origem e token anti-CSRF. */
export class TestClient {
  private cookies = new Map<string, string>();
  private host: string | null = null;

  constructor(private readonly app: ReturnType<typeof createApp>) {}

  /** Simula uma requisicao vinda do dominio publico de uma construtora. */
  withHost(host: string): this {
    this.host = host;
    return this;
  }

  get csrfToken(): string | null {
    return this.cookies.get('codeca_csrf') ?? null;
  }

  get sessionCookie(): string | null {
    return this.cookies.get('codeca_session') ?? null;
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  getCookie(name: string): string | null {
    return this.cookies.get(name) ?? null;
  }

  deleteCookie(name: string): void {
    this.cookies.delete(name);
  }

  clearCookies(): void {
    this.cookies.clear();
  }

  async request<T = any>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      origin?: string | null;
      formData?: FormData;
      /** Nao envia o cabecalho anti-CSRF, simulando uma requisicao forjada. */
      omitCsrf?: boolean;
    } = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...options.headers };

    const origin = options.origin === null ? undefined : (options.origin ?? TEST_APP_ORIGIN);
    if (origin) headers.origin = origin;
    if (this.host) headers.host = this.host;

    if (this.cookies.size > 0) {
      headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    const csrf = this.csrfToken;
    const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
    if (csrf && needsCsrf && !options.omitCsrf && headers['x-csrf-token'] === undefined) {
      headers['x-csrf-token'] = csrf;
    }
    if (options.omitCsrf) delete headers['x-csrf-token'];

    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData;
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const url = `${this.host ? `http://${this.host}` : TEST_APP_ORIGIN}${path}`;
    const response = await this.app.request(url, { method, headers, body });

    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (index <= 0 || !pair) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '' || /Max-Age=0/i.test(raw) || /Expires=Thu, 01 Jan 1970/i.test(raw)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, decodeURIComponent(value));
      }
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    // Respostas de texto puro (sitemap.xml, robots.txt, CSV) nao usam envelope.
    const isEnvelope = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    const envelope = isEnvelope
      ? (parsed as { data?: T; error?: { code?: string; message?: string } })
      : null;

    return {
      status: response.status,
      body: (envelope && 'data' in envelope ? envelope.data : parsed) as T,
      headers: response.headers,
      errorCode: envelope?.error?.code ?? null,
      errorMessage: envelope?.error?.message ?? null,
    };
  }

  get<T = any>(path: string, options?: Parameters<TestClient['request']>[2]) {
    return this.request<T>('GET', path, options);
  }
  post<T = any>(path: string, body?: unknown, options?: Parameters<TestClient['request']>[2]) {
    return this.request<T>('POST', path, { ...options, ...(body !== undefined ? { body } : {}) });
  }
  patch<T = any>(path: string, body?: unknown, options?: Parameters<TestClient['request']>[2]) {
    return this.request<T>('PATCH', path, { ...options, ...(body !== undefined ? { body } : {}) });
  }
  put<T = any>(path: string, body?: unknown, options?: Parameters<TestClient['request']>[2]) {
    return this.request<T>('PUT', path, { ...options, ...(body !== undefined ? { body } : {}) });
  }
  /**
   * `DELETE` com corpo opcional.
   *
   * Nao e capricho: a exclusao da empresa pede o nome digitado e a senha, e
   * mandar isso na query string deixaria a senha no log de acesso.
   */
  delete<T = any>(path: string, body?: unknown, options?: Parameters<TestClient['request']>[2]) {
    return this.request<T>('DELETE', path, { ...options, ...(body !== undefined ? { body } : {}) });
  }
}

export interface RegisteredAccount {
  client: TestClient;
  tenantId: string;
  /** Site principal da empresa. Todo conteudo pertence a ele. */
  siteId: string;
  userId: string;
  email: string;
  password: string;
}

/** Cria uma conta com construtora e devolve um cliente autenticado. */
export async function registerAccount(
  api: TestApi,
  input: {
    email: string;
    companyName: string;
    name?: string;
    password?: string;
    /**
     * Segmento do site criado. `null` deixa o padrao da plataforma valer.
     *
     * O padrao daqui e `construtora` porque a maioria dos testes exercita
     * imoveis e obras. Quem testa o **proprio** comportamento do segmento
     * padrao passa `null` -- senao o helper mascararia o que esta sob teste.
     */
    segment?: string | null;
  },
): Promise<RegisteredAccount> {
  const client = api.client();
  const password = input.password ?? 'senhaSegura123!';

  const response = await client.post('/api/auth/register', {
    name: input.name ?? 'Responsavel Teste',
    email: input.email,
    password,
    companyName: input.companyName,
    phone: '(19) 99999-0000',
    acceptedTerms: true,
  });

  if (response.status !== 201) {
    throw new Error(`Falha ao registrar conta: ${response.status} ${response.errorMessage ?? ''}`);
  }

  const session = response.body.session as {
    user: { id: string };
    memberships: Array<{ tenantId: string }>;
  };

  const tenantId = session.memberships[0]!.tenantId;
  const siteId = await primarySiteId(api, tenantId);

  /**
   * O site de teste nasce no segmento `construtora`, e nao no padrao.
   *
   * O padrao da instalacao e `institucional`, que de proposito **nao** liga
   * modulo de ramo nenhum -- e o certo para uma empresa cujo ramo ainda nao
   * foi escolhido. Mas a maioria dos testes exercita conteudo de imoveis e
   * obras, e precisa de uma empresa que tenha esses modulos.
   *
   * Fixar aqui e melhor que depender do padrao: o conjunto que os testes
   * usam para de mudar quando alguem troca o segmento padrao da plataforma,
   * que foi exatamente o que quebrou noventa e cinco testes de uma vez.
   */
  const codigoSegmento = input.segment === undefined ? 'construtora' : input.segment;
  const [segmento] = codigoSegmento
    ? await api.db
        .select({ id: schema.segments.id, defaultModules: schema.segments.defaultModules })
        .from(schema.segments)
        .where(eq(schema.segments.code, codigoSegmento))
    : [];
  if (segmento) {
    await api.db
      .update(schema.sites)
      .set({ segmentId: segmento.id })
      .where(eq(schema.sites.id, siteId));
    await provisionSiteModules(api.db, {
      tenantId,
      siteId,
      moduleKeys: segmento.defaultModules as string[],
    });
  }

  return { client, tenantId, siteId, userId: session.user.id, email: input.email, password };
}

/**
 * Site principal de uma empresa.
 *
 * Os testes que gravam direto no banco precisam dele: o par
 * `(site_id, tenant_id)` e conferido pelo banco, entao uma insercao sem site
 * -- ou com o site de outra empresa -- e recusada.
 */
export async function primarySiteId(api: TestApi, tenantId: string): Promise<string> {
  const [row] = await api.db
    .select({ id: schema.sites.id })
    .from(schema.sites)
    .where(and(eq(schema.sites.tenantId, tenantId), eq(schema.sites.isPrimary, true)));
  if (!row) throw new Error(`Empresa ${tenantId} nao tem site principal.`);
  return row.id;
}

/** Confirma o e-mail usando o link enviado, como faria o usuario. */
export async function verifyEmail(api: TestApi, account: RegisteredAccount): Promise<void> {
  const message = [...api.outbox].reverse().find((m) => m.kind === 'verify_email' && m.to === account.email);
  if (!message) throw new Error('Nenhum e-mail de confirmacao foi enviado.');
  const token = extractToken(message.text);
  const response = await account.client.post('/api/auth/verify-email', { token });
  if (response.status !== 200) {
    throw new Error(`Falha ao confirmar e-mail: ${response.status} ${response.errorMessage ?? ''}`);
  }
}

export function extractToken(text: string): string {
  const match = /token=([A-Za-z0-9_\-%]+)/.exec(text);
  if (!match?.[1]) throw new Error('Token nao encontrado na mensagem.');
  return decodeURIComponent(match[1]);
}

/**
 * Cria um administrador da plataforma direto no banco, como faz o
 * `pnpm db:seed`.
 *
 * Usado pelos cenarios em que as contas sob teste precisam ser **comuns**:
 * numa instalacao vazia a primeira conta cadastrada assume o painel mestre, e
 * sem este administrador previo o teste acabaria medindo a conta do dono da
 * instalacao em vez de um usuario qualquer.
 */
export async function seedPlatformAdmin(
  api: TestApi,
  email = 'admin-semente@codecabuild.test',
): Promise<string> {
  const [row] = await api.db
    .insert(schema.users)
    .values({
      email,
      name: 'Administrador da plataforma',
      passwordHash: 'nao-utilizado-neste-cenario',
      platformRole: 'platform_admin',
      emailVerifiedAt: new Date(),
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('Nao foi possivel criar o administrador de teste.');
  return row.id;
}
