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
 * Importacao automatica de sites, de ponta a ponta.
 *
 * ## O que esta sendo exercitado de verdade
 *
 * A API inteira sobre um Postgres real: rastreamento, extracao, mapeamento,
 * conflito, revisao, gravacao pelos schemas do painel e reversao. O unico
 * substituto e a **busca das paginas**, e por um motivo concreto: a
 * implementacao real recusa `localhost` e IP privado de proposito -- e a
 * barreira contra SSRF --, entao um teste com servidor local seria barrado pela
 * propria protecao que se quer ter. As barreiras de rede tem testes proprios em
 * `tests/unit/import-extract.test.ts` e `tests/unit/import-fetcher.test.ts`.
 *
 * ## O que os testes conferem
 *
 * Nao basta "a importacao respondeu 200". Cada teste confere o **conteudo que
 * chegou ao banco**: campo por campo, no modulo certo, da empresa certa, como
 * rascunho, e com o valor anterior preservado quando havia conflito.
 */

const HOME = `<!doctype html>
<html lang="pt-BR">
<head>
  <title>Clinica Sorriso | Odontologia em Curitiba</title>
  <meta name="description" content="Clinica odontologica com atendimento humanizado em Curitiba.">
  <meta property="og:site_name" content="Clinica Sorriso">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Dentist","name":"Clinica Sorriso",
   "telephone":"(41) 3333-4444","email":"contato@clinicasorriso.com.br",
   "address":{"@type":"PostalAddress","streetAddress":"Rua das Flores, 123","addressLocality":"Curitiba","addressRegion":"PR","postalCode":"80010-100"}}
  </script>
</head>
<body>
  <header><img src="/img/logo.png" alt="Logo Clinica Sorriso"></header>
  <nav><a href="/quem-somos">Quem somos</a><a href="/servicos">Servicos</a><a href="/equipe">Equipe</a><a href="/perguntas-frequentes">Perguntas</a></nav>
  <main>
    <h1>Seu sorriso em boas maos</h1>
    <img src="/img/hero-banner.jpg" alt="Recepcao da clinica" width="1600" height="900">
  </main>
  <footer>
    <p>Rua das Flores, 123 - Centro, Curitiba - PR. CEP 80010-100</p>
    <p>Telefone (41) 3333-4444 | contato@clinicasorriso.com.br</p>
    <p>Segunda a sexta, 8h as 18h</p>
    <a href="https://instagram.com/clinicasorriso">Instagram</a>
    <a href="https://wa.me/5541999887766">WhatsApp</a>
  </footer>
</body></html>`;

const SOBRE = `<html><head><title>Quem somos</title></head><body><main>
  <h1>Quem somos</h1>
  <h2>Nossa historia</h2>
  <p>A clinica nasceu em 1998 no bairro Centro, com um consultorio e dois profissionais. Hoje sao seis salas e uma equipe de doze pessoas, mantendo o mesmo cuidado do primeiro dia com cada paciente que chega ate a recepcao.</p>
  <h2>Missao</h2>
  <p>Oferecer tratamento odontologico de qualidade com acolhimento, tornando a visita ao dentista uma experiencia tranquila para toda a familia.</p>
  <h2>Valores</h2>
  <ul><li>Cuidado</li><li>Transparencia</li><li>Pontualidade</li></ul>
</main></body></html>`;

const SERVICOS = `<html><head><title>Servicos</title></head><body><main>
  <h1>Nossos servicos</h1>
  <h2>Clareamento dental</h2>
  <p>Procedimento feito em consultorio, com acompanhamento do dentista e resultado visivel na primeira sessao de atendimento.</p>
  <h2>Implante dentario</h2>
  <p>Reposicao de dentes perdidos com pino de titanio, planejada por tomografia antes de qualquer intervencao cirurgica.</p>
</main></body></html>`;

const EQUIPE = `<html><head><title>Equipe</title></head><body><main>
  <h1>Nossa equipe</h1>
  <div class="team-member"><img src="/img/ana.jpg" alt="Ana"><h3>Dra. Ana Souza</h3><p>Ortodontista</p><p>Formada pela UFPR, atende na clinica desde 2005 e coordena a area de ortodontia da equipe inteira.</p></div>
</main></body></html>`;

const FAQ = `<html><head><title>Perguntas frequentes</title>
<script type="application/ld+json">
{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Atendem convenio?","acceptedAnswer":{"@type":"Answer","text":"Atendemos os principais convenios odontologicos."}}]}
</script>
</head><body><main>
  <h1>Perguntas frequentes</h1>
  <blockquote>Fui muito bem atendida desde a recepcao, e o tratamento resolveu um problema que eu tinha havia anos.<cite>Maria Silva</cite></blockquote>
</main></body></html>`;

/** PNG 2x2 valido: o bastante para passar pela checagem dos bytes. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNk+M/AwMDAxMDAwAAABicBAp9rjKkAAAAASUVORK5CYII=',
  'base64',
);

/** Imagem com mais de 1 KB, que e o minimo aceito pela importacao. */
const IMAGEM = new Uint8Array(Buffer.concat([PNG_BYTES, Buffer.alloc(2048, 7)]));

