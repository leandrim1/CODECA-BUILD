import {
  AppWindow,
  Building2,
  CreditCard,
  FileClock,
  Globe,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  type LucideIcon,
  Package,
  Shapes,
} from 'lucide-react';

/**
 * Menu do painel mestre, como dado.
 *
 * Mesma escolha do `menuDoPainel.ts`: a lista fica fora do layout para que
 * acrescentar uma tela da plataforma seja editar um array, e nao mexer em JSX
 * de navegacao. A ordem aqui e a ordem na tela.
 *
 * Nao ha filtro por capacidade: o painel mestre inteiro ja esta atras de
 * `RequirePlatformAdmin`, e quem nao e administrador da plataforma nunca chega
 * a desenhar esta barra.
 */
export interface ItemDaPlataforma {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Casa so com o endereco exato -- usado pela raiz, que e prefixo de todos. */
  end?: boolean;
}

export const MENU_DA_PLATAFORMA: ItemDaPlataforma[] = [
  { to: '/plataforma', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { to: '/plataforma/empresas', label: 'Empresas', icon: Building2 },
  { to: '/plataforma/sites', label: 'Sites', icon: AppWindow },
  { to: '/plataforma/segmentos', label: 'Segmentos', icon: Shapes },
  { to: '/plataforma/planos', label: 'Planos', icon: Package },
  { to: '/plataforma/cobranca', label: 'Cobrança', icon: CreditCard },
  { to: '/plataforma/dominios', label: 'Domínios', icon: Globe },
  { to: '/plataforma/chamados', label: 'Chamados', icon: MessageSquare },
  { to: '/plataforma/suporte', label: 'Acesso de suporte', icon: LifeBuoy },
  { to: '/plataforma/auditoria', label: 'Auditoria', icon: FileClock },
];
