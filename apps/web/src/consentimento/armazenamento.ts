import {
  CATEGORIAS_OPCIONAIS,
  CHAVE_DO_CONSENTIMENTO,
  VERSAO_DA_POLITICA,
  type CategoriaOpcional,
} from './inventario.js';

/**
 * A escolha, como ela fica guardada no navegador.
 *
 * `necessarios` e sempre `true` e esta aqui de proposito: quem le o registro
 * depois -- a pessoa, no proprio navegador, ou o suporte olhando junto com ela
 * -- ve a decisao inteira, sem precisar saber que uma das categorias era
 * implicita.
 */
export interface Decisao {
  versao: string;
  /** ISO 8601, em UTC. */
  data: string;
  necessarios: true;
  estatisticos: boolean;
  marketing: boolean;
}

/** A escolha sem a papelada: o que as telas manipulam. */
export type Escolha = Record<CategoriaOpcional, boolean>;

export const ESCOLHA_VAZIA: Escolha = { estatisticos: false, marketing: false };

/**
 * `localStorage` e nao cookie, de proposito.
 *
 * A decisao e do navegador de quem usa o painel e nao precisa viajar a cada
 * requisicao -- mandar isto para o servidor em todo pedido seria trafego sem
 * destinatario. E, por nao ser cookie, guardar a escolha nao cria o problema
 * que a escolha resolve.
 */
function area(): Storage | null {
  try {
    // Em navegacao privada e com dados de site bloqueados, o acesso lanca.
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * A decisao valida para a versao atual, ou `null`.
 *
 * `null` quer dizer "ninguem decidiu ainda" em todos os casos que importam:
 * nunca houve escolha, o conteudo foi adulterado, ou a politica mudou de
 * versao. Nos tres a resposta certa e a mesma -- perguntar de novo.
 */
export function lerDecisao(): Decisao | null {
  const guardada = area();
  if (!guardada) return null;

  let bruto: string | null = null;
  try {
    bruto = guardada.getItem(CHAVE_DO_CONSENTIMENTO);
  } catch {
    return null;
  }
  if (!bruto) return null;

  try {
    const dado = JSON.parse(bruto) as Partial<Decisao> | null;
    if (!dado || typeof dado !== 'object') return null;
    // Versao diferente derruba a escolha: o que se perguntou mudou.
    if (dado.versao !== VERSAO_DA_POLITICA) return null;
    if (typeof dado.data !== 'string' || dado.data === '') return null;
    for (const categoria of CATEGORIAS_OPCIONAIS) {
      if (typeof dado[categoria] !== 'boolean') return null;
    }
    return {
      versao: VERSAO_DA_POLITICA,
      data: dado.data,
      necessarios: true,
      estatisticos: dado.estatisticos === true,
      marketing: dado.marketing === true,
    };
  } catch {
    // Conteudo de localStorage e entrada externa: outra aba, outra versao do
    // painel, ou alguem editando a mao.
    return null;
  }
}

/** Grava e devolve o que foi gravado, para quem chamou nao reconstruir. */
export function gravarDecisao(escolha: Escolha, agora: Date = new Date()): Decisao {
  const decisao: Decisao = {
    versao: VERSAO_DA_POLITICA,
    data: agora.toISOString(),
    necessarios: true,
    estatisticos: escolha.estatisticos,
    marketing: escolha.marketing,
  };
  const guardada = area();
  try {
    guardada?.setItem(CHAVE_DO_CONSENTIMENTO, JSON.stringify(decisao));
  } catch {
    /*
      Gravacao recusada (modo privado, cota cheia, dados de site bloqueados).
      A decisao vale nesta aba assim mesmo -- o que nao pode acontecer e o
      painel quebrar, ou um script opcional carregar porque a gravacao falhou.
    */
  }
  return decisao;
}

/** A escolha dentro de uma decisao guardada. */
export function escolhaDe(decisao: Decisao | null): Escolha {
  if (!decisao) return ESCOLHA_VAZIA;
  return { estatisticos: decisao.estatisticos, marketing: decisao.marketing };
}

export function esquecerDecisao(): void {
  try {
    area()?.removeItem(CHAVE_DO_CONSENTIMENTO);
  } catch {
    /* Ver `gravarDecisao`. */
  }
}
