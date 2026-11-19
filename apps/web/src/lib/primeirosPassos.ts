import { Building2, GalleryHorizontalEnd, Globe, Mail, Wrench, type LucideIcon } from 'lucide-react';
import type { OverviewResponse } from '../types/index.js';
import type { TenantCapability } from '@codeca/shared';

/**
 * Os primeiros passos, como dado.
 *
 * Cada passo sabe responder uma unica pergunta: "isto ja foi feito?". A
 * resposta vem dos DADOS REAIS do site, nunca de um progresso gravado --
 * progresso gravado descola do mundo no primeiro conteudo apagado e passa a
 * dizer "feito" sobre um site vazio.
 *
 * A descricao fala do beneficio para o cliente, e nao da operacao: "o que sua
 * empresa faz" em vez de "preencher o documento institucional". Quem abre este
 * painel pela primeira vez nao sabe o que e um documento institucional.
 */
export interface PassoInicial {
  id: string;
  titulo: string;
  /** Uma linha, no que isto resolve para o cliente. */
  descricao: string;
  icone: LucideIcon;
  para: string;
  /** Rotulo do botao, quando "Ir para" nao for o que a pessoa espera. */
  acao?: string;
  /** Sem a capacidade, o passo nao aparece -- nem conta no total. */
  capability?: TenantCapability;
  concluido: (visao: OverviewResponse) => boolean;
}

export const PASSOS_INICIAIS: PassoInicial[] = [
  {
    id: 'institucional',
    titulo: 'Conte quem é a sua empresa',
    descricao: 'A apresentação que aparece para quem chega no seu site.',
    icone: Building2,
    para: '/painel/institucional',
    acao: 'Preencher',
    capability: 'content:read',
    concluido: (v) => v.onboarding.institutionalFilled,
  },
  {
    id: 'contato',
    titulo: 'Diga como falar com você',
    descricao: 'Telefone, e-mail ou WhatsApp para o cliente entrar em contato.',
    icone: Mail,
    para: '/painel/contato',
    acao: 'Cadastrar',
    capability: 'content:read',
    concluido: (v) => v.onboarding.contactFilled,
  },
  {
    id: 'banner',
    titulo: 'Escolha a imagem de abertura',
    descricao: 'O destaque que ocupa o topo da página inicial.',
    icone: GalleryHorizontalEnd,
    para: '/painel/banners',
    acao: 'Adicionar',
    capability: 'content:read',
    concluido: (v) => v.banners.total > 0,
  },
  {
    id: 'servico',
    titulo: 'Cadastre o que a sua empresa oferece',
    descricao: 'Os serviços que você quer mostrar para quem visita.',
    icone: Wrench,
    para: '/painel/servicos',
    acao: 'Cadastrar',
    capability: 'content:read',
    concluido: (v) => v.services.total > 0,
  },
  {
    id: 'dominio',
    titulo: 'Use o seu próprio endereço',
    descricao: 'Para o site responder em www.suaempresa.com.br.',
    icone: Globe,
    para: '/painel/dominio',
    acao: 'Conectar',
    capability: 'domains:read',
    // "Conectado" e o dominio que de fato responde. Um cadastro pendente de
    // DNS nao coloca o site no ar, e marcar o passo como feito ali faria a
    // pessoa parar de mexer justamente quando falta a parte dela.
    concluido: (v) => v.domains.some((d) => d.status === 'active'),
  },
];

export interface ProgressoDosPassos {
  passos: Array<PassoInicial & { feito: boolean }>;
  feitos: number;
  total: number;
  tudoFeito: boolean;
}

/**
 * Progresso a partir da visao geral que a tela ja carregou.
 *
 * Funcao pura, e separada do componente, para ser testavel sem navegador: as
 * regras de "ja fez" sao a parte que erra em silencio.
 */
export function progressoDosPassos(
  visao: OverviewResponse,
  pode: (c: TenantCapability) => boolean,
): ProgressoDosPassos {
  const passos = PASSOS_INICIAIS
    .filter((p) => !p.capability || pode(p.capability))
    .map((p) => ({ ...p, feito: p.concluido(visao) }));
  const feitos = passos.filter((p) => p.feito).length;
  return { passos, feitos, total: passos.length, tudoFeito: passos.length > 0 && feitos === passos.length };
}
