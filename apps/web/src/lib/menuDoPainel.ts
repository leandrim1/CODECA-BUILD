import {
  BarChart3,
  Building2,
  CreditCard,
  DownloadCloud,
  GalleryHorizontalEnd,
  Globe,
  HardHat,
  Image,
  Images,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  Mail,
  MessageCircleQuestion,
  PanelsTopLeft,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Tags,
  Users,
  Wrench,
} from 'lucide-react';
import type { ModuleKey, TenantCapability } from '@codeca/shared';

/**
 * Menu do painel, como dado.
 *
 * Fica fora do `DashboardLayout` para que acrescentar um modulo seja editar
 * uma lista, e nao mexer em JSX de navegacao. Quem desenha e
 * `SidebarGroup`; aqui so se declara o que existe.
 *
 * Dois filtros, e eles respondem a perguntas diferentes: `capability` e sobre
 * o **papel de quem entrou**, `module` e sobre o **site da empresa**. Um
 * editor nao ve a equipe; um site institucional sem carteira nao ve imoveis.
 * Nenhum dos dois protege nada por si -- o servidor recusa a operacao de
 * qualquer forma -- mas um menu que oferece o que nao existe e um painel que
 * parece quebrado.
 */

export interface NavItem {
  to: string;
  label: string;
  /** Ausente nos modulos criados para o site, que trazem `iconName`. */
  icon?: LucideIcon;
  capability?: TenantCapability;
  /**
   * Modulo que precisa estar habilitado para este site.
   *
   * Sem modulo, o item vale para todo site: midia, interessados, dominio,
   * equipe, plano e empresa nao dependem de como o projeto foi montado.
   */
  module?: ModuleKey;
  /**
   * Continua disponivel quando o plano nao inclui o painel de conteudo.
   *
   * Marcado so no que e **conta**, nao conteudo: plano e cadastro da empresa.
   * O servidor recusa o resto de qualquer forma, e um menu que oferece telas
   * que respondem 402 parece quebrado.
   */
  semPainel?: boolean;
  end?: boolean;
  /**
   * Icone de um modulo criado para o site, pelo nome.
   *
   * Os itens fixos trazem o componente em `icon`; os deste site vem do banco,
   * onde so cabe o nome. `SafeIcon` desenha, e nao desenha nada quando o nome
   * nao e de um icone que o painel conhece.
   */
  iconName?: string;
}

/** Subdivisao dentro de um grupo. O titulo e rotulo, nunca botao. */
export interface NavSection {
  /** Sem titulo, os itens saem direto sob o grupo. */
  title?: string;
  /** Recebe os modulos criados para este site, quando houver. */
  recebeModulosProprios?: boolean;
  items: NavItem[];
}

export interface NavGroup {
  title: string;
  /**
   * Identidade estavel para guardar aberto/fechado.
   *
   * E o titulo que aparece na tela que muda com o tempo; a chave, nao. Sem
   * isto, renomear "Site" apagaria a preferencia de todo mundo.
   */
  id: string;
  /** So os grupos colapsaveis tem icone no cabecalho. */
  icon?: LucideIcon;
  colapsavel?: boolean;
  /** Vale para o grupo inteiro enquanto os modulos nao chegam. */
  mostraEsperaDeModulos?: boolean;
  sections: NavSection[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'visao-geral',
    title: 'Visão geral',
    sections: [
      {
        items: [
          { to: '/painel', label: 'Visão geral', icon: LayoutDashboard, end: true, semPainel: true },
        ],
      },
    ],
  },