const PAGINAS = {
  'https://clinicasorriso.com.br/': { body: HOME },
  'https://clinicasorriso.com.br/quem-somos': { body: SOBRE },
  'https://clinicasorriso.com.br/servicos': { body: SERVICOS },
  'https://clinicasorriso.com.br/equipe': { body: EQUIPE },
  'https://clinicasorriso.com.br/perguntas-frequentes': { body: FAQ },
  'https://clinicasorriso.com.br/img/logo.png': { contentType: 'image/png', bytes: IMAGEM },
  'https://clinicasorriso.com.br/img/hero-banner.jpg': { contentType: 'image/png', bytes: IMAGEM },
  'https://clinicasorriso.com.br/img/ana.jpg': { contentType: 'image/png', bytes: IMAGEM },
};

let api: TestApi;
let empresa: RegisteredAccount;
let outra: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi({ siteFetcher: createMemorySiteFetcher(PAGINAS) });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  empresa = await registerAccount(api, {
    email: 'contato@clinicasorriso.com.br',
    companyName: 'Clinica Sorriso',
  });
  await verifyEmail(api, empresa);
});

/**
 * Poe a empresa num plano com espaco para o conteudo do site de exemplo.
 *
 * O plano inicial permite 5 conteudos cadastrados, e o site de teste produz
 * mais que isso. A importacao respeita esse limite -- o que tem teste proprio
 * em "limite do plano" --, mas para conferir *em que modulo cada coisa foi
 * gravada* o cenario precisa de espaco.
 */
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

/** Habilita todos os modulos do registro para o site da empresa. */
async function habilitarTodosOsModulos(account: RegisteredAccount): Promise<void> {
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

async function siteDe(account: RegisteredAccount): Promise<string> {
  const [site] = await api.db
    .select({ id: schema.sites.id })
    .from(schema.sites)
    .where(eq(schema.sites.tenantId, account.tenantId));
  if (!site) throw new Error('A empresa de teste nao tem site.');
  return site.id;
}

/** Abre a analise e avanca ate ela terminar. */
async function analisar(
  account: RegisteredAccount,
  url = 'https://clinicasorriso.com.br/',
): Promise<{ importId: string; run: any; items: any[] }> {
  const abertura = await account.client.post(`/api/tenants/${account.tenantId}/site-import`, { url });
  expect(abertura.status, abertura.errorMessage ?? '').toBe(201);
  const importId = abertura.body.run.id as string;

  // Cada consulta avanca uma fatia. O laco e o que o painel faz ao mostrar o
  // progresso; o limite evita um teste infinito se algo travar.
  let run = abertura.body.run;
  let items: any[] = [];
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    const estado = await account.client.get(
      `/api/tenants/${account.tenantId}/site-import/${importId}`,
    );
    expect(estado.status, estado.errorMessage ?? '').toBe(200);
    run = estado.body.run;
    items = estado.body.run.items ?? [];
    if (!run.working) break;
  }

  return { importId, run, items };
}

describe('abertura da analise', () => {
  it('recusa endereco de rede interna antes de qualquer gravacao', async () => {
    for (const url of ['http://localhost/', 'http://10.0.0.5/', 'http://169.254.169.254/']) {
      const response = await empresa.client.post(`/api/tenants/${empresa.tenantId}/site-import`, {
        url,
      });
      expect(response.status, url).toBe(422);
    }

    // Nenhuma analise foi criada: a recusa acontece antes do banco.
    const analises = await api.db.select({ id: schema.siteImports.id }).from(schema.siteImports);
    expect(analises).toHaveLength(0);
  });

  it('recusa quem so tem permissao de leitura', async () => {
    const viewer = await registerAccount(api, {
      email: 'leitor@clinicasorriso.com.br',
      companyName: 'Outra',
    });
    await verifyEmail(api, viewer);
    await api.db
      .update(schema.memberships)
      .set({ role: 'viewer' })
      .where(eq(schema.memberships.userId, viewer.userId));

    const response = await viewer.client.post(`/api/tenants/${viewer.tenantId}/site-import`, {
      url: 'https://clinicasorriso.com.br/',
    });
    expect(response.status).toBe(403);
  });

  it('nao abre duas analises ao mesmo tempo para o mesmo site', async () => {
    const primeira = await empresa.client.post(`/api/tenants/${empresa.tenantId}/site-import`, {
      url: 'https://clinicasorriso.com.br/',
    });
    expect(primeira.status).toBe(201);

    const segunda = await empresa.client.post(`/api/tenants/${empresa.tenantId}/site-import`, {
      url: 'https://clinicasorriso.com.br/',
    });
    expect(segunda.status).toBe(409);
  });
});

