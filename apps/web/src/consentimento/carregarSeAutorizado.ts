import type { Categoria } from './inventario.js';

/**
 * O portao: o que segura o que nao foi autorizado.
 *
 * Um banner que so guarda a escolha e enfeite -- o script carrega do mesmo
 * jeito. O unico jeito confiavel de nao carregar algo e **nao o colocar na
 * pagina**, e e isso que estas funcoes fazem: elas recusam antes de criar a
 * tag, em vez de criar a tag e tentar silencia-la depois.
 *
 * O painel nao tem nenhum script opcional hoje (ver `FERRAMENTAS_OPCIONAIS`).
 * Isto existe para que o primeiro passe por aqui, e nao por um `<script>` solto
 * no `index.html` -- onde ele carregaria antes de qualquer pergunta.
 *
 * Vocabulario igual ao do `@codeca/sdk` (`data-codeca-consent` /
 * `data-codeca-src`) de proposito: quem aprendeu o portao do site do cliente
 * nao precisa aprender outro aqui.
 */

export const ATRIBUTO_CATEGORIA = 'data-codeca-consent';
export const ATRIBUTO_SRC = 'data-codeca-src';

export type Permissao = (categoria: Categoria) => boolean;

/** Scripts ja inseridos por este modulo, para nao inserir duas vezes. */
const jaCarregados = new Map<string, Promise<void>>();

export interface PedidoDeScript {
  src: string;
  categoria: Categoria;
  /** `id` do elemento; serve tambem de chave contra carga dupla. */
  id?: string;
  /** Atributos extras (`data-*`, `async`, chaves do fornecedor). */
  atributos?: Readonly<Record<string, string>>;
}

/**
 * Carrega um script **se, e somente se**, a categoria estiver autorizada.
 *
 * Devolve `false` sem tocar no DOM quando nao esta -- quem chama nao precisa
 * conferir antes, e esquecer de conferir nao vira vazamento.
 */
export function carregarScriptSeAutorizado(
  pedido: PedidoDeScript,
  permite: Permissao,
  documento: Document = document,
): Promise<boolean> {
  if (!permite(pedido.categoria)) return Promise.resolve(false);

  const chave = pedido.id ?? pedido.src;
  const existente = jaCarregados.get(chave);
  if (existente) return existente.then(() => true);

  const carga = new Promise<void>((resolve, reject) => {
    const tag = documento.createElement('script');
    tag.src = pedido.src;
    tag.async = true;
    if (pedido.id) tag.id = pedido.id;
    tag.setAttribute(ATRIBUTO_CATEGORIA, pedido.categoria);
    for (const [nome, valor] of Object.entries(pedido.atributos ?? {})) tag.setAttribute(nome, valor);
    tag.addEventListener('load', () => resolve(), { once: true });
    tag.addEventListener(
      'error',
      () => {
        // Sai do registro: uma falha de rede nao pode impedir a proxima
        // tentativa de nem criar a tag.
        jaCarregados.delete(chave);
        reject(new Error(`Não foi possível carregar ${pedido.src}`));
      },
      { once: true },
    );
    documento.head.append(tag);
  });

  jaCarregados.set(chave, carga);
  return carga.then(() => true);
}

/**
 * Libera o que ja esta no HTML marcado e desarmado.
 *
 * Um `<script type="text/plain" data-codeca-consent="estatisticos"
 * data-codeca-src="...">` nao executa -- e nao executa nem trocando o `type`,
 * porque o navegador so avalia um script ao INSERI-LO. Por isso cria-se outro
 * no lugar.
 */
export function liberarMarcados(permite: Permissao, raiz: ParentNode = document): number {
  let liberados = 0;

  for (const no of Array.from(raiz.querySelectorAll(`[${ATRIBUTO_CATEGORIA}]`))) {
    const categoria = no.getAttribute(ATRIBUTO_CATEGORIA) as Categoria | null;
    if (!categoria || !permite(categoria)) continue;

    const destino = no.getAttribute(ATRIBUTO_SRC);

    if (no instanceof HTMLScriptElement) {
      if (no.dataset.codecaLiberado === '1') continue;
      const novo = no.ownerDocument.createElement('script');
      for (const atributo of Array.from(no.attributes)) {
        if (atributo.name === 'type' || atributo.name === ATRIBUTO_SRC) continue;
        novo.setAttribute(atributo.name, atributo.value);
      }
      if (destino) novo.src = destino;
      else novo.text = no.textContent ?? '';
      novo.dataset.codecaLiberado = '1';
      no.replaceWith(novo);
      liberados += 1;
      continue;
    }

    // `<iframe>` e afins: o endereco so entra agora.
    if (destino && no instanceof HTMLElement && no.getAttribute('src') !== destino) {
      no.setAttribute('src', destino);
      liberados += 1;
    }
  }

  return liberados;
}

/** Esquece o registro de cargas. Existe para os testes, e para o logout. */
export function esquecerCarregados(): void {
  jaCarregados.clear();
}
