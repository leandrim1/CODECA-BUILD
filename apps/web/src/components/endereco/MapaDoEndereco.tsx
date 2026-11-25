import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker, TileLayer } from 'leaflet';
import { Crosshair, Loader2, Search } from 'lucide-react';
import { Button, cx } from '@codeca/ui';
import {
  ALTURA_EM_PIXELS,
  arredondarCoordenada,
  enderecoEmUmaLinha,
  tileProvider,
  tileUrlDoTema,
  type GeoResult,
  type MapSettings,
  type NormalizedAddress,
} from '@codeca/shared';
import type { Geo } from './useGeo.js';

/**
 * O mapa, e so o mapa.
 *
 * Nao conhece provedor: recebe um `MapTileProvider` (via `settings.estilo`) e
 * um `Geo` para perguntar enderecos. Trocar OpenStreetMap por outro
 * fornecedor nao encosta neste arquivo.
 *
 * Leaflet entra por `import()` e so quando o mapa aparece na tela -- sao
 * ~150 KB que a maioria das visitas ao painel nunca precisa.
 */

/** Praca da Se, Sao Paulo: centro enquanto nao ha coordenada. */
const PADRAO: [number, number] = [-23.5505, -46.6333];

export interface MapaDoEnderecoProps {
  geo: Geo;
  settings: MapSettings;
  latitude: number | null;
  longitude: number | null;
  endereco: Partial<NormalizedAddress>;
  disabled?: boolean;
  escuro?: boolean;
  /** Pino solto, sugestao escolhida ou "centralizar": tudo sai por aqui. */
  onEndereco: (endereco: NormalizedAddress) => void;
  onCoordenada: (lat: number, lng: number) => void;
}