describe('analise de um site institucional', () => {
  beforeEach(async () => {
    await habilitarTodosOsModulos(empresa);
    await usarPlanoComEspaco(empresa);
  });

  it('percorre as paginas e chega ao estado de revisao', async () => {
    const { run } = await analisar(empresa);

    expect(run.state).toBe('analisada');
    expect(run.working).toBe(false);

    const lidas = (run.pages as any[]).filter((page) => page.error === undefined);
    expect(lidas.length).toBeGreaterThanOrEqual(5);

    // O papel de cada pagina foi identificado pelo endereco.
    const papeis = lidas.map((page) => page.role);
    expect(papeis).toContain('inicial');
    expect(papeis).toContain('sobre');
    expect(papeis).toContain('servicos');
    expect(papeis).toContain('equipe');
    expect(papeis).toContain('faq');
  });

  it('o resumo traz os numeros reais do que foi encontrado', async () => {
    const { run } = await analisar(empresa);

    expect(run.summary.pages).toBe(run.pages.filter((p: any) => p.error === undefined).length);
    expect(run.summary.documentFields).toBeGreaterThan(5);
    expect(run.summary.images).toBeGreaterThan(0);
    expect(run.summary.collectionRecords.servicos).toBe(2);
    expect(run.summary.collectionRecords.equipe).toBe(1);
    expect(run.summary.collectionRecords.faq).toBe(1);

    // A frase exibida cita os numeros, nunca um exemplo.
    expect(run.message).toMatch(/Encontramos .*páginas/);
    expect(run.message).toContain('Revise os dados antes de importar');
  });

  /**
   * O cadastro da conta ja grava telefone no modulo Contato, entao o telefone
   * do site antigo chega como conflito -- e e assim que a tela de revisao
   * mostra os dois lados da escolha.
   */
  it('mostra o valor que esta no painel ao lado do que foi encontrado', async () => {
    const { items } = await analisar(empresa);

    const telefone = items.find(
      (item) => item.target === 'contato' && item.fieldKey === 'phone',
    );
    expect(telefone).toBeDefined();
    expect(telefone.conflict).toBe(true);
    expect(telefone.decision).toBe('ignorado');
    expect(telefone.preview).toBe('(41) 3333-4444');
    expect(telefone.currentPreview).toBe('(19) 99999-0000');
  });

  it('cada candidato aponta para a pagina de onde veio', async () => {
    const { items } = await analisar(empresa);
    expect(items.length).toBeGreaterThan(10);
    for (const item of items) {
      expect(item.evidence.pageUrl).toMatch(/^https:\/\/clinicasorriso\.com\.br/);
      expect(item.evidence.source).toBeTruthy();
    }
  });

  it('nao marca nada como importado antes de confirmar', async () => {
    const { items } = await analisar(empresa);
    for (const item of items) expect(item.outcome).toBe('pendente');

    // E nada foi gravado no painel.
    const servicos = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    expect(servicos).toHaveLength(0);
  });
});

