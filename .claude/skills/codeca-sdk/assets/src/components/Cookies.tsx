'use client';

import { useEffect, useRef } from 'react';
import { iniciarConsentimento, type ConsentimentoIniciado } from '@codeca/sdk/consent';

/**
 * Banner e painel de preferencias de cookies.
 *
 * O texto, o nome do controlador e os enderecos das politicas vem do painel da
 * plataforma (`/plataforma/sites`, aba Cookies) -- nao daqui. Quem responde
 * pelos dados de quem visita este site e a empresa dona dele, e esse nome e
 * preenchido la. Se o painel nao responder, o banner aparece do mesmo jeito,
 * com a versao de politica abaixo: ficar sem poder recusar porque uma
 * requisicao falhou seria o pior resultado possivel.
 *
 * Para bloquear um script de verdade, marque-o na pagina:
 *
 * ```html
 * <script type="text/plain" data-codeca-consent="estatisticas"
 *         data-codeca-src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
 * ```
 *
 * Um `<script type="text/plain">` nao executa. O SDK cria outro no lugar dele
 * -- e so depois do "sim". Nao basta "nao enviar evento": o que importa e o
 * que nao entra na pagina.
 */
export function Cookies() {
  const ligado = useRef<ConsentimentoIniciado | null>(null);

  useEffect(() => {
    let cancelado = false;

    void iniciarConsentimento({
      baseUrl: process.env.NEXT_PUBLIC_CODECA_BASE_URL ?? 'https://codecabuild.vercel.app',
      publishableKey: process.env.NEXT_PUBLIC_CODECA_KEY ?? '',
      // Vale so quando o painel nao responde. Mudou a politica? Mude no painel.
      policyVersion: '1',
    }).then((resultado) => {
      if (cancelado) {
        resultado.destruir();
        return;
      }
      ligado.current = resultado;
      // Deixa o rodape abrir as preferencias sem precisar de contexto do React:
      // revogar tem de ser tao facil quanto aceitar, e a lei pede isso.
      window.codecaAbrirPreferencias = resultado.abrirPreferencias;
    });

    return () => {
      cancelado = true;
      ligado.current?.destruir();
      ligado.current = null;
      delete window.codecaAbrirPreferencias;
    };
  }, []);

  return null;
}

declare global {
  interface Window {
    codecaAbrirPreferencias?: () => void;
  }
}
