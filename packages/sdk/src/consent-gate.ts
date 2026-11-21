import {
  type ConsentCategory,
  type ConsentManager,
  CATEGORIAS_OPCIONAIS,
} from './consent.js';

/**
 * O que segura o que nao foi autorizado.
 *
 * Um banner que so guarda a escolha e enfeite: o rastreador carrega do mesmo
 * jeito. Aqui estao as tres formas de impedir isso, da mais confiavel para a
 * menos.
 */

/** Atributo que marca um script ou incorporacao como dependente de categoria. */
export const ATRIBUTO_CATEGORIA = 'data-codeca-consent';
/** Endereco guardado para so entrar no ar depois da autorizacao. */
export const ATRIBUTO_SRC = 'data-codeca-src';

/**
 * Ativa o que foi autorizado, e mantem o resto desligado.
 *
 * O jeito confiavel de nao carregar um script e **nao o colocar na pagina**.
 * Por isso o padrao e marcar o script como `type="text/plain"`: o navegador
 * nao executa, e nao ha corrida entre o rastreador e o consentimento.
 *
 * ```html
 * <script type="text/plain" data-codeca-consent="estatisticas"
 *         data-codeca-src="https://exemplo/analytics.js"></script>
 *
 * <iframe data-codeca-consent="marketing"
 *         data-codeca-src="https://www.youtube.com/embed/..."></iframe>
 * ```
 *
 * Chame uma vez na carga e de novo a cada mudanca -- `aplicarConsentimento`
 * ja cuida disso se voce passar o gerenciador.
 *
 * O que ele NAO faz: desfazer o que ja rodou. Script executado nao se
 * desexecuta, e por isso a ordem importa -- autorizar liga, revogar vale da
 * proxima carga em diante. A revogacao esta descrita em `limparCookiesDe`.
 */
export function liberarMarcados(permite: (c: ConsentCategory) => boolean, raiz: ParentNode = document): number {
  let liberados = 0;

  for (const no of Array.from(raiz.querySelectorAll(`[${ATRIBUTO_CATEGORIA}]`))) {
    const categoria = no.getAttribute(ATRIBUTO_CATEGORIA) as ConsentCategory | null;
    if (!categoria || !permite(categoria)) continue;

    const destino = no.getAttribute(ATRIBUTO_SRC);

    if (no instanceof HTMLScriptElement) {
      // Ja liberado numa passagem anterior.
      if (no.dataset.codecaLiberado === '1') continue;
      /*
        Um `<script type="text/plain">` nao executa nem trocando o `type`: o
        navegador so avalia um script ao INSERI-LO. Entao cria-se outro, com o
        mesmo conteudo, e insere-se no lugar.
      */
      const novo = document.createElement('script');
      for (const atributo of Array.from(no.attributes)) {
        if (atributo.name === 'type' || atributo.name === ATRIBUTO_SRC) continue;
        novo.setAttribute(atributo.name, atributo.value);
      }
      if (destino) novo.src = destino;
      else novo.textContent = no.textContent;
      novo.dataset.codecaLiberado = '1';
      no.replaceWith(novo);
      liberados++;
      continue;
    }

    // Incorporacoes: basta devolver o endereco guardado.
    if (destino && 'src' in no && !(no as HTMLIFrameElement).src) {
      (no as HTMLIFrameElement).src = destino;
      liberados++;
    }
  }

  return liberados;
}

/**
 * Liga o gerenciador a pagina: libera o autorizado agora e a cada mudanca.
 *
 * Devolve a funcao que desfaz a inscricao.
 */
export function aplicarConsentimento(manager: ConsentManager): () => void {
  liberarMarcados(manager.permite);
  return manager.aoMudar(() => liberarMarcados(manager.permite));
}

type Gtag = (...args: unknown[]) => void;

