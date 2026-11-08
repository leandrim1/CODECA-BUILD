import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, schema } from '@codeca/database';
import { createMemorySiteFetcher } from '@codeca/api';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Sincronizacao com o site de origem, de ponta a ponta.
 *
 * O risco desta funcionalidade nao e travar: e **sobrescrever o trabalho do
 * cliente**. Por isso boa parte destes testes verifica que nada foi alterado,
 * que a alteracao ficou pendente, ou que o conflito foi apontado em vez de
 * resolvido sozinho.
 *
 * A busca das paginas e substituida (`createMemorySiteFetcher`) porque a de
 * verdade recusa `localhost` de proposito -- e a barreira contra SSRF, que tem
 * testes proprios. O resto (API, banco, schemas, gravacao, agendador) e real.
 */

/** Monta o site de origem, com os trechos que cada cenario quer variar. */
function siteOrigem(
  opcoes: {
    telefone?: string;
    email?: string;
    endereco?: string;
    descricao?: string;
    servicos?: { titulo: string; texto: string }[];
    imagemHero?: string;
    etagHome?: string;
    semPaginaServicos?: boolean;
  } = {},
) {
  const telefone = opcoes.telefone ?? '(34) 99999-1111';
  const email = opcoes.email ?? 'contato@siteantigo.com.br';
  const endereco = opcoes.endereco ?? 'Rua das Flores, 123';
  const descricao = opcoes.descricao ?? 'Clínica odontológica com atendimento humanizado.';
  const servicos = opcoes.servicos ?? [
    {
      titulo: 'Clareamento dental',
      texto: 'Procedimento feito em consultório, com acompanhamento do dentista do começo ao fim.',
    },
    {
      titulo: 'Implante dentário',
      texto: 'Reposição de dentes perdidos com pino de titânio, planejada por tomografia antes.',
    },
  ];
  const hero = opcoes.imagemHero ?? '/img/hero.jpg';

  const home = `<!doctype html><html lang="pt-BR"><head>
    <title>Clínica Sorriso</title>
    <meta name="description" content="${descricao}">
    <meta property="og:site_name" content="Clínica Sorriso">
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Dentist","name":"Clínica Sorriso",
     "telephone":"${telefone}","email":"${email}",
     "address":{"@type":"PostalAddress","streetAddress":"${endereco}","addressLocality":"Uberlândia","addressRegion":"MG","postalCode":"38400-100"}}
    </script></head><body>
    <header><img src="/img/logo.png" alt="Logo Clínica Sorriso"></header>
    <nav><a href="/servicos">Serviços</a></nav>
    <main><h1>Seu sorriso em boas mãos</h1>
      <img src="${hero}" alt="Recepção da clínica" width="1600" height="900"></main>
    <footer><p>${endereco} - Centro, Uberlândia - MG</p><p>${telefone} | ${email}</p></footer>
  </body></html>`;

  const paginaServicos = `<html><head><title>Serviços</title></head><body><main>
    <h1>Nossos serviços</h1>
    ${servicos.map((s) => `<h2>${s.titulo}</h2><p>${s.texto}</p>`).join('\n')}
  </main></body></html>`;

  const paginas: Record<string, { body?: string; status?: number; contentType?: string; bytes?: Uint8Array; etag?: string }> = {
    'https://siteantigo.com.br/': {
      body: home,
      ...(opcoes.etagHome ? { etag: opcoes.etagHome } : {}),
    },
    'https://siteantigo.com.br/img/logo.png': { contentType: 'image/png', bytes: IMAGEM },
    [`https://siteantigo.com.br${hero}`]: { contentType: 'image/png', bytes: IMAGEM },
  };

  if (opcoes.semPaginaServicos !== true) {
    paginas['https://siteantigo.com.br/servicos'] = { body: paginaServicos };
  }

  return paginas;
}

/** PNG 2x2 com peso suficiente para passar pelo mínimo da importação. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNk+M/AwMDAxMDAwAAABicBAp9rjKkAAAAASUVORK5CYII=',
  'base64',
);
const IMAGEM = new Uint8Array(Buffer.concat([PNG, Buffer.alloc(2048, 7)]));
/** Segunda imagem, de conteúdo diferente: troca de foto sem trocar o endereço. */
const IMAGEM_NOVA = new Uint8Array(Buffer.concat([PNG, Buffer.alloc(2048, 31)]));

let api: TestApi;
let empresa: RegisteredAccount;

/** Trocar as páginas entre uma verificação e outra é o que simula o cliente editando o site antigo. */
let paginasAtuais: ReturnType<typeof siteOrigem> = siteOrigem();

beforeAll(async () => {
  api = await createTestApi({
    siteFetcher: {
      fetch: async (url, options) => createMemorySiteFetcher(paginasAtuais).fetch(url, options),
    },
  });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  paginasAtuais = siteOrigem();
  empresa = await registerAccount(api, {
    email: 'contato@siteantigo.com.br',
    companyName: 'Clínica Sorriso',
  });
  await verifyEmail(api, empresa);
  await habilitarModulos(empresa);
  await usarPlanoComEspaco(empresa);
});

