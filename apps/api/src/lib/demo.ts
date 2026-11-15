import { and, eq, inArray, isNull, ne, schema, sql, type Database, type DemoSeed } from '@codeca/database';
import { AppError, normalizeOrigin, slugify } from '@codeca/shared';
import { issueApiKey } from './integration/keys.js';

/**
 * Site de demonstracao da avaliacao.
 *
 * ## O problema
 *
 * Quem se cadastrava sozinho recebia um painel sem site nenhum ligado a ele.
 * Ligar um site (emitir a chave de integracao) era ato exclusivo da CODECA IA,
 * entao a pessoa cadastrava conteudo que nao aparecia em lugar algum enquanto
 * os 14 dias corriam.
 *
 * ## A solucao, sem arquitetura nova
 *
 * O site que o cadastro ja criava passa a nascer como demonstracao:
 *
 * 1. marcado com `is_demo`;
 * 2. com uma chave PUBLICAVEL propria, autorizada so para o endereco da
 *    plataforma -- a mesma credencial que um site real usa;
 * 3. com alguns conteudos de exemplo, dentro do limite do plano;
 * 4. visivel em `/demonstracao/<id>`, que le o conteudo pela API publica de
 *    verdade (`routes/demo.ts` so encaminha).
 *
 * Nada e simulado: editar no painel grava no banco, e a pagina le pelo mesmo
 * caminho de autenticacao, cobranca e cache de qualquer site.
 *
 * ## O que a demonstracao NAO e
 *
 * - Nao e acesso a mais: usa a assinatura de avaliacao da propria empresa, e
 *   quando ela vence a API publica responde 402, como em qualquer site.
 * - Nao e conta compartilhada: cada empresa tem o seu site, a sua chave e os
 *   seus registros.
 * - Nao da privilegio: a chave e publicavel, so de leitura.
 *
 * ## Exemplos e conteudo do cliente nunca se confundem
 *
 * Os identificadores do que foi criado como exemplo ficam em `demo_seed`. Na
 * hora de ligar o site real, so sai o exemplo que o cliente NAO tocou; o que
 * ele editou ou criou e dele, e fica.
 */

/** Quantas vagas do plano ficam livres para o cliente criar o proprio conteudo. */
const VAGAS_LIVRES = 2;

const TEXTO_DE_APRESENTACAO =
  'Este é um texto de exemplo. Troque por uma apresentação da sua empresa: o que ela faz, para quem '
  + 'e o que a torna diferente. Edite em Conteúdo > Institucional e veja a mudança no site.';

/** Exemplos, na ordem em que entram. Cortados pelo limite do plano. */
const EXEMPLOS = [
  {
    tipo: 'banner' as const,
    title: 'Bem-vindo ao seu site de demonstração',
    subtitle: 'Tudo o que você vê aqui pode ser editado no painel. Troque este texto e atualize a página.',
    buttonLabel: 'Fale conosco',
    buttonUrl: '#contato',
  },
  {
    tipo: 'servico' as const,
    title: 'Serviço de exemplo',
    summary: 'Descreva aqui um serviço que a sua empresa oferece.',
    description:
      'Este serviço é um exemplo. Edite o título e o texto no painel, ou exclua e cadastre os seus.',
    highlights: ['Editável no painel', 'Aparece no site em segundos'],
    icon: 'wrench' as const,
  },
  {
    tipo: 'servico' as const,
    title: 'Outro serviço de exemplo',
    summary: 'Cada serviço cadastrado vira um cartão como este.',
    description: 'Use a ordem para escolher qual aparece primeiro.',
    highlights: ['Você escolhe a ordem'],
    icon: 'ruler' as const,
  },
];

export interface ProvisionDemoInput {
  tenantId: string;
  siteId: string;
  /** Endereco da plataforma: unica origem autorizada a ler a demonstracao. */
  appUrl: string;
  /** Limite de conteudos do plano de avaliacao; `null` = sem limite. */
  contentLimit: number | null;
  now: Date;
}

/**
 * Transforma o site recem-criado em demonstracao. Roda DENTRO da transacao do
 * cadastro: empresa, site, avaliacao e demonstracao vivem ou morrem juntos.
 */
