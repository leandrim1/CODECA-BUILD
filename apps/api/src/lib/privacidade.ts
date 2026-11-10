import { and, eq, schema, type Database } from '@codeca/database';
import { AppError } from '@codeca/shared';
import type { BlobStorage } from './blob.js';

/**
 * Direitos do titular: levar os dados embora, e mandar apagar.
 *
 * A LGPD da ao titular o direito de portabilidade (art. 18, V) e o de
 * eliminacao (art. 18, VI). Ate aqui a plataforma atendia os dois **pelo canal
 * de contato**, a mao -- o que funciona com um cliente e nao funciona com
 * cinquenta, e deixa o prazo legal na dependencia de alguem lembrar.
 *
 * ## O que a exclusao apaga, e o que sobrevive
 *
 * Apagar a empresa derruba, em cascata, as 47 tabelas que apontam para ela:
 * conteudo, imagens, interessados, chaves de integracao, dominios, vinculos de
 * usuario, importacoes, sincronizacao, assinatura e o espelho das cobrancas.
 *
 * Tres coisas **nao** vao junto, de proposito:
 *
 * 1. **O registro da propria exclusao**, gravado na auditoria com
 *    `tenantId: null` -- justamente para a cascata nao leva-lo. E a prova de
 *    quem pediu, quando, e o que foi removido.
 * 2. **Os eventos de webhook ja recebidos** (`webhook_events.tenant_id` e
 *    `set null`): sao o que o provedor de pagamento de fato enviou, e a
 *    politica de privacidade ja diz que registros de cobranca podem ser
 *    mantidos (LGPD, art. 16).
 * 3. **Os arquivos no Blob** -- esses nao tem cascata nenhuma. Sao apagados um
 *    a um ANTES do banco; sem isso, imagem de cliente excluido continuaria
 *    publica numa URL que ninguem mais controla. E o erro mais facil de
 *    cometer aqui, e o mais grave.
 *
 * A fonte fiscal da cobranca continua sendo a ValidaPay, que mantem os
 * proprios registros. O espelho local existe para o painel, nao para o fisco.
 */

// ----------------------------------------------------------- exportacao

export interface ExportedData {
  geradoEm: string;
  empresa: Record<string, unknown>;
  site: Record<string, unknown> | null;
  modulos: unknown[];
  conteudo: Record<string, unknown[]>;
  imagens: unknown[];
  interessados: unknown[];
  dominios: unknown[];
  pessoas: unknown[];
  assinatura: Record<string, unknown> | null;
}

/**
 * Tudo o que a empresa tem na plataforma, em um JSON.
 *
 * Sem segredo nenhum: chave de integracao aparece pelo prefixo, nunca pelo
 * valor, e nao ha hash de senha, token de sessao nem token do Analytics. O
 * objetivo e a pessoa poder levar o CONTEUDO dela embora -- nao clonar a conta.
 */
export async function exportTenantData(db: Database, tenantId: string): Promise<ExportedData> {
  const [empresa] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  if (!empresa) throw AppError.notFound('Empresa não encontrada.');

  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.tenantId, tenantId));
  const [
    modulos,
    documentos,
    imoveis,
    obras,
    servicos,
    depoimentos,
    equipe,
    perguntas,
    categorias,
    produtos,
    galerias,
    camposProprios,
    registrosProprios,
    imagens,
    interessados,
    dominios,
    vinculos,
    chaves,
    assinaturas,
  ] = await Promise.all([
    db.select().from(schema.siteModules).where(eq(schema.siteModules.tenantId, tenantId)),
    db.select().from(schema.contentDocuments).where(eq(schema.contentDocuments.tenantId, tenantId)),
    db.select().from(schema.properties).where(eq(schema.properties.tenantId, tenantId)),
    db.select().from(schema.projects).where(eq(schema.projects.tenantId, tenantId)),
    db.select().from(schema.services).where(eq(schema.services.tenantId, tenantId)),
    db.select().from(schema.testimonials).where(eq(schema.testimonials.tenantId, tenantId)),
    db.select().from(schema.teamMembers).where(eq(schema.teamMembers.tenantId, tenantId)),
    db.select().from(schema.faqs).where(eq(schema.faqs.tenantId, tenantId)),
    db.select().from(schema.categories).where(eq(schema.categories.tenantId, tenantId)),
    db.select().from(schema.products).where(eq(schema.products.tenantId, tenantId)),
    db.select().from(schema.galleries).where(eq(schema.galleries.tenantId, tenantId)),
    db.select().from(schema.siteCustomFields).where(eq(schema.siteCustomFields.tenantId, tenantId)),
    db.select().from(schema.customRecords).where(eq(schema.customRecords.tenantId, tenantId)),
    db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.tenantId, tenantId)),
    db.select().from(schema.leads).where(eq(schema.leads.tenantId, tenantId)),
    db.select().from(schema.domains).where(eq(schema.domains.tenantId, tenantId)),
    db
      .select({
        userId: schema.memberships.userId,
        role: schema.memberships.role,
        nome: schema.users.name,
        email: schema.users.email,
        criadoEm: schema.memberships.createdAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.tenantId, tenantId)),
    db
      .select({
        id: schema.siteApiKeys.id,
        nome: schema.siteApiKeys.name,
        tipo: schema.siteApiKeys.kind,
        criadaEm: schema.siteApiKeys.createdAt,
      })
      .from(schema.siteApiKeys)
      .where(eq(schema.siteApiKeys.tenantId, tenantId)),
    db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId)),
  ]);

  const assinatura = assinaturas[0] ?? null;

  return {
    geradoEm: new Date().toISOString(),
    empresa: { ...empresa, chavesDeIntegracao: chaves },
    site: site ?? null,
    modulos,
    conteudo: {
      documentos,
      imoveis,
      obras,
      servicos,
      depoimentos,
      equipe,
      perguntas,
      categorias,
      produtos,
      galerias,
      camposProprios,
      registrosProprios,
    },
    imagens,
    interessados,
    dominios,
    pessoas: vinculos,
    assinatura: assinatura
      ? {
          status: assinatura.status,
          providerStatus: assinatura.providerStatus,
          inicio: assinatura.currentPeriodStart,
          fim: assinatura.currentPeriodEnd,
          acessoAte: assinatura.accessUntil,
          formaDePagamento: assinatura.paymentMethod,
        }
      : null,
  };
}

