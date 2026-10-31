import type { ModuleKey } from './modules/registry.js';

/**
 * Segmento como o painel mestre o enxerga.
 *
 * `siteCount` acompanha a linha porque a tela precisa dele para decidir o que
 * oferecer: um segmento que nenhum site usa pode ser removido; um que ja
 * organiza projetos so pode ser desativado, senao a remocao desligaria o
 * segmento de sites no ar sem avisar ninguem.
 */
export interface SegmentView {
  id: string;
  code: string;
  name: string;
  description: string;
  defaultModules: ModuleKey[];
  isActive: boolean;
  /** Segmento aplicado a uma empresa recem-cadastrada. No maximo um. */
  isDefault: boolean;
  siteCount: number;
  createdAt: string;
}

/**
 * Segmentos de uma instalacao nova.
 *
 * Sao os tres de onde a plataforma nasceu, e nada no codigo depende deles:
 * existem para que uma instalacao recem-criada tenha um conjunto inicial e um
 * padrao, nao para dizer quais ramos a plataforma atende. A CODECA IA
 * cadastra os demais no painel.
 *
 * Como `ensureBaselinePlans`, so entram **com a tabela vazia**: um segmento
 * removido de proposito nao volta no proximo deploy.
 */
export interface SegmentSeed {
  code: string;
  name: string;
  description: string;
  defaultModules: ModuleKey[];
  isDefault: boolean;
}

export const DEFAULT_SEGMENTS: readonly SegmentSeed[] = [
  {
    code: 'construtora',
    name: 'Construtora',
    description: 'Obras, imoveis e institucional.',
    defaultModules: ['institucional', 'banners', 'imoveis', 'obras', 'servicos', 'contato'],
    isDefault: true,
  },
  {
    code: 'imobiliaria',
    name: 'Imobiliaria',
    description: 'Carteira de imoveis e servicos.',
    defaultModules: ['institucional', 'banners', 'imoveis', 'servicos', 'contato'],
    isDefault: false,
  },
  {
    code: 'corretor',
    name: 'Corretor autonomo',
    description: 'Carteira enxuta e contato direto.',
    defaultModules: ['institucional', 'banners', 'imoveis', 'contato'],
    isDefault: false,
  },
];
