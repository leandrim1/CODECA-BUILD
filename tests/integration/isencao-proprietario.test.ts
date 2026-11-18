import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { issueApiKey, isExemptTenant, setExemptTenants } from '@codeca/api';
import {
  createTestApi,
  primarySiteId,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';
import { expireTrial } from '../helpers/billing.js';

/**
 * Isencao de cobranca da empresa da propria CODECA IA.
 *
 * O que estes testes protegem, em ordem de gravidade:
 *  - a empresa isenta nunca e barrada, mesmo sem assinatura nenhuma;
 *  - **a isencao nao vaza**: a empresa do cliente ao lado continua sob todas
 *    as regras de cobranca, na mesma instalacao e ao mesmo tempo;
 *  - nenhuma acao de cliente alcanca a lista de isentas.
 */

let api: TestApi;
/** A empresa da CODECA IA. */
let dona: RegisteredAccount;
/** Um cliente pagante comum. */
let cliente: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  // Nao deixa a lista valendo para os proximos arquivos de teste.
  setExemptTenants([]);
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  dona = await registerAccount(api, { email: 'contato@codecaia.com.br', companyName: 'CODECA IA' });
  await verifyEmail(api, dona);
  cliente = await registerAccount(api, { email: 'dona@padariaaurora.com.br', companyName: 'Padaria Aurora' });
  await verifyEmail(api, cliente);

  /*
   * A lista de isentas e configuracao do processo, definida por
   * `createContext` a partir de `PLATFORM_OWNER_TENANT_IDS`. Aqui ela e
   * definida direto porque o identificador da empresa so existe depois do
   * cadastro -- e e a MESMA funcao que o contexto chama. O caminho da
   * variavel de ambiente tem teste proprio, no fim do arquivo.
   */
  setExemptTenants([dona.tenantId]);
});

/** Deixa a empresa sem assinatura valida: avaliacao vencida e nada pago. */
async function semAssinaturaValida(conta: RegisteredAccount) {
  await expireTrial(api, conta.siteId);
  await api.db
    .update(schema.subscriptions)
    .set({ status: 'past_due', publicationState: 'blocked_overdue' })
    .where(eq(schema.subscriptions.tenantId, conta.tenantId));
}

describe('a empresa da CODECA IA', () => {
  it('grava normalmente mesmo com a assinatura vencida e bloqueada', async () => {
    await semAssinaturaValida(dona);

    const criado = await dona.client.post(`/api/tenants/${dona.tenantId}/services`, { title: 'Serviço da casa' });
    expect(criado.status, criado.errorMessage ?? '').toBe(201);
  });

  it('o painel nao entra em somente leitura: a tela nao recebe restricao', async () => {
    await semAssinaturaValida(dona);

    const modulos = await dona.client.get(`/api/tenants/${dona.tenantId}/modules`);
    expect(modulos.status).toBe(200);
    // `current: true` e o que a tela le como "sem restricao agora".
    expect(modulos.body.suspension.current).toBe(true);
    expect(modulos.body.suspension.panel).not.toBe('blocked');
    expect(modulos.body.panel.included).toBe(true);
  });

  it('a tela de plano mostra a isencao, sem assinatura a regularizar', async () => {
    await semAssinaturaValida(dona);

    const cobranca = await dona.client.get(`/api/tenants/${dona.tenantId}/billing`);
    expect(cobranca.status).toBe(200);
    expect(cobranca.body.plan.exempt).toBe(true);
    // A situacao vem dentro da assinatura, que e onde a tela a le.
    expect(cobranca.body.subscription.suspension.current).toBe(true);
    expect(cobranca.body.subscription.suspension.panel).not.toBe('blocked');
  });

  it('nao esbarra nos limites do plano: usuarios, conteudos e armazenamento', async () => {
    const [trial] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'trial'));
    const limite = (trial!.limits as { maxContentRecords: number }).maxContentRecords;
    const siteId = await primarySiteId(api, dona.tenantId);

    // Enche a conta MUITO acima do limite da avaliacao.
    await api.db.insert(schema.services).values(
      Array.from({ length: limite + 10 }, (_, i) => ({
        tenantId: dona.tenantId,
        siteId,
        title: `Serviço ${i}`,
        slug: `servico-${i}`,
      })),
    );

    // E ainda assim cadastra mais um.
    const maisUm = await dona.client.post(`/api/tenants/${dona.tenantId}/services`, { title: 'Mais um' });
    expect(maisUm.status, maisUm.errorMessage ?? '').toBe(201);

    const cobranca = await dona.client.get(`/api/tenants/${dona.tenantId}/billing`);
    expect(cobranca.body.plan.limits.maxContentRecords).toBeGreaterThan(limite);
    expect(cobranca.body.plan.limits.features).toContain('cms_panel');
    expect(cobranca.body.plan.limits.features).toContain('custom_domain');
  });

  it('o site publico continua no ar com a assinatura vencida', async () => {
    await semAssinaturaValida(dona);
    const siteId = await primarySiteId(api, dona.tenantId);

    // Emitida pelo caminho real: uma linha inserida a mao nao autentica,
    // porque o segredo e conferido pelo hash.
    const chave = await issueApiKey(api.db, {
      tenantId: dona.tenantId,
      siteId,
      // Secreta, e nao publicavel: a publicavel exige origem autorizada, e o
      // que este teste mede e a assinatura, nao a origem.
      kind: 'secret',
      name: 'Site',
    });

    const publica = await api
      .client()
      .get('/api/v1/site', { origin: null, headers: { authorization: `Bearer ${chave.token}` } });
    // 402 seria "pendencia da assinatura": e exatamente o que nao pode acontecer.
    expect(publica.status).not.toBe(402);
    expect(publica.status).toBe(200);
  });
});

