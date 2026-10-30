import { and, eq, isNull, lt, or, schema, type Database } from '@codeca/database';
import {
  API_KEY_PREFIXES,
  AppError,
  DEFAULT_SCOPES,
  parseApiKey,
  type ApiKeyKind,
  type ApiKeyScope,
} from '@codeca/shared';
import { constantTimeEquals, createOpaqueToken, sha256 } from '@codeca/shared/server';

/**
 * Emissao e conferencia das credenciais de integracao.
 *
 * O token tem tres partes: prefixo, localizador e segredo. O localizador
 * viaja em claro e tem indice proprio -- sem ele, conferir uma chave exigiria
 * ler e comparar o hash de todas as chaves do banco a cada requisicao.
 */

/** 9 bytes em base64url dao exatamente 12 caracteres. */
const LOOKUP_BYTES = 9;
const SECRET_BYTES = 24;

export interface IssuedApiKey {
  id: string;
  kind: ApiKeyKind;
  lookup: string;
  scopes: ApiKeyScope[];
  /**
   * Token completo.
   *
   * Para a chave secreta, este e o **unico momento** em que ele existe fora do
   * navegador de quem o criou: o banco guarda so o hash.
   */
  token: string;
}

export interface IssueApiKeyInput {
  tenantId: string;
  siteId: string;
  kind: ApiKeyKind;
  name?: string;
  scopes?: ApiKeyScope[];
  createdByUserId?: string | null;
}

export async function issueApiKey(db: Database, input: IssueApiKeyInput): Promise<IssuedApiKey> {
  const lookup = createOpaqueToken(LOOKUP_BYTES);
  const secret = createOpaqueToken(SECRET_BYTES);
  const token = `${API_KEY_PREFIXES[input.kind]}_${lookup}_${secret}`;
  const scopes = input.scopes ?? [...DEFAULT_SCOPES[input.kind]];

  const [row] = await db
    .insert(schema.siteApiKeys)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      kind: input.kind,
      name: input.name ?? '',
      lookup,
      secretHash: sha256(secret),
      // A publicavel fica legivel: ela precisa ser copiada para o codigo do
      // site toda vez, e nao e segredo.
      token: input.kind === 'publishable' ? token : null,
      scopes,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning({ id: schema.siteApiKeys.id });

  if (!row) throw new Error('Nao foi possivel emitir a chave de integracao.');
  return { id: row.id, kind: input.kind, lookup, scopes, token };
}

/**
 * Emite uma chave nova e marca a anterior para expirar.
 *
 * A sobreposicao existe porque o site do cliente nao troca a credencial no
 * mesmo instante: revogar na hora derrubaria o site ate alguem publicar o
 * novo valor.
 */
export async function rotateApiKey(
  db: Database,
  keyId: string,
  graceMinutes: number,
  now = new Date(),
): Promise<IssuedApiKey> {
  const [antiga] = await db
    .select()
    .from(schema.siteApiKeys)
    .where(eq(schema.siteApiKeys.id, keyId));
  if (!antiga) throw AppError.notFound('Chave nao encontrada.');

  const nova = await issueApiKey(db, {
    tenantId: antiga.tenantId,
    siteId: antiga.siteId,
    kind: antiga.kind,
    name: antiga.name,
    scopes: antiga.scopes as ApiKeyScope[],
    createdByUserId: antiga.createdByUserId,
  });

  await db
    .update(schema.siteApiKeys)
    .set({
      expiresAt: new Date(now.getTime() + graceMinutes * 60_000),
      updatedAt: now,
    })
    .where(eq(schema.siteApiKeys.id, keyId));

  return nova;
}

export interface ApiKeyContext {
  keyId: string;
  kind: ApiKeyKind;
  tenantId: string;
  siteId: string;
  scopes: ApiKeyScope[];
}

export interface AuthenticateApiKeyInput {
  token: string | null | undefined;
  /** Cabecalho `Origin` da requisicao. Usado apenas pela chave publicavel. */
  origin?: string | null;
  now?: Date;
}

/** Mensagem unica para toda falha de credencial: nao entregamos um oraculo. */
const CREDENCIAL_INVALIDA = 'Credencial de integracao invalida.';

export async function authenticateApiKey(
  db: Database,
  input: AuthenticateApiKeyInput,
): Promise<ApiKeyContext & { origins: string[] }> {
  const now = input.now ?? new Date();
  const parsed = input.token ? parseApiKey(input.token) : null;
  if (!parsed) throw AppError.unauthenticated(CREDENCIAL_INVALIDA);

  const [row] = await db
    .select()
    .from(schema.siteApiKeys)
    .where(eq(schema.siteApiKeys.lookup, parsed.lookup));

  // Chave inexistente, de outro tipo, revogada ou vencida: a mesma resposta.
  if (!row || row.kind !== parsed.kind) throw AppError.unauthenticated(CREDENCIAL_INVALIDA);
  if (row.revokedAt) throw AppError.unauthenticated(CREDENCIAL_INVALIDA);
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    throw AppError.unauthenticated(CREDENCIAL_INVALIDA);
  }
  if (!constantTimeEquals(sha256(parsed.secret), row.secretHash)) {
    throw AppError.unauthenticated(CREDENCIAL_INVALIDA);
  }

  const [site] = await db
    .select({ status: schema.sites.status })
    .from(schema.sites)
    .where(eq(schema.sites.id, row.siteId));
  if (!site || site.status === 'archived') throw AppError.unauthenticated(CREDENCIAL_INVALIDA);

  const origins = await db
    .select({ origin: schema.siteOrigins.origin })
    .from(schema.siteOrigins)
    .where(eq(schema.siteOrigins.siteId, row.siteId));

  return {
    keyId: row.id,
    kind: row.kind,
    tenantId: row.tenantId,
    siteId: row.siteId,
    scopes: row.scopes as ApiKeyScope[],
    origins: origins.map((o) => o.origin),
  };
}

/**
 * Registra o uso sem gravar a cada requisicao.
 *
 * `last_used_at` serve para descobrir chave esquecida, nao para medir trafego:
 * precisao de minutos basta, e uma escrita por requisicao seria desperdicio em
 * funcao serverless.
 */
export async function touchApiKey(
  db: Database,
  keyId: string,
  now = new Date(),
  granularityMinutes = 5,
): Promise<void> {
  const limite = new Date(now.getTime() - granularityMinutes * 60_000);
  await db
    .update(schema.siteApiKeys)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(schema.siteApiKeys.id, keyId),
        or(isNull(schema.siteApiKeys.lastUsedAt), lt(schema.siteApiKeys.lastUsedAt, limite)),
      ),
    );
}

/** Revoga a chave imediatamente. Usado quando ela vazou. */
export async function revokeApiKeyById(
  db: Database,
  siteId: string,
  keyId: string,
  now = new Date(),
): Promise<boolean> {
  const linhas = await db
    .update(schema.siteApiKeys)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.siteApiKeys.id, keyId),
        eq(schema.siteApiKeys.siteId, siteId),
        isNull(schema.siteApiKeys.revokedAt),
      ),
    )
    .returning({ id: schema.siteApiKeys.id });
  return linhas.length > 0;
}

export function hasScope(context: Pick<ApiKeyContext, 'scopes'>, scope: ApiKeyScope): boolean {
  return context.scopes.includes(scope);
}

export function assertScope(context: Pick<ApiKeyContext, 'scopes'>, scope: ApiKeyScope): void {
  if (!hasScope(context, scope)) {
    throw AppError.forbidden('Esta credencial nao tem permissao para esta operacao.');
  }
}
