import {
  DEFAULT_GRACE_PERIOD_DAYS,
  DEFAULT_PLANS,
  addressSchema,
  slugify,
} from '@codeca/shared';
import { hashPassword } from '@codeca/shared/server';
import { eq, lt } from 'drizzle-orm';
import { ensureBaselineSegments } from './baseline.js';
import { createPrimarySite } from './sites.js';
import type { Database } from './client.js';
import {
  faqs,
  leads,
  rateLimits,
  sessions,
  userTokens,
  memberships,
  plans,
  projectUpdates,
  projects,
  properties,
  services,
  subscriptions,
  teamMembers,
  tenants,
  testimonials,
  users,
} from './schema.js';

/**
 * Seed idempotente.
 *
 * Sempre cria/atualiza os planos padrao. O administrador da plataforma e a
 * construtora de demonstracao sao criados somente quando as variaveis de
 * ambiente correspondentes estao presentes.
 *
 * O seed nao cria registros em `media_assets`: arquivos reais dependem de um
 * token do Vercel Blob configurado. As secoes do site tratam a ausencia de
 * imagem exibindo um espaco reservado com as cores do tema.
 */

export interface SeedOptions {
  platformAdmin?: { email: string; password: string; name?: string } | null;
  demo?: { email: string; password: string } | null;
  log?: (message: string) => void;
}

export interface SeedResult {
  plans: number;
  platformAdminId: string | null;
  demoTenantId: string | null;
}

export async function seedDatabase(db: Database, options: SeedOptions = {}): Promise<SeedResult> {
  const log = options.log ?? (() => undefined);

  // Segmentos vem antes dos planos porque o cadastro de uma empresa resolve o
  // segmento padrao: sem nenhum, o site nasceria com todos os modulos.
  // Reaproveita a regra do baseline -- so preenche com a tabela vazia, para
  // nao desfazer o que foi ajustado no painel.
  await ensureBaselineSegments(db);

  for (const plan of DEFAULT_PLANS) {
    await db
      .insert(plans)
      .values({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        limits: plan.limits,
        billing: plan.billing,
        /*
         * So na insercao. A politica de suspensao e ajustavel no painel
         * mestre, e reescreve-la a cada seed desfaria a escolha de quem opera.
         * Em producao, a mudanca de uma politica ja existente e feita por
         * migracao (ver `0028`), com guarda para nao sobrescrever ajuste.
         */
        ...(plan.suspension ? { suspension: plan.suspension } : {}),
        isPublic: true,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: plans.code,
        set: {
          name: plan.name,
          description: plan.description,
          priceCents: plan.priceCents,
          limits: plan.limits,
          billing: plan.billing,
          updatedAt: new Date(),
        },
      });
  }
  log(`Planos sincronizados: ${DEFAULT_PLANS.map((p) => p.code).join(', ')}`);

  let platformAdminId: string | null = null;
  if (options.platformAdmin) {
    const email = options.platformAdmin.email.toLowerCase();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) {
      await db
        .update(users)
        .set({ platformRole: 'platform_admin', updatedAt: new Date() })
        .where(eq(users.id, existing.id));
      platformAdminId = existing.id;
      log(`Administrador da plataforma já existia: ${email} (papel confirmado)`);
    } else {
      const [created] = await db
        .insert(users)
        .values({
          email,
          name: options.platformAdmin.name ?? 'Administrador da plataforma',
          passwordHash: await hashPassword(options.platformAdmin.password),
          platformRole: 'platform_admin',
          emailVerifiedAt: new Date(),
        })
        .returning({ id: users.id });
      platformAdminId = created?.id ?? null;
      log(`Administrador da plataforma criado: ${email}`);
    }
  }

  let demoTenantId: string | null = null;
  if (options.demo) {
    demoTenantId = await seedDemoTenant(db, options.demo, log);
  }

  return { plans: DEFAULT_PLANS.length, platformAdminId, demoTenantId };
}

const DEMO_SLUG = 'construtora-horizonte';
const DEMO_NAME = 'Construtora Horizonte';

