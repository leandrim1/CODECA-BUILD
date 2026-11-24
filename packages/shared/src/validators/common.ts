import { z } from 'zod';
import { BRAZIL_STATES, SOCIAL_NETWORKS } from '../constants.js';
import { SLUG_PATTERN } from '../slug.js';
import { SENHA_MAX, mensagemDeSenhaInvalida, validarSenha } from '../senha.js';
import { NOME_INVALIDO, NOME_MAX, nomeFinal, nomeValido } from '../nome.js';
import { TELEFONE_INVALIDO, digitosDeTelefone, telefoneValido } from '../telefone.js';

/** Schemas basicos reutilizados por todos os recursos. */

const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const uuidSchema = z.string().trim().regex(UUID, 'Identificador inválido.');

const EMAIL = /^[^\s@,;:<>()[\]\\"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5)
  .max(254)
  .regex(EMAIL, 'Informe um e-mail válido.');

/**
 * Senha nova (cadastro, redefinicao, troca e aceite de convite).
 *
 * As regras moram em `validarSenha`, a mesma funcao que desenha a lista de
 * conferencia na tela de cadastro -- aqui elas sao COBRADAS. O servidor nunca
 * confia na conferencia do navegador: quem chama a API direto passa longe
 * dela.
 *
 * A mensagem lista apenas o que faltou, para a pessoa nao ter de adivinhar
 * qual das cinco regras tropecou. O login nao usa este schema: senha antiga de
 * conta antiga continua entrando (o que muda e o que se pode DEFINIR daqui em
 * diante).
 */
export const passwordSchema = z
  .string()
  .max(SENHA_MAX, `A senha deve ter no máximo ${SENHA_MAX} caracteres.`)
  .superRefine((valor, ctx) => {
    if (validarSenha(valor).valida) return;
    ctx.addIssue({ code: 'custom', message: mensagemDeSenhaInvalida(valor) });
  });

export const personNameSchema = z.string().trim().min(2, 'Informe o nome completo.').max(120);

/**
 * Nome de pessoa com a mesma limpeza que o campo faz na tela.
 *
 * SANITIZA e so entao valida, na ordem: o que chega com numero ou simbolo
 * perde o excesso ("Maria 123" vira "Maria") em vez de ser recusado, porque e
 * exatamente o que a tela teria feito com a mesma digitacao. O servidor repete
 * a limpeza porque a tela nao e barreira nenhuma para quem chama a API direto
 * -- e o que fica no banco e o resultado daqui, nunca o que veio no corpo.
 *
 * Nao substitui `personNameSchema`: convite e perfil continuam com a regra
 * antiga, e so o cadastro passa por esta.
 */
export const nomeDePessoaSchema = z
  .string()
  .max(400, `O nome deve ter no máximo ${NOME_MAX} caracteres.`)
  .transform(nomeFinal)
  .refine(nomeValido, NOME_INVALIDO);

/**
 * Telefone brasileiro, guardado apenas em digitos.
 *
 * Mesma ordem: reduz a digitos (tirando mascara, `+55` e zero de operadora) e
 * so entao confere DDD, comprimento e o nono digito. Vazio continua valendo,
 * porque o campo e opcional -- quem nao informou nao erra.
 */
export const telefoneBrSchema = z
  .string()
  .max(32)
  .transform(digitosDeTelefone)
  .refine((d) => d === '' || telefoneValido(d), TELEFONE_INVALIDO);

export const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .refine((v) => v === '' || v.replace(/\D+/g, '').length >= 10, 'Informe um telefone com DDD.');

export const requiredPhoneSchema = z
  .string()
  .trim()
  .min(1, 'Informe um telefone.')
  .max(32)
  .refine((v) => v.replace(/\D+/g, '').length >= 10, 'Informe um telefone com DDD.');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(96)
  .regex(SLUG_PATTERN, 'Use apenas letras minúsculas, números e hifens.');

export const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => {
    if (v === '') return true;
    try {
      const url = new URL(v);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Informe uma URL iniciando com https://');

export const cnpjSchema = z
  .string()
  .trim()
  .max(18)
  .refine((v) => v === '' || v.replace(/\D+/g, '').length === 14, 'CNPJ deve ter 14 digitos.');

export const addressSchema = z.object({
  street: z.string().trim().max(160).default(''),
  number: z.string().trim().max(20).default(''),
  complement: z.string().trim().max(80).default(''),
  neighborhood: z.string().trim().max(80).default(''),
  city: z.string().trim().max(80).default(''),
  state: z.union([z.enum(BRAZIL_STATES), z.literal('')]).default(''),
  postalCode: z.string().trim().max(12).default(''),
  /** Controla se o endereco completo aparece no site publico. */
  showFullAddress: z.boolean().default(true),
});
export type AddressInput = z.infer<typeof addressSchema>;

export const socialLinksSchema = z
  .partialRecord(z.enum(SOCIAL_NETWORKS), httpsUrlSchema)
  .prefault({});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(items: T[], total: number, pagination: Pagination): Paginated<T> {
  return {
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
  };
}

export const sortDirectionSchema = z.enum(['asc', 'desc']).default('desc');

/** Converte "" em null para campos opcionais em formularios. */
export function emptyToNull<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === '' ? null : value), schema.nullable());
}