async function siteDe(account: RegisteredAccount): Promise<string> {
  const [site] = await api.db
    .select({ id: schema.sites.id })
    .from(schema.sites)
    .where(eq(schema.sites.tenantId, account.tenantId));
  if (!site) throw new Error('A empresa de teste nao tem site.');
  return site.id;
}

async function habilitarModulos(account: RegisteredAccount): Promise<void> {
  const site = await siteDe(account);
  const { MODULE_KEYS } = await import('@codeca/shared');
  for (const key of MODULE_KEYS) {
    await api.db
      .insert(schema.siteModules)
      .values({ tenantId: account.tenantId, siteId: site, moduleKey: key, enabled: true, settings: {} })
      .onConflictDoUpdate({
        target: [schema.siteModules.siteId, schema.siteModules.moduleKey],
        set: { enabled: true },
      });
  }
}

async function usarPlanoComEspaco(account: RegisteredAccount): Promise<void> {
  const [plano] = await api.db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.code, 'profissional'));
  await api.db
    .update(schema.tenants)
    .set({ planId: plano!.id, status: 'active' })
    .where(eq(schema.tenants.id, account.tenantId));
}

const base = (conta: RegisteredAccount) => `/api/tenants/${conta.tenantId}`;

/** Importa o site antigo, conecta a fonte e faz a primeira verificação. */
async function importarEConectar(conta: RegisteredAccount): Promise<void> {
  const abertura = await conta.client.post(`${base(conta)}/site-import`, {
    url: 'https://siteantigo.com.br/',
  });
  expect(abertura.status, abertura.errorMessage ?? '').toBe(201);
  const importId = abertura.body.run.id as string;

  for (let i = 0; i < 20; i += 1) {
    const estado = await conta.client.get(`${base(conta)}/site-import/${importId}`);
    if (!estado.body.run.working) break;
  }

  const confirmacao = await conta.client.post(`${base(conta)}/site-import/${importId}/confirmar`, {
    confirm: true,
    targets: [],
  });
  expect(confirmacao.status, confirmacao.errorMessage ?? '').toBe(200);

  const conexao = await conta.client.post(`${base(conta)}/sync`, {
    url: 'https://siteantigo.com.br/',
    frequency: 'semanal',
  });
  expect(conexao.status, conexao.errorMessage ?? '').toBe(201);

  // Primeira verificação: grava o baseline sem propor nada que já foi importado.
  const primeira = await conta.client.post(`${base(conta)}/sync/verificar`, {});
  expect(primeira.status, primeira.errorMessage ?? '').toBe(200);
}

async function verificar(conta: RegisteredAccount) {
  const r = await conta.client.post(`${base(conta)}/sync/verificar`, {});
  expect(r.status, r.errorMessage ?? '').toBe(200);
  return r.body;
}

async function estado(conta: RegisteredAccount) {
  const r = await conta.client.get(`${base(conta)}/sync`);
  expect(r.status, r.errorMessage ?? '').toBe(200);
  return r.body;
}

/** Alterações pendentes, por campo. */
function pendentes(corpo: any) {
  return (corpo.changes as any[]).filter((c) => c.decision === 'pendente');
}

function acharCampo(corpo: any, target: string, fieldKey: string) {
  return (corpo.changes as any[]).find((c) => c.target === target && c.fieldKey === fieldKey);
}

// ---------------------------------------------------------------- testes

