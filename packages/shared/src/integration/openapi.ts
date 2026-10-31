import { z } from 'zod';
import { DOCUMENT_SCHEMAS } from '../modules/documents.js';
import { API_KEY_SCOPES } from './keys.js';
import {
  publicListQuerySchema,
  publicProductQuerySchema,
  publicProjectQuerySchema,
  publicPropertyQuerySchema,
} from './public-queries.js';
import {
  leadReceivedSchema,
  publicBannerSchema,
  publicCategorySchema,
  publicFaqSchema,
  publicGallerySchema,
  publicGallerySummarySchema,
  publicImageSchema,
  publicPageSchema,
  publicProductSchema,
  publicProjectSchema,
  publicPropertySchema,
  publicSeoSchema,
  publicServiceSchema,
  publicTeamMemberSchema,
  publicTestimonialSchema,
  siteInfoSchema,
} from './public-schemas.js';
import { publicLeadSchema } from '../validators/lead.js';

/**
 * Documento OpenAPI de `/api/v1`, **gerado**.
 *
 * Escrever YAML a mao seria mais rapido hoje e estaria mentindo em tres meses.
 * Aqui o documento nasce dos mesmos schemas Zod que a API usa em tempo de
 * execucao: o filtro descrito e o filtro validado, e a forma documentada e a
 * forma que `tests/types/openapi-contract.types.ts` prova ser a entregue.
 *
 * Fica fora o que o painel usa (`/api/tenants/...`). Nao e esquecimento: o
 * painel e cliente do mesmo repositorio, tipado pelo TypeScript, e documentar
 * setenta rotas internas em OpenAPI daria trabalho de manutencao sem leitor.
 * O leitor deste documento e quem integra um site -- e isso e `/api/v1`.
 *
 * Cobertura nao e promessa: `tests/integration/openapi.test.ts` compara o
 * documento com a tabela de rotas do proprio Hono e falha se uma rota existir
 * sem estar descrita.
 */

export const OPENAPI_VERSION = '3.1.0';
export const PUBLIC_API_VERSION = 'v1';

/** Nome do componente de cada schema reaproveitado. */
const COMPONENTES = {
  PublicImage: publicImageSchema,
  PublicSeo: publicSeoSchema,
  PublicProperty: publicPropertySchema,
  PublicProject: publicProjectSchema,
  PublicService: publicServiceSchema,
  PublicBanner: publicBannerSchema,
  PublicCategory: publicCategorySchema,
  PublicProduct: publicProductSchema,
  PublicGallerySummary: publicGallerySummarySchema,
  PublicGallery: publicGallerySchema,
  PublicTestimonial: publicTestimonialSchema,
  PublicTeamMember: publicTeamMemberSchema,
  PublicFaq: publicFaqSchema,
  SiteInfo: siteInfoSchema,
  InstitutionalContent: DOCUMENT_SCHEMAS.institucional,
  ContactContent: DOCUMENT_SCHEMAS.contato,
  LeadInput: publicLeadSchema,
  LeadReceived: leadReceivedSchema,
} as const;

type ComponenteNome = keyof typeof COMPONENTES;

const ref = (nome: ComponenteNome) => ({ $ref: `#/components/schemas/${nome}` });

/** Envelope de um recurso unico: `{ property: ... }`, `{ gallery: ... }`. */
const envelope = (chave: string, nome: ComponenteNome) => ({
  type: 'object',
  properties: { [chave]: ref(nome) },
  required: [chave],
});

/** Envelope de lista sem paginacao: `{ items: [...] }`. */
const itens = (nome: ComponenteNome) => ({
  type: 'object',
  properties: { items: { type: 'array', items: ref(nome) } },
  required: ['items'],
});

/** Envelope de lista paginada. */
const pagina = (nome: ComponenteNome) => ({
  type: 'object',
  properties: {
    items: { type: 'array', items: ref(nome) },
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
    total: { type: 'integer' },
    totalPages: { type: 'integer' },
  },
  required: ['items', 'page', 'pageSize', 'total', 'totalPages'],
});

