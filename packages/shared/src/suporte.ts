import { z } from 'zod';

/**
 * Chamados de suporte: o contrato que a tela, a API e o banco compartilham.
 *
 * O suporte da plataforma era um `mailto:`. Um endereco de e-mail nao tem
 * situacao, nao tem historico e nao deixa o cliente saber se alguem leu --
 * quem abriu ficava sem nada para olhar depois. Aqui o chamado e um registro:
 * tem numero, situacao, conversa e dono.
 *
 * O ASSISTENTE DE IA NAO APARECE NESTE ARQUIVO, de proposito. O chamado existe
 * e funciona sem ele: a indisponibilidade da IA nao pode impedir alguem de
 * pedir ajuda. O autor `ia` existe na lista abaixo porque a etapa seguinte vai
 * anexar a conversa do assistente ao chamado -- e o banco precisa aceitar esse
 * valor antes, nao depois.
 */

export const TICKET_STATUSES = [
  'aberto',
  'em_atendimento',
  'aguardando_cliente',
  'resolvido',
  'fechado',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABELS: Readonly<Record<TicketStatus, string>> = {
  aberto: 'Aberto',
  em_atendimento: 'Em atendimento',
  aguardando_cliente: 'Aguardando você',
  resolvido: 'Resolvido',
  fechado: 'Fechado',
};

/** As situacoes em que o chamado ainda espera alguma coisa de alguem. */
export const TICKET_STATUSES_ABERTOS = ['aberto', 'em_atendimento', 'aguardando_cliente'] as const;

export function ticketEstaAberto(status: TicketStatus): boolean {
  return (TICKET_STATUSES_ABERTOS as readonly string[]).includes(status);
}

/**
 * Categorias que o cliente escolhe ao abrir.
 *
 * Sao as do PRODUTO, nao as do time: quem abre descreve o que nao consegue
 * fazer, nao adivinha quem resolve. Triagem interna e a prioridade, que so a
 * plataforma altera.
 */
export const TICKET_CATEGORIAS = [
  'conteudo',
  'site',
  'dominio',
  'plano_cobranca',
  'acesso',
  'erro',
  'outro',
] as const;
export type TicketCategoria = (typeof TICKET_CATEGORIAS)[number];

export const TICKET_CATEGORIA_LABELS: Readonly<Record<TicketCategoria, string>> = {
  conteudo: 'Conteúdo do site',
  site: 'Aparência ou funcionamento do site',
  dominio: 'Domínio e endereço',
  plano_cobranca: 'Plano, cobrança ou cancelamento',
  acesso: 'Acesso e usuários',
  erro: 'Algo deu errado',
  outro: 'Outro assunto',
};

export const TICKET_PRIORIDADES = ['baixa', 'normal', 'alta'] as const;
export type TicketPrioridade = (typeof TICKET_PRIORIDADES)[number];

export const TICKET_PRIORIDADE_LABELS: Readonly<Record<TicketPrioridade, string>> = {
  baixa: 'Baixa',
  normal: 'Normal',
  alta: 'Alta',
};

/**
 * Quem escreveu cada mensagem.
 *
 * `sistema` e para o que o proprio software registra (abertura, mudanca de
 * situacao): fica no fio da conversa sem se passar por pessoa. `ia` esta
 * reservado para a etapa do assistente.
 */
export const TICKET_AUTORES = ['cliente', 'suporte', 'ia', 'sistema'] as const;
export type TicketAutor = (typeof TICKET_AUTORES)[number];

export const TICKET_AUTOR_LABELS: Readonly<Record<TicketAutor, string>> = {
  cliente: 'Você',
  suporte: 'Suporte CODECA',
  ia: 'Assistente',
  sistema: 'Sistema',
};

export const TICKET_ASSUNTO_MIN = 5;
export const TICKET_ASSUNTO_MAX = 120;
export const TICKET_CORPO_MIN = 15;
export const TICKET_CORPO_MAX = 5000;

const assunto = z
  .string()
  .trim()
  .min(TICKET_ASSUNTO_MIN, 'Resuma o assunto em pelo menos 5 caracteres.')
  .max(TICKET_ASSUNTO_MAX, `O assunto deve ter no máximo ${TICKET_ASSUNTO_MAX} caracteres.`);

const corpo = z
  .string()
  .trim()
  .min(TICKET_CORPO_MIN, 'Conte o que está acontecendo com um pouco mais de detalhe.')
  .max(TICKET_CORPO_MAX, `A mensagem deve ter no máximo ${TICKET_CORPO_MAX} caracteres.`);

/**
 * Abertura de chamado.
 *
 * Repare no que NAO esta aqui: nada de empresa, plano, uso ou usuario. Esse
 * contexto e montado no servidor a partir da sessao -- aceita-lo do cliente
 * seria deixar o navegador dizer de qual empresa ele e.
 *
 * `origemUrl` e a unica pista que vem da tela, porque so a tela sabe de onde a
 * pessoa chamou. E caminho, nao endereco completo: um `https://` arbitrario
 * aqui viraria link clicavel no painel mestre, apontando para onde o remetente
 * quisesse.
 */
export const abrirTicketSchema = z.object({
  assunto,
  categoria: z.enum(TICKET_CATEGORIAS),
  corpo,
  origemUrl: z
    .string()
    .trim()
    .max(300)
    .refine((valor) => valor === '' || valor.startsWith('/'), 'Informe um caminho do painel, começando com /')
    .default(''),
});
export type AbrirTicketInput = z.infer<typeof abrirTicketSchema>;

export const responderTicketSchema = z.object({ corpo });
export type ResponderTicketInput = z.infer<typeof responderTicketSchema>;

/** O que a plataforma pode mudar num chamado. O cliente nao alcanca isto. */
export const atualizarTicketSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    prioridade: z.enum(TICKET_PRIORIDADES).optional(),
    categoria: z.enum(TICKET_CATEGORIAS).optional(),
  })
  .refine(
    (valor) => Object.values(valor).some((campo) => campo !== undefined),
    'Informe ao menos um campo para alterar.',
  );
export type AtualizarTicketInput = z.infer<typeof atualizarTicketSchema>;

export const ticketQuerySchema = z.object({
  /** `abertos` e o padrao: a caixa de entrada util e a dos que esperam algo. */
  situacao: z.enum(['abertos', 'todos', ...TICKET_STATUSES]).default('abertos'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type TicketQuery = z.infer<typeof ticketQuerySchema>;

/**
 * O contexto que acompanha o chamado.
 *
 * Existe para o atendimento nao comecar com cinco perguntas que a plataforma
 * ja sabe responder. E um retrato do momento da abertura: se o plano mudar
 * depois, o chamado continua mostrando o que valia quando a duvida apareceu.
 */
export interface TicketContexto {
  empresa: { nome: string; slug: string };
  plano: { codigo: string; nome: string };
  site: { id: string | null; dominio: string | null; publicado: boolean } | null;
  uso: {
    conteudos: { usados: number; limite: number };
    armazenamento: { bytes: number; limiteBytes: number };
    usuarios: { usados: number; limite: number };
  };
  usuario: { nome: string; email: string; papel: string };
  origemUrl: string;
  /** Quando o retrato foi tirado. */
  capturadoEm: string;
}

/** Numero legivel do chamado, para a pessoa citar ao falar com o suporte. */
export function numeroDoTicket(numero: number): string {
  return `#${String(numero).padStart(4, '0')}`;
}
