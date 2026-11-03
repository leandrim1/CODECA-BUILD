import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, provisionSiteModules, schema } from '@codeca/database';
import {
  CONTENT_LIMIT_MODULE_KEYS,
  DEFAULT_PLANS,
  MODULE_KEYS,
  MODULE_REGISTRY,
  planLimitsSchema,
} from '@codeca/shared';
import { getTableName } from 'drizzle-orm';
import { TABELAS_DE_CONTEUDO } from '../../apps/api/src/lib/content-usage.js';
import {
  createTestApi,
  registerAccount,
  seedPlatformAdmin,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * O limite geral de conteudos cadastrados, plano a plano e modulo a modulo.
 *
 * A promessa: **a mesma regra vale para qualquer segmento**. O limite nao
 * distingue produto de servico, imovel de obra, profissional de registro de
 * modulo personalizado -- e e conferido no servidor, em toda criacao.
 *
 * Os registros que enchem o plano sao gravados direto no banco (400 chamadas de
 * API so para chegar ao limite do Empresas nao testariam nada a mais); o que
 * se exercita pela API e o ultimo passo: a criacao que cabe e a que nao cabe.
 */

let api: TestApi;
let conta: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi();
});
afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  await seedPlatformAdmin(api);
  conta = await registerAccount(api, { email: 'dono@limites.test', companyName: 'Empresa Qualquer' });
  await verifyEmail(api, conta);
  // Todos os modulos ligados: o limite e de todos eles.
  await provisionSiteModules(api.db, {
    tenantId: conta.tenantId,
    siteId: conta.siteId,
    moduleKeys: [...MODULE_KEYS],
  });
});

const base = () => `/api/tenants/${conta.tenantId}`;

async function usarPlano(codigo: string, extras: Partial<{ features: string[]; maxContentRecords: number }> = {}) {
  const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, codigo));
  await api.db
    .update(schema.tenants)
    .set({
      planId: plano!.id,
      status: 'active',
      limitOverrides: Object.keys(extras).length ? (extras as never) : null,
    })
    .where(eq(schema.tenants.id, conta.tenantId));
  return plano!;
}

let sequencia = 0;
const proximo = () => {
  sequencia += 1;
  return sequencia;
};

/** Grava `n` registros num modulo, direto no banco. */
async function inserir(modulo: string, n: number, extra: Record<string, unknown> = {}) {
  const comum = () => {
    const i = proximo();
    return { tenantId: conta.tenantId, siteId: conta.siteId, slug: `reg-${i}`, _i: i };
  };
  const linhas = Array.from({ length: n }, comum);
  const t = { tenantId: conta.tenantId, siteId: conta.siteId };
  switch (modulo) {
    case 'servicos':
      await api.db.insert(schema.services).values(linhas.map((l) => ({ ...t, slug: l.slug, title: `Servico ${l._i}`, ...extra })) as never);
      break;
    case 'produtos':
      await api.db.insert(schema.products).values(linhas.map((l) => ({ ...t, slug: l.slug, title: `Produto ${l._i}`, ...extra })) as never);
      break;
    case 'imoveis':
      await api.db.insert(schema.properties).values(linhas.map((l) => ({ ...t, slug: l.slug, title: `Imovel ${l._i}`, type: 'casa', purpose: 'venda', ...extra })) as never);
      break;
    case 'obras':
      await api.db.insert(schema.projects).values(linhas.map((l) => ({ ...t, slug: l.slug, title: `Obra ${l._i}`, ...extra })) as never);
      break;
    case 'equipe':
      await api.db.insert(schema.teamMembers).values(linhas.map((l) => ({ ...t, name: `Pessoa ${l._i}`, role: 'Cargo', ...extra })) as never);
      break;
    case 'faq':
      await api.db.insert(schema.faqs).values(linhas.map((l) => ({ ...t, question: `Pergunta ${l._i}?`, answer: 'Resposta', ...extra })) as never);
      break;
    case 'depoimentos':
      await api.db.insert(schema.testimonials).values(linhas.map((l) => ({ ...t, authorName: `Autor ${l._i}`, content: 'Texto do depoimento', ...extra })) as never);
      break;
    case 'categorias':
      await api.db.insert(schema.categories).values(linhas.map((l) => ({ ...t, slug: l.slug, name: `Categoria ${l._i}`, moduleKey: 'produtos', ...extra })) as never);
      break;
    case 'galerias':
      await api.db.insert(schema.galleries).values(linhas.map((l) => ({ ...t, slug: l.slug, title: `Galeria ${l._i}`, ...extra })) as never);
      break;
    case 'banners':
      await api.db.insert(schema.banners).values(linhas.map((l) => ({ ...t, title: `Banner ${l._i}`, ...extra })) as never);
      break;
    default:
      throw new Error(`modulo sem semeador: ${modulo}`);
  }
}

