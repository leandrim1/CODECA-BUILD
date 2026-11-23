import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * A imagem gravada precisa VOLTAR com a URL.
 *
 * O defeito que estes testes travam apareceu em producao: o cliente escolhia
 * um logotipo, salvava, e a tela continuava mostrando a moldura vazia -- com o
 * botao "Remover" ao lado, porque o id estava gravado. A rota devolvia so o
 * id, e o painel nao tem como transformar id em endereco.
 *
 * O tipo do painel ja prometia `image` nos banners; a rota nunca mandou. O
 * TypeScript nao pega isso porque a resposta e tipada a mao do lado do
 * navegador -- entao o teste e o unico lugar onde essa promessa vale.
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
  conta = await registerAccount(api, {
    email: 'dona@clinica.com.br',
    companyName: 'Clinica Exemplo',
  });
  await verifyEmail(api, conta);
});

/** Uma imagem na biblioteca da empresa. */
async function imagem(nome = 'logotipo.webp') {
  const [asset] = await api.db
    .insert(schema.mediaAssets)
    .values({
      tenantId: conta.tenantId,
      siteId: conta.siteId,
      blobUrl: `https://blob.test/${nome}`,
      blobPathname: `tenants/${conta.tenantId}/${nome}`,
      fileName: nome,
      mimeType: 'image/webp',
      sizeBytes: 2048,
      width: 320,
      height: 120,
      alt: 'Logotipo da clinica',
    })
    .returning();
  return asset!;
}

/** O modulo precisa estar habilitado para o site responder. */
async function habilitar(moduleKey: string) {
  await api.db
    .insert(schema.siteModules)
    .values({
      tenantId: conta.tenantId,
      siteId: conta.siteId,
      moduleKey,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [schema.siteModules.siteId, schema.siteModules.moduleKey],
      set: { enabled: true },
    });
}

describe('documento de instancia unica', () => {
  it('devolve a imagem do campo de imagem, com a URL', async () => {
    const asset = await imagem();
    await habilitar('institucional');

    const salvou = await conta.client.put(
      `/api/tenants/${conta.tenantId}/modules/institucional/document`,
      { companyName: 'Clinica Exemplo', logoImageId: asset.id },
    );
    expect(salvou.status, salvou.errorMessage ?? '').toBe(200);

    const lido = await conta.client.get(
      `/api/tenants/${conta.tenantId}/modules/institucional/document`,
    );
    expect(lido.status, lido.errorMessage ?? '').toBe(200);
    expect(lido.body.data.logoImageId).toBe(asset.id);

    // O que faltava: sem isto a tela so tem o id, e desenha a moldura vazia.
    expect(lido.body.images[asset.id]).toMatchObject({
      id: asset.id,
      url: 'https://blob.test/logotipo.webp',
      alt: 'Logotipo da clinica',
      width: 320,
      height: 120,
    });
  });

  it('documento sem imagem nenhuma devolve o mapa vazio, nao ausente', async () => {
    await habilitar('institucional');

    const lido = await conta.client.get(
      `/api/tenants/${conta.tenantId}/modules/institucional/document`,
    );
    // Vazio e diferente de ausente: a tela faz `images[id]` sem conferir.
    expect(lido.body.images).toEqual({});
  });

  it('nao devolve imagem de outra empresa, nem com o id na mao', async () => {
    const outra = await registerAccount(api, {
      email: 'dono@vizinha.com.br',
      companyName: 'Empresa Vizinha',
    });
    await verifyEmail(api, outra);
    const [alheia] = await api.db
      .insert(schema.mediaAssets)
      .values({
        tenantId: outra.tenantId,
        siteId: outra.siteId,
        blobUrl: 'https://blob.test/alheia.webp',
        blobPathname: `tenants/${outra.tenantId}/alheia.webp`,
        fileName: 'alheia.webp',
        mimeType: 'image/webp',
        sizeBytes: 10,
      })
      .returning();

    await habilitar('institucional');
    // Gravar o id alheio e recusado na entrada; aqui o que se verifica e que,
    // mesmo se um id desses chegasse ao documento, a leitura nao o resolve.
    // Upsert: o cadastro ja cria o institucional do site de demonstracao, e
    // um insert puro bateria no indice unico (site, modulo).
    await api.db
      .insert(schema.contentDocuments)
      .values({
        tenantId: conta.tenantId,
        siteId: conta.siteId,
        moduleKey: 'institucional',
        data: { companyName: 'Clinica Exemplo', logoImageId: alheia!.id },
      })
      .onConflictDoUpdate({
        target: [schema.contentDocuments.siteId, schema.contentDocuments.moduleKey],
        set: { data: { companyName: 'Clinica Exemplo', logoImageId: alheia!.id } },
      });

    const lido = await conta.client.get(
      `/api/tenants/${conta.tenantId}/modules/institucional/document`,
    );
    expect(lido.body.images[alheia!.id]).toBeUndefined();
  });
});