describe('confirmacao da importacao', () => {
  beforeEach(async () => {
    await habilitarTodosOsModulos(empresa);
    await usarPlanoComEspaco(empresa);
  });

  it('grava o conteudo nos modulos certos, como rascunho', async () => {
    const { importId } = await analisar(empresa);

    const confirmacao = await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );
    expect(confirmacao.status, confirmacao.errorMessage ?? '').toBe(200);
    expect(confirmacao.body.result.imported).toBeGreaterThan(5);

    // --- institucional
    const [institucional] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.tenantId, empresa.tenantId),
          eq(schema.contentDocuments.moduleKey, 'institucional'),
        ),
      );
    const dados = institucional?.data as Record<string, unknown>;
    expect(dados['companyName']).toBe('Clinica Sorriso');
    expect(dados['tagline']).toBe('Seu sorriso em boas maos');
    expect(String(dados['history'])).toContain('consultorio e dois profissionais');
    expect(String(dados['mission'])).toContain('acolhimento');
    expect(dados['values']).toEqual(['Cuidado', 'Transparencia', 'Pontualidade']);
    expect(dados['foundedYear']).toBe(1998);
    // O logotipo virou identificador da biblioteca, nao URL do site antigo.
    expect(String(dados['logoImageId'])).toMatch(/^[0-9a-f-]{36}$/);

    // --- contato
    const [contato] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.tenantId, empresa.tenantId),
          eq(schema.contentDocuments.moduleKey, 'contato'),
        ),
      );
    const contatoDados = contato?.data as Record<string, unknown>;
    expect(contatoDados['email']).toBe('contato@clinicasorriso.com.br');
    /**
     * O telefone **nao** foi trocado, e isso e o comportamento correto.
     *
     * O cadastro da conta ja gravou o telefone informado no registro, e a
     * regra e nunca substituir conteudo existente sem autorizacao. O telefone
     * do site antigo fica na revisao como conflito, para a pessoa escolher.
     */
    expect(contatoDados['phone']).toBe('(19) 99999-0000');
    expect(contatoDados['addressLine']).toBe('Rua das Flores, 123');
    expect(contatoDados['city']).toBe('Curitiba');
    expect(contatoDados['state']).toBe('PR');
    expect(contatoDados['postalCode']).toBe('80010-100');
    expect(contatoDados['whatsapp']).toBe('(41) 99988-7766');
    expect((contatoDados['social'] as Record<string, string>)['instagram']).toContain('instagram.com');

    // --- servicos, como rascunho
    const servicos = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    expect(servicos).toHaveLength(2);
    for (const servico of servicos) {
      expect(servico.publicationStatus).toBe('draft');
      expect(servico.siteId).toBe(await siteDe(empresa));
      expect(servico.slug).not.toBe('');
    }
    expect(servicos.map((s) => s.title).sort()).toEqual(['Clareamento dental', 'Implante dentario']);

    // --- equipe
    const equipe = await api.db
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.tenantId, empresa.tenantId));
    expect(equipe).toHaveLength(1);
    expect(equipe[0]?.name).toBe('Dra. Ana Souza');
    expect(equipe[0]?.role).toBe('Ortodontista');
    expect(equipe[0]?.publicationStatus).toBe('draft');
    // A foto foi trazida para a biblioteca.
    expect(equipe[0]?.photoId).toMatch(/^[0-9a-f-]{36}$/);

    // --- perguntas frequentes
    const faqs = await api.db
      .select()
      .from(schema.faqs)
      .where(eq(schema.faqs.tenantId, empresa.tenantId));
    expect(faqs).toHaveLength(1);
    expect(faqs[0]?.question).toBe('Atendem convenio?');
    expect(faqs[0]?.publicationStatus).toBe('draft');
  });

  /**
   * O ponto mais sensivel do modulo de depoimentos. O campo declara que a
   * empresa tem autorizacao da pessoa citada; estar publicado no site antigo
   * nao e essa autorizacao, e marcar sozinho seria declarar no lugar dela.
   */
  it('importa depoimento sem autorizacao confirmada e sem publicar', async () => {
    const { importId } = await analisar(empresa);
    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );

    const depoimentos = await api.db
      .select()
      .from(schema.testimonials)
      .where(eq(schema.testimonials.tenantId, empresa.tenantId));
    expect(depoimentos).toHaveLength(1);
    expect(depoimentos[0]?.authorName).toBe('Maria Silva');
    expect(depoimentos[0]?.authorizationConfirmed).toBe(false);
    expect(depoimentos[0]?.publicationStatus).toBe('draft');
  });

  it('banner entra desativado, para nao aparecer no site sem conferencia', async () => {
    const { importId } = await analisar(empresa);
    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );

    const banners = await api.db
      .select()
      .from(schema.banners)
      .where(eq(schema.banners.tenantId, empresa.tenantId));
    expect(banners.length).toBeGreaterThan(0);
    for (const banner of banners) expect(banner.isActive).toBe(false);
  });

  it('as imagens vao para a biblioteca da empresa, no Blob dela', async () => {
    const { importId } = await analisar(empresa);
    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );

    const arquivos = await api.db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.tenantId, empresa.tenantId));
    expect(arquivos.length).toBeGreaterThan(0);

    for (const arquivo of arquivos) {
      // Caminho sempre no espaco da empresa: e o que impede uma empresa de
      // escrever no armazenamento de outra.
      expect(arquivo.blobPathname.startsWith(`tenants/${empresa.tenantId}/`)).toBe(true);
      expect(arquivo.mimeType).toBe('image/png');
      expect(arquivo.sizeBytes).toBeGreaterThan(1024);
      // A dimensao lida do arquivo, nao a declarada no HTML do site antigo.
      expect(arquivo.width).toBe(2);
      expect(arquivo.height).toBe(2);
      expect(arquivo.tag.startsWith('importado-')).toBe(true);
    }
  });

  it('confirmar duas vezes nao duplica o conteudo', async () => {
    const { importId } = await analisar(empresa);

    const primeira = await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );
    expect(primeira.status).toBe(200);

    const segunda = await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );
    expect(segunda.status).toBe(409);

    const servicos = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    expect(servicos).toHaveLength(2);
  });

  it('importa somente os destinos escolhidos', async () => {
    const { importId } = await analisar(empresa);

    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: ['servicos'] },
    );

    const servicos = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    expect(servicos).toHaveLength(2);

    // Nada mais entrou.
    const faqs = await api.db
      .select()
      .from(schema.faqs)
      .where(eq(schema.faqs.tenantId, empresa.tenantId));
    expect(faqs).toHaveLength(0);

    const [institucional] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.tenantId, empresa.tenantId),
          eq(schema.contentDocuments.moduleKey, 'institucional'),
        ),
      );
    // O documento pode nem existir; se existir, nao tem o que a analise achou.
    expect((institucional?.data as Record<string, unknown> | undefined)?.['tagline'] ?? '').not.toBe(
      'Seu sorriso em boas maos',
    );
  });
});

