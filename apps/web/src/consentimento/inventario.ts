/**
 * O que o PAINEL guarda no navegador de quem o usa.
 *
 * Esta lista e a fonte: dela saem a tabela da Politica de Cookies, as
 * categorias que o modal de preferencias mostra e a decisao de exibir ou nao o
 * banner. Duas listas escritas a mao divergem -- e uma politica de cookies que
 * diverge do que o software faz e pior do que nao ter politica.
 *
 * Nao vale para os sites dos clientes. Aqueles carregam o `@codeca/sdk`, que
 * tem banner, categorias e registro proprios, declarados pela empresa dona do
 * site no painel mestre. Esta lista fala so do painel.
 */

/** As categorias que a LGPD justifica separar. */
export const CATEGORIAS = ['necessarios', 'estatisticos', 'marketing'] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/** As duas que a pessoa pode recusar sem perder o acesso. */
export const CATEGORIAS_OPCIONAIS = ['estatisticos', 'marketing'] as const satisfies readonly Categoria[];
export type CategoriaOpcional = (typeof CATEGORIAS_OPCIONAIS)[number];

export const NOME_DA_CATEGORIA: Readonly<Record<Categoria, string>> = {
  necessarios: 'Necessários',
  estatisticos: 'Estatísticos',
  marketing: 'Marketing',
};

export const TEXTO_DA_CATEGORIA: Readonly<Record<Categoria, string>> = {
  necessarios:
    'Mantêm você conectado e protegem a sua sessão. Sem eles não há como entrar: por isso não podem ser desligados.',
  estatisticos:
    'Medem como o painel é usado, para saber o que melhorar. Nunca identificam você individualmente.',
  marketing:
    'Serviriam para anúncios ou para medir campanhas. O painel não tem publicidade.',
};

/**
 * Versao da politica.
 *
 * Mudar este valor faz toda escolha guardada deixar de valer e o banner
 * voltar. E um numero que alguem digita ao mudar o que se pergunta -- nao algo
 * que o codigo incrementa sozinho, senao pedir de novo viraria acidente.
 *
 * ACRESCENTAR UMA FERRAMENTA A `FERRAMENTAS_OPCIONAIS` EXIGE MUDAR ESTE
 * NUMERO. A decisao guardada diz "aceito o que me foi apresentado"; se a
 * lista cresce e a versao nao muda, quem ja respondeu nunca e perguntado
 * sobre a ferramenta nova -- ela ficaria bloqueada para sempre, e a pessoa
 * sem a chance de autoriza-la.
 */
export const VERSAO_DA_POLITICA = '1';

/** Chave onde a decisao mora. Entra na propria lista de armazenamento abaixo. */
export const CHAVE_DO_CONSENTIMENTO = 'codeca:consentimento';

export interface CookieDoPainel {
  nome: string;
  finalidade: string;
  duracao: string;
  /** `false` quando o painel precisa ler o valor por JavaScript. */
  httpOnly: boolean;
  categoria: Categoria;
}

/**
 * Os cookies que o painel coloca. Todos de primeira parte e todos necessarios
 * -- conferidos em `apps/api/src/lib/cookies.ts`, `login-code.ts`,
 * `oauth-state.ts` e `analytics/oauth-state.ts`.
 */