describe('banners', () => {
  it('a listagem devolve a imagem resolvida', async () => {
    const asset = await imagem('banner.webp');
    await habilitar('banners');

    const criado = await conta.client.post(`/api/tenants/${conta.tenantId}/banners`, {
      title: 'Abertura',
      subtitle: '',
      imageId: asset.id,
      buttonLabel: '',
      buttonUrl: '',
      sortOrder: 0,
      isActive: true,
    });
    expect(criado.status, criado.errorMessage ?? '').toBe(201);
    // Tambem na resposta da criacao: a tela usa o registro devolvido.
    expect(criado.body.banner.image?.url).toBe('https://blob.test/banner.webp');

    const lista = await conta.client.get(`/api/tenants/${conta.tenantId}/banners`);
    expect(lista.status, lista.errorMessage ?? '').toBe(200);
    expect(lista.body.items[0].imageId).toBe(asset.id);
    expect(lista.body.items[0].image).toMatchObject({
      id: asset.id,
      url: 'https://blob.test/banner.webp',
    });
  });

  it('banner sem imagem devolve `image: null`, e nao o campo faltando', async () => {
    await habilitar('banners');
    const criado = await conta.client.post(`/api/tenants/${conta.tenantId}/banners`, {
      title: 'Sem imagem',
      subtitle: '',
      imageId: null,
      buttonLabel: '',
      buttonUrl: '',
      sortOrder: 0,
      isActive: true,
    });
    expect(criado.status, criado.errorMessage ?? '').toBe(201);

    const lista = await conta.client.get(`/api/tenants/${conta.tenantId}/banners`);
    expect(lista.body.items[0]).toHaveProperty('image');
    expect(lista.body.items[0].image).toBeNull();
  });

  it('trocar a imagem devolve a nova na mesma resposta', async () => {
    const primeira = await imagem('primeira.webp');
    const segunda = await imagem('segunda.webp');
    await habilitar('banners');

    const criado = await conta.client.post(`/api/tenants/${conta.tenantId}/banners`, {
      title: 'Abertura',
      subtitle: '',
      imageId: primeira.id,
      buttonLabel: '',
      buttonUrl: '',
      sortOrder: 0,
      isActive: true,
    });
    const bannerId = criado.body.banner.id as string;

    // A rota valida o objeto inteiro, e nao um pedaco: e o que a tela manda.
    const trocado = await conta.client.patch(
      `/api/tenants/${conta.tenantId}/banners/${bannerId}`,
      {
        title: 'Abertura',
        subtitle: '',
        imageId: segunda.id,
        buttonLabel: '',
        buttonUrl: '',
        sortOrder: 0,
        isActive: true,
      },
    );
    expect(trocado.status, trocado.errorMessage ?? '').toBe(200);
    expect(trocado.body.banner.image?.url).toBe('https://blob.test/segunda.webp');
  });
});
