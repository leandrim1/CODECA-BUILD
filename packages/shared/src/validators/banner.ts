import { z } from 'zod';
import { httpsUrlSchema, uuidSchema } from './common.js';

/**
 * Banners da abertura do site.
 *
 * A janela de exibicao e opcional e, quando preenchida, precisa fazer sentido:
 * fim antes do inicio esconderia o banner para sempre sem nenhum aviso.
 */

const dataOpcional = z.coerce.date().nullable().default(null);

export const bannerInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Informe o titulo do banner.').max(160),
    subtitle: z.string().trim().max(400).default(''),
    imageId: uuidSchema.nullable().default(null),
    buttonLabel: z.string().trim().max(60).default(''),
    buttonUrl: z.union([z.literal(''), httpsUrlSchema]).default(''),
    sortOrder: z.number().int().min(0).max(9_999).default(0),
    isActive: z.boolean().default(true),
    startsAt: dataOpcional,
    endsAt: dataOpcional,
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt.getTime() > v.startsAt.getTime(), {
    message: 'A data final precisa ser depois da inicial.',
    path: ['endsAt'],
  })
  .refine((v) => !v.buttonLabel || Boolean(v.buttonUrl), {
    message: 'Informe o link do botao.',
    path: ['buttonUrl'],
  });

export type BannerInput = z.infer<typeof bannerInputSchema>;