describe('conectar a fonte', () => {
  it('recusa endereço de rede interna, sem gravar nada', async () => {
    for (const url of ['http://localhost/', 'http://10.0.0.5/', 'http://169.254.169.254/']) {
      const r = await empresa.client.post(`${base(empresa)}/sync`, { url, frequency: 'semanal' });
      expect(r.status, url).toBe(422);
    }
    const fontes = await api.db.select().from(schema.syncSources);
    expect(fontes).toHaveLength(0);
  });

  it('recusa quem só tem permissão de leitura', async () => {
    await api.db
      .update(schema.memberships)
      .set({ role: 'viewer' })
      .where(eq(schema.memberships.userId, empresa.userId));

    const r = await empresa.client.post(`${base(empresa)}/sync`, {
      url: 'https://siteantigo.com.br/',
      frequency: 'semanal',
    });
    expect(r.status).toBe(403);
  });

  it('não conecta duas fontes ao mesmo site', async () => {
    const primeira = await empresa.client.post(`${base(empresa)}/sync`, {
      url: 'https://siteantigo.com.br/',
      frequency: 'semanal',
    });
    expect(primeira.status).toBe(201);

    const segunda = await empresa.client.post(`${base(empresa)}/sync`, {
      url: 'https://outrosite.com.br/',
      frequency: 'semanal',
    });
    expect(segunda.status).toBe(409);
  });

  it('a fonte nasce ativa e vencida, para a primeira verificação não esperar o intervalo', async () => {
    const r = await empresa.client.post(`${base(empresa)}/sync`, {
      url: 'https://siteantigo.com.br/',
      frequency: 'semanal',
    });
    expect(r.body.source.state).toBe('ativa');
    expect(r.body.source.frequency).toBe('semanal');

    const [fonte] = await api.db.select().from(schema.syncSources);
    expect(fonte?.nextCheckAt).not.toBeNull();
    expect(fonte!.nextCheckAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('cenário 1: site de origem sem alterações', () => {
  it('não propõe nada quando nada mudou', async () => {
    await importarEConectar(empresa);

    const resultado = await verificar(empresa);
    expect(resultado.changesFound).toBe(0);
    expect(resultado.message).toContain('Nenhuma alteração');

    const corpo = await estado(empresa);
    expect(pendentes(corpo)).toHaveLength(0);
    expect(corpo.source.changesPending).toBe(0);
  });

  it('usa requisição condicional e pula a página que respondeu 304', async () => {
    paginasAtuais = siteOrigem({ etagHome: '"v1"' });
    await importarEConectar(empresa);

    const resultado = await verificar(empresa);
    expect(resultado.changesFound).toBe(0);

    const corpo = await estado(empresa);
    const inicial = (corpo.source.pages as any[]).find(
      (p) => p.url === 'https://siteantigo.com.br/',
    );
    // 304: a origem garantiu que nada mudou, e a página nem foi lida.
    expect(inicial?.unchanged).toBe(true);
  });
});

describe('cenário 2 e 3: telefone e endereço mudaram na origem', () => {
  it('encontra a alteração e a deixa PENDENTE, sem tocar no painel', async () => {
    await importarEConectar(empresa);

    paginasAtuais = siteOrigem({
      telefone: '(34) 98888-2222',
      endereco: 'Avenida Nova, 500',
    });

    const resultado = await verificar(empresa);
    expect(resultado.changesFound).toBeGreaterThan(0);

    const corpo = await estado(empresa);
    const telefone = acharCampo(corpo, 'contato', 'phone');
    expect(telefone).toBeDefined();
    expect(telefone.type).toBe('modificado');
    expect(telefone.decision).toBe('pendente');
    expect(telefone.sourcePreview).toBe('(34) 98888-2222');
    /**
     * O lado da CODECA e o telefone do **cadastro**, nao o do site antigo: a
     * importacao recusou sobrescrever um campo ja preenchido. Os dois lados
     * nascem diferentes sem ninguem ter editado nada -- e por isso `conflict`
     * e falso: quem mudou foi so a origem.
     */
    expect(telefone.codecaPreview).toBe('(19) 99999-0000');
    expect(telefone.conflict).toBe(false);

    const endereco = acharCampo(corpo, 'contato', 'addressLine');
    expect(endereco?.sourcePreview).toBe('Avenida Nova, 500');

    // Nada foi gravado: o painel continua com o valor antigo.
    const [documento] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.tenantId, empresa.tenantId),
          eq(schema.contentDocuments.moduleKey, 'contato'),
        ),
      );
    // Continua o telefone do cadastro: a sincronização não gravou nada.
    expect((documento?.data as Record<string, unknown>)['phone']).toBe('(19) 99999-0000');
  });

  it('aplica somente o que foi aprovado', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({ telefone: '(34) 98888-2222', endereco: 'Avenida Nova, 500' });
    await verificar(empresa);

    const corpo = await estado(empresa);
    const telefone = acharCampo(corpo, 'contato', 'phone');
    const endereco = acharCampo(corpo, 'contato', 'addressLine');

    // Aprova só o telefone; o endereço fica pendente.
    const decisao = await empresa.client.patch(`${base(empresa)}/sync/decisoes`, {
      items: [{ changeId: telefone.id, decision: 'aprovada' }],
    });
    expect(decisao.status, decisao.errorMessage ?? '').toBe(200);
    expect(decisao.body.applied).toBe(1);

    const aplicar = await empresa.client.post(`${base(empresa)}/sync/aplicar`, {
      confirm: true,
      targets: [],
    });
    expect(aplicar.status, aplicar.errorMessage ?? '').toBe(200);
    expect(aplicar.body.result.applied).toBe(1);

    const [documento] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.tenantId, empresa.tenantId),
          eq(schema.contentDocuments.moduleKey, 'contato'),
        ),
      );
    const dados = documento?.data as Record<string, unknown>;
    expect(dados['phone']).toBe('(34) 98888-2222');
    // O endereço NÃO foi aprovado: continua o antigo.
    expect(dados['addressLine']).toBe('Rua das Flores, 123');
    expect(endereco.id).toBeTruthy();
  });

  it('a mesma alteração não volta na verificação seguinte depois de aplicada', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({ telefone: '(34) 98888-2222' });
    await verificar(empresa);

    const corpo = await estado(empresa);
    const telefone = acharCampo(corpo, 'contato', 'phone');
    await empresa.client.patch(`${base(empresa)}/sync/decisoes`, {
      items: [{ changeId: telefone.id, decision: 'aprovada' }],
    });
    await empresa.client.post(`${base(empresa)}/sync/aplicar`, { confirm: true, targets: [] });

    // A origem continua com o telefone novo; o baseline avançou junto.
    const segunda = await verificar(empresa);
    expect(segunda.changesFound).toBe(0);
  });

  it('a alteração pendente não é duplicada quando a verificação roda de novo', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({ telefone: '(34) 98888-2222' });

    await verificar(empresa);
    await verificar(empresa);

    const corpo = await estado(empresa);
    const telefones = (corpo.changes as any[]).filter(
      (c) => c.target === 'contato' && c.fieldKey === 'phone',
    );
    expect(telefones).toHaveLength(1);
  });
});