describe('campo que ja tem conteudo', () => {
  beforeEach(async () => {
    await habilitarTodosOsModulos(empresa);
    await usarPlanoComEspaco(empresa);
  });

  /** Preenche o institucional como se a pessoa tivesse editado no painel. */
  async function preencherInstitucional(tagline: string): Promise<void> {
    const site = await siteDe(empresa);
    const { emptyDocument } = await import('@codeca/shared');
    const base = emptyDocument('institucional');
    await api.db
      .insert(schema.contentDocuments)
      .values({
        tenantId: empresa.tenantId,
        siteId: site,
        moduleKey: 'institucional',
        data: { ...base, companyName: 'Nome escolhido pelo cliente', tagline },
        customFields: {},
      })
      .onConflictDoUpdate({
        target: [schema.contentDocuments.siteId, schema.contentDocuments.moduleKey],
        set: { data: { ...base, companyName: 'Nome escolhido pelo cliente', tagline } },
      });
  }

  it('marca conflito e nao substitui sem autorizacao', async () => {
    await preencherInstitucional('Frase que o cliente escreveu');
    const { importId, items } = await analisar(empresa);

    const tagline = items.find(
      (item) => item.target === 'institucional' && item.fieldKey === 'tagline',
    );
    expect(tagline).toBeDefined();
    expect(tagline.conflict).toBe(true);
    // Vem desmarcado: o padrao nunca substitui conteudo cadastrado.
    expect(tagline.decision).toBe('ignorado');
    expect(tagline.resolution).toBe('manter');
    expect(tagline.currentPreview).toBe('Frase que o cliente escreveu');

    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );

    const [documento] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.tenantId, empresa.tenantId),
          eq(schema.contentDocuments.moduleKey, 'institucional'),
        ),
      );
    const dados = documento?.data as Record<string, unknown>;
    // O que o cliente escreveu continua ali.
    expect(dados['tagline']).toBe('Frase que o cliente escreveu');
    expect(dados['companyName']).toBe('Nome escolhido pelo cliente');
    // E o que estava vazio foi preenchido: importacao parcial do mesmo modulo.
    expect(dados['foundedYear']).toBe(1998);
  });

  it('substitui quando a revisao autoriza, guardando o valor anterior', async () => {
    await preencherInstitucional('Frase que o cliente escreveu');
    const { importId, items } = await analisar(empresa);

    const tagline = items.find(
      (item) => item.target === 'institucional' && item.fieldKey === 'tagline',
    );

    const revisao = await empresa.client.patch(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/revisao`,
      { items: [{ itemId: tagline.id, decision: 'selecionado', resolution: 'substituir' }] },
    );
    expect(revisao.status, revisao.errorMessage ?? '').toBe(200);

    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );

    const [documento] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.tenantId, empresa.tenantId),
          eq(schema.contentDocuments.moduleKey, 'institucional'),
        ),
      );
    expect((documento?.data as Record<string, unknown>)['tagline']).toBe('Seu sorriso em boas maos');

    // O valor anterior ficou guardado, que e o que a reversao usa.
    const [item] = await api.db
      .select()
      .from(schema.siteImportItems)
      .where(eq(schema.siteImportItems.id, tagline.id));
    expect(item?.previousValue).toBe('Frase que o cliente escreveu');
  });
});

describe('desfazer a importacao', () => {
  beforeEach(async () => {
    await habilitarTodosOsModulos(empresa);
    await usarPlanoComEspaco(empresa);
  });

  it('apaga o que criou e devolve os campos ao valor anterior', async () => {
    const { importId } = await analisar(empresa);
    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );

    const antes = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    expect(antes).toHaveLength(2);

    const desfazer = await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/desfazer`,
      {},
    );
    expect(desfazer.status, desfazer.errorMessage ?? '').toBe(200);
    expect(desfazer.body.failed).toBe(0);
    expect(desfazer.body.reverted).toBeGreaterThan(0);

    const depois = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    expect(depois).toHaveLength(0);

    const faqs = await api.db
      .select()
      .from(schema.faqs)
      .where(eq(schema.faqs.tenantId, empresa.tenantId));
    expect(faqs).toHaveLength(0);

    // Os campos do institucional voltaram ao vazio.
    const [documento] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.tenantId, empresa.tenantId),
          eq(schema.contentDocuments.moduleKey, 'institucional'),
        ),
      );
    const dados = documento?.data as Record<string, unknown>;
    expect(dados['tagline']).toBe('');
    expect(dados['foundedYear']).toBeNull();

    /**
     * As imagens ficam. Desfazer a importacao do conteudo nao deveria apagar
     * um arquivo que a pessoa pode ja ter usado em outro lugar -- a Biblioteca
     * de imagens tem a propria exclusao, que recusa apagar arquivo em uso.
     */
    const arquivos = await api.db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.tenantId, empresa.tenantId));
    expect(arquivos.length).toBeGreaterThan(0);
  });

  it('nao desfaz duas vezes', async () => {
    const { importId } = await analisar(empresa);
    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );
    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/desfazer`,
      {},
    );
    const segunda = await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/desfazer`,
      {},
    );
    expect(segunda.status).toBe(409);
  });
});

describe('limite do plano', () => {
  /**
   * Importar nao e uma via de contornar o plano.
   *
   * O site de exemplo produz mais conteudos de colecao do que o plano inicial
   * permite (5). A importacao usa o **mesmo** `assertContentLimit` que a tela
   * de cadastro, entao o excedente falha com a mensagem do plano em vez de
   * entrar -- e o que entrou continua valendo: a importacao e parcial, nao
   * tudo-ou-nada.
   */
  it('para no limite de conteudos do plano, com mensagem, e mantem o que entrou', async () => {
    await habilitarTodosOsModulos(empresa);
    // Sem `usarPlanoComEspaco`: a empresa fica no plano do cadastro.
    const { importId } = await analisar(empresa);

    const confirmacao = await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );
    expect(confirmacao.status).toBe(200);
    expect(confirmacao.body.result.failed).toBeGreaterThan(0);

    const falhas = (confirmacao.body.run.items as any[]).filter(
      (item) => item.kind === 'colecao_registro' && item.outcome === 'falhou',
    );
    expect(falhas.length).toBeGreaterThan(0);
    // A mensagem cita o plano, e nao um erro tecnico.
    expect(falhas.some((item) => /plano/i.test(item.error ?? ''))).toBe(true);

    const [plano] = await api.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.code, 'trial'));
    const limite = (plano?.limits as { maxContentRecords: number }).maxContentRecords;

    const servicos = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    const equipe = await api.db
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.tenantId, empresa.tenantId));
    const faqs = await api.db
      .select()
      .from(schema.faqs)
      .where(eq(schema.faqs.tenantId, empresa.tenantId));
    const banners = await api.db
      .select()
      .from(schema.banners)
      .where(eq(schema.banners.tenantId, empresa.tenantId));
    const depoimentos = await api.db
      .select()
      .from(schema.testimonials)
      .where(eq(schema.testimonials.tenantId, empresa.tenantId));

    const total =
      servicos.length + equipe.length + faqs.length + banners.length + depoimentos.length;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(limite);
  });
});

