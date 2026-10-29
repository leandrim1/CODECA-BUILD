import { createContext, useContext, type ReactNode } from 'react';
import { whatsAppLink, type PublicSiteData, type WhatsAppContext } from '@codeca/shared';

/**
 * Dados do site disponiveis para todos os blocos.
 *
 * O mesmo contexto serve a renderizacao no servidor (site publicado) e a previa
 * do editor, garantindo que o que o cliente ve no editor seja o que vai ao ar.
 */
const SiteDataContext = createContext<PublicSiteData | null>(null);

export function SiteDataProvider({ value, children }: { value: PublicSiteData; children: ReactNode }) {
  return <SiteDataContext.Provider value={value}>{children}</SiteDataContext.Provider>;
}

export function useSite(): PublicSiteData {
  const value = useContext(SiteDataContext);
  if (!value) {
    throw new Error('useSite precisa ser usado dentro de <SiteDataProvider>.');
  }
  return value;
}

/** Link de WhatsApp da empresa com mensagem conforme o conteudo em tela. */
export function useWhatsApp(context: WhatsAppContext, customMessage?: string | null): string | null {
  const site = useSite();
  return whatsAppLink(
    site.tenant.whatsapp,
    context,
    site.tenant.displayName,
    customMessage || site.tenant.whatsappDefaultMessage || null,
  );
}

/** Caminho absoluto a partir da raiz do site. */
export function useHref(path: string): string {
  return path.startsWith('/') || path.startsWith('#') || /^[a-z]+:/i.test(path) ? path : `/${path}`;
}