describe('cenário 4 e 5: textos e serviços', () => {
  it('encontra texto institucional modificado', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({ descricao: 'Agora somos uma clínica com três unidades na cidade.' });

    await verificar(empresa);
    const corpo = await estado(empresa);
    const descricao = acharCampo(corpo, 'institucional', 'shortDescription');
    expect(descricao?.type).toBe('modificado');
    expect(descricao?.sourcePreview).toContain('três unidades');
  });

  it('encontra serviço novo na origem', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({
      servicos: [
        { titulo: 'Clareamento dental', texto: 'Procedimento feito em consultório, com acompanhamento do dentista do começo ao fim.' },
        { titulo: 'Implante dentário', texto: 'Reposição de dentes perdidos com pino de titânio, planejada por tomografia antes.' },
        { titulo: 'Ortodontia', texto: 'Aparelhos fixos e alinhadores transparentes, com acompanhamento mensal do caso.' },
      ],
    });

    await verificar(empresa);
    const corpo = await estado(empresa);
    const novo = (corpo.changes as any[]).find((c) => c.label === 'Ortodontia');
    expect(novo).toBeDefined();
    expect(novo.type).toBe('novo');
    expect(novo.target).toBe('servicos');

    await empresa.client.patch(`${base(empresa)}/sync/decisoes`, {
      items: [{ changeId: novo.id, decision: 'aprovada' }],
    });
    await empresa.client.post(`${base(empresa)}/sync/aplicar`, { confirm: true, targets: [] });

    const servicos = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    expect(servicos.map((s) => s.title)).toContain('Ortodontia');
    // Entra como rascunho, como todo conteúdo que a plataforma traz de fora.
    expect(servicos.find((s) => s.title === 'Ortodontia')?.publicationStatus).toBe('draft');
  });

  it('encontra serviço com o texto alterado e atualiza só os campos da origem', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({
      servicos: [
        { titulo: 'Clareamento dental', texto: 'Agora com sessão única e acompanhamento por aplicativo durante o tratamento.' },
        { titulo: 'Implante dentário', texto: 'Reposição de dentes perdidos com pino de titânio, planejada por tomografia antes.' },
      ],
    });

    await verificar(empresa);
    const corpo = await estado(empresa);
    const alterado = (corpo.changes as any[]).find((c) => c.label === 'Clareamento dental');
    expect(alterado?.type).toBe('modificado');

    await empresa.client.patch(`${base(empresa)}/sync/decisoes`, {
      items: [{ changeId: alterado.id, decision: 'aprovada' }],
    });
    await empresa.client.post(`${base(empresa)}/sync/aplicar`, { confirm: true, targets: [] });

    const [servico] = await api.db
      .select()
      .from(schema.services)
      .where(
        and(eq(schema.services.tenantId, empresa.tenantId), eq(schema.services.title, 'Clareamento dental')),
      );
    expect(servico?.description).toContain('sessão única');
    // Nenhum registro novo foi criado: o existente foi atualizado.
    const todos = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    expect(todos).toHaveLength(2);
  });
});

