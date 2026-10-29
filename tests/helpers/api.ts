import {
  createApp,
  createSiteApp,
  createContext,
  createMemoryBillingProvider,
  createMemoryBlobStorage,
  createMemoryMailer,
  createUnconfiguredDomainProvider,
  parseEnv,
  type DomainProvider,
  type MailMessage,
  type MemoryBillingProvider,
} from '@codeca/api';
import { seedDatabase, type Database } from '@codeca/database';
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
}

/** Segredo do webhook usado nos testes; o mesmo que assina os corpos. */
export const TEST_WEBHOOK_SECRET = 'segredo-de-webhook-para-testes-com-32-caracteres';
/** Segredo do job de reconciliacao nos testes. */
export const TEST_JOB_SECRET = 'segredo-do-job-de-reconciliacao-de-teste';

export interface TestApi {
  db: Database;
  database: TestDatabase;
  app: ReturnType<typeof createApp>;
  /** Aplicacao que serve os sites publicos, usada nos testes de SSR. */
  siteApp: ReturnType<typeof createSiteApp>;
  outbox: MailMessage[];
  blobFiles: ReturnType<typeof createMemoryBlobStorage>['files'];
  /** Provedor de cobranca controlado pelo teste. Nenhuma cobranca real. */
  billing: MemoryBillingProvider;
  client: () => TestClient;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestApi(options: TestApiOptions = {}): Promise<TestApi> {
  const database = await createTestDatabase();
  const mailer = createMemoryMailer();
  const blob = createMemoryBlobStorage();
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
  });

  const context = createContext({
    env,
    db: database.db,
    mailer,
    blob,
    domains: options.domains ?? createUnconfiguredDomainProvider(),
    billing,
    ...(options.now ? { now: options.now } : {}),
  });

  const app = createApp({ context });
  const siteApp = createSiteApp({ context });
  await seedDatabase(database.db);

  return {
    db: database.db,
    database,
    app,
    siteApp,
    outbox: mailer.outbox,
    blobFiles: blob.files,
    billing,
    client: () => new TestClient(app),
    reset: async () => {
      await database.reset();
      mailer.outbox.length = 0;
      blob.files.clear();
      billing.sessions.clear();
      billing.subscriptions.clear();
      billing.charges.clear();
      billing.calls.length = 0;
      await seedDatabase(database.db);
    },
    close: () => database.close(),
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
  delete<T = any>(path: string, options?: Parameters<TestClient['request']>[2]) {
    return this.request<T>('DELETE', path, options);
  }
}

export interface RegisteredAccount {
  client: TestClient;
  tenantId: string;
  userId: string;
  email: string;
  password: string;
}

/** Cria uma conta com construtora e devolve um cliente autenticado. */
export async function registerAccount(
  api: TestApi,
  input: { email: string; companyName: string; name?: string; password?: string },
): Promise<RegisteredAccount> {
  const client = api.client();
  const password = input.password ?? 'senhaSegura123';

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

  return {
    client,
    tenantId: session.memberships[0]!.tenantId,
    userId: session.user.id,
    email: input.email,
    password,
  };
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
