/**
 * Consentimento de cookies para os sites do CODECA Build.
 *
 * O que este arquivo e: o **mecanismo**. Ele guarda a escolha, avisa quem
 * precisa saber, e segura o que nao foi autorizado. A interface visual vive em
 * `consent-ui.ts`, separada de proposito -- um site com desenho proprio usa so
 * este nucleo e desenha o resto.
 *
 * Tres decisoes que vale explicar:
 *
 * **Sem dependencia.** O pacote inteiro nao tem nenhuma, e isso nao e enfeite:
 * um gerenciador de consentimento que arrasta um framework passa a ser a maior
 * coisa carregada antes do consentimento, e justamente na primeira visita.
 *
 * **A escolha nao sai do dominio.** Ela vive no `localStorage` do site, que o
 * navegador ja isola por origem. Nao ha cookie de terceiro, nao ha
 * identificador de visitante, e o site de um cliente nao enxerga a escolha
 * feita noutro -- sem precisar de nenhum codigo para isso.
 *
 * **Nada opcional comeca ligado.** A LGPD pede consentimento previo para o que
 * nao e necessario, e a ANPD trata "pre-marcado" como consentimento nao
 * obtido. O estado inicial e: necessarios sim, o resto nao.
 */

/** Versao do mecanismo. Entra no registro para a escolha ser rastreavel. */
export const CONSENT_ENGINE_VERSION = '1';

/** Onde a escolha mora. Prefixo com o dominio por clareza, nao por isolamento. */
const CHAVE = 'codeca:consentimento';

export type ConsentCategory = 'necessarios' | 'preferencias' | 'estatisticas' | 'marketing';

/**
 * As quatro categorias, e o que cabe em cada uma.
 *
 * `necessarios` nao aparece em escolha nenhuma porque nao e escolha: sem ele
 * o site nao funciona, e pedir autorizacao para algo que nao se pode recusar e
 * teatro, nao consentimento.
 */
export const CONSENT_CATEGORIES: ReadonlyArray<{
  id: ConsentCategory;
  titulo: string;
  descricao: string;
  /** `true` so em `necessarios`: nao pode ser desligado. */
  obrigatoria: boolean;
}> = [
  {
    id: 'necessarios',
    titulo: 'Necessários',
    descricao:
      'Fazem o site funcionar: manter você conectado, lembrar o que você colocou num formulário e proteger contra uso indevido. Sem eles o site não responde, por isso ficam sempre ativos.',
    obrigatoria: true,
  },
  {
    id: 'preferencias',
    titulo: 'Preferências',
    descricao:
      'Guardam escolhas suas, como idioma ou o modo de exibição, para não precisar repeti-las a cada visita.',
    obrigatoria: false,
  },
  {
    id: 'estatisticas',
    titulo: 'Estatísticas',
    descricao:
      'Mostram quais páginas são mais visitadas e como o site é usado, para melhorá-lo. Os dados são agregados.',
    obrigatoria: false,
  },
  {
    id: 'marketing',
    titulo: 'Marketing',
    descricao:
      'Permitem medir campanhas e mostrar anúncios mais relevantes em outros sites.',
    obrigatoria: false,
  },
];

/** As categorias que o visitante pode recusar. */
export const CATEGORIAS_OPCIONAIS = CONSENT_CATEGORIES.filter((c) => !c.obrigatoria).map(
  (c) => c.id,
);

export type ConsentDecision = Record<ConsentCategory, boolean>;

/**
 * O registro de uma escolha.
 *
 * Guarda o necessario para provar o consentimento, e nada alem: nao ha IP, nao
 * ha identificador de pessoa, nao ha o que a pessoa visitou. O `id` e aleatorio
 * e serve so para distinguir uma escolha da seguinte.
 */
export interface ConsentRecord {
  id: string;
  /** ISO 8601. */
  decidedAt: string;
  domain: string;
  granted: ConsentCategory[];
  denied: ConsentCategory[];
  /** Versao da politica vigente quando a pessoa decidiu. */
  policyVersion: string;
  engineVersion: string;
}

export interface ConsentOptions {
  /**
   * Versao da politica de cookies do site.
   *
   * Mudou a politica, muda esta versao: a escolha anterior deixa de valer e o
   * banner volta. E a unica forma honesta de pedir de novo quando o que se
   * pede mudou.
   */
  policyVersion: string;
  /**
   * Para onde enviar o registro agregado, se houver.
   *
   * Opcional de proposito: um site que nao queira enviar nada continua em
   * conformidade -- a escolha ja esta guardada no navegador de quem decidiu.
   */
  reportTo?: string;
  /** Troca o relogio nos testes. */
  now?: () => Date;
}

export interface ConsentState {
  /** `null` enquanto a pessoa nao decidiu: e o que faz o banner aparecer. */
  record: ConsentRecord | null;
  decision: ConsentDecision;
}

const PADRAO: ConsentDecision = {
  necessarios: true,
  preferencias: false,
  estatisticas: false,
  marketing: false,
};

function decisaoDe(record: ConsentRecord | null): ConsentDecision {
  if (!record) return { ...PADRAO };
  const decisao = { ...PADRAO };
  for (const categoria of record.granted) decisao[categoria] = true;
  return decisao;
}