describe('cenário 6 e 9: conteúdo e página que saem do ar', () => {
  it('serviço removido da origem vira alteração, e nunca exclusão automática', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({
      servicos: [
        { titulo: 'Clareamento dental', texto: 'Procedimento feito em consultório, com acompanhamento do dentista do começo ao fim.' },
      ],
    });

    await verificar(empresa);
    const corpo = await estado(empresa);
    const removido = (corpo.changes as any[]).find((c) => c.label === 'Implante dentário');
    expect(removido).toBeDefined();
    expect(removido.type).toBe('removido');
    expect(removido.decision).toBe('pendente');

    // Mesmo aplicando tudo sem escolher ação, o conteúdo continua lá.
    await empresa.client.patch(`${base(empresa)}/sync/decisoes`, {
      items: [{ changeId: removido.id, decision: 'aprovada' }],
    });
    await empresa.client.post(`${base(empresa)}/sync/aplicar`, { confirm: true, targets: [] });

    const servicos = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    expect(servicos.map((s) => s.title)).toContain('Implante dentário');
  });

  it('arquivar tira do site sem apagar o registro', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({
      servicos: [
        { titulo: 'Clareamento dental', texto: 'Procedimento feito em consultório, com acompanhamento do dentista do começo ao fim.' },
      ],
    });
    await verificar(empresa);

    const corpo = await estado(empresa);
    const removido = (corpo.changes as any[]).find((c) => c.label === 'Implante dentário');

    await empresa.client.patch(`${base(empresa)}/sync/decisoes`, {
      items: [{ changeId: removido.id, decision: 'aprovada', removalAction: 'arquivar' }],
    });
    const aplicar = await empresa.client.post(`${base(empresa)}/sync/aplicar`, {
      confirm: true,
      targets: [],
    });
    expect(aplicar.body.result.archived).toBe(1);

    const [servico] = await api.db
      .select()
      .from(schema.services)
      .where(
        and(eq(schema.services.tenantId, empresa.tenantId), eq(schema.services.title, 'Implante dentário')),
      );
    expect(servico).toBeDefined();
    expect(servico?.publicationStatus).toBe('archived');
  });

  it('excluir só acontece quando o pedido disse excluir', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({
      servicos: [
        { titulo: 'Clareamento dental', texto: 'Procedimento feito em consultório, com acompanhamento do dentista do começo ao fim.' },
      ],
    });
    await verificar(empresa);

    const corpo = await estado(empresa);
    const removido = (corpo.changes as any[]).find((c) => c.label === 'Implante dentário');

    await empresa.client.patch(`${base(empresa)}/sync/decisoes`, {
      items: [{ changeId: removido.id, decision: 'aprovada', removalAction: 'excluir' }],
    });
    const aplicar = await empresa.client.post(`${base(empresa)}/sync/aplicar`, {
      confirm: true,
      targets: [],
    });
    expect(aplicar.body.result.deleted).toBe(1);

    const servicos = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    expect(servicos.map((s) => s.title)).not.toContain('Implante dentário');
  });

  /**
   * O cuidado que impede o pior resultado possivel: uma pagina fora do ar por
   * dez minutos nao pode fazer a plataforma propor apagar tudo que vinha dela.
   */
  it('página que falhou não faz o conteúdo dela parecer removido', async () => {
    await importarEConectar(empresa);

    const comFalha = siteOrigem();
    comFalha['https://siteantigo.com.br/servicos'] = { status: 503 };
    paginasAtuais = comFalha;

    const resultado = await verificar(empresa);
    const corpo = await estado(empresa);
    const remocoes = (corpo.changes as any[]).filter((c) => c.type === 'removido');

    expect(remocoes).toHaveLength(0);
    expect(resultado.changesFound).toBe(0);
  });
});

describe('imagens estáveis', () => {
  /**
   * O texto alternativo ficou fora da comparacao de imagem: do lado da CODECA
   * ele e editavel pelo cliente, e inclui-lo fazia os dois lados nunca
   * baterem -- toda imagem apareceria como alterada em toda verificacao, para
   * sempre.
   */
  it('imagem que não mudou não reaparece a cada verificação', async () => {
    await importarEConectar(empresa);

    await verificar(empresa);
    await verificar(empresa);

    const corpo = await estado(empresa);
    const imagens = (corpo.changes as any[]).filter((c) => c.target === 'midia');
    expect(imagens).toHaveLength(0);
  });
});

describe('cenário 7: imagem trocada na origem', () => {
  it('troca de arquivo no mesmo endereço é detectada pelo conteúdo', async () => {
    await importarEConectar(empresa);

    const comImagemNova = siteOrigem();
    comImagemNova['https://siteantigo.com.br/img/hero.jpg'] = {
      contentType: 'image/png',
      bytes: IMAGEM_NOVA,
    };
    // O texto da home muda junto, senão o ETag/hash não acusaria a diferença:
    // a imagem é um recurso separado, lido só quando a página é relida.
    comImagemNova['https://siteantigo.com.br/'] = {
      body: (comImagemNova['https://siteantigo.com.br/']!.body ?? '').replace(
        'Recepção da clínica',
        'Nova recepção da clínica',
      ),
    };
    paginasAtuais = comImagemNova;

    await verificar(empresa);
    const corpo = await estado(empresa);
    const imagem = (corpo.changes as any[]).find(
      (c) => c.target === 'midia' && String(c.sourceImageUrl ?? '').includes('hero'),
    );
    expect(imagem).toBeDefined();
    expect(['imagem_modificada', 'imagem_nova']).toContain(imagem.type);
    expect(imagem.sourceImageUrl).toContain('hero.jpg');
  });
});

