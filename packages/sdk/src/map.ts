/**
 * Mapa do endereco para o site do cliente.
 *
 * ## Por que web component, e nao componente React
 *
 * Este pacote tem zero dependencias, e isso e uma escolha: ele entra em site
 * React, em site Astro e em pagina estatica com uma tag `<script>`. Um
 * componente React obrigaria todos a carregar React -- e obrigaria a gente a
 * seguir a versao de React de cada cliente. Um elemento customizado funciona
 * nos tres, inclusive dentro do JSX, onde se escreve `<codeca-map ...>` como
 * qualquer outra tag.
 *
 * ## O que ele faz antes de carregar qualquer coisa
 *
 * Desenha o CARTAO: endereco em texto e botoes "Como chegar". Esse cartao e o
 * conteudo real do elemento -- sobrevive sem JavaScript, sem Leaflet e sem o
 * provedor de ladrilhos no ar. O mapa e um acrescimo em cima dele, carregado
 * so quando aparece na tela (ou so no clique, se o site pediu).
 */

export interface CodecaMapAddress {
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  lat?: number | null;
  lng?: number | null;
}

export interface CodecaMapSettings {
  zoom?: number;
  altura?: 'compacta' | 'media' | 'grande';
  estilo?: string;
  corDoPino?: string;
  mostrarControles?: boolean;
  mostrarComoChegar?: boolean;
  carregarAoClicar?: boolean;
  comoChegar?: { google?: boolean; waze?: boolean; apple?: boolean };
}

export interface CodecaMapOptions {
  address: CodecaMapAddress;
  settings?: CodecaMapSettings;
  /** Versao do Leaflet buscada do CDN quando o mapa carrega. */
  leafletVersion?: string;
  /** Rotulo acessivel do mapa. */
  label?: string;
}

const ALTURAS = { compacta: 220, media: 320, grande: 460 } as const;

/**
 * Os mesmos presets do painel, repetidos aqui de proposito.
 *
 * O SDK roda no site do cliente e nao importa `@codeca/shared` -- a plataforma
 * nao se instala no site de ninguem. A duplicacao e de DADO (tres URLs), nao
 * de regra, e um teste de contrato trava as duas listas juntas.
 */
export const TILES: Record<string, { url: string; attribution: string; maxZoom: number }> = {
  padrao: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  claro: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
  },
  escuro: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
  },
  minimalista: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
  },
};

export function enderecoEmTexto(endereco: CodecaMapAddress): string {
  const rua = [endereco.street, endereco.number].filter(Boolean).join(', ');
  const comBairro = [rua, endereco.neighborhood].filter(Boolean).join(' - ');
  const cidade = [endereco.city, endereco.state].filter(Boolean).join(' - ');
  return [comBairro, cidade].filter(Boolean).join(', ');
}

/** Links de rota a partir da coordenada. So URL: sem SDK, sem chave, sem custo. */
export function linksDeRota(
  endereco: CodecaMapAddress,
  ativos: CodecaMapSettings['comoChegar'] = { google: true, waze: true },
): Array<{ id: string; label: string; url: string }> {
  const { lat, lng } = endereco;
  if (typeof lat !== 'number' || typeof lng !== 'number') return [];
  const destino = `${lat},${lng}`;
  const links = [
    { id: 'google', label: 'Google Maps', url: `https://www.google.com/maps/dir/?api=1&destination=${destino}`, ativo: ativos?.google !== false },
    { id: 'waze', label: 'Waze', url: `https://waze.com/ul?ll=${destino}&navigate=yes`, ativo: ativos?.waze !== false },
    { id: 'apple', label: 'Apple Maps', url: `https://maps.apple.com/?daddr=${destino}`, ativo: ativos?.apple === true },
  ];
  return links.filter((link) => link.ativo).map(({ id, label, url }) => ({ id, label, url }));
}

function cartao(opcoes: CodecaMapOptions): HTMLElement {
  const { address, settings = {} } = opcoes;
  const caixa = document.createElement('div');
  caixa.className = 'codeca-map__cartao';
  caixa.style.cssText = 'display:grid;gap:8px;padding:16px;border:1px solid rgba(0,0,0,.12);border-radius:16px';

  const texto = document.createElement('p');
  texto.className = 'codeca-map__endereco';
  texto.style.cssText = 'margin:0;font-size:14px;line-height:1.5';
  texto.textContent = enderecoEmTexto(address) || 'Endereço não informado.';
  caixa.append(texto);

  if (settings.mostrarComoChegar !== false) {
    const rotas = linksDeRota(address, settings.comoChegar);
    if (rotas.length > 0) {
      const linha = document.createElement('div');
      linha.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
      for (const rota of rotas) {
        const link = document.createElement('a');
        link.href = rota.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = rota.label;
        link.style.cssText =
          'font-size:13px;text-decoration:none;border:1px solid currentColor;border-radius:999px;padding:6px 12px';
        linha.append(link);
      }
      caixa.append(linha);
    }
  }
  return caixa;
}

