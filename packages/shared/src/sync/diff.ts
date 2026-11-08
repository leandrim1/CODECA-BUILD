import { normalizeSpace } from '../import/html.js';
import { candidatePreview, type ImportCandidate } from '../import/mapping.js';
import { MEDIA_TARGET, type ImportTarget } from '../import/types.js';
import type { SyncChangeType } from './types.js';

/**
 * Comparacao de tres pontas.
 *
 * O coracao da protecao contra conflito. Comparar a origem com a CODECA Build
 * **nao basta**: os dois lados divergem tanto quando a origem mudou quanto
 * quando o cliente editou no painel, e tratar os dois casos igual acabaria
 * desfazendo o trabalho dele.
 *
 * Por isso guardamos uma terceira ponta: o **baseline**, que e o que a origem
 * dizia na ultima vez que sincronizamos. Com as tres pontas a pergunta deixa
 * de ser "estao diferentes?" e passa a ser "quem mudou?":
 *
 * | origem x baseline | codeca x baseline | conclusao              |
 * |-------------------|-------------------|------------------------|
 * | igual             | igual             | nada aconteceu         |
 * | igual             | diferente         | so o cliente editou -- nao e alteracao |
 * | diferente         | igual             | so a origem mudou -- alteracao simples |
 * | diferente         | diferente         | **conflito**           |
 *
 * A terceira linha e o caso comum e entra como alteracao normal. A quarta e a
 * que exige decisao humana, e e exatamente o cenario do item 7 do pedido: o
 * cliente reescreveu a descricao no painel e a origem tambem mudou.
 */

/** Uma ponta da comparacao, ja reduzida ao que importa. */
export interface DiffSide {
  /** Valor cru, para gravar e exibir. */
  value: unknown;
  /** Forma normalizada, que decide igualdade. */
  fingerprint: string;
  /** `true` quando este lado nao tem o conteudo. */
  missing: boolean;
}

export const MISSING: DiffSide = { value: null, fingerprint: '', missing: true };

/**
 * Reduz um valor a forma que decide igualdade.
 *
 * Espaco, quebra de linha e maiuscula entram: um site que troca `<br>` por
 * `<p>` muda o HTML sem mudar o que esta escrito, e acusar isso como alteracao
 * encheria a tela de ruido todo dia. Maiuscula fica **de fora** da
 * normalizacao de texto curto -- trocar "Clinica Sorriso" por "CLINICA
 * SORRISO" e uma alteracao de verdade na marca da empresa.
 */
export function fingerprint(value: unknown): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') {
    // Espacos colapsados e pontuacao de fim descartada: `Sobre nos.` e
    // `Sobre nos` sao o mesmo texto para quem le.
    return normalizeSpace(value).replace(/[\s.;,]+$/, '');
  }

  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value.map((item) => fingerprint(item)).join('\u0001');
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Ordem das chaves nao e conteudo: um gerador de site pode troca-la entre
    // duas publicacoes sem nada ter mudado.
    return Object.keys(record)
      .filter((key) => !key.startsWith('__'))
      .sort()
      .map((key) => `${key}\u0002${fingerprint(record[key])}`)
      .join('\u0001');
  }

  return '';
}

/**
 * Numero de telefone, e-mail e endereco pedem uma normalizacao propria?
 *
 * Nao. `(34) 99999-1111` e `34999991111` sao o mesmo numero, e seria tentador
 * compara-los so pelos digitos -- mas o campo do painel guarda o texto
 * formatado, e o cliente ve esse texto no site dele. Se a origem passou a
 * escrever o telefone de outro jeito, isso **e** uma alteracao que ele pode
 * querer (ou nao) trazer. Entao a comparacao e do texto, e a decisao e dele.
 */

export function sideOf(value: unknown): DiffSide {
  if (value === null || value === undefined) return MISSING;
  const print = fingerprint(value);
  if (print === '') return { value, fingerprint: '', missing: true };
  return { value, fingerprint: print, missing: false };
}

export interface ThreeWayInput {
  /** O que a origem dizia na ultima sincronizacao. */
  baseline: DiffSide;
  /** O que a origem diz agora. */
  source: DiffSide;
  /** O que esta na CODECA Build agora. */
  codeca: DiffSide;
  /**
   * A impressao do que a CODECA tinha **na ultima sincronizacao**.
   *
   * Sem isto, "o cliente editou?" era respondido comparando o painel de hoje
   * com o que a **origem** dizia -- o que so funciona quando os dois estavam
   * iguais. Eles frequentemente nao estao: a importacao recusa sobrescrever
   * campo ja preenchido, entao um telefone pode nascer diferente dos dois
   * lados sem ninguem ter editado nada. Naquele desenho, a primeira mudanca
   * na origem virava "conflito" para um campo que o cliente nunca tocou.
   *
   * Ausente, cai no valor da origem -- que e o certo quando o conteudo veio
   * de la e foi aceito como estava.
   */
  codecaAtBaseline?: string;
  /** `true` quando o conteudo e uma imagem. */
  image?: boolean;
}

export type ThreeWayVerdict =
  | { kind: 'sem_alteracao' }
  /** So o cliente mexeu. A origem nao tem nada novo a oferecer. */
  | { kind: 'apenas_local' }
  | { kind: 'alteracao'; type: SyncChangeType; conflict: boolean };