describe('cenário 10 e 11: edição feita na CODECA Build', () => {
  /** Edita a descrição institucional direto no painel, como o cliente faria. */
  async function editarNoPainel(texto: string): Promise<void> {
    const site = await siteDe(empresa);
    const [documento] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.siteId, site),
          eq(schema.contentDocuments.moduleKey, 'institucional'),
        ),
      );
    const dados = { ...((documento?.data ?? {}) as Record<string, unknown>), shortDescription: texto };
    await api.db
      .update(schema.contentDocuments)
      .set({ data: dados })
      .where(eq(schema.contentDocuments.id, documento!.id));
  }

  /**
   * O caso do item 7 do pedido, na metade: o cliente editou e a origem NAO
   * mudou. Propor "volte para o texto do site antigo" desfaria o trabalho
   * dele.
   */
  it('edição no painel sozinha não vira alteração pendente', async () => {
    await importarEConectar(empresa);
    await editarNoPainel('Texto que eu reescrevi no painel da CODECA.');

    const resultado = await verificar(empresa);
    const corpo = await estado(empresa);
    const descricao = acharCampo(corpo, 'institucional', 'shortDescription');

    expect(descricao).toBeUndefined();
    expect(resultado.changesFound).toBe(0);

    // E o texto do cliente continua no lugar.
    const site = await siteDe(empresa);
    const [documento] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.siteId, site),
          eq(schema.contentDocuments.moduleKey, 'institucional'),
        ),
      );
    expect((documento?.data as Record<string, unknown>)['shortDescription']).toBe(
      'Texto que eu reescrevi no painel da CODECA.',
    );
  });

  /** O caso completo: os dois lados mudaram. */
  it('os dois lados mudaram: vira conflito com as três versões', async () => {
    await importarEConectar(empresa);
    await editarNoPainel('Texto que eu reescrevi no painel da CODECA.');
    paginasAtuais = siteOrigem({ descricao: 'Texto novo que foi publicado no site antigo.' });

    const resultado = await verificar(empresa);
    expect(resultado.conflicts).toBeGreaterThan(0);

    const corpo = await estado(empresa);
    const descricao = acharCampo(corpo, 'institucional', 'shortDescription');
    expect(descricao).toBeDefined();
    expect(descricao.conflict).toBe(true);
    expect(descricao.decision).toBe('pendente');

    // As três pontas, que é o que a tela mostra.
    expect(descricao.baselinePreview).toContain('atendimento humanizado');
    expect(descricao.sourcePreview).toContain('publicado no site antigo');
    expect(descricao.codecaPreview).toContain('reescrevi no painel');
  });

  it('manter a versão da CODECA preserva a edição do cliente', async () => {
    await importarEConectar(empresa);
    await editarNoPainel('Texto que eu reescrevi no painel da CODECA.');
    paginasAtuais = siteOrigem({ descricao: 'Texto novo que foi publicado no site antigo.' });
    await verificar(empresa);

    const corpo = await estado(empresa);
    const descricao = acharCampo(corpo, 'institucional', 'shortDescription');

    await empresa.client.patch(`${base(empresa)}/sync/decisoes`, {
      items: [{ changeId: descricao.id, decision: 'manter_atual', conflictChoice: 'manter_codeca' }],
    });
    await empresa.client.post(`${base(empresa)}/sync/aplicar`, { confirm: true, targets: [] });

    const site = await siteDe(empresa);
    const [documento] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.siteId, site),
          eq(schema.contentDocuments.moduleKey, 'institucional'),
        ),
      );
    expect((documento?.data as Record<string, unknown>)['shortDescription']).toBe(
      'Texto que eu reescrevi no painel da CODECA.',
    );
  });

  /**
   * A trava do servidor: aprovar um conflito sem escolher "usar a versao da
   * origem" nao grava nada. A interface nao e o unico caminho ate a API, e a
   * promessa de nao sobrescrever edicao do cliente precisa valer aqui.
   */
  it('aprovar um conflito sem escolher a origem não sobrescreve', async () => {
    await importarEConectar(empresa);
    await editarNoPainel('Texto que eu reescrevi no painel da CODECA.');
    paginasAtuais = siteOrigem({ descricao: 'Texto novo que foi publicado no site antigo.' });
    await verificar(empresa);

    const corpo = await estado(empresa);
    const descricao = acharCampo(corpo, 'institucional', 'shortDescription');

    // Aprovada, mas com a escolha apontando para manter a versão da CODECA.
    await empresa.client.patch(`${base(empresa)}/sync/decisoes`, {
      items: [{ changeId: descricao.id, decision: 'aprovada', conflictChoice: 'manter_codeca' }],
    });
    const aplicar = await empresa.client.post(`${base(empresa)}/sync/aplicar`, {
      confirm: true,
      targets: [],
    });
    expect(aplicar.body.result.applied).toBe(0);

    const site = await siteDe(empresa);
    const [documento] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.siteId, site),
          eq(schema.contentDocuments.moduleKey, 'institucional'),
        ),
      );
    expect((documento?.data as Record<string, unknown>)['shortDescription']).toBe(
      'Texto que eu reescrevi no painel da CODECA.',
    );
  });

  it('usar a versão da origem substitui, e a alteração pode ser desfeita', async () => {
    await importarEConectar(empresa);
    await editarNoPainel('Texto que eu reescrevi no painel da CODECA.');
    paginasAtuais = siteOrigem({ descricao: 'Texto novo que foi publicado no site antigo.' });
    await verificar(empresa);

    const corpo = await estado(empresa);
    const descricao = acharCampo(corpo, 'institucional', 'shortDescription');

    await empresa.client.patch(`${base(empresa)}/sync/decisoes`, {
      items: [{ changeId: descricao.id, decision: 'aprovada', conflictChoice: 'usar_origem' }],
    });
    await empresa.client.post(`${base(empresa)}/sync/aplicar`, { confirm: true, targets: [] });

    const site = await siteDe(empresa);
    const ler = async () => {
      const [documento] = await api.db
        .select()
        .from(schema.contentDocuments)
        .where(
          and(
            eq(schema.contentDocuments.siteId, site),
            eq(schema.contentDocuments.moduleKey, 'institucional'),
          ),
        );
      return (documento?.data as Record<string, unknown>)['shortDescription'];
    };

    expect(await ler()).toContain('publicado no site antigo');

    // Desfazer devolve o que estava na CODECA no momento da gravação.
    const desfazer = await empresa.client.post(
      `${base(empresa)}/sync/alteracoes/${descricao.id}/desfazer`,
      {},
    );
    expect(desfazer.status, desfazer.errorMessage ?? '').toBe(200);
    expect(await ler()).toBe('Texto que eu reescrevi no painel da CODECA.');
  });
});