/**
 * Ponte com o Consent Mode do Google.
 *
 * Serve ao caso em que o site PRECISA carregar o gtag antes da escolha (por
 * exemplo, para medir conversao de quem aceita). Com o modo de consentimento,
 * o gtag entra ja negado e so passa a coletar depois do "sim".
 *
 * **O caminho preferido continua sendo nao carregar nada** -- `liberarMarcados`
 * e mais forte, porque o que nao esta na pagina nao tem como coletar. Use esta
 * ponte quando a ferramenta exigir presenca previa, e saiba a diferenca:
 * aqui o script do Google roda desde o inicio, apenas restrito.
 *
 * Chame ANTES de carregar o gtag, para o padrao negado valer desde a primeira
 * chamada.
 */
export function pontearConsentModeDoGoogle(manager: ConsentManager): () => void {
  const janela = window as unknown as { dataLayer?: unknown[]; gtag?: Gtag };
  janela.dataLayer = janela.dataLayer ?? [];
  const gtag: Gtag =
    janela.gtag ??
    function (...args: unknown[]) {
      janela.dataLayer!.push(args);
    };
  janela.gtag = gtag;

  const enviar = (permite: (c: ConsentCategory) => boolean, modo: 'default' | 'update') => {
    gtag('consent', modo, {
      analytics_storage: permite('estatisticas') ? 'granted' : 'denied',
      ad_storage: permite('marketing') ? 'granted' : 'denied',
      ad_user_data: permite('marketing') ? 'granted' : 'denied',
      ad_personalization: permite('marketing') ? 'granted' : 'denied',
      // Preferencia de interface nao e das categorias do Google; fica de fora
      // para nao afirmar algo que ele interpretaria de outro jeito.
      ...(modo === 'default' ? { wait_for_update: 500 } : {}),
    });
  };

  enviar(manager.permite, 'default');
  return manager.aoMudar((estado) => enviar((c) => estado.decision[c], 'update'));
}

/**
 * Apaga cookies de primeira parte cujo nome comece por um dos prefixos.
 *
 * Use na revogacao, para o que ja foi gravado nao continuar valendo.
 *
 * **O limite e real e precisa ser dito:** o navegador so deixa apagar cookie
 * do proprio dominio. Cookie gravado por terceiro (o Google, por exemplo) em
 * dominio dele nao se apaga daqui -- nem por este codigo, nem por nenhum
 * outro na pagina. O que se faz e parar de carregar a ferramenta e, quando ela
 * oferecer, usar o mecanismo dela. Prometer "apagamos tudo" seria mentira.
 */
export function limparCookiesDe(prefixos: string[], dominio = location.hostname): number {
  if (typeof document === 'undefined') return 0;
  let apagados = 0;
  // O ponto antes do dominio cobre o cookie gravado para os subdominios.
  const escopos = [dominio, `.${dominio}`, ''];

  for (const parte of document.cookie.split(';')) {
    const nome = parte.split('=')[0]?.trim();
    if (!nome || !prefixos.some((p) => nome.startsWith(p))) continue;
    for (const escopo of escopos) {
      document.cookie = `${nome}=; Max-Age=0; path=/;${escopo ? ` domain=${escopo};` : ''}`;
    }
    apagados++;
  }
  return apagados;
}

/**
 * Revogacao completa: apaga a escolha, os cookies conhecidos, e recarrega.
 *
 * A recarga nao e preguica: script ja executado nao se desexecuta, e sem ela
 * a ferramenta autorizada antes continuaria rodando ate a pessoa trocar de
 * pagina. Recarregar e a forma honesta de fazer a revogacao valer agora.
 */
export function revogarEReiniciar(manager: ConsentManager, prefixosDeCookie: string[] = ['_ga', '_gid', '_fbp', '_gcl']): void {
  manager.revogar();
  limparCookiesDe(prefixosDeCookie);
  location.reload();
}

/** As categorias que o visitante pode recusar, para montar a interface. */
export { CATEGORIAS_OPCIONAIS };
