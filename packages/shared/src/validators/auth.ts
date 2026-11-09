import { z } from 'zod';
import { TENANT_ROLES } from '../roles.js';
import { emailSchema, passwordSchema, personNameSchema, phoneSchema, slugSchema, uuidSchema } from './common.js';

export const registerSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  /** Dados da primeira empresa criada junto com a conta. */
  companyName: z.string().trim().min(2, 'Informe o nome da empresa.').max(160),
  companySlug: slugSchema.optional(),
  phone: phoneSchema.default(''),
  acceptedTerms: z.literal(true, { message: 'E necessario aceitar os termos de uso.' }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha.').max(200),
  rememberMe: z.boolean().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const requestPasswordResetSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(20).max(200),
});

export const resendVerificationSchema = z.object({ email: emailSchema });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: personNameSchema,
  phone: phoneSchema.default(''),
});

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(TENANT_ROLES).refine((r) => r !== 'owner' || true),
  name: z.string().trim().max(120).default(''),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().trim().min(20).max(200),
  name: personNameSchema.optional(),
  password: passwordSchema.optional(),
});

export const updateMemberRoleSchema = z.object({
  membershipId: uuidSchema,
  role: z.enum(TENANT_ROLES),
});

/**
 * Inicio do login com Google.
 *
 * `continue` serve a "Entrar" e a "Criar conta": o servidor decide, pelo que ja
 * existe, se entra ou cria. `link` vincula o Google a uma conta que ja esta
 * logada, e por isso exige a senha atual -- ver `docs/google-oauth.md`.
 */
export const googleStartSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('continue'),
    /** Destino depois de entrar. So caminho interno; o servidor revalida. */
    next: z.string().trim().max(300).optional(),
  }),
  z.object({
    intent: z.literal('link'),
    /** Comprova que quem esta com a sessao aberta controla a conta. */
    password: z.string().min(1, 'Informe a sua senha para vincular o Google.').max(200),
  }),
]);
export type GoogleStartInput = z.infer<typeof googleStartSchema>;

export const unlinkGoogleSchema = z.object({
  password: z.string().min(1, 'Informe a sua senha para desvincular o Google.').max(200),
});

/**
 * Primeira empresa de quem entrou pelo Google.
 *
 * E o mesmo cadastro de empresa do formulario de e-mail e senha, sem o que o
 * Google ja respondeu (nome, e-mail) e sem senha.
 */
export const createCompanySchema = z.object({
  companyName: z.string().trim().min(2, 'Informe o nome da empresa.').max(160),
  companySlug: slugSchema.optional(),
  phone: phoneSchema.default(''),
  acceptedTerms: z.literal(true, { message: 'É necessário aceitar os termos de uso.' }),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/**
 * Motivos pelos quais o login com Google volta para a tela com erro.
 *
 * Viajam na URL (`?google=<codigo>`), por isso sao codigos fixos e nunca texto
 * livre: nada que o provedor devolva chega a tela sem passar por esta lista.
 */
export const GOOGLE_AUTH_ERRORS = {
  cancelled: 'Você cancelou o acesso com o Google. Nenhuma alteração foi feita.',
  email_in_use:
    'Já existe uma conta com o e-mail desta conta Google. Entre com a sua senha e, depois de entrar, vincule o Google em Empresa > Minha conta. Se você foi convidado para uma empresa, use o link do convite que chegou por e-mail.',
  unverified_email: 'O Google informou que o e-mail desta conta ainda não foi verificado. Verifique-o e tente de novo.',
  invalid_state: 'Não foi possível confirmar a origem do pedido. Volte e clique em "Continuar com Google" outra vez.',
  invalid_token: 'Não foi possível validar a resposta do Google. Tente novamente em instantes.',
  not_configured: 'O login com Google não está disponível neste ambiente.',
  already_linked: 'Esta conta Google já está vinculada a outro usuário.',
  already_has_google: 'Sua conta já tem uma conta Google vinculada. Desvincule-a antes de vincular outra.',
  session_mismatch: 'Sua sessão mudou durante o processo. Entre novamente e tente de novo.',
  code_send_failed: 'Entrou com o Google, mas não foi possível enviar o código de verificação por e-mail agora. Tente novamente em instantes.',
  failed: 'Não foi possível entrar com o Google agora. Tente novamente.',
  linked: 'Conta Google vinculada.',
} as const;
export type GoogleAuthResult = keyof typeof GOOGLE_AUTH_ERRORS;

// ------------------------------------------------- verificacao por e-mail (2a etapa)

/**
 * Regras do codigo enviado por e-mail depois da senha (ou do Google).
 * Servidor e tela leem os mesmos numeros.
 */
export const LOGIN_CODE_LENGTH = 6;
export const LOGIN_CODE_TTL_MINUTES = 10;
/** Tentativas de validacao por codigo; ao errar a ultima, o codigo morre. */
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
/** Intervalo minimo entre dois envios de codigo para o mesmo e-mail. */
export const LOGIN_CODE_RESEND_SECONDS = 60;

/**
 * Pedido de codigo para entrar so com o e-mail (sem senha).
 *
 * E uma forma de autenticacao, nao um atalho: quem digita o codigo prova que
 * controla a caixa de entrada daquele endereco -- a mesma prova que a
 * recuperacao de senha ja aceita hoje para TROCAR a senha. Por isso nao abre
 * nenhuma porta que nao existisse.
 *
 * A resposta e identica exista ou nao conta com este e-mail (ver a rota).
 */
export const requestLoginCodeSchema = z.object({
  email: emailSchema,
  rememberMe: z.boolean().default(false),
});
export type RequestLoginCodeInput = z.infer<typeof requestLoginCodeSchema>;

/**
 * O codigo digitado. O e-mail NAO vem no corpo: o servidor o le do comprovante
 * emitido ao iniciar o login (cookie HttpOnly), nunca da requisicao -- senao
 * bastaria trocar o e-mail no corpo para usar o codigo de outra pessoa.
 */
export const verifyLoginCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${LOGIN_CODE_LENGTH}}$`), `Informe os ${LOGIN_CODE_LENGTH} dígitos do código.`),
});
export type VerifyLoginCodeInput = z.infer<typeof verifyLoginCodeSchema>;

/** Mensagem unica para qualquer falha de validacao: nao diz se o e-mail existe. */
export const LOGIN_CODE_INVALID_MESSAGE = 'Código incorreto ou expirado. Confira os números ou peça um novo código.';