describe('modulo que o site nao tem', () => {
  it('marca o candidato como indisponivel e nao grava nada nele', async () => {
    // Somente institucional e contato habilitados.
    const site = await siteDe(empresa);
    await api.db.delete(schema.siteModules).where(eq(schema.siteModules.siteId, site));
    for (const key of ['institucional', 'contato']) {
      await api.db.insert(schema.siteModules).values({
        tenantId: empresa.tenantId,
        siteId: site,
        moduleKey: key,
        enabled: true,
        settings: {},
      });
    }

    const { importId, items } = await analisar(empresa);

    const servico = items.find((item) => item.target === 'servicos');
    expect(servico).toBeDefined();
    // Aparece na revisao, marcado como indisponivel e desmarcado: o cliente
    // precisa saber que o site antigo tinha isso.
    expect(servico.targetDisabled).toBe(true);
    expect(servico.decision).toBe('ignorado');

    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );

    const servicos = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, empresa.tenantId));
    expect(servicos).toHaveLength(0);

    // Mas o institucional entrou.
    const [documento] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.tenantId, empresa.tenantId),
          eq(schema.contentDocuments.moduleKey, 'institucional'),
        ),
      );
    expect((documento?.data as Record<string, unknown>)['companyName']).toBe('Clinica Sorriso');
  });
});

