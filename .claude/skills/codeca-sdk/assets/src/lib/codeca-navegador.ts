'use client';

import { createClient } from '@codeca/sdk';

/**
 * Cliente para o navegador, com a chave publicavel.
 *
 * Ela nao e segredo: le so conteudo publicado, e so a partir de uma origem
 * cadastrada no painel. Mas **so atende** se a origem estiver cadastrada --
 * em `/plataforma/sites`, aba Origens. Sem nenhuma origem, a chave recusa, e
 * falhar assim e melhor do que atender a qualquer site.
 */
export function clienteDoNavegador() {
  const chave = process.env.NEXT_PUBLIC_CODECA_KEY;
  if (!chave) throw new Error('Falta NEXT_PUBLIC_CODECA_KEY.');
  return createClient({
    baseUrl: process.env.NEXT_PUBLIC_CODECA_BASE_URL ?? 'https://codecabuild.vercel.app',
    publishableKey: chave,
  });
}