/**
 * Decide o que fazer com um conteudo, olhando as tres pontas.
 *
 * Devolve `apenas_local` em vez de "sem alteracao" quando so o cliente mexeu:
 * sao a mesma coisa para a tela (nada a revisar), mas distingui-los permite ao
 * verificador avancar o baseline sem sugerir nada, e a um teste provar que a
 * edicao do cliente nao virou alteracao pendente.
 */
export function compareThreeWay(input: ThreeWayInput): ThreeWayVerdict {
  const { baseline, source, codeca } = input;
  const imagem = input.image === true;

  const codecaAnterior = input.codecaAtBaseline ?? baseline.fingerprint;

  const origemMudou = source.fingerprint !== baseline.fingerprint;
  const clienteMudou = codeca.fingerprint !== codecaAnterior;

  if (!origemMudou) {
    return clienteMudou ? { kind: 'apenas_local' } : { kind: 'sem_alteracao' };
  }

  // A origem mudou. Resta saber se o cliente tambem mexeu, e de que tipo e a
  // mudanca da origem.
  const conflict = clienteMudou;

  if (source.missing) {
    /**
     * Sumiu da origem.
     *
     * Nunca vira exclusao automatica: o item 8 do pedido e explicito, e a
     * decisao de apagar conteudo de um cliente nao pode nascer de um site
     * que ficou fora do ar por dez minutos.
     */
    return { kind: 'alteracao', type: imagem ? 'imagem_removida' : 'removido', conflict: false };
  }

  /**
   * A CODECA ja esta igual ao que a origem diz agora.
   *
   * Nao ha o que sugerir: so gravar o baseline. Esta checagem vem **antes**
   * da de baseline ausente, e e isso que evita o pior momento da
   * funcionalidade -- a primeira verificacao logo depois de conectar.
   *
   * Nesse instante o baseline esta vazio (nunca sincronizamos) mas o conteudo
   * ja esta no painel, porque veio da importacao. Sem esta ordem, cada campo
   * e cada registro apareceria como "novo conteudo", e o cliente receberia
   * dezenas de alteracoes pendentes propondo trazer o que ele acabou de
   * trazer.
   *
   * Tambem cobre o caso de o cliente aplicar a mesma mudanca a mao antes de a
   * verificacao rodar.
   */
  if (!codeca.missing && codeca.fingerprint === source.fingerprint) {
    return { kind: 'apenas_local' };
  }

  if (baseline.missing) {
    // Apareceu agora na origem. Se a CODECA ja tem algo diferente no lugar, e
    // conflito: o cliente pode ter preenchido o campo a mao no meio tempo.
    return {
      kind: 'alteracao',
      type: imagem ? 'imagem_nova' : 'novo',
      conflict: !codeca.missing,
    };
  }

  return {
    kind: 'alteracao',
    type: imagem ? 'imagem_modificada' : 'modificado',
    conflict,
  };
}

// ------------------------------------------------------ chave do conteudo

/**
 * Identidade de um conteudo entre duas verificacoes.
 *
 * E o que permite dizer "este servico e o mesmo de antes, com o texto
 * trocado" em vez de "sumiu um servico e apareceu outro". Para campo de
 * documento a chave e obvia; para registro de colecao usamos o titulo
 * normalizado, que e o que o site tem de mais estavel.
 *
 * Consequencia assumida: renomear um servico na origem aparece como um
 * removido mais um novo, nao como um modificado. Casar por semelhanca de
 * texto resolveria alguns casos e erraria outros em silencio -- e aqui errar
 * significa sobrescrever o servico errado no site de um cliente.
 */
export function syncKey(input: {
  target: ImportTarget;
  fieldKey?: string;
  label?: string;
  url?: string;
}): string {
  if (input.target === MEDIA_TARGET) return `${MEDIA_TARGET}:${input.url ?? ''}`;
  if (input.fieldKey !== undefined && input.fieldKey !== '') {
    return `${input.target}:${input.fieldKey}`;
  }
  return `${input.target}:${normalizeKeyText(input.label ?? '')}`;
}

/** Texto reduzido ao que identifica, para a chave nao variar com acento e caixa. */
export function normalizeKeyText(input: string): string {
  return normalizeSpace(input)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Chave de um candidato recem-extraido da origem. */
export function keyOfCandidate(candidate: ImportCandidate): string {
  if (candidate.kind === 'documento_campo') {
    return syncKey({ target: candidate.target, fieldKey: candidate.fieldKey });
  }
  if (candidate.kind === 'imagem') {
    return syncKey({ target: candidate.target, url: candidate.url });
  }
  return syncKey({ target: candidate.target, label: candidate.label });
}

/** Valor comparavel de um candidato. */
export function valueOfCandidate(candidate: ImportCandidate): unknown {
  if (candidate.kind === 'documento_campo') return candidate.value;
  if (candidate.kind === 'imagem') {
    // Endereco e texto alternativo: trocar a foto mantendo o nome do arquivo e
    // alteracao, e so o conteudo do arquivo denuncia -- por isso o verificador
    // tambem compara o resumo criptografico quando consegue baixar.
    return { url: candidate.url, alt: candidate.alt };
  }
  return candidate.value;
}

/** Como a alteracao aparece na tela, em uma linha. */
export function previewOf(value: unknown): string {
  return candidatePreview(value);
}
