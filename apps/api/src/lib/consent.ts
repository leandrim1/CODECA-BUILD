import { count, desc, eq, schema, sql, type Database } from '@codeca/database';
import {
  DEFAULT_SITE_COOKIE_SETTINGS,
  normalizeOrigin,
  type ConsentCategory,
  type ConsentReport,
  type ConsentSummary,
  type SiteCookieSettings,
} from '@codeca/shared';

/**
 * Cookies e consentimento: o que a plataforma guarda por site.
 *
 * O mecanismo que pergunta ao visitante roda no site do cliente, dentro do
 * `@codeca/sdk`. Aqui ficam duas coisas que precisam de servidor: a
 * configuracao que diz **quem** responde pelos dados daquele site e **o que**
 * ele declara carregar, e o registro anonimo da escolha, para a empresa poder
 * demonstrar o consentimento que praticou.
 */

/** Configuracao gravada, ou o padrao de quem ainda nao configurou. */
export async function loadCookieSettings(db: Database, siteId: string): Promise<SiteCookieSettings> {
  const [linha] = await db
    .select()
    .from(schema.siteCookieSettings)
    .where(eq(schema.siteCookieSettings.siteId, siteId))
    .limit(1);

  if (!linha) return { ...DEFAULT_SITE_COOKIE_SETTINGS, tools: [] };

  return {
    controllerName: linha.controllerName,
    controllerDocument: linha.controllerDocument,
    controllerContact: linha.controllerContact,
    privacyPolicyUrl: linha.privacyPolicyUrl,
    cookiePolicyUrl: linha.cookiePolicyUrl,
    policyVersion: linha.policyVersion,
    bannerEnabled: linha.bannerEnabled,
    recordConsent: linha.recordConsent,
    tools: linha.tools ?? [],
  };
}

/** Grava a configuracao inteira. Uma linha por site, criada na primeira vez. */
export async function saveCookieSettings(
  db: Database,
  params: {
    tenantId: string;
    siteId: string;
    userId: string | null;
    settings: SiteCookieSettings;
    now: Date;
  },
): Promise<SiteCookieSettings> {
  const valores = {
    tenantId: params.tenantId,
    siteId: params.siteId,
    controllerName: params.settings.controllerName,
    controllerDocument: params.settings.controllerDocument,
    controllerContact: params.settings.controllerContact,
    privacyPolicyUrl: params.settings.privacyPolicyUrl,
    cookiePolicyUrl: params.settings.cookiePolicyUrl,
    policyVersion: params.settings.policyVersion,
    bannerEnabled: params.settings.bannerEnabled,
    recordConsent: params.settings.recordConsent,
    tools: params.settings.tools,
    updatedByUserId: params.userId,
  };

  await db
    .insert(schema.siteCookieSettings)
    .values(valores)
    .onConflictDoUpdate({
      target: schema.siteCookieSettings.siteId,
      set: { ...valores, updatedAt: params.now },
    });

  return params.settings;
}

/**
 * De que site veio esta origem.
 *
 * E o que permite receber o registro de consentimento sem credencial: o
 * `sendBeacon` do navegador nao sabe enviar cabecalho, e exigir um faria o
 * registro simplesmente nao chegar. O que o navegador envia e `Origin`, e ele
 * nao deixa a pagina mentir sobre isso.
 *
 * Origem cadastrada por mais de um site devolve `null`: duas empresas
 * reivindicando o mesmo endereco e configuracao errada, e escolher uma delas
 * atribuiria a escolha do visitante ao cliente errado. Melhor nao gravar.
 */
export async function siteFromOrigin(
  db: Database,
  origin: string | null,
): Promise<{ siteId: string; tenantId: string; host: string } | null> {
  if (!origin) return null;
  const normalizada = normalizeOrigin(origin);
  if (!normalizada) return null;

  const linhas = await db
    .select({ siteId: schema.siteOrigins.siteId, tenantId: schema.siteOrigins.tenantId })
    .from(schema.siteOrigins)
    .where(eq(schema.siteOrigins.origin, normalizada))
    .limit(2);

  if (linhas.length !== 1) return null;
  const [linha] = linhas;
  return { siteId: linha.siteId, tenantId: linha.tenantId, host: new URL(normalizada).hostname };
}