export async function provisionDemoSite(
  tx: Database,
  input: ProvisionDemoInput,
): Promise<DemoSeed | null> {
  const origin = normalizeOrigin(input.appUrl);
  if (!origin) {
    /*
     * Sem endereco valido da plataforma nao ha onde mostrar a demonstracao.
     * Isso NAO pode impedir o cadastro: a pessoa fica com o painel de antes
     * (sem site para ver), que e pior do que com a demonstracao e muito melhor
     * do que nao conseguir criar a conta. Conferido antes de qualquer escrita,
     * para nao deixar a transacao do cadastro em estado de erro.
     */
    console.warn('[demo] APP_URL não é um endereço aceito como origem: cadastro segue sem demonstração.');
    return null;
  }

  // A demonstracao mostra banners e servicos: garante os modulos, seja qual
  // for o segmento padrao que a CODECA IA tiver escolhido no painel.
  await tx
    .insert(schema.siteModules)
    .values(
      ['institucional', 'contato', 'banners', 'servicos'].map((moduleKey) => ({
        tenantId: input.tenantId,
        siteId: input.siteId,
        moduleKey,
        enabled: true,
      })),
    )
    .onConflictDoNothing();

  // Chave propria desta empresa, so de leitura, e so para o endereco da plataforma.
  const chave = await issueApiKey(tx, {
    tenantId: input.tenantId,
    siteId: input.siteId,
    kind: 'publishable',
    name: 'Site de demonstração',
  });
  await tx
    .insert(schema.siteOrigins)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      origin,
      note: 'Site de demonstração (criado no cadastro)',
    })
    .onConflictDoNothing();

  // Exemplos: nunca alem do que deixa vagas para o cliente criar os dele.
  const teto =
    input.contentLimit === null ? EXEMPLOS.length : Math.max(0, input.contentLimit - VAGAS_LIVRES);
  const escolhidos = EXEMPLOS.slice(0, teto);

  const records: DemoSeed['records'] = { banners: [], services: [] };
  let ordem = 0;
  for (const exemplo of escolhidos) {
    if (exemplo.tipo === 'banner') {
      const [linha] = await tx
        .insert(schema.banners)
        .values({
          tenantId: input.tenantId,
          siteId: input.siteId,
          title: exemplo.title,
          subtitle: exemplo.subtitle,
          buttonLabel: exemplo.buttonLabel,
          buttonUrl: exemplo.buttonUrl,
          sortOrder: 0,
          isActive: true,
        })
        .returning({ id: schema.banners.id });
      if (linha) records.banners.push(linha.id);
    } else {
      const [linha] = await tx
        .insert(schema.services)
        .values({
          tenantId: input.tenantId,
          siteId: input.siteId,
          slug: slugify(exemplo.title),
          title: exemplo.title,
          summary: exemplo.summary,
          description: exemplo.description,
          highlights: exemplo.highlights,
          icon: exemplo.icon,
          publicationStatus: 'published',
          sortOrder: ordem,
        })
        .returning({ id: schema.services.id });
      if (linha) records.services.push(linha.id);
      ordem += 1;
    }
  }

  // Texto de apresentacao, so se a empresa ainda nao tiver um.
  const [documento] = await tx
    .select({ id: schema.contentDocuments.id, data: schema.contentDocuments.data })
    .from(schema.contentDocuments)
    .where(
      and(
        eq(schema.contentDocuments.siteId, input.siteId),
        eq(schema.contentDocuments.moduleKey, 'institucional'),
      ),
    );
  let shortDescription = '';
  if (documento && !String(documento.data.shortDescription ?? '').trim()) {
    shortDescription = TEXTO_DE_APRESENTACAO;
    await tx
      .update(schema.contentDocuments)
      .set({ data: { ...documento.data, shortDescription } })
      .where(eq(schema.contentDocuments.id, documento.id));
  }

  const seed: DemoSeed = {
    seededAt: input.now.toISOString(),
    records,
    shortDescription,
    apiKeyId: chave.id,
  };
  await tx
    .update(schema.sites)
    .set({ isDemo: true, demoSeed: seed, updatedAt: input.now })
    .where(and(eq(schema.sites.id, input.siteId), eq(schema.sites.tenantId, input.tenantId)));

  return seed;
}

/**
 * Credencial para a pagina de demonstracao ler o conteudo.
 *
 * `null` para qualquer site que nao seja uma demonstracao em vigor -- site
 * real, inexistente, ou demonstracao ja encerrada. Quem chama responde 404 em
 * todos os casos: a rota nao revela quais sites existem.
 */
