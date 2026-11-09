import { checkImportHostname, IMPORT_LIMITS } from '@codeca/shared';

/**
 * Renderizacao de pagina com navegador, para sites que montam o conteudo no
 * cliente.
 *
 * ## A tensao que este arquivo carrega
 *
 * A regra de seguranca da importacao e clara: **nao executar scripts
 * encontrados no site analisado**. Renderizar com um navegador e exatamente
 * isso -- executar o JavaScript de terceiros. As duas coisas nao se
 * conciliam, e fingir que sim seria pior do que escolher.
 *
 * A escolha feita aqui: renderizar **nao acontece por padrao**. A plataforma
 * tenta, em ordem, o que e seguro:
 *
 * 1. requisicao HTTP e leitura das tags -- nunca executa nada;
 * 2. estado serializado que o framework deixou no HTML (`embedded.ts`) --
 *    tambem nao executa nada, so le JSON;
 * 3. navegador, **so quando configurado de proposito** por quem opera.
 *
 * Os dois primeiros resolvem a maioria dos sites, incluindo Next.js e Nuxt. O
 * terceiro existe para o resto, e quem o liga esta aceitando conscientemente
 * rodar codigo de terceiros -- por isso e configuracao explicita, nunca
 * padrao.
 *
 * ## Por que nao empacotar o Chromium na funcao
 *
 * A funcao da Vercel tem teto de tamanho, e a instalacao roda no plano
 * gratuito. Somar um Chromium ao pacote arrisca estourar esse teto e
 * **derrubar o deploy do site inteiro** -- trocar uma funcionalidade que
 * falta por outra que para de funcionar. Por isso o navegador vive fora:
 *
 * - `remoto`: um servico de renderizacao proprio, chamado por HTTP. E o
 *   caminho para a Vercel. Zero peso no pacote.
 * - `local`: Playwright no proprio processo. Serve para instalacao
 *   self-hosted, para desenvolvimento e para os testes -- nunca e carregado
 *   sem configuracao, porque a importacao e dinamica.
 *
 * ## O que a renderizacao NAO muda
 *
 * As barreiras contra SSRF continuam valendo para decidir **se** um endereco
 * pode ser visitado: o renderizador so recebe endereco que ja passou por
 * elas. O que ele faz depois esta fora do nosso controle -- um navegador
 * busca os proprios subrecursos --, e e mais uma razao para ligar isto
 * conscientemente. Ver `docs/importacao-de-sites.md`.
 */

export interface RenderedPage {
  /** HTML do DOM depois de o navegador montar a pagina. */
  html: string;
  /** Endereco final, se o navegador tiver seguido redirecionamento. */
  finalUrl: string;
}

export interface PageRenderer {
  /** Nome da estrategia, para o registro da importacao. */
  readonly kind: 'nenhum' | 'remoto' | 'local' | 'memoria';
  /** `null` quando nao foi possivel renderizar. Nunca lanca. */
  render: (url: string, options?: { timeoutMs?: number }) => Promise<RenderedPage | null>;
}

/** O padrao: nao existe navegador, e a importacao segue sem ele. */
export function createNullRenderer(): PageRenderer {
  return {
    kind: 'nenhum',
    render: async () => null,
  };
}

/**
 * Renderizador por servico externo.
 *
 * O servico recebe o endereco e devolve o HTML final. O contrato e
 * propositalmente mingua -- `{ url }` entra, `{ html }` sai -- para caber em
 * qualquer implementacao: uma funcao propria num plano que aceite Chromium,
 * um Browserless, um container.
 *
 * O segredo vai no cabecalho, nunca na URL, que fica em log de servidor e em
 * historico.
 */
export function createRemoteRenderer(input: {
  endpoint: string;
  secret?: string;
  fetchImpl?: typeof fetch;
}): PageRenderer {
  const buscar = input.fetchImpl ?? fetch;

  return {
    kind: 'remoto',
    render: async (url, options = {}) => {
      // O endereco ja passou pelas barreiras de quem chamou; esta e a
      // conferencia de que nada se perdeu no caminho ate aqui.
      let alvo: URL;
      try {
        alvo = new URL(url);
      } catch {
        return null;
      }
      if (alvo.protocol !== 'http:' && alvo.protocol !== 'https:') return null;
      if (!checkImportHostname(alvo.hostname).ok) return null;

      const timeoutMs = options.timeoutMs ?? IMPORT_LIMITS.requestTimeoutMs * 2;
      const controle = new AbortController();
      const relogio = setTimeout(() => controle.abort(), timeoutMs);

      try {
        const resposta = await buscar(input.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(input.secret !== undefined && input.secret !== ''
              ? { authorization: `Bearer ${input.secret}` }
              : {}),
          },
          body: JSON.stringify({ url: alvo.toString(), timeoutMs }),
          signal: controle.signal,
        });

        if (!resposta.ok) return null;
        const corpo = (await resposta.json()) as { html?: unknown; finalUrl?: unknown };
        const html = typeof corpo.html === 'string' ? corpo.html : '';
        if (html === '') return null;

        return {
          html: html.slice(0, IMPORT_LIMITS.maxHtmlBytes),
          finalUrl: typeof corpo.finalUrl === 'string' && corpo.finalUrl !== ''
            ? corpo.finalUrl
            : alvo.toString(),
        };
      } catch {
        // Falha de renderizacao nunca derruba a analise: ela segue com o
        // que a leitura sem navegador conseguiu.
        return null;
      } finally {
        clearTimeout(relogio);
      }
    },
  };
}