async function seedDemoTenant(
  db: Database,
  credentials: { email: string; password: string },
  log: (message: string) => void,
): Promise<string> {
  const [existingTenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, DEMO_SLUG));
  if (existingTenant) {
    log(`Construtora de demonstração já existe (${DEMO_SLUG}); nada a fazer.`);
    return existingTenant.id;
  }

  const [plan] = await db.select().from(plans).where(eq(plans.code, 'profissional'));
  if (!plan) throw new Error('Plano "profissional" não encontrado. Rode o seed de planos primeiro.');

  const email = credentials.email.toLowerCase();
  let [owner] = await db.select().from(users).where(eq(users.email, email));
  if (!owner) {
    [owner] = await db
      .insert(users)
      .values({
        email,
        name: 'Marina Prado',
        passwordHash: await hashPassword(credentials.password),
        phone: '(19) 99876-5432',
        emailVerifiedAt: new Date(),
      })
      .returning();
  }
  if (!owner) throw new Error('Não foi possível criar o usuário de demonstração.');

  const [tenant] = await db
    .insert(tenants)
    .values({
      slug: DEMO_SLUG,
      legalName: 'Horizonte Engenharia e Construções Ltda',
      displayName: DEMO_NAME,
      taxId: '12.345.678/0001-90',
      description:
        'Construtora e incorporadora com 18 anos de atuação em Campinas e região, especializada em '
        + 'empreendimentos residenciais de medio porte, obras comerciais e reformas estruturais.',
      foundedYear: 2007,
      creaNumber: 'CREA-SP 1234567',
      status: 'active',
      planId: plan.id,
      contactEmail: 'contato@construtorahorizonte.com.br',
      contactPhone: '(19) 3232-4545',
      whatsapp: '(19) 99876-5432',
      whatsappDefaultMessage: '',
      address: addressSchema.parse({
        street: 'Avenida Barao de Itapura',
        number: '1800',
        complement: 'Conjunto 42',
        neighborhood: 'Botafogo',
        city: 'Campinas',
        state: 'SP',
        postalCode: '13020-431',
        showFullAddress: true,
      }),
      serviceArea: 'Campinas, Valinhos, Vinhedo, Paulínia e Indaiatuba',
      businessHours: 'Segunda a sexta, das 8h as 18h',
      social: {
        instagram: 'https://www.instagram.com/construtorahorizonte',
        linkedin: 'https://www.linkedin.com/company/construtorahorizonte',
      },
    })
    .returning();
  if (!tenant) throw new Error('Não foi possível criar a construtora de demonstracao.');

  // Todo conteudo pertence a um site, nao so a empresa.
  const site = await createPrimarySite(db, { tenantId: tenant.id, name: DEMO_NAME });

  await db.insert(memberships).values({
    tenantId: tenant.id,
    userId: owner.id,
    role: 'owner',
    status: 'active',
    acceptedAt: new Date(),
  });

  const periodEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await db.insert(subscriptions).values({
    tenantId: tenant.id,
    siteId: site.id,
    planId: plan.id,
    status: 'active',
    publicationState: 'allowed',
    paymentMethod: 'creditcard',
    currentPeriodStart: new Date(),
    currentPeriodEnd: periodEnd,
    accessUntil: periodEnd,
    gracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
  });

  // ------------------------------------------------------------- servicos
  const serviceSeed = [
    {
      title: 'Construção de residências',
      icon: 'home' as const,
      summary: 'Projeto, execução e acabamento de casas e sobrados sob medida.',
      highlights: ['Projeto arquitetônico e estrutural', 'Cronograma com medições mensais', 'Garantia de 5 anos na estrutura'],
    },
    {
      title: 'Obras comerciais',
      icon: 'building-2' as const,
      summary: 'Lojas, clinicas e escritorios entregues prontos para operar.',
      highlights: ['Adequação a normas de acessibilidade', 'Instalações elétricas e hidráulicas', 'Aprovações junto a prefeitura'],
    },
    {
      title: 'Reformas estruturais',
      icon: 'hammer' as const,
      summary: 'Reforços, ampliações e recuperação estrutural com laudo técnico.',
      highlights: ['Laudo de engenheiro responsável', 'Reforço de fundação e lajes', 'Recuperação de concreto armado'],
    },
    {
      title: 'Acabamentos e interiores',
      icon: 'paint-roller' as const,
      summary: 'Revestimentos, marcenaria planejada, pintura e iluminação.',
      highlights: ['Seleção de materiais com o cliente', 'Marcenaria sob medida', 'Entrega com checklist de qualidade'],
    },
    {
      title: 'Gerenciamento de obras',
      icon: 'hard-hat' as const,
      summary: 'Acompanhamento técnico e financeiro de obras de terceiros.',
      highlights: ['Controle de cronograma físico-financeiro', 'Medição e conferência de notas', 'Relatório mensal fotográfico'],
    },
    {
      title: 'Regularização e documentação',
      icon: 'file-check' as const,
      summary: 'Averbação, habite-se e regularização de imóveis.',
      highlights: ['Levantamento documental', 'Protocolo em órgãos públicos', 'Acompanhamento até a conclusão'],
    },
  ];
  await db.insert(services).values(
    serviceSeed.map((service, index) => ({
      tenantId: tenant.id,
      siteId: site.id,
      slug: slugify(service.title),
      title: service.title,
      summary: service.summary,
      description: `${service.summary} Nossa equipe acompanha cada etapa com responsável técnico dedicado e relatórios periódicos.`,
      icon: service.icon,
      highlights: service.highlights,
      publicationStatus: 'published' as const,
      sortOrder: index,
    })),
  );

  // -------------------------------------------------------------- imoveis
  const propertySeed = [
    {
      title: 'Residencial Aurora - Apartamento 3 dormitórios',
      type: 'apartamento' as const,
      purpose: 'venda' as const,
      price: 780_000,
      commercial: 'disponivel' as const,
      publication: 'published' as const,
      bedrooms: 3,
      suites: 1,
      bathrooms: 2,
      parking: 2,
      built: 94,
      neighborhood: 'Cambui',
      featured: true,
      features: ['Varanda gourmet', 'Lazer completo', 'Portaria 24 horas', 'Elevador privativo'],
    },
    {
      title: 'Casa Vila Verde - 4 dormitórios com piscina',
      type: 'casa_condominio' as const,
      purpose: 'venda' as const,
      price: 1_450_000,
      commercial: 'disponivel' as const,
      publication: 'published' as const,
      bedrooms: 4,
      suites: 2,
      bathrooms: 4,
      parking: 4,
      built: 280,
      land: 450,
      neighborhood: 'Alphaville',
      featured: true,
      features: ['Piscina aquecida', 'Churrasqueira', 'Automação residencial', 'Energia solar'],
    },
    {
      title: 'Edificio Mirante - Studio mobiliado',
      type: 'studio' as const,
      purpose: 'venda_locacao' as const,
      price: 395_000,
      commercial: 'disponivel' as const,
      publication: 'published' as const,
      bedrooms: 1,
      bathrooms: 1,
      parking: 1,
      built: 38,
      neighborhood: 'Centro',
      features: ['Mobiliado', 'Coworking no predio', 'Pet place'],
    },
    {
      title: 'Terreno Vista Serra - 520 m2',
      type: 'terreno' as const,
      purpose: 'venda' as const,
      price: 310_000,
      commercial: 'disponivel' as const,
      publication: 'published' as const,
      land: 520,
      neighborhood: 'Jardim Botanico',
      features: ['Topografia plana', 'Documentação regularizada'],
    },
    {
      title: 'Sala comercial Horizonte Office',
      type: 'sala_comercial' as const,
      purpose: 'locacao' as const,
      price: 4_200,
      commercial: 'reservado' as const,
      publication: 'published' as const,
      bathrooms: 1,
      parking: 2,
      built: 62,
      neighborhood: 'Botafogo',
      features: ['Ar-condicionado central', 'Recepção compartilhada'],
    },
    {
      title: 'Residencial Jatoba - Lancamento',
      type: 'apartamento' as const,
      purpose: 'lancamento' as const,
      price: null,
      priceOnRequest: true,
      commercial: 'em_construcao' as const,
      publication: 'draft' as const,
      bedrooms: 2,
      suites: 1,
      bathrooms: 2,
      parking: 1,
      built: 68,
      neighborhood: 'Taquaral',
      features: ['Entrega prevista para 2027', 'Lazer no rooftop'],
    },
  ];

  await db.insert(properties).values(
    propertySeed.map((item, index) => ({
      tenantId: tenant.id,
      siteId: site.id,
      slug: slugify(item.title),
      title: item.title,
      reference: `HZT-${String(index + 1).padStart(3, '0')}`,
      shortDescription: `${item.neighborhood}, Campinas - ${item.built ? `${item.built} m2` : `${item.land ?? 0} m2 de terreno`}.`,
      description:
        'Imóvel entregue pela Construtora Horizonte, com acabamento conferido item por item antes da entrega. '
        + 'Agende uma visita para conhecer a planta e as opções de personalização.',
      type: item.type,
      purpose: item.purpose,
      price: item.price,
      priceOnRequest: item.priceOnRequest ?? false,
      currency: 'BRL' as const,
      address: addressSchema.parse({
        neighborhood: item.neighborhood,
        city: 'Campinas',
        state: 'SP',
        showFullAddress: false,
      }),
      builtAreaM2: item.built ?? null,
      landAreaM2: item.land ?? null,
      bedrooms: item.bedrooms ?? null,
      suites: item.suites ?? null,
      bathrooms: item.bathrooms ?? null,
      parkingSpots: item.parking ?? null,
      features: item.features,
      publicationStatus: item.publication,
      commercialStatus: item.commercial,
      featured: item.featured ?? false,
      sortOrder: index,
      publishedAt: item.publication === 'published' ? new Date() : null,
    })),
  );

  // ---------------------------------------------------------------- obras
  const projectSeed = [
    {
      title: 'Residencial Aurora',
      category: 'residencial' as const,
      status: 'em_andamento' as const,
      stage: 'acabamentos' as const,
      progress: 78,
      start: '2024-03-11',
      expected: '2026-02-27',
      updates: [
        { title: 'Início dos acabamentos internos', stage: 'acabamentos' as const, progress: 78, at: '2025-09-15' },
        { title: 'Conclusão das instalações elétricas', stage: 'instalacoes' as const, progress: 64, at: '2025-06-02' },
        { title: 'Alvenaria do último pavimento', stage: 'alvenaria' as const, progress: 45, at: '2025-02-10' },
      ],
    },
    {
      title: 'Clínica Bem Viver',
      category: 'comercial' as const,
      status: 'em_andamento' as const,
      stage: 'instalacoes' as const,
      progress: null,
      start: '2025-01-20',
      expected: '2026-05-29',
      updates: [{ title: 'Instalações hidráulicas concluídas', stage: 'instalacoes' as const, progress: null, at: '2025-10-01' }],
    },
    {
      title: 'Galpão Logístico Paulínia',
      category: 'industrial' as const,
      status: 'concluida' as const,
      stage: 'concluida' as const,
      progress: 100,
      start: '2023-05-08',
      expected: '2024-11-29',
      completed: '2024-11-14',
      updates: [{ title: 'Obra entregue ao cliente', stage: 'concluida' as const, progress: 100, at: '2024-11-14' }],
    },
    {
      title: 'Reforma estrutural Edificio Santos Dumont',
      category: 'reforma' as const,
      status: 'prevista' as const,
      stage: 'planejamento' as const,
      progress: null,
      start: null,
      expected: '2026-08-31',
      updates: [],
    },
  ];

  for (const [index, item] of projectSeed.entries()) {
    const [project] = await db
      .insert(projects)
      .values({
        tenantId: tenant.id,
        siteId: site.id,
        slug: slugify(item.title),
        title: item.title,
        shortDescription: `Obra ${item.category} acompanhada pela equipe técnica da Construtora Horizonte.`,
        description:
          'Projeto executado com cronograma físico-financeiro acompanhado mensalmente e relatório fotográfico '
          + 'disponibilizado ao cliente em cada medição.',
        category: item.category,
        status: item.status,
        stage: item.stage,
        progressPercent: item.progress,
        city: 'Campinas',
        state: 'SP',
        neighborhood: '',
        showLocation: true,
        startDate: item.start,
        expectedCompletionDate: item.expected,
        completedDate: item.completed ?? null,
        publicationStatus: 'published' as const,
        featured: index === 0,
        sortOrder: index,
        publishedAt: new Date(),
      })
      .returning();
    if (!project) continue;
    if (item.updates.length > 0) {
      await db.insert(projectUpdates).values(
        item.updates.map((update) => ({
          tenantId: tenant.id,
          siteId: site.id,
          projectId: project.id,
          title: update.title,
          note: 'Registro de evolução publicado pela equipe técnica.',
          stage: update.stage,
          progressPercent: update.progress,
          recordedAt: update.at,
        })),
      );
    }
  }

  // ------------------------------------------------------ prova social
  await db.insert(testimonials).values([
    {
      tenantId: tenant.id,
      siteId: site.id,
      authorName: 'Ana Beatriz Correia',
      authorRole: 'Proprietária - Casa Vila Verde',
      content:
        'Acompanhei a obra do início ao fim com relatórios mensais. O prazo foi cumprido e o acabamento ficou '
        + 'exatamente como combinamos em projeto.',
      rating: 5,
      authorizationConfirmed: true,
      authorizationNote: 'Autorização por escrito recebida em 12/03/2025.',
      publicationStatus: 'published',
      sortOrder: 0,
    },
    {
      tenantId: tenant.id,
      siteId: site.id,
      authorName: 'Dr. Rogerio Lemos',
      authorRole: 'Clínica Bem Viver',
      content:
        'A equipe resolveu as adequações de acessibilidade sem atrasar o cronograma. Recomendo para obras '
        + 'comerciais que precisam abrir em data definida.',
      rating: 5,
      authorizationConfirmed: true,
      authorizationNote: 'Autorização registrada em contrato de obra.',
      publicationStatus: 'published',
      sortOrder: 1,
    },
    {
      tenantId: tenant.id,
      siteId: site.id,
      authorName: 'Cooperativa Agro Paulínia',
      authorRole: 'Galpão Logístico',
      content: 'Entrega antecipada em duas semanas e documentação de habite-se resolvida pela própria construtora.',
      rating: 4,
      authorizationConfirmed: false,
      authorizationNote: 'Aguardando retorno do cliente para autorizar a publicação.',
      publicationStatus: 'draft',
      sortOrder: 2,
    },
  ]);

  await db.insert(teamMembers).values([
    {
      tenantId: tenant.id,
      siteId: site.id,
      name: 'Marina Prado',
      role: 'Engenheira civil responsável - CREA-SP 1234567',
      bio: 'Responsável técnica pelos empreendimentos residenciais, com 18 anos de experiência em obras verticais.',
      publicationStatus: 'published',
      sortOrder: 0,
    },
    {
      tenantId: tenant.id,
      siteId: site.id,
      name: 'Caio Ferreira',
      role: 'Arquiteto - CAU A12345-6',
      bio: 'Coordena projetos arquitetônicos e a compatibilização com as disciplinas complementares.',
      publicationStatus: 'published',
      sortOrder: 1,
    },
    {
      tenantId: tenant.id,
      siteId: site.id,
      name: 'Juliana Sato',
      role: 'Coordenadora de obras',
      bio: 'Acompanha cronogramas, medições e a qualidade da execução em campo.',
      publicationStatus: 'published',
      sortOrder: 2,
    },
  ]);

  await db.insert(faqs).values([
    {
      tenantId: tenant.id,
      siteId: site.id,
      question: 'Vocês fazem apenas a execução ou também o projeto?',
      answer: 'Atuamos nas duas frentes. Podemos desenvolver o projeto completo ou executar um projeto já aprovado.',
      publicationStatus: 'published',
      sortOrder: 0,
    },
    {
      tenantId: tenant.id,
      siteId: site.id,
      question: 'Como funciona o acompanhamento da obra?',
      answer:
        'Cada obra tem um responsável técnico e medições mensais. O cliente recebe relatório fotográfico e '
        + 'planilha de cronograma físico-financeiro.',
      publicationStatus: 'published',
      sortOrder: 1,
    },
    {
      tenantId: tenant.id,
      siteId: site.id,
      question: 'Qual o prazo médio de uma residência?',
      answer: 'Depende da área e do padrão de acabamento. Casas de 200 a 300 m2 levam de 12 a 18 meses.',
      publicationStatus: 'published',
      sortOrder: 2,
    },
    {
      tenantId: tenant.id,
      siteId: site.id,
      question: 'Vocês atendem fora de Campinas?',
      answer: 'Atendemos Campinas, Valinhos, Vinhedo, Paulínia e Indaiatuba. Outras cidades são avaliadas caso a caso.',
      publicationStatus: 'published',
      sortOrder: 3,
    },
  ]);

  await db.insert(leads).values([
    {
      tenantId: tenant.id,
      siteId: site.id,
      name: 'Patricia Nunes',
      phone: '(19) 99111-2233',
      email: 'patricia.nunes@exemplo.com.br',
      interestType: 'compra_imovel',
      message: 'Gostaria de visitar o Residencial Aurora neste fim de semana.',
      status: 'novo',
      sourcePath: '/imoveis/residencial-aurora-apartamento-3-dormitorios',
    },
    {
      tenantId: tenant.id,
      siteId: site.id,
      name: 'Eduardo Machado',
      phone: '(19) 98222-4455',
      interestType: 'construcao',
      message: 'Tenho um terreno em Valinhos e quero orçamento para uma casa de 220 m2.',
      status: 'em_atendimento',
      sourcePath: '/contato',
    },
    {
      tenantId: tenant.id,
      siteId: site.id,
      name: 'Condomínio Jardim das Palmeiras',
      phone: '(19) 3777-8899',
      email: 'sindico@jardimdaspalmeiras.com.br',
      interestType: 'reforma',
      message: 'Precisamos de laudo e orçamento para recuperação estrutural da garagem.',
      status: 'qualificado',
      sourcePath: '/servicos',
    },
  ]);

  log(`Construtora de demonstração criada: ${DEMO_NAME}`);
  log(`Acesso de demonstração: ${email}`);
  return tenant.id;
}

/** Remove registros expirados. Pode ser agendado como tarefa periodica. */
export async function pruneExpiredRecords(db: Database): Promise<void> {
  const now = new Date();
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(userTokens).where(lt(userTokens.expiresAt, now));
  await db.delete(rateLimits).where(lt(rateLimits.expiresAt, now));
}
