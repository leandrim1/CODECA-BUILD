import { z } from 'zod';
import { normalizeDomain } from '../domain.js';
import { uuidSchema } from './common.js';

export const addDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(4)
    .max(253)
    .transform((value, ctx) => {
      const normalized = normalizeDomain(value);
      if (!normalized) {
        ctx.addIssue({
          code: 'custom',
          message: 'Informe um dominio valido, por exemplo www.suaconstrutora.com.br',
        });
        return z.NEVER;
      }
      return normalized;
    }),
  /** Quando true, o dominio passa a responder como principal do site. */
  setAsPrimary: z.boolean().default(false),
});
export type AddDomainInput = z.infer<typeof addDomainSchema>;

export const domainIdParamSchema = z.object({ domainId: uuidSchema });
