import type { AddressInput } from '../validators/common.js';

/**
 * Contrato do conteudo entregue aos sites dos clientes.
 *
 * E o que o SDK tipa e o que o site consome, entao mudar algo aqui quebra
 * codigo que nao controlamos de perto -- por isso a API e versionada desde a
 * primeira rota.
 *
 * Dois cuidados estao embutidos na forma, e nao na implementacao:
 *
 * - **Nada de dado pessoal.** Nenhum tipo aqui tem nome, telefone ou e-mail de
 *   interessado. Nao e uma regra que alguem precisa lembrar de aplicar: o
 *   formato simplesmente nao tem onde guardar isso.
 * - **Nada de campo interno.** `tenantId`, anotacoes internas e estado de
 *   publicacao ficam de fora. Quem le o site nao precisa saber que a
 *   plataforma existe.
 */

export interface PublicImage {
  id: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/**
 * Endereco publico de um imovel.
 *
 * Respeita `showFullAddress`: com ele desligado, saem apenas bairro, cidade e
 * estado. E uma escolha do cliente sobre o imovel dele, e vale tambem para a
 * API -- nao so para a tela.
 */
export interface PublicAddress {
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
}

export function publicAddress(address: AddressInput): PublicAddress {
  if (address.showFullAddress) {
    return {
      street: address.street,
      number: address.number,
      complement: address.complement,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
    };
  }
  return {
    street: '',
    number: '',
    complement: '',
    neighborhood: address.neighborhood,
    city: address.city,
    state: address.state,
    postalCode: '',
  };
}

export interface PublicSeo {
  title: string;
  description: string;
}

export interface PublicProperty {
  id: string;
  slug: string;
  title: string;
  reference: string;
  description: string;
  shortDescription: string;
  type: string;
  purpose: string;
  /**
   * Preco anunciado, em reais.
   *
   * Numero, e nao centavos: aqui e valor de vitrine, nao calculo financeiro.
   * O que a plataforma **cobra** passa por outro caminho, em centavos
   * inteiros (ver `billing/money.ts`) -- os dois nunca se encontram.
   */
  price: number | null;
  priceOnRequest: boolean;
  condoFee: number | null;
  iptu: number | null;
  currency: string;
  address: PublicAddress;
  builtAreaM2: number | null;
  landAreaM2: number | null;
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parkingSpots: number | null;
  floor: number | null;
  features: string[];
  cover: PublicImage | null;
  gallery: PublicImage[];
  commercialStatus: string;
  featured: boolean;
  deliveryDate: string | null;
  videoUrl: string;
  seo: PublicSeo;
  publishedAt: string | null;
}

export interface PublicProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  shortDescription: string;
  category: string;
  status: string;
  stage: string;
  progressPercent: number | null;
  /** Vazio quando o cliente escolheu nao divulgar a localizacao da obra. */
  city: string;
  state: string;
  neighborhood: string;
  startDate: string | null;
  expectedCompletionDate: string | null;
  completedDate: string | null;
  cover: PublicImage | null;
  gallery: PublicImage[];
  featured: boolean;
  seo: PublicSeo;
  publishedAt: string | null;
}

export interface PublicService {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  icon: string;
  image: PublicImage | null;
  highlights: string[];
  sortOrder: number;
  seo: PublicSeo;
}

export interface PublicBanner {
  id: string;
  title: string;
  subtitle: string;
  image: PublicImage | null;
  buttonLabel: string;
  buttonUrl: string;
  sortOrder: number;
}

export interface PublicPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
