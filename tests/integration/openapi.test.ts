import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentedPublicPaths } from '@codeca/shared';
import { createTestApi, type TestApi } from '../helpers/api.js';

/**
 * O documento OpenAPI de `/api/v1`.
 *
 * O teste que importa e o de **cobertura**: ele compara o documento com a
 * tabela de rotas do proprio Hono. Sem ele, "a API esta documentada" seria uma
 * afirmacao de hoje -- a proxima rota entraria sem descricao, e quem integra
 * confiaria num documento incompleto sem ter como saber.
 *
 * O resto confere o que um gerador de cliente precisa encontrar, porque e para
 * isso que o documento existe.
 */

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

/** Rotas reais de `/api/v1` registradas no servidor. */
function rotasDoServidor(): string[] {
  const rotas = (api.app as unknown as { routes: Array<{ method: string; path: string }> }).routes;
  return [
    ...new Set(
      rotas
        .filter((rota) => rota.path.startsWith('/api/v1'))
        // `ALL` e `OPTIONS` em `/api/v1/*` sao middleware e preflight, nao
        // rotas de conteudo: nao ha o que documentar neles.
        .filter((rota) => rota.method !== 'ALL' && rota.method !== 'OPTIONS')
        .filter((rota) => !rota.path.endsWith('/*'))
        .map((rota) => rota.path),
    ),
  ].sort();
}

async function documento() {
  const response = await api.client().get('/api/v1/openapi.json');
  expect(response.status, response.errorMessage ?? '').toBe(200);
  return response.body as {
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
    info: { title: string; description: string };
    servers: Array<{ url: string }>;
  };
}

describe('cobertura', () => {
  it('toda rota de /api/v1 registrada no servidor esta descrita', async () => {
    const servidor = rotasDoServidor();
    // O proprio documento nao se descreve: ele nao e conteudo do site.
    const esperadas = servidor.filter((caminho) => caminho !== '/api/v1/openapi.json');
    const descritas = documentedPublicPaths().sort();

    const faltando = esperadas.filter((caminho) => !descritas.includes(caminho));
    expect(faltando, 'rotas sem descricao no OpenAPI').toEqual([]);
  });

  it('nao descreve rota que nao existe', async () => {
    // O outro lado do mesmo cuidado: uma rota removida do servidor e deixada
    // no documento mandaria quem integra chamar um endereco morto.
    const servidor = rotasDoServidor();
    const sobrando = documentedPublicPaths().filter((caminho) => !servidor.includes(caminho));
    expect(sobrando, 'descricoes sem rota correspondente').toEqual([]);
  });

  it('descreve as dezessete rotas de conteudo', async () => {
    // Numero derivado do servidor, nao fixado: o teste acima ja garante a
    // igualdade, e este so confirma que nao sao zero de cada lado.
    const total = rotasDoServidor().filter((c) => c !== '/api/v1/openapi.json').length;
    expect(total).toBeGreaterThan(10);
    expect(Object.keys((await documento()).paths)).toHaveLength(total);
  });
});

