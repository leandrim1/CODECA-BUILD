import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  registerAccount,
  seedPlatformAdmin,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Direitos do titular: levar os dados embora, e mandar apagar.
 *
 * A LGPD garante portabilidade (art. 18, V) e eliminacao (art. 18, VI). Ate
 * aqui a plataforma atendia os dois a mao, pelo canal de contato -- o que nao
 * escala e deixa o prazo legal na memoria de alguem.
 *
 * ## O que estes testes protegem, em ordem de gravidade
 *
 * 1. **A exclusao nao atravessa a parede entre empresas.** Apagar uma nao pode
 *    encostar na outra. E a unica falha aqui que seria irreversivel.
 * 2. **Os arquivos saem do armazenamento.** Imagem de cliente excluido numa URL
 *    publica que ninguem mais controla e vazamento, nao sobra.
 * 3. **Fica prova de quem pediu.** O registro da exclusao sobrevive a propria
 *    exclusao, porque e gravado fora do escopo da empresa.
 * 4. **Nao se apaga por engano.** Nome exato da empresa e senha de quem pede.
 * 5. **A exportacao nao vira chave da conta.** Nem hash de senha, nem segredo
 *    de chave de integracao.
 */

let api: TestApi;
let dona: RegisteredAccount;
let vizinha: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  // A primeira conta da instalacao viraria administradora da plataforma; a
  // semente ocupa esse lugar para as contas abaixo serem clientes comuns.
  await seedPlatformAdmin(api);

  dona = await registerAccount(api, { email: 'marina@agencia.com.br', companyName: 'Agência Norte' });
  await verifyEmail(api, dona);
  vizinha = await registerAccount(api, { email: 'contato@vizinha.com.br', companyName: 'Empresa Vizinha' });
  await verifyEmail(api, vizinha);
});

const base = (conta: RegisteredAccount) => `/api/tenants/${conta.tenantId}`;