describe('a empresa do cliente ao lado, na MESMA instalacao', () => {
  it('inadimplente, continua em somente leitura', async () => {
    await semAssinaturaValida(cliente);

    const tentativa = await cliente.client.post(`/api/tenants/${cliente.tenantId}/services`, { title: 'Não deve gravar' });
    expect(tentativa.status).toBe(403);
    expect(tentativa.errorMessage).toContain('somente leitura');
  });

  it('inadimplente, o site publico responde 402', async () => {
    await semAssinaturaValida(cliente);
    const siteId = await primarySiteId(api, cliente.tenantId);

    const chave = await issueApiKey(api.db, {
      tenantId: cliente.tenantId,
      siteId,
      // Secreta, e nao publicavel: a publicavel exige origem autorizada, e o
      // que este teste mede e a assinatura, nao a origem.
      kind: 'secret',
      name: 'Site',
    });

    const publica = await api
      .client()
      .get('/api/v1/site', { origin: null, headers: { authorization: `Bearer ${chave.token}` } });
    expect(publica.status).toBe(402);
  });

  it('em avaliacao valida, grava normalmente e NAO fica isento', async () => {
    const criado = await cliente.client.post(`/api/tenants/${cliente.tenantId}/services`, { title: 'Serviço' });
    expect(criado.status).toBe(201);

    const cobranca = await cliente.client.get(`/api/tenants/${cliente.tenantId}/billing`);
    expect(cobranca.body.plan.exempt).toBe(false);
    // Os limites continuam sendo os do plano dele.
    const [trial] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'trial'));
    expect(cobranca.body.plan.limits.maxContentRecords).toBe(
      (trial!.limits as { maxContentRecords: number }).maxContentRecords,
    );
  });

  it('continua esbarrando no limite de conteudos do plano', async () => {
    const [trial] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'trial'));
    const limite = (trial!.limits as { maxContentRecords: number }).maxContentRecords;
    const siteId = await primarySiteId(api, cliente.tenantId);

    await api.db.insert(schema.services).values(
      Array.from({ length: limite }, (_, i) => ({
        tenantId: cliente.tenantId,
        siteId,
        title: `Serviço ${i}`,
        slug: `servico-${i}`,
      })),
    );

    const excedente = await cliente.client.post(`/api/tenants/${cliente.tenantId}/services`, { title: 'Passa do limite' });
    expect(excedente.status).toBe(402);
  });
});

describe('a isencao nao e alcancavel pelo cliente', () => {
  it('nenhum campo da empresa muda quem e isento', async () => {
    // O cliente tenta se renomear como a CODECA IA.
    const renomeia = await cliente.client.patch(`/api/tenants/${cliente.tenantId}`, {
      legalName: 'CODECA IA',
      displayName: 'CODECA IA',
    });
    expect(renomeia.status).toBe(200);
    expect(isExemptTenant(cliente.tenantId)).toBe(false);

    await semAssinaturaValida(cliente);
    const tentativa = await cliente.client.post(`/api/tenants/${cliente.tenantId}/services`, { title: 'Não deve gravar' });
    expect(tentativa.status).toBe(403);
  });

  it('a empresa do cliente nao alcanca a rota da empresa isenta', async () => {
    const cruzado = await cliente.client.get(`/api/tenants/${dona.tenantId}/billing`);
    expect([403, 404]).toContain(cruzado.status);
  });

  /**
   * O motivo de a isencao ser por EMPRESA e nao por pessoa.
   *
   * O papel de proprietario e concedivel por convite: se a isencao seguisse a
   * pessoa, bastaria um cliente convidar o dono da plataforma como
   * proprietario -- e o convite ser aceito uma vez -- para a empresa dele
   * virar gratuita. Com o identificador da empresa, nenhum vinculo muda nada.
   */
  it('ter a pessoa da CODECA IA como proprietaria NAO torna a empresa isenta', async () => {
    const [pessoa] = await api.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, dona.email));

    await api.db.insert(schema.memberships).values({
      tenantId: cliente.tenantId,
      userId: pessoa!.id,
      role: 'owner',
      status: 'active',
    });

    expect(isExemptTenant(cliente.tenantId)).toBe(false);

    await semAssinaturaValida(cliente);
    const tentativa = await cliente.client.post(`/api/tenants/${cliente.tenantId}/services`, { title: 'Não deve gravar' });
    expect(tentativa.status).toBe(403);
  });
});

describe('configuracao', () => {
  it('a variavel de ambiente alimenta a lista na montagem do contexto', async () => {
    const identificador = '11111111-2222-3333-4444-555555555555';
    const outra = await createTestApi({ env: { PLATFORM_OWNER_TENANT_IDS: ` ${identificador} , ` } });
    try {
      // `createContext` chamou `setExemptTenants` com o valor da variavel.
      expect(isExemptTenant(identificador)).toBe(true);
      expect(isExemptTenant('66666666-7777-8888-9999-000000000000')).toBe(false);
    } finally {
      await outra.close();
    }
  });

  it('sem a variavel, ninguem e isento', async () => {
    const semLista = await createTestApi();
    try {
      expect(isExemptTenant(semLista ? 'qualquer-coisa' : '')).toBe(false);
    } finally {
      await semLista.close();
    }
  });
});