describe('forma do documento', () => {
  it('e OpenAPI 3.1 com servidor e seguranca declarados', async () => {
    const doc = await documento();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers[0]!.url).toBeTruthy();
    expect(doc.components.securitySchemes.ApiKey).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('os schemas vem do Zod, com os campos que a API entrega', async () => {
    const doc = await documento();
    const produto = doc.components.schemas.PublicProduct as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(Object.keys(produto.properties)).toEqual(
      expect.arrayContaining(['price', 'priceOnRequest', 'isAvailable', 'category', 'unit']),
    );
    expect(produto.required).toContain('isAvailable');
  });

  it('reaproveita componente em vez de repetir a forma', async () => {
    const doc = await documento();
    const produto = doc.components.schemas.PublicProduct as {
      properties: { cover: { anyOf: Array<{ $ref?: string }> } };
    };
    // `$ref`, e nao a forma inline: um gerador de cliente produz um tipo
    // `PublicImage` reutilizado, nao quatro tipos anonimos iguais.
    expect(produto.properties.cover.anyOf[0]!.$ref).toBe('#/components/schemas/PublicImage');
    expect(doc.components.schemas.PublicImage).toBeDefined();
  });

  it('os filtros descritos sao os que a rota valida', async () => {
    const doc = await documento();
    const imoveis = doc.paths['/api/v1/properties']!.get as {
      parameters: Array<{ name: string; in: string }>;
    };
    const nomes = imoveis.parameters.map((p) => p.name);

    // Vem de `publicPropertyQuerySchema`, o mesmo schema que valida a
    // requisicao: filtro documentado e filtro aceito sao o mesmo.
    expect(nomes).toEqual(
      expect.arrayContaining(['purpose', 'minPrice', 'maxPrice', 'bedrooms', 'page', 'preview']),
    );
    expect(imoveis.parameters.every((p) => p.in === 'query')).toBe(true);
  });

  it('o parametro de caminho e descrito como tal', async () => {
    const doc = await documento();
    const detalhe = doc.paths['/api/v1/products/{slug}']!.get as {
      parameters: Array<{ name: string; in: string; required: boolean }>;
    };
    const slug = detalhe.parameters.find((p) => p.name === 'slug');
    expect(slug).toMatchObject({ in: 'path', required: true });
  });

  it('o corpo do formulario de contato esta descrito', async () => {
    const doc = await documento();
    const leads = doc.paths['/api/v1/leads']!.post as {
      requestBody: { content: { 'application/json': { schema: { $ref: string } } } };
      responses: Record<string, unknown>;
    };
    expect(leads.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/LeadInput',
    );
    expect(leads.responses['201']).toBeDefined();
  });

  it('cada rota declara as recusas que o site vai encontrar', async () => {
    const doc = await documento();
    for (const [caminho, operacoes] of Object.entries(doc.paths)) {
      for (const [metodo, operacao] of Object.entries(operacoes)) {
        const respostas = (operacao as { responses: Record<string, unknown> }).responses;
        // 402 entra em todas porque a politica de suspensao pode parar
        // qualquer rota de conteudo, e quem integra precisa distinguir isso
        // de erro de credencial.
        for (const codigo of ['401', '402', '403', '404', '429']) {
          expect(respostas[codigo], `${metodo.toUpperCase()} ${caminho} sem ${codigo}`).toBeDefined();
        }
      }
    }
  });

  it('toda referencia aponta para um componente que existe', async () => {
    // A falha realista de um documento montado a mao: um `$ref` com nome
    // errado. Nenhuma ferramenta reclama na hora -- o gerador de cliente
    // falha depois, na maquina de quem integra. Aqui nao ha validador formal
    // de OpenAPI (seria uma dependencia nova); esta verificacao cobre a
    // classe de erro que de fato acontece.
    const doc = await documento();
    const definidos = new Set(Object.keys(doc.components.schemas));
    const referenciados: string[] = [];

    const andar = (valor: unknown): void => {
      if (Array.isArray(valor)) {
        valor.forEach(andar);
        return;
      }
      if (valor === null || typeof valor !== 'object') return;
      for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
        if (chave === '$ref' && typeof item === 'string') referenciados.push(item);
        else andar(item);
      }
    };
    andar(doc);

    expect(referenciados.length).toBeGreaterThan(10);
    const quebrados = referenciados.filter(
      (ref) => !definidos.has(ref.replace('#/components/schemas/', '')),
    );
    expect(quebrados, 'referencias sem componente').toEqual([]);
  });

  it('nenhum componente fica orfao', async () => {
    // O outro lado: um componente que ninguem referencia e peso morto no
    // documento, e normalmente sinal de rota removida pela metade.
    const doc = await documento();
    const referenciados = new Set<string>();
    const andar = (valor: unknown): void => {
      if (Array.isArray(valor)) {
        valor.forEach(andar);
        return;
      }
      if (valor === null || typeof valor !== 'object') return;
      for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
        if (chave === '$ref' && typeof item === 'string') {
          referenciados.add(item.replace('#/components/schemas/', ''));
        } else andar(item);
      }
    };
    andar(doc.paths);
    andar(doc.components.schemas);

    const orfaos = Object.keys(doc.components.schemas).filter((nome) => !referenciados.has(nome));
    expect(orfaos, 'componentes que ninguem referencia').toEqual([]);
  });

  it('a descricao avisa que dado de interessado nao sai', async () => {
    const doc = await documento();
    expect(doc.info.description).toMatch(/interessado/i);
    expect(doc.info.description).toMatch(/cb_pub_/);
    expect(doc.info.description).toMatch(/cb_sec_/);
  });
});

describe('acesso ao documento', () => {
  it('responde sem chave de integracao', async () => {
    // Quem esta comecando a integrar aponta um gerador de cliente para a URL
    // antes de ter chave. Exigir credencial aqui atrapalharia exatamente o
    // leitor que o documento serve.
    const response = await api.client().get('/api/v1/openapi.json');
    expect(response.status).toBe(200);
  });

  it('nao vaza nada de empresa nenhuma', async () => {
    const corpo = JSON.stringify(await documento());

    // O prefixo aparece na descricao de proposito (`cb_sec_...`), entao o que
    // se procura e uma chave **de verdade**: prefixo seguido de entropia.
    expect(corpo).not.toMatch(/cb_(pub|sec)_[A-Za-z0-9_-]{8,}/);
    expect(corpo).not.toMatch(/\bcb_whsec_/);
    // Campo interno e dado pessoal: o documento descreve so o que e publico.
    expect(corpo).not.toMatch(/"tenantId"/);
    expect(corpo).not.toMatch(/"siteId"/);
    expect(corpo).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