export async function loadDemoCredential(
  db: Database,
  siteId: string,
): Promise<{ token: string; tenantId: string } | null> {
  const [site] = await db
    .select({ tenantId: schema.sites.tenantId, isDemo: schema.sites.isDemo, demoSeed: schema.sites.demoSeed })
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId));
  if (!site || !site.isDemo || !site.demoSeed) return null;

  const [chave] = await db
    .select({ token: schema.siteApiKeys.token })
    .from(schema.siteApiKeys)
    .where(
      and(
        eq(schema.siteApiKeys.id, site.demoSeed.apiKeyId),
        eq(schema.siteApiKeys.siteId, siteId),
        isNull(schema.siteApiKeys.revokedAt),
      ),
    );
  if (!chave?.token) return null;
  return { token: chave.token, tenantId: site.tenantId };
}

// ------------------------------------------------- transicao para o site real

export interface DemoTransitionPreview {
  isDemo: boolean;
  /** O site real ja tem credencial propria? Sem ela, a transicao e recusada. */
  realKeyIssued: boolean;
  /** Exemplos que o cliente nao tocou: podem sair. */
  untouchedExamples: { banners: number; services: number };
  /** Exemplos que o cliente editou: passaram a ser dele, e ficam. */
  editedExamples: { banners: number; services: number };
  /** O texto de apresentacao ainda e o de exemplo? */
  exampleDescriptionInPlace: boolean;
}

async function intocados(
  db: Database,
  tabela: typeof schema.banners | typeof schema.services,
  ids: string[],
  siteId: string,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const linhas = await db
    .select({ id: tabela.id })
    .from(tabela)
    .where(
      and(
        inArray(tabela.id, ids),
        eq(tabela.siteId, siteId),
        // Nunca editado: quem editou assumiu o conteudo como seu.
        sql`${tabela.updatedAt} = ${tabela.createdAt}`,
      ),
    );
  return linhas.map((linha) => linha.id);
}

async function existentes(
  db: Database,
  tabela: typeof schema.banners | typeof schema.services,
  ids: string[],
  siteId: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const linhas = await db
    .select({ id: tabela.id })
    .from(tabela)
    .where(and(inArray(tabela.id, ids), eq(tabela.siteId, siteId)));
  return linhas.length;
}

export async function demoTransitionPreview(db: Database, siteId: string): Promise<DemoTransitionPreview> {
  const [site] = await db
    .select({ isDemo: schema.sites.isDemo, demoSeed: schema.sites.demoSeed })
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId));
  if (!site) throw AppError.notFound('Site não encontrado.');

  const seed = site.demoSeed;
  const vazio = { banners: 0, services: 0 };
  if (!site.isDemo || !seed) {
    return {
      isDemo: false,
      realKeyIssued: false,
      untouchedExamples: vazio,
      editedExamples: vazio,
      exampleDescriptionInPlace: false,
    };
  }

  const [bannersIntocados, servicosIntocados, bannersVivos, servicosVivos] = await Promise.all([
    intocados(db, schema.banners, seed.records.banners, siteId),
    intocados(db, schema.services, seed.records.services, siteId),
    existentes(db, schema.banners, seed.records.banners, siteId),
    existentes(db, schema.services, seed.records.services, siteId),
  ]);

  const outrasChaves = await db
    .select({ id: schema.siteApiKeys.id })
    .from(schema.siteApiKeys)
    .where(
      and(
        eq(schema.siteApiKeys.siteId, siteId),
        ne(schema.siteApiKeys.id, seed.apiKeyId),
        isNull(schema.siteApiKeys.revokedAt),
      ),
    );

  const [documento] = await db
    .select({ data: schema.contentDocuments.data })
    .from(schema.contentDocuments)
    .where(
      and(eq(schema.contentDocuments.siteId, siteId), eq(schema.contentDocuments.moduleKey, 'institucional')),
    );

  return {
    isDemo: true,
    realKeyIssued: outrasChaves.length > 0,
    untouchedExamples: { banners: bannersIntocados.length, services: servicosIntocados.length },
    editedExamples: {
      banners: bannersVivos - bannersIntocados.length,
      services: servicosVivos - servicosIntocados.length,
    },
    exampleDescriptionInPlace:
      seed.shortDescription !== '' && documento?.data.shortDescription === seed.shortDescription,
  };
}