  /**
   * Tudo que e o site do cliente, num grupo so.
   *
   * Eram catorze itens no mesmo nivel, e a barra ja nascia rolando. Agrupados,
   * cabem numa linha fechada quando a pessoa esta cuidando de assinatura ou de
   * dominio, e abrem quando ela esta cuidando de conteudo.
   */
  {
    id: 'site',
    title: 'Site',
    icon: PanelsTopLeft,
    colapsavel: true,
    mostraEsperaDeModulos: true,
    sections: [
      {
        title: 'Páginas',
        items: [
          {
            to: '/painel/institucional',
            label: 'Institucional',
            icon: Store,
            capability: 'content:read',
            module: 'institucional',
          },
          {
            to: '/painel/contato',
            label: 'Contato',
            icon: Mail,
            capability: 'content:read',
            module: 'contato',
          },
          {
            to: '/painel/perguntas',
            label: 'Perguntas frequentes',
            icon: MessageCircleQuestion,
            capability: 'content:read',
            module: 'faq',
          },
        ],
      },
      {
        title: 'Conteúdo',
        // Os modulos criados para este site entram aqui: sao conteudo como
        // qualquer outro, e e onde a pessoa vai procurar por eles.
        recebeModulosProprios: true,
        items: [
          {
            to: '/painel/banners',
            label: 'Banners',
            icon: GalleryHorizontalEnd,
            capability: 'content:read',
            module: 'banners',
          },
          {
            to: '/painel/imoveis',
            label: 'Imóveis',
            icon: Building2,
            capability: 'content:read',
            module: 'imoveis',
          },
          {
            to: '/painel/obras',
            label: 'Obras e projetos',
            icon: HardHat,
            capability: 'content:read',
            module: 'obras',
          },
          {
            to: '/painel/servicos',
            label: 'Serviços',
            icon: Wrench,
            capability: 'content:read',
            module: 'servicos',
          },
          {
            to: '/painel/produtos',
            label: 'Produtos',
            icon: ShoppingBag,
            capability: 'content:read',
            module: 'produtos',
          },
          {
            to: '/painel/categorias',
            label: 'Categorias',
            icon: Tags,
            capability: 'content:read',
            module: 'categorias',
          },
          {
            to: '/painel/galerias',
            label: 'Galerias',
            icon: Images,
            capability: 'content:read',
            module: 'galerias',
          },
          {
            to: '/painel/depoimentos',
            label: 'Depoimentos',
            icon: Sparkles,
            capability: 'content:read',
            module: 'depoimentos',
          },
          {
            to: '/painel/equipe',
            label: 'Equipe do site',
            icon: Users,
            capability: 'content:read',
            module: 'equipe',
          },
        ],
      },
      {
        title: 'Mídia',
        items: [
          { to: '/painel/midia', label: 'Biblioteca de imagens', icon: Image, capability: 'media:read' },
        ],
      },
      {
        title: 'Ferramentas',
        items: [
          /**
           * Importar site fica no Site, e nao em Configuracoes, porque e um
           * atalho para **preencher conteudo** -- a alternativa a digitar tudo
           * nas telas acima. Sem `module`: nao e um modulo do site, e vale
           * para qualquer projeto que tenha painel.
           */
          {
            to: '/painel/importar',
            label: 'Importar site',
            icon: DownloadCloud,
            capability: 'content:write',
          },
          {
            to: '/painel/sincronizacao',
            label: 'Sincronização',
            icon: RefreshCw,
            capability: 'content:read',
          },
        ],
      },
    ],
  },

  {
    id: 'relacionamento',
    title: 'Relacionamento',
    sections: [
      {
        items: [
          { to: '/painel/interessados', label: 'Interessados', icon: Users, capability: 'leads:read' },
          {
            to: '/painel/estatisticas',
            label: 'Estatísticas do site',
            icon: BarChart3,
            capability: 'analytics:read',
          },
        ],
      },
    ],
  },

  {
    id: 'configuracoes',
    title: 'Configurações',
    sections: [
      {
        items: [
          { to: '/painel/dominio', label: 'Domínio próprio', icon: Globe, capability: 'domains:read' },
          // "Usuarios", e nao "Equipe": isto e quem acessa o painel. A equipe
          // exibida no site e o modulo `equipe`, em Conteudo.
          {
            to: '/painel/usuarios',
            label: 'Usuários e permissões',
            icon: ShieldCheck,
            capability: 'members:read',
          },
          {
            to: '/painel/plano',
            label: 'Plano e assinatura',
            icon: CreditCard,
            capability: 'billing:read',
            semPainel: true,
          },
          {
            to: '/painel/integracao',
            label: 'Integração',
            icon: KeyRound,
            capability: 'integration:read',
            semPainel: true,
          },
          {
            to: '/painel/empresa',
            label: 'Configurações da empresa',
            icon: Settings,
            capability: 'tenant:read',
            semPainel: true,
          },
          // Seguranca e da PESSOA, nao da empresa: aparece para todo mundo que
          // entra, em qualquer plano, sem depender de capacidade da empresa.
          { to: '/painel/seguranca', label: 'Segurança da conta', icon: ShieldCheck, semPainel: true },
        ],
      },
    ],
  },
];