export const COOKIES_DO_PAINEL: readonly CookieDoPainel[] = [
  {
    nome: 'codeca_session',
    finalidade:
      'Mantém você conectado. Guarda um valor sorteado que não diz nada sobre você; os dados da sessão ficam no nosso banco.',
    duracao: '12 horas, ou 30 dias com "continuar conectado"',
    httpOnly: true,
    categoria: 'necessarios',
  },
  {
    nome: 'codeca_csrf',
    finalidade:
      'Protege contra requisições forjadas por outro site: o painel reenvia este valor em um cabeçalho, e o servidor confere se os dois batem.',
    duracao: 'A mesma da sessão',
    httpOnly: false,
    categoria: 'necessarios',
  },
  {
    nome: 'codeca_login_pending',
    finalidade:
      'Liga o código enviado ao seu e-mail ao navegador que começou o acesso. Só existe entre pedir o código e digitá-lo.',
    duracao: '15 minutos',
    httpOnly: true,
    categoria: 'necessarios',
  },
  {
    nome: 'codeca_oauth_state',
    finalidade:
      'Protege o login com Google: garante que o retorno do Google pertence ao navegador que iniciou o acesso.',
    duracao: '10 minutos',
    httpOnly: true,
    categoria: 'necessarios',
  },
  {
    nome: 'codeca_ga_state',
    finalidade:
      'A mesma proteção, ao conectar uma conta do Google Analytics às estatísticas do seu site.',
    duracao: '10 minutos',
    httpOnly: true,
    categoria: 'necessarios',
  },
];

export interface ChaveLocal {
  chave: string;
  guarda: string;
}

/** O que fica no `localStorage`. Nada disto chega aos nossos servidores. */
export const ARMAZENAMENTO_DO_PAINEL: readonly ChaveLocal[] = [
  { chave: 'codeca:tema', guarda: 'Se você escolheu o tema claro, escuro ou o do sistema.' },
  {
    chave: 'codeca:tenant-selecionado',
    guarda: 'Qual empresa o painel abre, quando você tem acesso a mais de uma.',
  },
  { chave: 'codeca:menu-grupos-fechados', guarda: 'Quais grupos do menu você deixou recolhidos.' },
  {
    chave: 'codeca:plataforma-menu-recolhido',
    guarda: 'Se a barra lateral da área restrita fica recolhida.',
  },
  { chave: CHAVE_DO_CONSENTIMENTO, guarda: 'A sua escolha de cookies e a data em que você a fez.' },
];

export interface FerramentaOpcional {
  chave: string;
  nome: string;
  fornecedor: string;
  categoria: CategoriaOpcional;
  finalidade: string;
  /** Nomes ou prefixos (`_ga_*`) dos cookies que ela deixa. */
  cookies: readonly string[];
}

/**
 * As ferramentas opcionais do painel. Hoje: nenhuma.
 *
 * A lista vazia NAO e um esqueleto a preencher depois -- e o estado real,
 * conferido no levantamento: dentro de `/painel` nao ha script de terceiro,
 * nao ha medicao de audiencia e nao ha pixel. O unico terceiro do aplicativo e
 * o Cloudflare Turnstile, e ele so aparece em `/criar-conta` e
 * `/esqueci-a-senha`, fora do painel, como defesa contra automacao: sem ele
 * essas telas nao abrem, entao ele nao e opcional nem seria honesto perguntar.
 *
 * Enquanto ela estiver vazia o banner NAO aparece, e isso e deliberado: pedir
 * autorizacao para o que ninguem pode recusar treina a pessoa a clicar em
 * "aceitar" sem ler, e gasta a unica pergunta que vale a pena fazer. O
 * mecanismo inteiro ja esta de pe -- hook, portao, modal e a entrada no menu;
 * acrescentar uma linha aqui faz o banner aparecer e o script so carregar
 * depois do sim.
 */
export const FERRAMENTAS_OPCIONAIS: readonly FerramentaOpcional[] = [];

/** As categorias opcionais que alguma ferramenta declarada usa. */
export function categoriasOpcionaisEmUso(
  ferramentas: readonly FerramentaOpcional[] = FERRAMENTAS_OPCIONAIS,
): CategoriaOpcional[] {
  return CATEGORIAS_OPCIONAIS.filter((categoria) =>
    ferramentas.some((ferramenta) => ferramenta.categoria === categoria),
  );
}

/** Ha algo a perguntar? Se nao ha, nao ha banner. */
export function haOpcionais(ferramentas: readonly FerramentaOpcional[] = FERRAMENTAS_OPCIONAIS): boolean {
  return categoriasOpcionaisEmUso(ferramentas).length > 0;
}
