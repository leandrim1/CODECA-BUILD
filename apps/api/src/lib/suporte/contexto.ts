import { and, desc, eq, schema, type Database } from '@codeca/database';
import type { TicketContexto } from '@codeca/shared';
import { loadPlanStatus } from '../plan-limits.js';

/**
 * O retrato que acompanha um chamado.
 *
 * Tudo aqui sai do BANCO a partir do `tenantId` da sessao -- nada vem do
 * corpo da requisicao. Essa e a regra que faz o isolamento valer: se o
 * navegador pudesse mandar "minha empresa e X, meu plano e Y", um chamado
 * aberto por qualquer pessoa poderia descrever a empresa de outra, e o
 * atendimento acreditaria.
 *
 * Existe para o atendimento nao comecar com cinco perguntas que a plataforma
 * ja sabe responder -- qual plano, quanto do limite foi usado, qual site. E
 * um retrato do MOMENTO: se o plano mudar amanha, o chamado continua
 * mostrando o que valia quando a duvida apareceu.
 *
 * O que NAO entra, e nao deve entrar: nada de outra empresa, nada de segredo
 * (chave de integracao, token, senha) e nada de conteudo dos clientes finais
 * -- interessados, por exemplo, sao dados pessoais de terceiros e nao ajudam
 * a responder "como mudo meu horario".
 */
export async function montarContexto(
  db: Database,
  entrada: {
    tenantId: string;
    usuario: { id: string; nome: string; email: string; papel: string };
    origemUrl: string;
    agora: Date;
  },
): Promise<{ contexto: TicketContexto; siteId: string | null }> {
  const [tenant] = await db
    .select({ nome: schema.tenants.displayName, slug: schema.tenants.slug })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, entrada.tenantId))
    .limit(1);

  const [site] = await db
    .select({ id: schema.sites.id, status: schema.sites.status, nome: schema.sites.name })
    .from(schema.sites)
    .where(eq(schema.sites.tenantId, entrada.tenantId))
    .orderBy(desc(schema.sites.createdAt))
    .limit(1);

  // O endereco proprio, quando ja existe e esta no ar. O dominio mora em
  // outra tabela porque uma empresa pode ter mais de um.
  const dominio = site
    ? (
        await db
          .select({ hostname: schema.domains.hostname })
          .from(schema.domains)
          .where(and(eq(schema.domains.siteId, site.id), eq(schema.domains.isPrimary, true)))
          .limit(1)
      )[0]?.hostname ?? null
    : null;

  const { plan, usage } = await loadPlanStatus(db, entrada.tenantId);

  const contexto: TicketContexto = {
    empresa: { nome: tenant?.nome ?? '', slug: tenant?.slug ?? '' },
    plano: { codigo: plan.planCode, nome: plan.planName },
    site: site
      ? {
          id: site.id,
          dominio,
          // `active` e o que o produto chama de "no ar". Um site em rascunho
          // ou suspenso nao esta.
          publicado: site.status === 'active',
        }
      : null,
    uso: {
      conteudos: { usados: usage.contentRecords, limite: plan.limits.maxContentRecords },
      armazenamento: { bytes: usage.storageBytes, limiteBytes: plan.limits.storageBytes },
      usuarios: { usados: usage.users, limite: plan.limits.maxUsers },
    },
    usuario: {
      nome: entrada.usuario.nome,
      email: entrada.usuario.email,
      papel: entrada.usuario.papel,
    },
    origemUrl: entrada.origemUrl,
    capturadoEm: entrada.agora.toISOString(),
  };

  return { contexto, siteId: site?.id ?? null };
}

/**
 * O proximo numero da empresa.
 *
 * Numero legivel e por empresa -- um contador global contaria a concorrencia
 * quantos chamados a plataforma recebe. A corrida entre duas aberturas
 * simultaneas nao e resolvida aqui e sim pelo indice unico
 * (`tickets_numero_key`): a segunda insercao falha e quem chamou tenta de
 * novo. Um `select max()+1` sozinho daria o mesmo numero as duas.
 */
export async function proximoNumero(db: Database, tenantId: string): Promise<number> {
  const [linha] = await db
    .select({ numero: schema.tickets.numero })
    .from(schema.tickets)
    .where(eq(schema.tickets.tenantId, tenantId))
    .orderBy(desc(schema.tickets.numero))
    .limit(1);
  return (linha?.numero ?? 0) + 1;
}

/** O chamado desta empresa, ou `null`. O filtro por empresa e obrigatorio. */
export async function acharChamado(db: Database, tenantId: string, ticketId: string) {
  const [linha] = await db
    .select()
    .from(schema.tickets)
    .where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.tenantId, tenantId)))
    .limit(1);
  return linha ?? null;
}
