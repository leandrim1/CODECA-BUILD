import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  CATEGORIAS_OPCIONAIS,
  FERRAMENTAS_OPCIONAIS,
  categoriasOpcionaisEmUso,
  haOpcionais,
  type Categoria,
  type CategoriaOpcional,
  type FerramentaOpcional,
} from './inventario.js';
import {
  ESCOLHA_VAZIA,
  escolhaDe,
  gravarDecisao,
  lerDecisao,
  type Decisao,
  type Escolha,
} from './armazenamento.js';

/**
 * O consentimento do painel, em um lugar so.
 *
 * Fica ACIMA das rotas, e nao dentro do painel, por um motivo pratico: o
 * rodape da pagina publica tambem precisa reabrir as preferencias. O que e
 * exclusivo do painel e o BANNER -- quem decide isso e quem o monta, nao este
 * contexto.
 */

export interface Consentimento {
  /** `null` enquanto ninguem decidiu nesta versao da politica. */
  decisao: Decisao | null;
  /** A escolha atual; tudo desligado enquanto nao ha decisao. */
  escolha: Escolha;
  /** Ha algo opcional a perguntar E ninguem respondeu ainda. */
  precisaDecidir: boolean;
  /** As categorias que alguma ferramenta declarada usa. Vazia hoje. */
  opcionaisEmUso: CategoriaOpcional[];
  ferramentas: readonly FerramentaOpcional[];
  /** A categoria pode carregar? `necessarios` sempre pode. */
  permite: (categoria: Categoria) => boolean;
  aceitarTodos: () => void;
  recusarOpcionais: () => void;
  salvar: (escolha: Escolha) => void;
  preferenciasAbertas: boolean;
  abrirPreferencias: () => void;
  fecharPreferencias: () => void;
}

const Contexto = createContext<Consentimento | null>(null);

export function ConsentimentoProvider({
  children,
  ferramentas = FERRAMENTAS_OPCIONAIS,
}: {
  children: ReactNode;
  /** Injetavel para teste; em producao vem do inventario. */
  ferramentas?: readonly FerramentaOpcional[];
}) {
  /*
    Leitura SINCRONA na montagem, e nao num efeito.

    Com efeito, o primeiro quadro sai sem decisao -- e quem ja decidiu ha meses
    veria o banner aparecer e sumir. O flash nao e um detalhe estetico: um
    banner que pisca convida ao clique errado.
  */
  const [decisao, setDecisao] = useState<Decisao | null>(() => lerDecisao());
  const [preferenciasAbertas, setPreferenciasAbertas] = useState(false);

  const opcionaisEmUso = useMemo(() => categoriasOpcionaisEmUso(ferramentas), [ferramentas]);
  const escolha = useMemo(() => escolhaDe(decisao), [decisao]);

  const salvar = useCallback((proxima: Escolha) => {
    setDecisao(gravarDecisao(proxima));
    setPreferenciasAbertas(false);
  }, []);

  const aceitarTodos = useCallback(() => {
    salvar(Object.fromEntries(CATEGORIAS_OPCIONAIS.map((c) => [c, true])) as Escolha);
  }, [salvar]);

  const recusarOpcionais = useCallback(() => salvar({ ...ESCOLHA_VAZIA }), [salvar]);

  const permite = useCallback(
    (categoria: Categoria) => {
      // O necessario nao depende de autorizacao -- e o que a LGPD dispensa, e
      // o que a pessoa nao teria como recusar sem perder o acesso.
      if (categoria === 'necessarios') return true;
      return escolha[categoria] === true;
    },
    [escolha],
  );

  const valor = useMemo<Consentimento>(
    () => ({
      decisao,
      escolha,
      // Sem ferramenta opcional declarada nao ha pergunta a fazer, e portanto
      // nao ha banner. Ver o comentario de `FERRAMENTAS_OPCIONAIS`.
      precisaDecidir: haOpcionais(ferramentas) && decisao === null,
      opcionaisEmUso,
      ferramentas,
      permite,
      aceitarTodos,
      recusarOpcionais,
      salvar,
      preferenciasAbertas,
      abrirPreferencias: () => setPreferenciasAbertas(true),
      fecharPreferencias: () => setPreferenciasAbertas(false),
    }),
    [decisao, escolha, ferramentas, opcionaisEmUso, permite, aceitarTodos, recusarOpcionais, salvar, preferenciasAbertas],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/**
 * O consentimento desta sessao.
 *
 * Fora do provedor devolve um consentimento NEUTRO em vez de lancar: o que
 * nao pode acontecer e uma tela montada sem o provedor passar a carregar o que
 * nao foi autorizado. Neutro quer dizer "so o necessario".
 */
export function useConsentimento(): Consentimento {
  const contexto = useContext(Contexto);
  if (contexto) return contexto;
  return CONSENTIMENTO_NEUTRO;
}

const CONSENTIMENTO_NEUTRO: Consentimento = {
  decisao: null,
  escolha: ESCOLHA_VAZIA,
  precisaDecidir: false,
  opcionaisEmUso: [],
  ferramentas: [],
  permite: (categoria) => categoria === 'necessarios',
  aceitarTodos: () => undefined,
  recusarOpcionais: () => undefined,
  salvar: () => undefined,
  preferenciasAbertas: false,
  abrirPreferencias: () => undefined,
  fecharPreferencias: () => undefined,
};