/**
 * Renderizador local, com Playwright no proprio processo.
 *
 * A importacao do Playwright e **dinamica e dentro do try**: assim o pacote
 * nao entra no grafo de dependencias de quem nao o configurou, e a ausencia
 * dele vira "nao renderizou" em vez de erro de inicializacao. E o que permite
 * esta funcao existir no codigo sem pesar no deploy da Vercel.
 *
 * O navegador sobe uma vez e e reaproveitado entre paginas: subir um por
 * pagina gastaria mais tempo iniciando do que lendo.
 */
export function createLocalRenderer(options: { moduleName?: string } = {}): PageRenderer {
  /**
   * Qual pacote carregar.
   *
   * Configuravel porque as instalacoes divergem: umas tem `playwright`,
   * outras so o `playwright-core`, e um self-hosted pode querer apontar para
   * um caminho proprio. Um nome fixo no codigo obrigaria a mexer no codigo
   * para trocar de pacote.
   */
  const moduleName = options.moduleName ?? 'playwright';
  let navegador: { newPage: () => Promise<unknown>; close: () => Promise<void> } | null = null;
  let indisponivel = false;

  return {
    kind: 'local',
    render: async (url, options = {}) => {
      if (indisponivel) return null;

      let alvo: URL;
      try {
        alvo = new URL(url);
      } catch {
        return null;
      }
      if (alvo.protocol !== 'http:' && alvo.protocol !== 'https:') return null;
      if (!checkImportHostname(alvo.hostname).ok) return null;

      const timeoutMs = options.timeoutMs ?? IMPORT_LIMITS.requestTimeoutMs * 2;

      try {
        if (navegador === null) {
          /**
           * Especificador em variavel, de proposito.
           *
           * O Playwright **nao e** dependencia deste projeto, e nao pode ser:
           * uma dependencia entra no grafo do empacotador e soma um Chromium
           * ao pacote da funcao da Vercel, que tem teto de tamanho. Com o
           * nome numa variavel, nem o compilador nem o empacotador resolvem o
           * modulo -- ele so e procurado em tempo de execucao, em instalacao
           * que o tenha. Onde nao houver, a importacao falha e a analise
           * segue sem navegador.
           */
          type Chromium = {
            launch: (opcoes: Record<string, unknown>) => Promise<{
              newPage: () => Promise<unknown>;
              close: () => Promise<void>;
            }>;
          };
          const modulo = (await import(moduleName)) as unknown as {
            chromium?: Chromium;
            default?: { chromium?: Chromium };
          };

          /**
           * O Playwright e um pacote CommonJS.
           *
           * Carregado por `import()` a partir de codigo ESM, os exports dele
           * podem aparecer no topo ou debaixo de `default`, conforme como o
           * Node resolveu o pacote -- por nome ou por caminho. Olhar so um
           * dos dois faz o renderizador falhar em metade das instalacoes, com
           * a mensagem inutil de que `chromium` nao existe.
           */
          const chromium = modulo.chromium ?? modulo.default?.chromium;
          if (!chromium) {
            indisponivel = true;
            return null;
          }

          navegador = await chromium.launch({
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
          });
        }

        const pagina = (await navegador.newPage()) as {
          goto: (endereco: string, opcoes: Record<string, unknown>) => Promise<unknown>;
          content: () => Promise<string>;
          url: () => string;
          close: () => Promise<void>;
        };

        try {
          await pagina.goto(alvo.toString(), { waitUntil: 'networkidle', timeout: timeoutMs });
          const html = await pagina.content();
          const finalUrl = pagina.url();
          return { html: html.slice(0, IMPORT_LIMITS.maxHtmlBytes), finalUrl };
        } finally {
          await pagina.close().catch(() => undefined);
        }
      } catch {
        // Playwright ausente, navegador que nao sobe, pagina que nao carrega:
        // todos dao no mesmo para quem chamou -- segue sem renderizar.
        if (navegador === null) indisponivel = true;
        return null;
      }
    },
  };
}

/** Renderizador de teste: devolve o HTML combinado, sem navegador nenhum. */
export function createMemoryRenderer(paginas: Record<string, string>): PageRenderer {
  return {
    kind: 'memoria',
    render: async (url) => {
      const limpo = url.replace(/#.*$/, '');
      const html =
        paginas[limpo] ?? paginas[limpo.replace(/\/$/, '')] ?? paginas[`${limpo}/`] ?? '';
      return html === '' ? null : { html, finalUrl: limpo };
    },
  };
}

/**
 * Monta o renderizador a partir da configuracao.
 *
 * Sem configuracao, devolve o que nao renderiza -- e o padrao seguro, e e o
 * que roda hoje em producao.
 */
export function createRendererFromEnv(env: {
  IMPORT_RENDER_MODE?: string;
  IMPORT_RENDER_URL?: string;
  IMPORT_RENDER_SECRET?: string;
  IMPORT_RENDER_MODULE?: string;
}): PageRenderer {
  const modo = (env.IMPORT_RENDER_MODE ?? 'nenhum').toLowerCase();

  if (modo === 'remoto') {
    const endpoint = env.IMPORT_RENDER_URL ?? '';
    if (endpoint === '') return createNullRenderer();
    return createRemoteRenderer({
      endpoint,
      ...(env.IMPORT_RENDER_SECRET !== undefined ? { secret: env.IMPORT_RENDER_SECRET } : {}),
    });
  }

  if (modo === 'local') {
    return createLocalRenderer(
      env.IMPORT_RENDER_MODULE !== undefined && env.IMPORT_RENDER_MODULE !== ''
        ? { moduleName: env.IMPORT_RENDER_MODULE }
        : {},
    );
  }

  return createNullRenderer();
}