export interface EndDemoResult {
  removed: { banners: number; services: number };
  kept: { banners: number; services: number };
  descriptionCleared: boolean;
}

/**
 * Encerra a demonstracao: o site passa a ser o site real do cliente.
 *
 * So acontece depois que o site real tem credencial propria -- antes disso,
 * encerrar deixaria o cliente sem site nenhum. Tudo numa transacao: se
 * qualquer passo falhar, a demonstracao continua exatamente como estava.
 *
 * `removeUntouchedExamples` precisa vir `true` de forma explicita para que
 * algo seja apagado, e mesmo assim so sai o exemplo que o cliente nunca
 * editou. Conteudo criado ou alterado por ele nao e tocado em hipotese alguma.
 */
export async function endDemo(
  db: Database,
  input: { siteId: string; removeUntouchedExamples: boolean; now: Date; appUrl: string },
): Promise<EndDemoResult> {
  return db.transaction(async (transacao) => {
    const tx = transacao as unknown as Database;

    // Trava o site: duas transicoes ao mesmo tempo nao se atropelam.
    const [site] = await tx
      .select({ isDemo: schema.sites.isDemo, demoSeed: schema.sites.demoSeed })
      .from(schema.sites)
      .where(eq(schema.sites.id, input.siteId))
      .for('update');
    if (!site) throw AppError.notFound('Site não encontrado.');
    if (!site.isDemo || !site.demoSeed) {
      throw AppError.conflict('Este site não é uma demonstração, ou ela já foi encerrada.');
    }
    const seed = site.demoSeed;

    const previa = await demoTransitionPreview(tx, input.siteId);
    if (!previa.realKeyIssued) {
      throw AppError.conflict(
        'Emita primeiro a chave de integração do site real. A demonstração só é encerrada depois '
          + 'que o site do cliente tem como se conectar.',
      );
    }

    const removed = { banners: 0, services: 0 };
    let descriptionCleared = false;

    if (input.removeUntouchedExamples) {
      const banners = await intocados(tx, schema.banners, seed.records.banners, input.siteId);
      const servicos = await intocados(tx, schema.services, seed.records.services, input.siteId);
      if (banners.length > 0) {
        await tx.delete(schema.banners).where(inArray(schema.banners.id, banners));
      }
      if (servicos.length > 0) {
        await tx.delete(schema.services).where(inArray(schema.services.id, servicos));
      }
      removed.banners = banners.length;
      removed.services = servicos.length;

      if (previa.exampleDescriptionInPlace) {
        const [documento] = await tx
          .select({ id: schema.contentDocuments.id, data: schema.contentDocuments.data })
          .from(schema.contentDocuments)
          .where(
            and(
              eq(schema.contentDocuments.siteId, input.siteId),
              eq(schema.contentDocuments.moduleKey, 'institucional'),
            ),
          );
        if (documento) {
          await tx
            .update(schema.contentDocuments)
            .set({ data: { ...documento.data, shortDescription: '' } })
            .where(eq(schema.contentDocuments.id, documento.id));
          descriptionCleared = true;
        }
      }
    }

    // A credencial da demonstracao deixa de valer: o endereco de demonstracao
    // para de responder no mesmo instante.
    await tx
      .update(schema.siteApiKeys)
      .set({ revokedAt: input.now, updatedAt: input.now })
      .where(and(eq(schema.siteApiKeys.id, seed.apiKeyId), eq(schema.siteApiKeys.siteId, input.siteId)));

    // E a plataforma deixa de ser origem autorizada do site: dali em diante
    // so o endereco do site real le com a chave publicavel dele.
    const origem = normalizeOrigin(input.appUrl);
    if (origem) {
      await tx
        .delete(schema.siteOrigins)
        .where(and(eq(schema.siteOrigins.siteId, input.siteId), eq(schema.siteOrigins.origin, origem)));
    }

    await tx
      .update(schema.sites)
      .set({
        isDemo: false,
        // O registro fica, com a data: e a historia de onde este site veio.
        demoSeed: { ...seed, endedAt: input.now.toISOString() },
        updatedAt: input.now,
      })
      .where(eq(schema.sites.id, input.siteId));

    return {
      removed,
      kept: {
        banners: previa.untouchedExamples.banners + previa.editedExamples.banners - removed.banners,
        services: previa.untouchedExamples.services + previa.editedExamples.services - removed.services,
      },
      descriptionCleared,
    };
  });
}
