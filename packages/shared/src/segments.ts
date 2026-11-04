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
 * Nada no codigo depende desta lista: ela existe para que uma instalacao
 * recem-criada tenha um conjunto inicial e um padrao. A CODECA IA cadastra,
 * renomeia e remove os que quiser no painel mestre.
 *
 * Ate 11/2026 eram tres, e as tres do ramo imobiliario -- de onde a
 * plataforma nasceu. O efeito era pratico, nao cosmetico: um restaurante que
 * se cadastrasse caia em "Construtora" por omissao e abria o painel com
 * Imoveis e Obras ligados. A lista cobre agora ramos distintos, e o padrao e
 * um segmento **neutro**, que nao liga modulo de ramo nenhum.
 *
 * Como `ensureBaselinePlans`, so entram **com a tabela vazia**: um segmento
 * removido de proposito nao volta no proximo deploy. Para as instalacoes que
 * ja existiam, quem acrescenta e a migracao 0015.
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
    /**
     * Padrao da instalacao: nao liga modulo de ramo nenhum.
     *
     * Um site institucional serve a qualquer negocio, entao e o ponto de
     * partida honesto para uma empresa cujo ramo ainda nao foi escolhido --
     * ao contrario de "Construtora", que abriria o painel com Imoveis e Obras
     * para um restaurante.
     *
     * O codigo coincide com o do modulo `institucional`, e nao ha conflito:
     * segmento e modulo sao tabelas diferentes. Aqui e "que tipo de negocio";
     * la e "qual conteudo o site tem".
     */
    code: 'institucional',
    name: 'Site institucional',
    description: 'Apresentação, serviços e contato. Ponto de partida para qualquer ramo.',
    defaultModules: ['institucional', 'banners', 'contato', 'servicos', 'depoimentos', 'equipe', 'faq', 'galerias'],
    isDefault: true,
  },
  {
    code: 'restaurante',
    name: 'Restaurante ou bar',
    description: 'Cardápio por categoria, ambiente e equipe.',
    defaultModules: ['institucional', 'banners', 'contato', 'produtos', 'categorias', 'galerias', 'depoimentos', 'equipe', 'faq'],
    isDefault: false,
  },
  {
    code: 'clinica',
    name: 'Clínica ou consultório',
    description: 'Especialidades, corpo clínico e agendamento por contato.',
    defaultModules: ['institucional', 'banners', 'contato', 'servicos', 'equipe', 'depoimentos', 'faq', 'galerias'],
    isDefault: false,
  },
  {
    code: 'escola',
    name: 'Escola ou curso',
    description: 'Cursos, corpo docente e estrutura.',
    defaultModules: ['institucional', 'banners', 'contato', 'servicos', 'equipe', 'depoimentos', 'faq', 'galerias'],
    isDefault: false,
  },
  {
    code: 'varejo',
    name: 'Loja ou varejo',
    description: 'Catálogo de produtos por categoria, com vitrine.',
    defaultModules: ['institucional', 'banners', 'contato', 'produtos', 'categorias', 'galerias', 'depoimentos', 'faq'],
    isDefault: false,
  },
  {
    code: 'prestador',
    name: 'Prestador de serviços',
    description: 'Serviços oferecidos, portfólio e equipe.',
    defaultModules: ['institucional', 'banners', 'contato', 'servicos', 'equipe', 'galerias', 'depoimentos', 'faq'],
    isDefault: false,
  },
  {
    code: 'construtora',
    name: 'Construtora',
    description: 'Obras, imóveis e institucional.',
    defaultModules: [
      'institucional',
      'banners',
      'imoveis',
      'obras',
      'servicos',
      'contato',
      'depoimentos',
      'equipe',
      'faq',
      'galerias',
    ],
    isDefault: false,
  },
  {
    code: 'imobiliaria',
    name: 'Imobiliária',
    description: 'Carteira de imóveis e serviços.',
    defaultModules: [
      'institucional',
      'banners',
      'imoveis',
      'servicos',
      'contato',
      'depoimentos',
      'faq',
      'galerias',
    ],
    isDefault: false,
  },
  {
    code: 'corretor',
    name: 'Corretor autônomo',
    description: 'Carteira enxuta e contato direto.',
    defaultModules: ['institucional', 'banners', 'imoveis', 'contato', 'depoimentos'],
    isDefault: false,
  },
];
