import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { codeca } from '@/lib/codeca';
import { Cookies } from '@/components/Cookies';

/**
 * O titulo e a descricao vem do conteudo, e nao do codigo.
 *
 * Quem edita o institucional no painel espera que o site mude -- inclusive o
 * que aparece na aba do navegador e no resultado de busca.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const institucional = await codeca.institutional.get();
    return {
      title: institucional.companyName,
      description: institucional.shortDescription ?? undefined,
    };
  } catch {
    // Metadado nao derruba a pagina: sem a plataforma, o site ainda abre.
    return { title: 'Site' };
  }
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        {/*
          O consentimento fica no layout, e nao em cada pagina: ele precisa
          existir na PRIMEIRA visualizacao, qualquer que seja a rota de entrada.
        */}
        <Cookies />
      </body>
    </html>
  );
}