/** Distribui `n` registros entre varios modulos, para provar que o limite e geral. */
async function encher(n: number) {
  const modulos = ['servicos', 'produtos', 'equipe', 'faq', 'galerias', 'categorias'];
  let restante = n;
  let i = 0;
  while (restante > 0) {
    const lote = Math.min(restante, Math.ceil(n / modulos.length));
    await inserir(modulos[i % modulos.length]!, lote);
    restante -= lote;
    i += 1;
  }
}

const uso = async () => (await conta.client.get(`${base()}/content-usage`)).body as {
  used: number;
  max: number;
  byModule: Record<string, number>;
  planName: string;
  overridden: boolean;
};

/** Uma criacao valida em cada modulo de colecao. */
const CRIACOES: Record<string, () => Promise<{ status: number; errorCode: string | null }>> = {
  banners: () => conta.client.post(`${base()}/banners`, { title: 'Banner novo', isActive: true }),
  imoveis: () =>
    conta.client.post(`${base()}/properties`, {
      title: 'Imovel novo',
      description: 'Descricao completa do imovel cadastrado.',
      type: 'casa',
      purpose: 'venda',
      price: 100000,
      address: { city: 'Campinas', state: 'SP', showFullAddress: false },
      publicationStatus: 'draft',
    }),
  obras: () => conta.client.post(`${base()}/projects`, { title: 'Obra nova', category: 'residencial' }),
  servicos: () => conta.client.post(`${base()}/services`, { title: 'Servico novo', summary: 'Resumo do servico.', icon: 'wrench' }),
  depoimentos: () =>
    conta.client.post(`${base()}/testimonials`, {
      authorName: 'Cliente',
      content: 'Texto do depoimento do cliente satisfeito.',
      authorizationConfirmed: true,
      publicationStatus: 'draft',
    }),
  equipe: () => conta.client.post(`${base()}/team`, { name: 'Profissional Novo', role: 'Cargo' }),
  faq: () => conta.client.post(`${base()}/faqs`, { question: 'Pergunta nova?', answer: 'Resposta nova.' }),
  produtos: () => conta.client.post(`${base()}/products`, { title: 'Produto novo', publicationStatus: 'draft' }),
  categorias: () => conta.client.post(`${base()}/categories`, { name: 'Categoria nova' }),
  galerias: () => conta.client.post(`${base()}/galleries`, { title: 'Galeria nova', publicationStatus: 'draft' }),
};

describe('os quatro planos: o limite geral, conferido no servidor', () => {
  for (const semente of DEFAULT_PLANS) {
    const max = semente.limits.maxContentRecords;
    // O Essencial nao inclui o painel: quem mantem o conteudo e a CODECA IA,
    // que o faz com o recurso concedido a empresa. E por esse caminho que o
    // limite dele e alcancado.
    const extras = semente.limits.features.includes('cms_panel')
      ? {}
      : { features: [...semente.limits.features, 'cms_panel'] };

    describe(`${semente.code} (${max} conteudos)`, () => {
      it('o plano do banco tem o limite combinado', async () => {
        const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, semente.code));
        expect(planLimitsSchema.parse(plano!.limits).maxContentRecords).toBe(max);
      });

      it('aceita ate o limite e recusa o seguinte, em qualquer modulo', async () => {
        await usarPlano(semente.code, extras);

        // Falta uma vaga: o plano esta cheio menos um.
        await encher(max - 1);
        expect((await uso()).used).toBe(max - 1);

        // A ultima vaga cabe -- pela API, num modulo diferente dos que a encheram.
        const ultima = await CRIACOES.imoveis!();
        expect(ultima.status, JSON.stringify(ultima)).toBe(201);
        expect((await uso()).used).toBe(max);

        // Cheio: NENHUM modulo cria mais, qualquer que seja o segmento.
        for (const modulo of CONTENT_LIMIT_MODULE_KEYS) {
          const resposta = await CRIACOES[modulo]!();
          expect(resposta.status, `${modulo} deveria ser recusado`).toBe(402);
          expect(resposta.errorCode, modulo).toBe('plan_limit_reached');
        }
        expect((await uso()).used).toBe(max);
      });
    });
  }
});

