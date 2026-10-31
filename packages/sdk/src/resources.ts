import { buildQuery, type Transport } from './http.js';
import type {
  ContactContent,
  InstitutionalContent,
  LeadInput,
  ListQuery,
  ProjectQuery,
  PropertyQuery,
  PublicBanner,
  PublicFaq,
  PublicPage,
  PublicProject,
  PublicProperty,
  PublicService,
  PublicTeamMember,
  PublicTestimonial,
  SiteInfo,
} from './types.js';

/**
 * Operacoes disponiveis em ambos os clientes.
 *
 * O que separa o cliente de navegador do de servidor nao e a lista de metodos,
 * e o que a credencial permite: `preview` so passa com chave secreta, e a API
 * recusa com a publicavel.
 */
export function createResources(request: Transport) {
  return {
    site: {
      /** Identidade do site e modulos habilitados. */
      get: () => request<SiteInfo>('/api/v1/site'),
    },

    institutional: {
      get: async () => {
        const resposta = await request<{ data: InstitutionalContent }>('/api/v1/content/institucional');
        return resposta.data;
      },
    },

    contact: {
      get: async () => {
        const resposta = await request<{ data: ContactContent }>('/api/v1/content/contato');
        return resposta.data;
      },
    },

    banners: {
      list: async () => {
        const resposta = await request<{ items: PublicBanner[] }>('/api/v1/banners');
        return resposta.items;
      },
    },

    properties: {
      list: (query: PropertyQuery = {}) =>
        request<PublicPage<PublicProperty>>(`/api/v1/properties${buildQuery({ ...query })}`),
      /** Um imovel pelo endereco na URL, com a galeria completa. */
      get: async (slug: string, query: ListQuery = {}) => {
        const resposta = await request<{ property: PublicProperty }>(
          `/api/v1/properties/${encodeURIComponent(slug)}${buildQuery({ ...query })}`,
        );
        return resposta.property;
      },
    },

    projects: {
      list: (query: ProjectQuery = {}) =>
        request<PublicPage<PublicProject>>(`/api/v1/projects${buildQuery({ ...query })}`),
      get: async (slug: string, query: ListQuery = {}) => {
        const resposta = await request<{ project: PublicProject }>(
          `/api/v1/projects/${encodeURIComponent(slug)}${buildQuery({ ...query })}`,
        );
        return resposta.project;
      },
    },

    services: {
      list: (query: ListQuery = {}) =>
        request<PublicPage<PublicService>>(`/api/v1/services${buildQuery({ ...query })}`),
    },

    testimonials: {
      /**
       * Depoimentos autorizados pelo autor.
       *
       * A plataforma nao devolve depoimento sem autorizacao, entao nao ha o
       * que filtrar aqui -- o que vem pode ir para a tela.
       */
      list: (query: ListQuery = {}) =>
        request<PublicPage<PublicTestimonial>>(`/api/v1/testimonials${buildQuery({ ...query })}`),
    },

    team: {
      list: (query: ListQuery = {}) =>
        request<PublicPage<PublicTeamMember>>(`/api/v1/team${buildQuery({ ...query })}`),
    },

    faqs: {
      list: (query: ListQuery = {}) =>
        request<PublicPage<PublicFaq>>(`/api/v1/faqs${buildQuery({ ...query })}`),
    },

    leads: {
      /**
       * Envia o formulario de contato.
       *
       * Devolve apenas a confirmacao: quem envia nao le de volta. O site nao
       * deve exibir nada do que foi enviado a partir da resposta -- use o que
       * ja tem em maos no formulario.
       */
      create: (input: LeadInput) =>
        request<{ received: boolean }>('/api/v1/leads', { method: 'POST', body: input }),
    },
  };
}

export type CodecaResources = ReturnType<typeof createResources>;