describe('isolamento entre empresas', () => {
  beforeEach(async () => {
    await habilitarTodosOsModulos(empresa);
    await usarPlanoComEspaco(empresa);
    outra = await registerAccount(api, {
      email: 'contato@outraclinica.com.br',
      companyName: 'Outra Clinica',
    });
    await verifyEmail(api, outra);
    await habilitarTodosOsModulos(outra);
    await usarPlanoComEspaco(outra);
  });

  it('uma empresa nao ve a analise da outra', async () => {
    const { importId } = await analisar(empresa);

    // 404, nao 403: responder diferente confirmaria que a analise existe.
    const leitura = await outra.client.get(
      `/api/tenants/${outra.tenantId}/site-import/${importId}`,
    );
    expect(leitura.status).toBe(404);

    const confirmacao = await outra.client.post(
      `/api/tenants/${outra.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );
    expect(confirmacao.status).toBe(404);

    const desfazer = await outra.client.post(
      `/api/tenants/${outra.tenantId}/site-import/${importId}/desfazer`,
      {},
    );
    expect(desfazer.status).toBe(404);
  });

  it('nao consegue usar o identificador da empresa da analise na propria rota', async () => {
    const { importId } = await analisar(empresa);

    // Tentando passar o tenant da vitima: o middleware recusa por falta de
    // vinculo, antes de qualquer consulta de importacao.
    const response = await outra.client.get(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}`,
    );
    expect(response.status).toBe(404);
  });

  it('o conteudo importado por uma empresa nao aparece na outra', async () => {
    const { importId } = await analisar(empresa);
    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );

    const servicosDaOutra = await api.db
      .select()
      .from(schema.services)
      .where(eq(schema.services.tenantId, outra.tenantId));
    expect(servicosDaOutra).toHaveLength(0);

    const arquivosDaOutra = await api.db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.tenantId, outra.tenantId));
    expect(arquivosDaOutra).toHaveLength(0);

    // E a listagem dela nao traz a analise da vizinha.
    const lista = await outra.client.get(`/api/tenants/${outra.tenantId}/site-import`);
    expect(lista.status).toBe(200);
    expect(lista.body.latest).toBeNull();
    expect(lista.body.history).toHaveLength(0);
  });

  it('as duas empresas podem analisar o mesmo site sem se misturar', async () => {
    const primeira = await analisar(empresa);
    const segunda = await analisar(outra);

    expect(primeira.importId).not.toBe(segunda.importId);

    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${primeira.importId}/confirmar`,
      { confirm: true, targets: ['servicos'] },
    );
    await outra.client.post(
      `/api/tenants/${outra.tenantId}/site-import/${segunda.importId}/confirmar`,
      { confirm: true, targets: ['servicos'] },
    );

    for (const conta of [empresa, outra]) {
      const servicos = await api.db
        .select()
        .from(schema.services)
        .where(eq(schema.services.tenantId, conta.tenantId));
      expect(servicos).toHaveLength(2);
      const site = await siteDe(conta);
      for (const servico of servicos) expect(servico.siteId).toBe(site);
    }
  });
});

describe('sites que dao problema', () => {
  beforeEach(async () => {
    await habilitarTodosOsModulos(empresa);
    await usarPlanoComEspaco(empresa);
  });

  it('endereco que nao responde termina a analise com mensagem, nao com erro', async () => {
    const { run } = await analisar(empresa, 'https://clinicasorriso.com.br/nao-existe');

    // A pagina respondeu 404; a analise termina sem candidato de conteudo.
    expect(['analisada', 'erro']).toContain(run.state);
    expect(run.working).toBe(false);
    expect(run.message).toBeTruthy();
  });

  it('site que monta o conteudo no navegador e sinalizado', async () => {
    const spa = createMemorySiteFetcher({
      'https://app-spa.com.br/': {
        body: '<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
      },
    });
    const apiSpa = await createTestApi({ siteFetcher: spa });
    try {
      const conta = await registerAccount(apiSpa, {
        email: 'contato@app-spa.com.br',
        companyName: 'App SPA',
      });
      await verifyEmail(apiSpa, conta);

      const abertura = await conta.client.post(`/api/tenants/${conta.tenantId}/site-import`, {
        url: 'https://app-spa.com.br/',
      });
      const importId = abertura.body.run.id as string;

      let run: any;
      for (let i = 0; i < 10; i += 1) {
        const estado = await conta.client.get(
          `/api/tenants/${conta.tenantId}/site-import/${importId}`,
        );
        run = estado.body.run;
        if (!run.working) break;
      }

      expect(run.state).toBe('analisada');
      // A analise nao executa JavaScript: o aviso e o que explica o resultado
      // magro, em vez de entregar campos vazios sem motivo.
      expect(run.likelyClientRendered).toBe(true);
      expect(run.summary.documentFields).toBeLessThan(3);
    } finally {
      await apiSpa.close();
    }
  });

  it('imagem indisponivel nao impede a importacao do conteudo', async () => {
    const semImagem = createMemorySiteFetcher({
      ...PAGINAS,
      'https://clinicasorriso.com.br/img/logo.png': { status: 500 },
      'https://clinicasorriso.com.br/img/hero-banner.jpg': { status: 404 },
      'https://clinicasorriso.com.br/img/ana.jpg': { status: 404 },
    });
    const apiSemImagem = await createTestApi({ siteFetcher: semImagem });
    try {
      const conta = await registerAccount(apiSemImagem, {
        email: 'contato@semimagem.com.br',
        companyName: 'Sem Imagem',
      });
      await verifyEmail(apiSemImagem, conta);
      const { MODULE_KEYS } = await import('@codeca/shared');
      const [site] = await apiSemImagem.db
        .select({ id: schema.sites.id })
        .from(schema.sites)
        .where(eq(schema.sites.tenantId, conta.tenantId));
      for (const key of MODULE_KEYS) {
        await apiSemImagem.db
          .insert(schema.siteModules)
          .values({
            tenantId: conta.tenantId,
            siteId: site!.id,
            moduleKey: key,
            enabled: true,
            settings: {},
          })
          .onConflictDoUpdate({
            target: [schema.siteModules.siteId, schema.siteModules.moduleKey],
            set: { enabled: true },
          });
      }

      const abertura = await conta.client.post(`/api/tenants/${conta.tenantId}/site-import`, {
        url: 'https://clinicasorriso.com.br/',
      });
      const importId = abertura.body.run.id as string;
      let run: any;
      let items: any[] = [];
      for (let i = 0; i < 20; i += 1) {
        const estado = await conta.client.get(
          `/api/tenants/${conta.tenantId}/site-import/${importId}`,
        );
        run = estado.body.run;
        items = run.items ?? [];
        if (!run.working) break;
      }
      expect(run.state).toBe('analisada');

      const confirmacao = await conta.client.post(
        `/api/tenants/${conta.tenantId}/site-import/${importId}/confirmar`,
        { confirm: true, targets: [] },
      );
      expect(confirmacao.status).toBe(200);
      // As imagens falharam, com motivo registrado.
      expect(confirmacao.body.result.failed).toBeGreaterThan(0);

      // E o conteudo entrou mesmo assim.
      const servicos = await apiSemImagem.db
        .select()
        .from(schema.services)
        .where(eq(schema.services.tenantId, conta.tenantId));
      expect(servicos).toHaveLength(2);

      // O membro da equipe entrou sem foto, em vez de nao entrar.
      const equipe = await apiSemImagem.db
        .select()
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.tenantId, conta.tenantId));
      expect(equipe).toHaveLength(1);
      expect(equipe[0]?.photoId).toBeNull();

      const detalhes = await conta.client.get(
        `/api/tenants/${conta.tenantId}/site-import/${importId}`,
      );
      const imagensFalhadas = (detalhes.body.run.items as any[]).filter(
        (item) => item.kind === 'imagem' && item.outcome === 'falhou',
      );
      expect(imagensFalhadas.length).toBeGreaterThan(0);
      expect(imagensFalhadas[0].error).toBeTruthy();
      expect(items.length).toBeGreaterThan(0);
    } finally {
      await apiSemImagem.close();
    }
  });

  /**
   * Arquivo que diz ser imagem mas nao e: a decisao e pelos bytes, nao pelo
   * `content-type` do servidor de origem.
   */
  it('recusa arquivo que nao e imagem, mesmo declarado como imagem', async () => {
    const falsa = createMemorySiteFetcher({
      ...PAGINAS,
      'https://clinicasorriso.com.br/img/logo.png': {
        contentType: 'image/png',
        bytes: new Uint8Array(Buffer.from('<?php echo "nao sou imagem"; ?>'.repeat(100))),
      },
    });
    const apiFalsa = await createTestApi({ siteFetcher: falsa });
    try {
      const conta = await registerAccount(apiFalsa, {
        email: 'contato@falsa.com.br',
        companyName: 'Falsa',
      });
      await verifyEmail(apiFalsa, conta);

      const abertura = await conta.client.post(`/api/tenants/${conta.tenantId}/site-import`, {
        url: 'https://clinicasorriso.com.br/',
      });
      const importId = abertura.body.run.id as string;
      for (let i = 0; i < 20; i += 1) {
        const estado = await conta.client.get(
          `/api/tenants/${conta.tenantId}/site-import/${importId}`,
        );
        if (!estado.body.run.working) break;
      }
      await conta.client.post(
        `/api/tenants/${conta.tenantId}/site-import/${importId}/confirmar`,
        { confirm: true, targets: [] },
      );

      const arquivos = await apiFalsa.db
        .select()
        .from(schema.mediaAssets)
        .where(eq(schema.mediaAssets.tenantId, conta.tenantId));
      for (const arquivo of arquivos) {
        expect(arquivo.fileName).not.toContain('logo');
      }
    } finally {
      await apiFalsa.close();
    }
  });
});

describe('historico e auditoria', () => {
  beforeEach(async () => {
    await habilitarTodosOsModulos(empresa);
    await usarPlanoComEspaco(empresa);
  });

  it('registra quem analisou, quem confirmou e quem desfez', async () => {
    const { importId } = await analisar(empresa);
    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/confirmar`,
      { confirm: true, targets: [] },
    );
    await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/desfazer`,
      {},
    );

    const trilha = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.tenantId, empresa.tenantId));

    const acoes = trilha.map((linha) => linha.action);
    expect(acoes).toContain('site_import.started');
    expect(acoes).toContain('site_import.confirmed');
    expect(acoes).toContain('site_import.reverted');

    // Nenhuma linha carrega conteudo do site analisado: so endereco e numeros.
    const inicio = trilha.find((linha) => linha.action === 'site_import.started');
    expect(inicio?.metadata).toEqual({ sourceUrl: 'https://clinicasorriso.com.br/' });
  });

  it('a listagem traz a analise mais recente e o historico', async () => {
    const { importId } = await analisar(empresa);
    const lista = await empresa.client.get(`/api/tenants/${empresa.tenantId}/site-import`);

    expect(lista.status).toBe(200);
    expect(lista.body.latest.id).toBe(importId);
    expect(lista.body.history).toHaveLength(1);
    expect(lista.body.limits.maxPages).toBeGreaterThan(0);
  });

  it('cancelar libera o site para uma nova analise', async () => {
    const abertura = await empresa.client.post(`/api/tenants/${empresa.tenantId}/site-import`, {
      url: 'https://clinicasorriso.com.br/',
    });
    const importId = abertura.body.run.id as string;

    const cancelar = await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${importId}/cancelar`,
      {},
    );
    expect(cancelar.status, cancelar.errorMessage ?? '').toBe(200);
    expect(cancelar.body.run.state).toBe('erro');

    const nova = await empresa.client.post(`/api/tenants/${empresa.tenantId}/site-import`, {
      url: 'https://clinicasorriso.com.br/',
    });
    expect(nova.status).toBe(201);
  });

  it('analise terminada e aguardando revisao tambem pode ser descartada', async () => {
    /**
     * O beco sem saida que isto impede.
     *
     * Uma analise que **terminou** e espera revisao esconde o formulario de
     * endereco, para nao abrir duas analises sobre o mesmo site. Se ela
     * tambem nao pudesse ser descartada, quem analisou o endereco errado --
     * ou cujo site nao rendeu nada -- ficaria preso olhando o resultado, sem
     * conseguir tentar outro endereco. Sem saida nenhuma na tela.
     *
     * O caso apareceu em producao, com um site que monta o conteudo no
     * navegador: a analise concluiu, nao achou nada, e nao havia como sair.
     */
    await habilitarTodosOsModulos(empresa);
    await usarPlanoComEspaco(empresa);

    const { run } = await analisar(empresa);
    expect(run.state).toBe('analisada');
    expect(run.working).toBe(false);

    /**
     * Descartar e aceito neste estado -- e e o que a tela precisa.
     *
     * A API por si so nem exigiria isso: `loadRunningRun` guarda apenas os
     * estados de trabalho, entao abrir outra analise com uma em revisao
     * passaria. Quem segura e a tela, de proposito: comecar outra analise
     * abandonaria em silencio os candidatos que a pessoa ja estava
     * revisando. Por isso a saida e explicita, e por isso ela precisa
     * existir.
     */
    const descartar = await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/site-import/${run.id}/cancelar`,
      {},
    );
    expect(descartar.status, descartar.errorMessage ?? '').toBe(200);
    expect(descartar.body.run.state).toBe('erro');

    const nova = await empresa.client.post(`/api/tenants/${empresa.tenantId}/site-import`, {
      url: 'https://clinicasorriso.com.br/',
    });
    expect(nova.status, nova.errorMessage ?? '').toBe(201);
  });
});
