import { z } from 'zod';
import { TENANT_ROLES } from '../roles.js';
import { emailSchema, passwordSchema, personNameSchema, phoneSchema, slugSchema, uuidSchema } from './common.js';

export const registerSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  /** Dados da primeira construtora criada junto com a conta. */
  companyName: z.string().trim().min(2, 'Informe o nome da construtora.').max(160),
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