describe('o que conta como conteudo cadastrado', () => {
  it('rascunho, publicado e arquivado contam; os tres ocupam vaga', async () => {
    await usarPlano('profissional');
    await inserir('produtos', 1, { publicationStatus: 'draft' });
    await inserir('produtos', 1, { publicationStatus: 'published' });
    await inserir('produtos', 1, { publicationStatus: 'archived' });
    expect((await uso()).used).toBe(3);
  });

  it('excluir libera a vaga na hora', async () => {
    await usarPlano('trial'); // 5
    await encher(5);
    expect((await CRIACOES.servicos!()).status).toBe(402);

    const [um] = await api.db.select().from(schema.services).where(eq(schema.services.tenantId, conta.tenantId)).limit(1);
    const excluir = await conta.client.delete(`${base()}/services/${um!.id}`);
    expect(excluir.status).toBe(204);

    expect((await uso()).used).toBe(4);
    expect((await CRIACOES.servicos!()).status).toBe(201);
  });

  it('modulo desabilitado no site nao conta; ao habilitar de novo, volta a contar', async () => {
    await usarPlano('profissional');
    await inserir('produtos', 3);
    await inserir('servicos', 2);
    expect((await uso()).used).toBe(5);

    await api.db
      .update(schema.siteModules)
      .set({ enabled: false })
      .where(and(eq(schema.siteModules.siteId, conta.siteId), eq(schema.siteModules.moduleKey, 'produtos')));
    const sem = await uso();
    expect(sem.used).toBe(2);
    expect(sem.byModule.produtos).toBeUndefined();

    await api.db
      .update(schema.siteModules)
      .set({ enabled: true })
      .where(and(eq(schema.siteModules.siteId, conta.siteId), eq(schema.siteModules.moduleKey, 'produtos')));
    expect((await uso()).used).toBe(5);
  });

  it('documentos (institucional e contato) nao contam: sao uma pagina, nao uma lista', async () => {
    await usarPlano('profissional');
    const antes = (await uso()).used;
    const salvar = await conta.client.put(`${base()}/modules/institucional/document`, {
      companyName: 'Empresa Qualquer',
    });
    expect([200, 201, 204, 422]).toContain(salvar.status);
    expect((await uso()).used).toBe(antes);
  });

  it('registros de modulo personalizado de colecao contam; de documento, nao; desabilitado, nao', async () => {
    await usarPlano('profissional');
    const [colecao] = await api.db
      .insert(schema.siteCustomModules)
      .values({ tenantId: conta.tenantId, siteId: conta.siteId, key: 'portfolio', name: 'Portfolio', kind: 'collection' })
      .returning();
    const [documento] = await api.db
      .insert(schema.siteCustomModules)
      .values({ tenantId: conta.tenantId, siteId: conta.siteId, key: 'sobre', name: 'Sobre', kind: 'document' })
      .returning();
    await api.db.insert(schema.customRecords).values([
      { tenantId: conta.tenantId, siteId: conta.siteId, moduleKey: 'portfolio', title: 'Trabalho 1', slug: 't1' },
      { tenantId: conta.tenantId, siteId: conta.siteId, moduleKey: 'portfolio', title: 'Trabalho 2', slug: 't2' },
      { tenantId: conta.tenantId, siteId: conta.siteId, moduleKey: 'sobre', title: 'Sobre nos', slug: '' },
    ]);

    const com = await uso();
    expect(com.used).toBe(2);
    expect(com.byModule['custom:portfolio']).toBe(2);
    expect(com.byModule['custom:sobre']).toBeUndefined();

    await api.db.update(schema.siteCustomModules).set({ enabled: false }).where(eq(schema.siteCustomModules.id, colecao!.id));
    expect((await uso()).used).toBe(0);
    void documento;
  });

  it('o limite vale tambem para a criacao em modulo personalizado', async () => {
    await usarPlano('trial'); // 5
    await api.db
      .insert(schema.siteCustomModules)
      .values({ tenantId: conta.tenantId, siteId: conta.siteId, key: 'cardapio', name: 'Cardapio', kind: 'collection' });
    await encher(5);

    const bloqueada = await conta.client.post(`${base()}/custom/cardapio`, { title: 'Prato do dia' });
    expect(bloqueada.status).toBe(402);
    expect(bloqueada.errorCode).toBe('plan_limit_reached');

    await api.db.delete(schema.faqs).where(eq(schema.faqs.tenantId, conta.tenantId));
    const [restante] = await api.db.select().from(schema.services).where(eq(schema.services.tenantId, conta.tenantId)).limit(1);
    if (restante) await api.db.delete(schema.services).where(eq(schema.services.id, restante.id));
    const cabe = await conta.client.post(`${base()}/custom/cardapio`, { title: 'Prato do dia' });
    expect(cabe.status, JSON.stringify(cabe)).toBe(201);
  });

  it('o que e filho de um registro, ou arquivo da biblioteca, nao conta', async () => {
    await usarPlano('profissional');
    await api.db.insert(schema.mediaAssets).values({
      tenantId: conta.tenantId,
      siteId: conta.siteId,
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      blobUrl: 'https://blob.test/a',
      blobPathname: 'tenants/x/a',
    } as never);
    expect((await uso()).used).toBe(0);
  });

  it('o uso de uma empresa nao entra na conta de outra', async () => {
    await usarPlano('profissional');
    await inserir('produtos', 4);

    const outra = await registerAccount(api, { email: 'outra@limites.test', companyName: 'Outra Empresa' });
    await verifyEmail(api, outra);
    const dela = await outra.client.get(`/api/tenants/${outra.tenantId}/content-usage`);
    expect(dela.status).toBe(200);
    expect(dela.body.used).toBe(0);
    expect((await uso()).used).toBe(4);
  });
});