/** Um site com conteudo, imagem e interessado, como o de um cliente de verdade. */
async function povoar(conta: RegisteredAccount, marca: string): Promise<{ blobUrl: string }> {
  const site = { id: conta.siteId };

  // O documento institucional ja nasce com o site; aqui ele so recebe conteudo.
  await api.db
    .insert(schema.contentDocuments)
    .values({
      tenantId: conta.tenantId,
      siteId: site.id,
      moduleKey: 'institucional',
      data: { companyName: marca, shortDescription: `Descrição de ${marca}` },
    })
    .onConflictDoUpdate({
      target: [schema.contentDocuments.siteId, schema.contentDocuments.moduleKey],
      set: { data: { companyName: marca, shortDescription: `Descrição de ${marca}` } },
    });

  const blobUrl = `https://blob.test/tenants/${conta.tenantId}/foto-${marca}.jpg`;
  api.blobFiles.set(blobUrl, {
    url: blobUrl,
    downloadUrl: `${blobUrl}?download=1`,
    pathname: `tenants/${conta.tenantId}/foto-${marca}.jpg`,
    size: 1024,
    contentType: 'image/jpeg',
  });
  await api.db.insert(schema.mediaAssets).values({
    tenantId: conta.tenantId,
    siteId: site.id,
    blobUrl,
    blobPathname: `tenants/${conta.tenantId}/foto-${marca}.jpg`,
    fileName: `foto-${marca}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
  });

  await api.db.insert(schema.leads).values({
    tenantId: conta.tenantId,
    siteId: site.id,
    name: `Interessado de ${marca}`,
    phone: '(41) 98888-7777',
    email: `interessado.${marca}@exemplo.com.br`,
    message: 'Gostaria de um orçamento.',
    consentAt: new Date(),
  });

  return { blobUrl };
}

describe('levar os dados embora', () => {
  it('a proprietária exporta conteúdo, imagens, interessados e equipe', async () => {
    await povoar(dona, 'norte');

    const resposta = await dona.client.get(`${base(dona)}/dados`);
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);

    const corpo = JSON.stringify(resposta.body);
    expect(corpo).toContain('Agência Norte');
    expect(corpo).toContain('interessado.norte@exemplo.com.br');
    expect(resposta.body.imagens).toHaveLength(1);
    expect(resposta.body.pessoas[0].email).toBe('marina@agencia.com.br');
  });

  it('a exportação não carrega segredo nenhum', async () => {
    await povoar(dona, 'norte');
    const resposta = await dona.client.get(`${base(dona)}/dados`);
    const corpo = JSON.stringify(resposta.body);

    // Nem o hash da senha, nem o segredo da chave de integracao.
    expect(corpo).not.toContain('scrypt$');
    expect(corpo).not.toContain('passwordHash');
    expect(corpo).not.toContain('secretHash');
  });

  it('quem não é proprietário não exporta', async () => {
    await api.db
      .update(schema.memberships)
      .set({ role: 'admin' })
      .where(eq(schema.memberships.userId, dona.userId));

    const resposta = await dona.client.get(`${base(dona)}/dados`);
    expect(resposta.status).toBe(403);
  });

  it('uma empresa não exporta os dados da outra', async () => {
    await povoar(vizinha, 'vizinha');
    const resposta = await dona.client.get(`${base(vizinha)}/dados`);
    // 404, e nao 403: a empresa simplesmente nao existe para quem nao e dela.
    expect(resposta.status).toBe(404);
  });
});

describe('mandar apagar', () => {
  const apagar = (conta: RegisteredAccount, corpo: Record<string, unknown>) =>
    conta.client.delete(`${base(conta)}`, corpo);

  it('exige o nome exato da empresa', async () => {
    await povoar(dona, 'norte');

    const errado = await apagar(dona, { confirmacao: 'agencia norte ltda', password: dona.password });
    expect(errado.status).toBe(400);
    expect(errado.errorMessage).toContain('Agência Norte');

    // Nada foi tocado.
    const empresas = await api.db.select().from(schema.tenants).where(eq(schema.tenants.id, dona.tenantId));
    expect(empresas).toHaveLength(1);
  });

  it('exige a senha de quem pede, e não só a sessão aberta', async () => {
    const resposta = await apagar(dona, { confirmacao: 'Agência Norte', password: 'senhaErrada123' });
    expect(resposta.status).toBe(401);

    const empresas = await api.db.select().from(schema.tenants).where(eq(schema.tenants.id, dona.tenantId));
    expect(empresas).toHaveLength(1);
  });

  it('apaga a empresa, o conteúdo, os interessados e os arquivos', async () => {
    const { blobUrl } = await povoar(dona, 'norte');
    expect(api.blobFiles.has(blobUrl)).toBe(true);

    const resposta = await apagar(dona, { confirmacao: 'Agência Norte', password: dona.password });
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
    expect(resposta.body.arquivos.apagados).toBe(1);
    expect(resposta.body.arquivos.falharam).toBe(0);

    // Banco limpo, em cascata.
    expect(await api.db.select().from(schema.tenants).where(eq(schema.tenants.id, dona.tenantId))).toHaveLength(0);
    expect(
      await api.db.select().from(schema.contentDocuments).where(eq(schema.contentDocuments.tenantId, dona.tenantId)),
    ).toHaveLength(0);
    expect(await api.db.select().from(schema.leads).where(eq(schema.leads.tenantId, dona.tenantId))).toHaveLength(0);

    // E o arquivo saiu do armazenamento -- nao ficou numa URL publica orfa.
    expect(api.blobFiles.has(blobUrl)).toBe(false);
  });

  it('apagar uma empresa não encosta na outra', async () => {
    await povoar(dona, 'norte');
    const vizinhaArquivo = await povoar(vizinha, 'vizinha');

    const resposta = await apagar(dona, { confirmacao: 'Agência Norte', password: dona.password });
    expect(resposta.status).toBe(200);

    // A vizinha continua inteira: empresa, conteudo, interessado e arquivo.
    expect(
      await api.db.select().from(schema.tenants).where(eq(schema.tenants.id, vizinha.tenantId)),
    ).toHaveLength(1);
    const docsVizinha = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(eq(schema.contentDocuments.tenantId, vizinha.tenantId));
    expect(JSON.stringify(docsVizinha)).toContain('vizinha');
    expect(await api.db.select().from(schema.leads).where(eq(schema.leads.tenantId, vizinha.tenantId))).toHaveLength(1);
    expect(api.blobFiles.has(vizinhaArquivo.blobUrl)).toBe(true);
    expect((await vizinha.client.get(`${base(vizinha)}`)).status).toBe(200);
  });

  it('fica a prova de quem pediu, e ela sobrevive à exclusão', async () => {
    await povoar(dona, 'norte');
    await apagar(dona, { confirmacao: 'Agência Norte', password: dona.password });

    const registros = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'tenant.deleted'));
    expect(registros).toHaveLength(1);
    // Gravado FORA do escopo da empresa: a cascata nao o levou junto.
    expect(registros[0]!.tenantId).toBeNull();
    expect(registros[0]!.actorEmail).toBe('marina@agencia.com.br');
    expect(registros[0]!.entityId).toBe(dona.tenantId);
    expect((registros[0]!.metadata as Record<string, unknown>).slug).toBeDefined();
  });

  it('a conta de quem ficou sem empresa nenhuma também é removida', async () => {
    await apagar(dona, { confirmacao: 'Agência Norte', password: dona.password });

    const usuarios = await api.db.select().from(schema.users).where(eq(schema.users.id, dona.userId));
    expect(usuarios).toHaveLength(0);
  });

  it('quem ainda tem outra empresa continua com a conta', async () => {
    // A mesma pessoa, vinculada tambem a empresa vizinha.
    await api.db.insert(schema.memberships).values({
      tenantId: vizinha.tenantId,
      userId: dona.userId,
      role: 'admin',
    });

    const resposta = await apagar(dona, { confirmacao: 'Agência Norte', password: dona.password });
    expect(resposta.status).toBe(200);
    expect(resposta.body.contaRemovida).toBe(false);

    const usuarios = await api.db.select().from(schema.users).where(eq(schema.users.id, dona.userId));
    expect(usuarios).toHaveLength(1);
  });

  it('quem não é proprietário não apaga', async () => {
    await api.db
      .update(schema.memberships)
      .set({ role: 'admin' })
      .where(eq(schema.memberships.userId, dona.userId));

    const resposta = await apagar(dona, { confirmacao: 'Agência Norte', password: dona.password });
    expect(resposta.status).toBe(403);
    expect(await api.db.select().from(schema.tenants).where(eq(schema.tenants.id, dona.tenantId))).toHaveLength(1);
  });

  it('o resumo diz o que vai sumir antes de a pessoa confirmar', async () => {
    await povoar(dona, 'norte');
    const resposta = await dona.client.get(`${base(dona)}/exclusao/resumo`);
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
    expect(resposta.body.displayName).toBe('Agência Norte');
    expect(resposta.body.removidos.interessados).toBe(1);
    expect(resposta.body.removidos.imagens).toBe(1);
    expect(resposta.body.removidos.pessoas).toBe(1);
  });
});