/**
 * Grava a escolha. Reenvio da mesma decisao nao vira segunda linha.
 *
 * `domain` vem da origem conferida no servidor e nao do corpo enviado: sem
 * isso, um visitante poderia atribuir a propria escolha ao site de outra
 * empresa. `decidedAt` vem do relogio do navegador e e limitado ao instante da
 * chegada -- um relogio adiantado nao grava uma decisao no futuro.
 */
export async function storeConsentRecord(
  db: Database,
  params: { tenantId: string; siteId: string; host: string; report: ConsentReport; now: Date },
): Promise<void> {
  const informado = new Date(params.report.decidedAt);
  const valido = Number.isFinite(informado.getTime());
  const decidedAt = valido && informado < params.now ? informado : params.now;

  await db
    .insert(schema.siteConsentRecords)
    .values({
      tenantId: params.tenantId,
      siteId: params.siteId,
      consentId: params.report.id,
      decidedAt,
      domain: params.host,
      granted: [...params.report.granted],
      denied: [...params.report.denied],
      policyVersion: params.report.policyVersion,
      engineVersion: params.report.engineVersion,
    })
    .onConflictDoNothing({
      target: [schema.siteConsentRecords.siteId, schema.siteConsentRecords.consentId],
    });
}

/** Contagem por categoria, para o painel mestre. Uma consulta, nao cinco. */
export async function consentSummary(db: Database, siteId: string): Promise<ConsentSummary> {
  /*
    `@>` e contencao de jsonb: conta as linhas cuja lista de autorizadas
    contem aquela categoria. Resolve as quatro contagens na mesma varredura,
    em vez de uma consulta por categoria.
  */
  const autorizou = (categoria: ConsentCategory) =>
    sql<number>`count(*) filter (where ${schema.siteConsentRecords.granted} @> ${JSON.stringify([categoria])}::jsonb)`;

  const [linha] = await db
    .select({
      total: count(),
      firstAt: sql<string | null>`min(${schema.siteConsentRecords.decidedAt})`,
      lastAt: sql<string | null>`max(${schema.siteConsentRecords.decidedAt})`,
      necessarios: autorizou('necessarios'),
      preferencias: autorizou('preferencias'),
      estatisticas: autorizou('estatisticas'),
      marketing: autorizou('marketing'),
    })
    .from(schema.siteConsentRecords)
    .where(eq(schema.siteConsentRecords.siteId, siteId));

  const emData = (valor: string | Date | null | undefined): string | null => {
    if (!valor) return null;
    const data = valor instanceof Date ? valor : new Date(valor);
    return Number.isFinite(data.getTime()) ? data.toISOString() : null;
  };

  return {
    total: Number(linha?.total ?? 0),
    granted: {
      necessarios: Number(linha?.necessarios ?? 0),
      preferencias: Number(linha?.preferencias ?? 0),
      estatisticas: Number(linha?.estatisticas ?? 0),
      marketing: Number(linha?.marketing ?? 0),
    },
    firstAt: emData(linha?.firstAt),
    lastAt: emData(linha?.lastAt),
  };
}

/** Pagina de registros, do mais recente ao mais antigo. Para auditoria. */
export async function listConsentRecords(
  db: Database,
  params: { siteId: string; page: number; pageSize: number },
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const onde = eq(schema.siteConsentRecords.siteId, params.siteId);
  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.siteConsentRecords)
    .where(onde);

  const linhas = await db
    .select({
      consentId: schema.siteConsentRecords.consentId,
      decidedAt: schema.siteConsentRecords.decidedAt,
      domain: schema.siteConsentRecords.domain,
      granted: schema.siteConsentRecords.granted,
      denied: schema.siteConsentRecords.denied,
      policyVersion: schema.siteConsentRecords.policyVersion,
      engineVersion: schema.siteConsentRecords.engineVersion,
      receivedAt: schema.siteConsentRecords.createdAt,
    })
    .from(schema.siteConsentRecords)
    .where(onde)
    .orderBy(desc(schema.siteConsentRecords.createdAt))
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);

  return {
    items: linhas.map((l) => ({
      consentId: l.consentId,
      decidedAt: l.decidedAt.toISOString(),
      domain: l.domain,
      granted: l.granted,
      denied: l.denied,
      policyVersion: l.policyVersion,
      engineVersion: l.engineVersion,
      receivedAt: l.receivedAt.toISOString(),
    })),
    total: Number(total ?? 0),
  };
}