describe('cenário 12 e 13: origem indisponível e falha', () => {
  it('site fora do ar não quebra a verificação e adia a próxima', async () => {
    await importarEConectar(empresa);
    paginasAtuais = {
      'https://siteantigo.com.br/': { status: 503 },
      'https://siteantigo.com.br/servicos': { status: 503 },
    };

    const resultado = await verificar(empresa);
    expect(resultado.failed).toBe(true);
    expect(resultado.changesFound).toBe(0);

    const corpo = await estado(empresa);
    expect(corpo.source.state).toBe('erro');
    expect(corpo.source.lastError).toBeTruthy();
    expect(corpo.source.consecutiveFailures).toBe(1);

    // Nada foi proposto para remoção por causa da indisponibilidade.
    expect((corpo.changes as any[]).filter((c) => c.type === 'removido')).toHaveLength(0);
  });

  it('pausa sozinha depois de falhar muitas vezes seguidas', async () => {
    const { SYNC_LIMITS } = await import('@codeca/shared');
    await importarEConectar(empresa);
    paginasAtuais = { 'https://siteantigo.com.br/': { status: 503 } };

    for (let i = 0; i < SYNC_LIMITS.maxConsecutiveFailures; i += 1) {
      await verificar(empresa);
    }

    const corpo = await estado(empresa);
    expect(corpo.source.state).toBe('pausada');
    // Fora da fila: `next_check_at` nulo tira a linha do índice do agendador.
    const [fonte] = await api.db.select().from(schema.syncSources);
    expect(fonte?.nextCheckAt).toBeNull();
  });
});

describe('agendador', () => {
  it('roda sem sessão e sem aba aberta, pelo job protegido por segredo', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({ telefone: '(34) 98888-2222' });

    // Vence a fonte agora.
    await api.db.update(schema.syncSources).set({ nextCheckAt: new Date(Date.now() - 1000) });

    const { TEST_JOB_SECRET } = await import('../helpers/api.js');
    const job = await empresa.client.post(
      '/api/sync/run',
      {},
      { headers: { authorization: `Bearer ${TEST_JOB_SECRET}` } },
    );
    expect(job.status, job.errorMessage ?? '').toBe(200);
    expect(job.body.claimed).toBe(1);
    expect(job.body.checked).toBe(1);
    expect(job.body.changesFound).toBeGreaterThan(0);

    const corpo = await estado(empresa);
    expect(acharCampo(corpo, 'contato', 'phone')).toBeDefined();
  });

  it('o job recusa quem não tem o segredo', async () => {
    const semSegredo = await empresa.client.post('/api/sync/run', {});
    expect(semSegredo.status).toBe(401);

    const errado = await empresa.client.post(
      '/api/sync/run',
      {},
      { headers: { authorization: 'Bearer errado' } },
    );
    expect(errado.status).toBe(401);
  });

  it('fonte pausada não entra na fila do agendador', async () => {
    await importarEConectar(empresa);
    await empresa.client.patch(`${base(empresa)}/sync`, { paused: true });

    await api.db.update(schema.syncSources).set({ nextCheckAt: new Date(Date.now() - 1000) });

    const { TEST_JOB_SECRET } = await import('../helpers/api.js');
    const job = await empresa.client.post(
      '/api/sync/run',
      {},
      { headers: { authorization: `Bearer ${TEST_JOB_SECRET}` } },
    );
    expect(job.body.claimed).toBe(0);
  });
});