interface RotaDescrita {
  method: 'get' | 'post';
  /** Caminho no formato OpenAPI, com `{slug}` em vez de `:slug`. */
  path: string;
  summary: string;
  description?: string;
  /** Schema de onde saem os parametros de consulta. */
  query?: z.ZodObject;
  /** Parametros de caminho, em ordem. */
  params?: Array<{ name: string; description: string }>;
  body?: ComponenteNome;
  response: unknown;
  /** Escopo exigido da chave. */
  scope: (typeof API_KEY_SCOPES)[number];
  /** Modulo que precisa estar habilitado no site, quando houver. */
  module?: string;
}

const ROTAS: readonly RotaDescrita[] = [
  {
    method: 'get',
    path: '/site',
    summary: 'Identidade do site, modulos habilitados e escopos da chave',
    description:
      'Primeira chamada de qualquer integracao: confirma que a chave vale, diz '
      + 'quais modulos este site tem e traz o aviso de pendencia, se houver.',
    response: ref('SiteInfo'),
    scope: 'content:read',
  },
  {
    method: 'get',
    path: '/content/{moduleKey}',
    summary: 'Documento de instancia unica',
    description:
      'Modulos de documento: `institucional` e `contato`. A forma de `data` '
      + 'depende do modulo pedido.',
    params: [{ name: 'moduleKey', description: '`institucional` ou `contato`.' }],
    response: {
      type: 'object',
      properties: {
        data: { oneOf: [ref('InstitutionalContent'), ref('ContactContent')] },
      },
      required: ['data'],
    },
    scope: 'content:read',
  },
  {
    method: 'get',
    path: '/banners',
    summary: 'Banners ativos',
    description:
      'Ja filtrados pela janela de exibicao: um banner programado para a '
      + 'semana que vem simplesmente nao vem. O site nao precisa conhecer a regra.',
    response: itens('PublicBanner'),
    scope: 'content:read',
    module: 'banners',
  },
  {
    method: 'get',
    path: '/properties',
    summary: 'Imoveis publicados',
    query: publicPropertyQuerySchema,
    response: pagina('PublicProperty'),
    scope: 'content:read',
    module: 'imoveis',
  },
  {
    method: 'get',
    path: '/properties/{slug}',
    summary: 'Um imovel, com a galeria completa',
    params: [{ name: 'slug', description: 'Endereco do imovel na URL.' }],
    query: publicListQuerySchema,
    response: envelope('property', 'PublicProperty'),
    scope: 'content:read',
    module: 'imoveis',
  },
  {
    method: 'get',
    path: '/projects',
    summary: 'Obras publicadas',
    query: publicProjectQuerySchema,
    response: pagina('PublicProject'),
    scope: 'content:read',
    module: 'obras',
  },
  {
    method: 'get',
    path: '/projects/{slug}',
    summary: 'Uma obra, com a galeria completa',
    params: [{ name: 'slug', description: 'Endereco da obra na URL.' }],
    query: publicListQuerySchema,
    response: envelope('project', 'PublicProject'),
    scope: 'content:read',
    module: 'obras',
  },
  {
    method: 'get',
    path: '/services',
    summary: 'Servicos publicados',
    query: publicListQuerySchema,
    response: pagina('PublicService'),
    scope: 'content:read',
    module: 'servicos',
  },
  {
    method: 'get',
    path: '/products',
    summary: 'Produtos publicados',
    description:
      'O esgotado vem junto, com `isAvailable: false` -- use `availableOnly` '
      + 'para nao receber. `gallery` vem vazia aqui.',
    query: publicProductQuerySchema,
    response: pagina('PublicProduct'),
    scope: 'content:read',
    module: 'produtos',
  },
  {
    method: 'get',
    path: '/products/{slug}',
    summary: 'Um produto, com a galeria completa',
    params: [{ name: 'slug', description: 'Endereco do produto na URL.' }],
    query: publicListQuerySchema,
    response: envelope('product', 'PublicProduct'),
    scope: 'content:read',
    module: 'produtos',
  },
  {
    method: 'get',
    path: '/categories',
    summary: 'Categorias de produto',
    description: 'Sem paginacao: um menu de agrupamentos tem dezenas de itens, nao milhares.',
    query: publicListQuerySchema,
    response: itens('PublicCategory'),
    scope: 'content:read',
    module: 'categorias',
  },
  {
    method: 'get',
    path: '/galleries',
    summary: 'Galerias, com capa e contagem',
    description:
      'Sem as imagens: uma galeria pode ter duzentas. Use '
      + '`GET /api/v1/galleries/{slug}` para o conjunto.',
    query: publicListQuerySchema,
    response: pagina('PublicGallerySummary'),
    scope: 'content:read',
    module: 'galerias',
  },
  {
    method: 'get',
    path: '/galleries/{slug}',
    summary: 'Uma galeria, com as imagens na ordem do cliente',
    params: [{ name: 'slug', description: 'Endereco da galeria na URL.' }],
    query: publicListQuerySchema,
    response: envelope('gallery', 'PublicGallery'),
    scope: 'content:read',
    module: 'galerias',
  },
  {
    method: 'get',
    path: '/testimonials',
    summary: 'Depoimentos autorizados pelo autor',
    description:
      'A plataforma **nao** devolve depoimento sem a confirmacao de que o autor '
      + 'autorizou a publicacao, nem com `preview=true`. Nao ha nada a conferir '
      + 'no site: o que chega pode ser exibido.',
    query: publicListQuerySchema,
    response: pagina('PublicTestimonial'),
    scope: 'content:read',
    module: 'depoimentos',
  },
  {
    method: 'get',
    path: '/team',
    summary: 'Equipe exibida no site',
    query: publicListQuerySchema,
    response: pagina('PublicTeamMember'),
    scope: 'content:read',
    module: 'equipe',
  },
  {
    method: 'get',
    path: '/faqs',
    summary: 'Perguntas frequentes publicadas',
    query: publicListQuerySchema,
    response: pagina('PublicFaq'),
    scope: 'content:read',
    module: 'faq',
  },
  {
    method: 'post',
    path: '/leads',
    summary: 'Recebe o formulario de contato',
    description:
      'Unica escrita aceita com chave publicavel, porque o formulario roda no '
      + 'navegador do visitante e nao ha segredo a guardar. A protecao vem da '
      + 'origem autorizada, do limite por IP e do campo-armadilha `honeypot`. '
      + 'A resposta e so a confirmacao: quem envia nao le de volta.',
    body: 'LeadInput',
    response: ref('LeadReceived'),
    scope: 'leads:write',
  },
];

