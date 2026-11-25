/**
 * Ponto de entrada do mapa: `@codeca/sdk/map`.
 *
 * Importar este modulo REGISTRA o elemento `<codeca-map>`. Em site React
 * basta `import '@codeca/sdk/map'` uma vez e usar a tag no JSX; em pagina
 * estatica, uma linha de `<script type="module">`.
 *
 * Separado do cliente de conteudo de proposito: quem nao mostra mapa nao
 * carrega nada disto.
 */
import { montarMapa, type CodecaMapAddress, type CodecaMapOptions, type CodecaMapSettings } from './map.js';

export { montarMapa, enderecoEmTexto, linksDeRota, TILES } from './map.js';
export type { CodecaMapAddress, CodecaMapOptions, CodecaMapSettings } from './map.js';

/**
 * `<codeca-map>`: o mapa como elemento da pagina.
 *
 * Recebe o endereco e a configuracao como atributos JSON, que e o formato que
 * a API publica ja devolve -- o site repassa o que leu, sem traduzir nada.
 *
 * ```html
 * <codeca-map
 *   address='{"street":"Rua X","number":"100","city":"Campinas","state":"SP","lat":-22.9,"lng":-47.06}'
 *   settings='{"altura":"media","carregarAoClicar":true}'
 * ></codeca-map>
 * ```
 */
export class CodecaMapElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['address', 'settings', 'label'];
  }

  private limpar: (() => void) | null = null;

  connectedCallback(): void {
    this.desenhar();
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.desenhar();
  }

  disconnectedCallback(): void {
    this.limpar?.();
    this.limpar = null;
  }

  private lerJson<T>(nome: string): T | null {
    const bruto = this.getAttribute(nome);
    if (!bruto) return null;
    try {
      return JSON.parse(bruto) as T;
    } catch {
      // Atributo malformado nao derruba a pagina do cliente: o elemento cai
      // no cartao sem coordenada, que ainda mostra o que souber.
      return null;
    }
  }

  private desenhar(): void {
    this.limpar?.();
    const address = this.lerJson<CodecaMapAddress>('address') ?? {};
    const settings = this.lerJson<CodecaMapSettings>('settings') ?? {};
    const rotulo = this.getAttribute('label');
    const opcoes: CodecaMapOptions = { address, settings, ...(rotulo ? { label: rotulo } : {}) };
    this.limpar = montarMapa(this, opcoes);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('codeca-map')) {
  customElements.define('codeca-map', CodecaMapElement);
}