describe('so a criacao consome vaga', () => {
  it('publicar, arquivar e restaurar funcionam com o plano cheio', async () => {
    await usarPlano('trial'); // 5
    await inserir('produtos', 5, { publicationStatus: 'draft' });
    const [produto] = await api.db.select().from(schema.products).where(eq(schema.products.tenantId, conta.tenantId)).limit(1);

    for (const status of ['published', 'archived', 'draft']) {
      const resposta = await conta.client.patch(`${base()}/products/${produto!.id}`, { publicationStatus: status });
      expect(resposta.status, `${status}: ${JSON.stringify(resposta.body)}`).toBe(200);
    }
    expect((await uso()).used).toBe(5);
  });
});

describe('quem esta acima do limite: nada se perde, so nao cadastra', () => {
  it('empresa com mais conteudo do que o plano permite continua editando e excluindo', async () => {
    await usarPlano('trial'); // 5
    await encher(8); // legado: 8 > 5
    expect((await uso()).used).toBe(8);

    expect((await CRIACOES.faq!()).status).toBe(402);

    const [servico] = await api.db.select().from(schema.services).where(eq(schema.services.tenantId, conta.tenantId)).limit(1);
    const editar = await conta.client.patch(`${base()}/services/${servico!.id}`, { title: 'Titulo novo' });
    expect(editar.status).toBe(200);
    expect((await conta.client.get(`${base()}/services`)).status).toBe(200);

    // Excluir ate voltar abaixo do limite reabre o cadastro.
    await api.db.delete(schema.faqs).where(eq(schema.faqs.tenantId, conta.tenantId));
    await api.db.delete(schema.products).where(eq(schema.products.tenantId, conta.tenantId));
    expect((await uso()).used).toBe(4);
    expect((await CRIACOES.faq!()).status).toBe(201);
    expect((await CRIACOES.faq!()).status).toBe(402);
  });

  it('o ajuste individual do limite vale: a empresa passa a poder cadastrar', async () => {
    await usarPlano('trial', { maxContentRecords: 8 }); // plano 5, ajuste 8
    await encher(6);
    const resposta = await uso();
    expect(resposta.max).toBe(8);
    expect(resposta.overridden).toBe(true);
    expect((await CRIACOES.servicos!()).status).toBe(201);
  });
});