// ------------------------------------------------------------- exclusao

export interface DeletionSummary {
  /** Quantos registros de cada tipo deixaram de existir. */
  removidos: Record<string, number>;
  /** Arquivos apagados do armazenamento, e os que resistiram. */
  arquivos: { apagados: number; falharam: number };
  /** `true` quando a conta de quem pediu tambem deixou de existir. */
  contaRemovida: boolean;
}

/** Conta o que sera removido, para a tela poder dizer antes de perguntar. */
export async function deletionPreview(db: Database, tenantId: string): Promise<Record<string, number>> {
  const dados = await exportTenantData(db, tenantId);
  const conteudo = Object.values(dados.conteudo).reduce((soma, lista) => soma + lista.length, 0);
  return {
    conteudos: conteudo,
    imagens: dados.imagens.length,
    interessados: dados.interessados.length,
    dominios: dados.dominios.length,
    pessoas: dados.pessoas.length,
  };
}

/**
 * Apaga a empresa e tudo o que pertence a ela.
 *
 * A ordem importa: arquivos primeiro, banco depois. Se o banco caisse primeiro,
 * perderiamos a lista de URLs e os arquivos ficariam orfaos para sempre.
 */
export async function deleteTenant(
  db: Database,
  blob: BlobStorage,
  input: { tenantId: string; requesterUserId: string },
): Promise<DeletionSummary> {
  const removidos = await deletionPreview(db, input.tenantId);

  const imagens = await db
    .select({ url: schema.mediaAssets.blobUrl })
    .from(schema.mediaAssets)
    .where(eq(schema.mediaAssets.tenantId, input.tenantId));

  let apagados = 0;
  let falharam = 0;
  for (const imagem of imagens) {
    try {
      await blob.remove(imagem.url);
      apagados += 1;
    } catch {
      // Um arquivo que resiste nao pode impedir a exclusao do resto: o numero
      // volta no resumo e vai para a auditoria, para alguem resolver depois.
      falharam += 1;
    }
  }

  await db.delete(schema.tenants).where(eq(schema.tenants.id, input.tenantId));

  // A conta de quem pediu some junto se ela nao servia a mais nada.
  const contaRemovida = await removeUserIfOrphan(db, input.requesterUserId);

  return { removidos, arquivos: { apagados, falharam }, contaRemovida };
}

/**
 * Remove o usuario que ficou sem nenhuma empresa.
 *
 * Quem administra a plataforma nunca e removido por este caminho: perder o
 * unico administrador trancaria o painel mestre para sempre.
 */
export async function removeUserIfOrphan(db: Database, userId: string): Promise<boolean> {
  const [usuario] = await db
    .select({ id: schema.users.id, platformRole: schema.users.platformRole })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!usuario || usuario.platformRole === 'platform_admin') return false;

  const vinculos = await db
    .select({ tenantId: schema.memberships.tenantId })
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, userId));
  if (vinculos.length > 0) return false;

  await db.delete(schema.users).where(eq(schema.users.id, userId));
  return true;
}

/**
 * Confere a frase de confirmacao.
 *
 * Exigir o nome exato da empresa e a barreira contra o clique distraido: quem
 * digita o nome inteiro sabe o que esta apagando. A comparacao ignora espacos
 * nas pontas e diferenca de maiusculas -- o objetivo e provar intencao, nao
 * testar a digitacao.
 */
export function confirmacaoConfere(digitado: string, nomeDaEmpresa: string): boolean {
  const normalizar = (valor: string) => valor.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  return normalizar(digitado) === normalizar(nomeDaEmpresa) && nomeDaEmpresa.trim() !== '';
}

/** Ha outro proprietario alem deste usuario? */
export async function temOutroProprietario(
  db: Database,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const outros = await db
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, 'owner')));
  return outros.some((linha) => linha.userId !== userId);
}
