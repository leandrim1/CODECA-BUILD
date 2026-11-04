import { z } from 'zod';

/**
 * Contrato da integracao com o Google Analytics 4.
 *
 * Compartilhado entre a API e o painel: deixar de enviar um campo que a tela le
 * passa a ser erro de compilacao, nao surpresa em producao.
 */

export const ANALYTICS_RANGES = ['7d', '28d', '90d'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRange, string> = {
  '7d': 'Últimos 7 dias',
  '28d': 'Últimos 28 dias',
  '90d': 'Últimos 90 dias',
};

export const analyticsRangeQuerySchema = z.object({
  range: z.enum(ANALYTICS_RANGES).default('28d'),
});

/** Identificador numerico da propriedade GA4 (o que vem depois de `properties/`). */
export const analyticsPropertyIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,20}$/, 'Propriedade inválida.');

export const selectAnalyticsPropertySchema = z.object({
  propertyId: analyticsPropertyIdSchema,
});

export const ANALYTICS_CONNECTION_STATUSES = ['pending_property', 'active', 'needs_reconnect'] as const;
export type AnalyticsConnectionStatus = (typeof ANALYTICS_CONNECTION_STATUSES)[number];

/** Codigos que o retorno do Google pode deixar em `?analytics=`. */
export const ANALYTICS_RESULTS = [
  'connected',
  'cancelled',
  'invalid_state',
  'session_mismatch',
  'forbidden',
  'not_configured',
  'scope_missing',
  'no_refresh_token',
  'failed',
] as const;
export type AnalyticsResult = (typeof ANALYTICS_RESULTS)[number];

export const ANALYTICS_RESULT_MESSAGES: Record<AnalyticsResult, string> = {
  connected: 'Google Analytics conectado. Escolha a propriedade do seu site.',
  cancelled: 'A conexão foi cancelada. Nada foi alterado.',
  invalid_state: 'A tentativa de conexão expirou ou é inválida. Clique em Conectar novamente.',
  session_mismatch: 'A conexão precisa ser concluída pela mesma pessoa que a iniciou.',
  forbidden: 'Seu papel não permite conectar o Google Analytics.',
  not_configured: 'A integração com o Google Analytics não está configurada nesta instalação.',
  scope_missing: 'É preciso permitir a leitura dos dados do Google Analytics para conectar.',
  no_refresh_token: 'O Google não concedeu o acesso contínuo. Clique em Conectar e aceite todas as permissões.',
  failed: 'Não foi possível concluir a conexão com o Google. Tente novamente.',
};

export interface AnalyticsPropertyOption {
  propertyId: string;
  propertyName: string;
  accountName: string;
}

export interface AnalyticsConnectionView {
  status: AnalyticsConnectionStatus;
  propertyId: string | null;
  propertyName: string;
  accountName: string;
  connectedAt: string;
  lastError: string;
}

export interface AnalyticsStatus {
  /** Integracao configurada no servidor (credenciais Google e chave de cifra). */
  available: boolean;
  /**
   * Variaveis de ambiente que faltam (ou estao invalidas) para a integracao ligar.
   * So nomes, nunca valores, e so para quem pode gerenciar; vazio quando disponivel.
   */
  missingConfig: string[];
  /** Papel atual pode conectar/desconectar/escolher propriedade. */
  canManage: boolean;
  /**
   * URL de retorno que precisa estar cadastrada no Google Cloud. So vai para
   * quem pode gerenciar: e o dado de que o administrador precisa para configurar.
   */
  redirectUri: string | null;
  connection: AnalyticsConnectionView | null;
}

export interface AnalyticsTotals {
  activeUsers: number;
  sessions: number;
  pageViews: number;
  /** 0 a 1. */
  engagementRate: number;
  avgSessionSeconds: number;
}

export interface AnalyticsReport {
  range: AnalyticsRange;
  propertyId: string;
  propertyName: string;
  totals: AnalyticsTotals;
  daily: Array<{ date: string; activeUsers: number; sessions: number; pageViews: number }>;
  topPages: Array<{ path: string; views: number }>;
  channels: Array<{ channel: string; sessions: number }>;
  devices: Array<{ device: string; sessions: number }>;
  generatedAt: string;
}