export function MapaDoEndereco({
  geo,
  settings,
  latitude,
  longitude,
  endereco,
  disabled,
  escuro = false,
  onEndereco,
  onCoordenada,
}: MapaDoEnderecoProps) {
  const caixa = useRef<HTMLDivElement>(null);
  const moldura = useRef<HTMLDivElement>(null);
  const mapa = useRef<LeafletMap | null>(null);
  const pino = useRef<Marker | null>(null);
  const camada = useRef<TileLayer | null>(null);
  const [visivel, setVisivel] = useState(false);
  const [pronto, setPronto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [termo, setTermo] = useState('');
  const [sugestoes, setSugestoes] = useState<GeoResult[]>([]);

  // Callbacks numa referencia: funcao nova a cada render do formulario
  // remontaria o mapa a cada tecla digitada em qualquer campo da pagina.
  const avisos = useRef({ onEndereco, onCoordenada, geo });
  avisos.current = { onEndereco, onCoordenada, geo };

  const provider = tileProvider(settings.estilo);
  const altura = ALTURA_EM_PIXELS[settings.altura];

  /** Carrega so quando entra na area visivel. */
  useEffect(() => {
    const alvo = moldura.current;
    if (!alvo || visivel) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisivel(true);
      return;
    }
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) setVisivel(true);
      },
      { rootMargin: '200px' },
    );
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [visivel]);

  async function lerPonto(lat: number, lng: number) {
    setOcupado(true);
    try {
      const encontrado = await avisos.current.geo.porCoordenada(lat, lng);
      if (encontrado) {
        avisos.current.onEndereco({
          ...encontrado,
          lat: arredondarCoordenada(lat),
          lng: arredondarCoordenada(lng),
        });
      } else {
        // Sem endereco, a coordenada ainda vale: o pino ficou onde a pessoa
        // soltou, e e isso que o site vai desenhar.
        avisos.current.onCoordenada(arredondarCoordenada(lat), arredondarCoordenada(lng));
      }
    } finally {
      setOcupado(false);
    }
  }

  useEffect(() => {
    if (!visivel) return;
    let vivo = true;

    void (async () => {
      const [L] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
      if (!vivo || !caixa.current || mapa.current) return;

      const centro: [number, number] = latitude !== null && longitude !== null ? [latitude, longitude] : PADRAO;
      const instancia = L.map(caixa.current, {
        center: centro,
        zoom: latitude !== null ? settings.zoom : 12,
        zoomControl: false,
        /*
          No celular, arrastar com UM dedo rola a pagina; o mapa so pega o
          gesto com dois dedos. Sem isso, quem rola a pagina com o polegar
          sobre o mapa fica preso dentro dele.
        */
        dragging: !L.Browser.mobile,
        tap: false,
      });
      if (L.Browser.mobile) {
        instancia.dragging.disable();
        // Um toque no mapa libera o arraste; sair dele devolve a rolagem.
        instancia.on('click', () => instancia.dragging.enable());
        instancia.on('mouseout', () => instancia.dragging.disable());
      }
      if (settings.mostrarControles) L.control.zoom({ position: 'bottomleft' }).addTo(instancia);

      camada.current = L.tileLayer(tileUrlDoTema(provider, escuro), {
        maxZoom: provider.maxZoom,
        // Exigencia da licenca do OpenStreetMap e dos mapas derivados.
        attribution: provider.attribution,
      }).addTo(instancia);

      /*
        Marcador em HTML, e nao o icone padrao do Leaflet: o padrao aponta para
        imagens por caminho relativo ao CSS, e no bundle isso quebra. De quebra,
        a cor sai da configuracao do site.
      */
      const cor = settings.corDoPino || '#1d4ed8';
      const icone = L.divIcon({
        className: '',
        html: `<span style="background:${cor}" class="block size-5 -translate-x-1/2 -translate-y-full rounded-full border-2 border-white shadow-[0_2px_8px_rgb(0_0_0/0.4)]"></span>`,
        iconSize: [20, 20],
        iconAnchor: [0, 0],
      });
      const marcador = L.marker(centro, { draggable: !disabled, icon: icone, keyboard: true }).addTo(instancia);
      marcador.on('dragend', () => {
        const { lat, lng } = marcador.getLatLng();
        void lerPonto(lat, lng);
      });
      instancia.on('click', (evento) => {
        if (disabled) return;
        marcador.setLatLng(evento.latlng);
        void lerPonto(evento.latlng.lat, evento.latlng.lng);
      });

      mapa.current = instancia;
      pino.current = marcador;
      setPronto(true);
    })();

    return () => {
      vivo = false;
      mapa.current?.remove();
      mapa.current = null;
      pino.current = null;
      camada.current = null;
    };
    // Monta uma vez, quando fica visivel: as mudancas entram pelos efeitos
    // abaixo, para nao perder o zoom e a posicao escolhidos.
  }, [visivel]);

  /** Coordenada mudou por fora (CEP, busca, localizacao): o mapa segue. */
  useEffect(() => {
    if (!pronto || latitude === null || longitude === null) return;
    pino.current?.setLatLng([latitude, longitude]);
    mapa.current?.setView([latitude, longitude], Math.max(mapa.current.getZoom(), settings.zoom));
  }, [pronto, latitude, longitude, settings.zoom]);

  /** Estilo ou tema mudou: troca a camada sem remontar o mapa. */
  useEffect(() => {
    if (!pronto || !camada.current) return;
    camada.current.setUrl(tileUrlDoTema(provider, escuro));
  }, [pronto, provider, escuro]);

  /**
   * Busca com espera de 600 ms e minimo de tres caracteres.
   *
   * Nao e capricho: e a politica de uso do provedor padrao, que pede
   * explicitamente para nao disparar autocomplete a cada tecla.
   */
  useEffect(() => {
    const consulta = termo.trim();
    if (consulta.length < 3) {
      setSugestoes([]);
      return;
    }
    const relogio = setTimeout(async () => {
      setSugestoes(await avisos.current.geo.buscar(consulta));
    }, 600);
    return () => clearTimeout(relogio);
  }, [termo]);

  function centralizar() {
    if (!('geolocation' in navigator)) return;
    setOcupado(true);
    navigator.geolocation.getCurrentPosition(
      (posicao) => {
        setOcupado(false);
        void lerPonto(posicao.coords.latitude, posicao.coords.longitude);
      },
      () => setOcupado(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  const resumo = enderecoEmUmaLinha(endereco);

  return (
    <div className="grid gap-2">
      {/*
        `isolate`: a barra de busca precisa vencer as camadas internas do
        Leaflet (que chegam a 800), e sem contexto proprio esse valor competia
        com o cabecalho fixo do painel, aparecendo por cima dele ao rolar.
      */}
      <div
        ref={moldura}
        className="relative isolate overflow-hidden rounded-2xl border border-contorno bg-slate-100"
        style={{ height: altura }}
      >
        <div className="absolute inset-x-3 top-3 z-[1000] grid gap-1">
          <div className="relative">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={termo}
              disabled={disabled}
              placeholder="Digite um endereço"
              aria-label="Buscar endereço no mapa"
              onChange={(evento) => setTermo(evento.target.value)}
              className={cx(
                'w-full rounded-xl border border-contorno bg-white py-2.5 pl-9 pr-9 text-sm text-slate-900 shadow-card',
                'focus:border-brand-500 focus:outline-2 focus:outline-brand-500/40',
              )}
            />
            {geo.carregando || ocupado ? (
              <Loader2 aria-hidden="true" className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-slate-500" />
            ) : null}
          </div>

          {sugestoes.length > 0 ? (
            <ul className="max-h-44 overflow-auto rounded-xl border border-contorno bg-white shadow-raised">
              {sugestoes.map((sugestao, indice) => (
                <li key={`${sugestao.label}-${indice}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onEndereco({ ...sugestao.address, lat: sugestao.lat, lng: sugestao.lng });
                      setSugestoes([]);
                      setTermo('');
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    {sugestao.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div ref={caixa} className="size-full" aria-label="Mapa do endereço" />

        {!visivel ? (
          <p className="absolute inset-0 grid place-items-center text-sm text-slate-500">Carregando o mapa…</p>
        ) : null}

        <button
          type="button"
          onClick={centralizar}
          disabled={disabled}
          aria-label="Centralizar na minha localização"
          className={cx(
            'absolute bottom-3 right-3 z-[1000] rounded-xl border border-contorno bg-white p-2.5 shadow-card',
            'text-slate-600 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600',
          )}
        >
          <Crosshair aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-contorno bg-white p-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Local selecionado</p>
          <p className="truncate text-sm text-slate-700">{resumo || 'Arraste o pino ou busque um endereço.'}</p>
          {latitude !== null && longitude !== null ? (
            <p className="text-xs tabular-nums text-slate-500">
              {latitude.toFixed(6)}, {longitude.toFixed(6)}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={disabled || latitude === null || longitude === null}
          loading={ocupado}
          onClick={() => {
            if (latitude !== null && longitude !== null) void lerPonto(latitude, longitude);
          }}
        >
          Confirmar local
        </Button>
      </div>
    </div>
  );
}
