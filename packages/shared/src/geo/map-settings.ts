import { z } from 'zod';
import { TILE_PADRAO, TILE_PROVIDER_IDS } from './tiles.js';
import type { NormalizedAddress } from './tipos.js';

/**
 * Como o mapa aparece no site do cliente.
 *
 * Tudo aqui e **apresentacao**, e nenhum campo guarda id, URL ou chave de
 * fornecedor: `estilo` e o id de um preset nosso, e o endereco mora noutro
 * lugar. Trocar de fornecedor nao invalida nada do que esta gravado.
 */

export const ALTURAS_DO_MAPA = ['compacta', 'media', 'grande'] as const;
export const FORMATOS_DO_MAPA = ['cartao', 'largura-total'] as const;
export const POSICOES_DO_ENDERECO = ['lado', 'abaixo', 'oculto'] as const;
export const ICONES_DO_PINO = ['pino', 'loja', 'predio', 'casa'] as const;

/** Altura em pixels de cada opcao, para o painel e o site desenharem igual. */
export const ALTURA_EM_PIXELS: Record<(typeof ALTURAS_DO_MAPA)[number], number> = {
  compacta: 220,
  media: 320,
  grande: 460,
};

export const mapSettingsSchema = z.object({
  /** 1 (mundo) a 19 (rua). 16 mostra o quarteirao. */
  zoom: z.number().int().min(1).max(19).default(16),
  altura: z.enum(ALTURAS_DO_MAPA).default('media'),
  formato: z.enum(FORMATOS_DO_MAPA).default('cartao'),
  /** Id de um preset de `TILE_PROVIDERS`. */
  estilo: z.enum(TILE_PROVIDER_IDS as [string, ...string[]]).default(TILE_PADRAO),
  /**
   * Cor do pino. Vazio = a cor primaria do site, decidida por quem desenha o
   * site; a plataforma nao adivinha a identidade visual dele.
   */
  corDoPino: z.union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).default(''),
  icone: z.enum(ICONES_DO_PINO).default('pino'),
  mostrarControles: z.boolean().default(true),
  mostrarComoChegar: z.boolean().default(true),
  mostrarHorario: z.boolean().default(false),
  posicaoDoEndereco: z.enum(POSICOES_DO_ENDERECO).default('abaixo'),
  /**
   * Carrega o mapa so depois de um clique, mostrando antes um cartao.
   *
   * Existe por causa de ladrilho: site com muito trafego multiplica pedidos a
   * um servico gratuito e de uso compartilhado. Com isto, quem so passa pela
   * pagina nao pede ladrilho nenhum.
   */
  carregarAoClicar: z.boolean().default(false),
  comoChegar: z
    .object({
      google: z.boolean().default(true),
      waze: z.boolean().default(true),
      apple: z.boolean().default(false),
    })
    .default({ google: true, waze: true, apple: false }),
});

export type MapSettings = z.infer<typeof mapSettingsSchema>;

export function mapSettingsPadrao(): MapSettings {
  return mapSettingsSchema.parse({});
}

/**
 * Le configuracao vinda do banco sem nunca falhar.
 *
 * O que estiver corrompido ou desconhecido cai no padrao: um mapa com estilo
 * invalido deve aparecer como o mapa padrao, e nao derrubar a pagina do
 * cliente.
 */
export function lerMapSettings(valor: unknown): MapSettings {
  const resultado = mapSettingsSchema.safeParse(valor ?? {});
  return resultado.success ? resultado.data : mapSettingsPadrao();
}

// ------------------------------------------------------------- como chegar

export interface LinkDeRota {
  id: 'google' | 'waze' | 'apple';
  label: string;
  url: string;
}

/**
 * Links de rota a partir da coordenada.
 *
 * So URL, sem SDK e sem chave -- os tres aplicativos abrem por endereco web, e
 * no celular o sistema manda para o aplicativo instalado. O endereco em texto
 * entra como rotulo onde o formato aceita, para o destino ficar legivel.
 */
export function linksDeRota(
  endereco: Pick<NormalizedAddress, 'lat' | 'lng'> & { rotulo?: string },
  ativos: MapSettings['comoChegar'] = { google: true, waze: true, apple: false },
): LinkDeRota[] {
  const { lat, lng } = endereco;
  if (typeof lat !== 'number' || typeof lng !== 'number') return [];
  const coordenada = `${lat},${lng}`;
  const rotulo = endereco.rotulo ? encodeURIComponent(endereco.rotulo) : '';

  const todos: LinkDeRota[] = [
    {
      id: 'google',
      label: 'Google Maps',
      url: `https://www.google.com/maps/dir/?api=1&destination=${coordenada}`,
    },
    {
      id: 'waze',
      label: 'Waze',
      url: `https://waze.com/ul?ll=${coordenada}&navigate=yes`,
    },
    {
      id: 'apple',
      label: 'Apple Maps',
      url: `https://maps.apple.com/?daddr=${coordenada}${rotulo ? `&q=${rotulo}` : ''}`,
    },
  ];
  return todos.filter((link) => ativos[link.id]);
}