/**
 * Monta o mapa dentro de um elemento.
 *
 * Devolve uma funcao de limpeza. Nunca lanca: se o Leaflet ou os ladrilhos nao
 * vierem, o cartao fica -- um site de cliente nao pode quebrar porque um
 * servico de mapa de terceiros saiu do ar.
 */
export function montarMapa(alvo: HTMLElement, opcoes: CodecaMapOptions): () => void {
  const { address, settings = {} } = opcoes;
  const altura = ALTURAS[settings.altura ?? 'media'];
  const tile = TILES[settings.estilo ?? 'padrao'] ?? TILES.padrao!;
  const temCoordenada = typeof address.lat === 'number' && typeof address.lng === 'number';

  alvo.innerHTML = '';
  const raiz = document.createElement('div');
  raiz.style.cssText = 'display:grid;gap:8px';
  alvo.append(raiz);

  // O cartao vem primeiro, sempre: e o conteudo que sobrevive a tudo.
  const ficha = cartao(opcoes);

  if (!temCoordenada) {
    raiz.append(ficha);
    return () => {
      alvo.innerHTML = '';
    };
  }

  const caixaDoMapa = document.createElement('div');
  caixaDoMapa.setAttribute('role', 'region');
  caixaDoMapa.setAttribute('aria-label', opcoes.label ?? 'Mapa do endereço');
  caixaDoMapa.style.cssText = `position:relative;height:${altura}px;border-radius:16px;overflow:hidden;background:#e8eaed`;
  raiz.append(caixaDoMapa, ficha);

  let limpar = () => undefined as void;
  let carregado = false;

  async function carregar() {
    if (carregado) return;
    carregado = true;
    try {
      const L = await carregarLeaflet(opcoes.leafletVersion ?? '1.9.4');
      const mapa = L.map(caixaDoMapa, {
        center: [address.lat as number, address.lng as number],
        zoom: settings.zoom ?? 16,
        zoomControl: settings.mostrarControles !== false,
        scrollWheelZoom: false,
      });
      L.tileLayer(tile.url, { maxZoom: tile.maxZoom, attribution: tile.attribution }).addTo(mapa);
      const cor = settings.corDoPino || '#1d4ed8';
      L.marker([address.lat as number, address.lng as number], {
        icon: L.divIcon({
          className: '',
          html: `<span style="display:block;width:20px;height:20px;border-radius:999px;background:${cor};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);transform:translate(-50%,-100%)"></span>`,
          iconSize: [20, 20],
          iconAnchor: [0, 0],
        }),
      }).addTo(mapa);
      limpar = () => mapa.remove();
    } catch {
      // Falhou: o cartao continua, e o espaco do mapa sai da tela.
      caixaDoMapa.remove();
    }
  }

  if (settings.carregarAoClicar) {
    /*
      Modo "clique para carregar": nenhum ladrilho e pedido enquanto o
      visitante nao quiser o mapa. Para site com muito trafego, e a diferenca
      entre dezenas de milhares de pedidos por dia a um servico gratuito e
      quase nenhum.
    */
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = 'Ver no mapa';
    botao.style.cssText =
      'position:absolute;inset:0;width:100%;border:0;background:transparent;cursor:pointer;font-size:14px';
    caixaDoMapa.append(botao);
    botao.addEventListener('click', () => {
      botao.remove();
      void carregar();
    });
  } else if (typeof IntersectionObserver !== 'undefined') {
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          observador.disconnect();
          void carregar();
        }
      },
      { rootMargin: '200px' },
    );
    observador.observe(caixaDoMapa);
  } else {
    void carregar();
  }

  return () => {
    limpar();
    alvo.innerHTML = '';
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type LeafletGlobal = any;

/** Carrega Leaflet do CDN uma vez por pagina. */
let carregando: Promise<LeafletGlobal> | null = null;
function carregarLeaflet(versao: string): Promise<LeafletGlobal> {
  const janela = window as unknown as { L?: LeafletGlobal };
  if (janela.L) return Promise.resolve(janela.L);
  carregando ??= new Promise<LeafletGlobal>((resolver, recusar) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `https://unpkg.com/leaflet@${versao}/dist/leaflet.css`;
    document.head.append(css);

    const script = document.createElement('script');
    script.src = `https://unpkg.com/leaflet@${versao}/dist/leaflet.js`;
    script.async = true;
    script.onload = () => (janela.L ? resolver(janela.L) : recusar(new Error('leaflet ausente')));
    script.onerror = () => {
      carregando = null;
      recusar(new Error('falha ao carregar o leaflet'));
    };
    document.head.append(script);
  });
  return carregando;
}