function lerGuardado(policyVersion: string): ConsentRecord | null {
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (!bruto) return null;
    const dado: unknown = JSON.parse(bruto);
    if (!dado || typeof dado !== 'object') return null;
    const registro = dado as ConsentRecord;
    if (typeof registro.decidedAt !== 'string' || !Array.isArray(registro.granted)) return null;
    /*
      Politica nova invalida a escolha antiga.
      Continuar valendo seria tratar um "sim" dado a outro texto como se fosse
      um "sim" a este -- que e exatamente o que a lei nao aceita.
    */
    if (registro.policyVersion !== policyVersion) return null;
    return registro;
  } catch {
    // Navegacao privada, armazenamento bloqueado, JSON corrompido: trata-se
    // como "ainda nao decidiu". O banco pergunta de novo, que e o lado seguro.
    return null;
  }
}

function idAleatorio(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

export type ConsentListener = (estado: ConsentState) => void;

export interface ConsentManager {
  /** O estado agora. */
  get: () => ConsentState;
  /** A pessoa ja decidiu alguma coisa nesta versao da politica? */
  decidiu: () => boolean;
  /** Uma categoria especifica esta autorizada? */
  permite: (categoria: ConsentCategory) => boolean;
  /** Aceita tudo. */
  aceitarTudo: () => void;
  /** Recusa todo o opcional. Tao simples quanto aceitar -- a lei pede isso. */
  recusarOpcionais: () => void;
  /** Salva uma escolha por categoria. `necessarios` e ignorado: e sempre sim. */
  salvar: (escolha: Partial<Record<ConsentCategory, boolean>>) => void;
  /**
   * Apaga a escolha e volta ao estado inicial.
   *
   * O banner reaparece, e o que dependia de autorizacao para de rodar na
   * proxima carga. Ver `limparCookiesDe` para o que ja foi gravado.
   */
  revogar: () => void;
  /** Avisa a cada mudanca. Devolve a funcao que cancela. */
  aoMudar: (ouvinte: ConsentListener) => () => void;
}

export function createConsentManager(options: ConsentOptions): ConsentManager {
  const agora = options.now ?? (() => new Date());
  let record = lerGuardado(options.policyVersion);
  const ouvintes = new Set<ConsentListener>();

  const estado = (): ConsentState => ({ record, decision: decisaoDe(record) });

  const avisar = () => {
    const atual = estado();
    for (const ouvinte of ouvintes) ouvinte(atual);
  };

  const gravar = (decisao: ConsentDecision) => {
    const granted = (Object.keys(decisao) as ConsentCategory[]).filter((c) => decisao[c]);
    const denied = (Object.keys(decisao) as ConsentCategory[]).filter((c) => !decisao[c]);
    const novo: ConsentRecord = {
      id: idAleatorio(),
      decidedAt: agora().toISOString(),
      domain: typeof location !== 'undefined' ? location.hostname : '',
      granted,
      denied,
      policyVersion: options.policyVersion,
      engineVersion: CONSENT_ENGINE_VERSION,
    };
    record = novo;
    try {
      window.localStorage.setItem(CHAVE, JSON.stringify(novo));
    } catch {
      // Sem armazenamento a escolha vale so nesta aba. Melhor do que recusar
      // a decisao e deixar o banner travado na frente da pessoa.
    }
    relatar(options.reportTo, novo);
    avisar();
  };

  return {
    get: estado,
    decidiu: () => record !== null,
    permite: (categoria) => decisaoDe(record)[categoria],
    aceitarTudo: () =>
      gravar({ necessarios: true, preferencias: true, estatisticas: true, marketing: true }),
    recusarOpcionais: () => gravar({ ...PADRAO }),
    salvar: (escolha) =>
      gravar({
        ...PADRAO,
        ...escolha,
        // Nunca sai do ar, venha o que vier no argumento.
        necessarios: true,
      }),
    revogar: () => {
      record = null;
      try {
        window.localStorage.removeItem(CHAVE);
      } catch {
        // Idem: sem armazenamento, a revogacao vale nesta aba.
      }
      avisar();
    },
    aoMudar: (ouvinte) => {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
  };
}

/**
 * Envia o registro, sem bloquear a pagina e sem levar nada do visitante junto.
 *
 * **Por que nao `navigator.sendBeacon`.** Ele parecia a escolha obvia -- foi
 * feito exatamente para descarregar dado enquanto a pagina fecha -- mas a
 * requisicao dele tem o modo de credenciais em `include`, por especificacao e
 * sem como desligar. Duas consequencias, as duas ruins:
 *
 * 1. O navegador anexaria os cookies que o visitante tenha do dominio da
 *    plataforma. Num registro que existe JUSTAMENTE para ser anonimo, mandar o
 *    cookie de sessao de quem por acaso esta logado no painel e o oposto do
 *    que se quer -- e ele chega ao log de acesso antes de qualquer codigo
 *    nosso rodar.
 * 2. Com credenciais, o preflight passa a exigir
 *    `Access-Control-Allow-Credentials: true` na resposta. Sem isso o
 *    navegador descarta a requisicao em silencio. Visto em Chromium: o banner
 *    funcionava, a escolha era guardada, e o registro simplesmente nao
 *    aparecia no banco.
 *
 * `fetch` com `keepalive` sobrevive a saida da pagina do mesmo jeito e aceita
 * `credentials: 'omit'`. A escolha e registrada num clique, nao no
 * fechamento, entao a diferenca de confiabilidade nem pesa aqui.
 *
 * O corpo leva so o que esta no `ConsentRecord`: nenhum IP, nenhum
 * identificador de pessoa, nenhuma pagina visitada.
 */
function relatar(url: string | undefined, registro: ConsentRecord): void {
  if (!url) return;
  try {
    void fetch(url, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registro),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // O registro e desejavel, nao essencial: a escolha ja vale no navegador.
  }
}