describe('cenário 14: dois clientes ao mesmo tempo', () => {
  it('cada empresa só vê e aplica o que é dela', async () => {
    await importarEConectar(empresa);

    const outra = await registerAccount(api, {
      email: 'contato@outraclinica.com.br',
      companyName: 'Outra Clínica',
    });
    await verifyEmail(api, outra);
    await habilitarModulos(outra);
    await usarPlanoComEspaco(outra);
    await importarEConectar(outra);

    paginasAtuais = siteOrigem({ telefone: '(34) 98888-2222' });
    await verificar(empresa);
    await verificar(outra);

    const corpoA = await estado(empresa);
    const corpoB = await estado(outra);
    const telefoneA = acharCampo(corpoA, 'contato', 'phone');
    const telefoneB = acharCampo(corpoB, 'contato', 'phone');

    expect(telefoneA.id).not.toBe(telefoneB.id);

    // A empresa A aprova; a B não.
    await empresa.client.patch(`${base(empresa)}/sync/decisoes`, {
      items: [{ changeId: telefoneA.id, decision: 'aprovada' }],
    });
    await empresa.client.post(`${base(empresa)}/sync/aplicar`, { confirm: true, targets: [] });

    const lerTelefone = async (conta: RegisteredAccount) => {
      const [documento] = await api.db
        .select()
        .from(schema.contentDocuments)
        .where(
          and(
            eq(schema.contentDocuments.tenantId, conta.tenantId),
            eq(schema.contentDocuments.moduleKey, 'contato'),
          ),
        );
      return (documento?.data as Record<string, unknown>)['phone'];
    };

    expect(await lerTelefone(empresa)).toBe('(34) 98888-2222');
    // A empresa B não aprovou: o telefone dela continua o do cadastro.
    expect(await lerTelefone(outra)).toBe('(19) 99999-0000');
  });

  it('uma empresa não alcança a fonte nem as alterações da outra', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({ telefone: '(34) 98888-2222' });
    await verificar(empresa);

    const corpoA = await estado(empresa);
    const telefoneA = acharCampo(corpoA, 'contato', 'phone');

    const outra = await registerAccount(api, {
      email: 'contato@terceira.com.br',
      companyName: 'Terceira',
    });
    await verifyEmail(api, outra);

    // Sem fonte própria: 404, não 403 -- 403 confirmaria que existe algo.
    const semFonte = await outra.client.post(`${base(outra)}/sync/verificar`, {});
    expect(semFonte.status).toBe(404);

    const desfazerAlheio = await outra.client.post(
      `${base(outra)}/sync/alteracoes/${telefoneA.id}/desfazer`,
      {},
    );
    expect(desfazerAlheio.status).toBe(404);

    const estadoDaOutra = await estado(outra);
    expect(estadoDaOutra.source).toBeNull();
    expect(estadoDaOutra.changes).toHaveLength(0);
  });
});

describe('aviso no painel e histórico', () => {
  it('a visão geral avisa quando há o que revisar, com os números reais', async () => {
    await importarEConectar(empresa);

    const semNada = await empresa.client.get(`${base(empresa)}/overview`);
    expect(semNada.body.syncNotice).toBeNull();

    paginasAtuais = siteOrigem({ telefone: '(34) 98888-2222', endereco: 'Avenida Nova, 500' });
    await verificar(empresa);

    const comAviso = await empresa.client.get(`${base(empresa)}/overview`);
    expect(comAviso.body.syncNotice).not.toBeNull();
    expect(comAviso.body.syncNotice.pending).toBeGreaterThan(0);
    expect(comAviso.body.syncNotice.message).toContain('Revise os conteúdos');
  });

  it('o histórico registra cada verificação, com quem pediu', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({ telefone: '(34) 98888-2222' });
    await verificar(empresa);

    const corpo = await estado(empresa);
    expect((corpo.checks as any[]).length).toBeGreaterThanOrEqual(2);

    const manual = (corpo.checks as any[]).find((c) => c.trigger === 'manual');
    expect(manual).toBeDefined();
    expect(manual.pagesChecked).toBeGreaterThan(0);
    expect(manual.state).toBe('concluida');
  });

  it('registra conectar, verificar, aplicar e desconectar na auditoria', async () => {
    await importarEConectar(empresa);
    paginasAtuais = siteOrigem({ telefone: '(34) 98888-2222' });
    await verificar(empresa);

    const corpo = await estado(empresa);
    const telefone = acharCampo(corpo, 'contato', 'phone');
    await empresa.client.patch(`${base(empresa)}/sync/decisoes`, {
      items: [{ changeId: telefone.id, decision: 'aprovada' }],
    });
    await empresa.client.post(`${base(empresa)}/sync/aplicar`, { confirm: true, targets: [] });
    await empresa.client.delete(`${base(empresa)}/sync`);

    const trilha = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.tenantId, empresa.tenantId));
    const acoes = trilha.map((l) => l.action);

    expect(acoes).toContain('site_sync.connected');
    expect(acoes).toContain('site_sync.checked');
    expect(acoes).toContain('site_sync.applied');
    expect(acoes).toContain('site_sync.disconnected');
  });

  it('desconectar apaga o acompanhamento, não o conteúdo já aplicado', async () => {
    await importarEConectar(empresa);
    const antes = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));

    await empresa.client.delete(`${base(empresa)}/sync`);

    const fontes = await api.db.select().from(schema.syncSources);
    expect(fontes).toHaveLength(0);

    const depois = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    expect(depois).toHaveLength(antes.length);
    expect(depois.length).toBeGreaterThan(0);
  });
});