describe('o limite e configuravel no painel mestre', () => {
  /** A empresa de teste passa a ser administradora da plataforma. */
  async function comoSuperadmin() {
    await api.db
      .update(schema.users)
      .set({ platformRole: 'platform_admin' })
      .where(eq(schema.users.id, conta.userId));
  }

  it('o superadmin muda o limite de um plano e a empresa passa a ser medida por ele', async () => {
    await comoSuperadmin();
    const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'trial'));
    await usarPlano('trial');

    const mudar = await conta.client.patch(`/api/platform/plans/${plano!.id}`, {
      limits: { ...DEFAULT_PLANS[0]!.limits, maxContentRecords: 7 },
    });
    expect(mudar.status, JSON.stringify(mudar.body)).toBe(200);
    expect(mudar.body.plan.limits.maxContentRecords).toBe(7);

    await encher(6);
    expect((await uso()).max).toBe(7);
    expect((await CRIACOES.servicos!()).status).toBe(201);
    expect((await CRIACOES.servicos!()).status).toBe(402);
  });

  it('a vitrine publica acompanha a mudanca (mesma fonte)', async () => {
    await comoSuperadmin();
    const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'profissional'));
    await conta.client.patch(`/api/platform/plans/${plano!.id}`, {
      limits: { ...DEFAULT_PLANS[2]!.limits, maxContentRecords: 123 },
    });
    const publica = await api.client().get('/api/public/plans');
    const p = publica.body.plans.find((x: { code: string }) => x.code === 'profissional');
    expect(p.limits.maxContentRecords).toBe(123);
  });

  it('recusa limite invalido: negativo, ausente ou que nao e inteiro', async () => {
    await comoSuperadmin();
    const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'trial'));
    const { maxContentRecords: _removido, ...semLimite } = DEFAULT_PLANS[0]!.limits;
    void _removido;

    for (const limits of [
      { ...DEFAULT_PLANS[0]!.limits, maxContentRecords: -1 },
      { ...DEFAULT_PLANS[0]!.limits, maxContentRecords: 1.5 },
      semLimite,
    ]) {
      const resposta = await conta.client.patch(`/api/platform/plans/${plano!.id}`, { limits });
      expect(resposta.status).toBe(422);
    }
  });

  it('as chaves antigas (imoveis e obras) sao aceitas e ignoradas: nada le o que elas dizem', async () => {
    await comoSuperadmin();
    const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'trial'));
    const resposta = await conta.client.patch(`/api/platform/plans/${plano!.id}`, {
      limits: { ...DEFAULT_PLANS[0]!.limits, maxPublishedProperties: 999, maxProjects: 999 },
    });
    expect(resposta.status, JSON.stringify(resposta.body)).toBe(200);
    expect(resposta.body.plan.limits).not.toHaveProperty('maxPublishedProperties');
    expect(resposta.body.plan.limits).not.toHaveProperty('maxProjects');
    expect(resposta.body.plan.limits.maxContentRecords).toBe(DEFAULT_PLANS[0]!.limits.maxContentRecords);
  });

  it('o superadmin ajusta o limite de uma empresa so, sem criar plano', async () => {
    await comoSuperadmin();
    await usarPlano('trial');
    await encher(5);
    expect((await CRIACOES.faq!()).status).toBe(402);

    const ajuste = await conta.client.patch(`/api/platform/tenants/${conta.tenantId}`, {
      limitOverrides: { maxContentRecords: 9 },
    });
    expect(ajuste.status, JSON.stringify(ajuste.body)).toBe(200);

    const depois = await uso();
    expect(depois.max).toBe(9);
    expect(depois.overridden).toBe(true);
    expect((await CRIACOES.faq!()).status).toBe(201);
  });
});

describe('cobertura: nenhum modulo escapa do limite', () => {
  it('todo modulo de colecao do registro tem tabela de contagem, e vice-versa', () => {
    expect(Object.keys(TABELAS_DE_CONTEUDO).sort()).toEqual([...CONTENT_LIMIT_MODULE_KEYS].sort());
  });

  it('a tabela de cada modulo e a que o registro declara', () => {
    for (const chave of CONTENT_LIMIT_MODULE_KEYS) {
      const declarada = MODULE_REGISTRY[chave].table;
      expect(getTableName(TABELAS_DE_CONTEUDO[chave]!), chave).toBe(declarada);
    }
  });

  it('todo modulo de colecao tem uma criacao exercitada neste arquivo', () => {
    expect(Object.keys(CRIACOES).sort()).toEqual([...CONTENT_LIMIT_MODULE_KEYS].sort());
  });

  it('documentos nao estao na lista', () => {
    expect(CONTENT_LIMIT_MODULE_KEYS).not.toContain('institucional');
    expect(CONTENT_LIMIT_MODULE_KEYS).not.toContain('contato');
  });
});