/** Caminhos de `/api/v1` descritos aqui, no formato do Hono (`:slug`). */
export function documentedPublicPaths(): string[] {
  return ROTAS.map(
    (rota) => `/api/v1${rota.path.replace(/\{(\w+)\}/g, ':$1')}`,
  );
}

/** Parametros de consulta a partir do schema que a rota realmente valida. */
function parametrosDeConsulta(schema: z.ZodObject): unknown[] {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const obrigatorios = new Set(json.required ?? []);

  return Object.entries(json.properties ?? {}).map(([nome, forma]) => {
    const { description, ...resto } = forma;
    return {
      name: nome,
      in: 'query',
      required: obrigatorios.has(nome),
      ...(typeof description === 'string' ? { description } : {}),
      schema: resto,
    };
  });
}

export interface OpenApiOptions {
  /** Endereco da plataforma, sem barra no fim. */
  baseUrl: string;
  /** Versao do pacote, para o cabecalho do documento. */
  version?: string;
}

export function buildOpenApiDocument(options: OpenApiOptions): Record<string, unknown> {
  const registry = z.registry<{ id: string }>();
  for (const [nome, schema] of Object.entries(COMPONENTES)) {
    registry.add(schema as z.ZodType, { id: nome });
  }

  const gerado = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    io: 'output',
    uri: (id) => `#/components/schemas/${id}`,
  }) as { schemas: Record<string, Record<string, unknown>> };

  // `$schema` e `$id` por componente nao pertencem ao documento: o OpenAPI 3.1
  // ja declara o dialeto no topo, e o `$id` relativo confunde gerador de
  // cliente.
  const schemas: Record<string, unknown> = {};
  for (const [nome, forma] of Object.entries(gerado.schemas)) {
    const { $schema: _schema, $id: _id, ...resto } = forma;
    schemas[nome] = resto;
  }

  const paths: Record<string, Record<string, unknown>> = {};
  for (const rota of ROTAS) {
    const caminho = `/api/v1${rota.path}`;
    paths[caminho] ??= {};

    const parametros = [
      ...(rota.params ?? []).map((param) => ({
        name: param.name,
        in: 'path',
        required: true,
        description: param.description,
        schema: { type: 'string' },
      })),
      ...(rota.query ? parametrosDeConsulta(rota.query) : []),
    ];

    paths[caminho][rota.method] = {
      summary: rota.summary,
      ...(rota.description ? { description: rota.description } : {}),
      operationId: operationId(rota),
      tags: [rota.module ?? 'site'],
      ...(parametros.length > 0 ? { parameters: parametros } : {}),
      ...(rota.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: ref(rota.body) } },
            },
          }
        : {}),
      responses: {
        [rota.method === 'post' ? '201' : '200']: {
          description: 'Sucesso.',
          content: { 'application/json': { schema: rota.response } },
        },
        '401': { description: 'Chave ausente, invalida ou revogada.' },
        '402': {
          description:
            'Assinatura com pendencia e o plano do site manda parar de responder. '
            + 'Nada foi apagado.',
        },
        '403': {
          description:
            rota.scope === 'content:read'
              ? 'A chave nao tem o escopo necessario, ou pediu `preview` sem `content:draft`.'
              : 'A chave nao tem o escopo necessario.',
        },
        '404': {
          description: rota.module
            ? `Este site nao tem o modulo \`${rota.module}\` habilitado, ou o registro nao existe.`
            : 'Registro nao encontrado.',
        },
        '429': { description: 'Limite de requisicoes da chave excedido.' },
      },
      security: [{ ApiKey: [] }],
    };
  }

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'CODECA Build - API publica',
      version: options.version ?? '1.0.0',
      description:
        'Conteudo dos sites desenvolvidos pela CODECA IA. Autenticada por chave '
        + 'de integracao do site: a **publicavel** (`cb_pub_...`) le o publicado e '
        + 'pode enviar o formulario de contato; a **secreta** (`cb_sec_...`) le '
        + 'tambem rascunho e previa e nunca deve ir para o navegador.\n\n'
        + 'Dado de interessado nao sai por nenhuma rota: nome, telefone e e-mail '
        + 'ficam atras do painel autenticado.\n\n'
        + 'Este documento e gerado dos mesmos schemas que a API usa para validar, '
        + 'e um teste compara a cobertura com a tabela de rotas do servidor.',
    },
    servers: [{ url: options.baseUrl }],
    tags: [
      { name: 'site', description: 'Identidade do site e documentos de instancia unica.' },
      { name: 'banners', description: 'Destaques da abertura.' },
      { name: 'imoveis', description: 'Carteira de imoveis.' },
      { name: 'obras', description: 'Obras e projetos.' },
      { name: 'servicos', description: 'Servicos oferecidos.' },
      { name: 'produtos', description: 'Catalogo, cardapio ou lista de itens.' },
      { name: 'categorias', description: 'Agrupamento dos produtos.' },
      { name: 'galerias', description: 'Conjuntos de imagens.' },
      { name: 'depoimentos', description: 'Depoimentos autorizados pelo autor.' },
      { name: 'equipe', description: 'Pessoas exibidas no site.' },
      { name: 'faq', description: 'Perguntas frequentes.' },
    ],
    paths,
    components: {
      schemas,
      securitySchemes: {
        ApiKey: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Chave de integracao do site no cabecalho `Authorization: Bearer <chave>`.',
        },
      },
    },
  };
}

function operationId(rota: RotaDescrita): string {
  const partes = rota.path
    .replace(/[{}]/g, '')
    .split('/')
    .filter(Boolean)
    .map((parte, indice) => (indice === 0 ? parte : parte[0]!.toUpperCase() + parte.slice(1)));
  return `${rota.method}${partes.join('').replace(/^./, (c) => c.toUpperCase())}`;
}
