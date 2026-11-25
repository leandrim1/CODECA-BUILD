import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';
import { Crosshair, Loader2, Search } from 'lucide-react';
import { Button, cx } from '@codeca/ui';
import { arredondarCoordenada } from '@codeca/shared';
import { ApiError } from '../services/api.js';
import { enderecoApi, type EnderecoEncontrado } from '../services/endpoints.js';

/**
 * Mapa para marcar onde a empresa fica.
 *
 * O Leaflet e o CSS dele entram por `import()` dentro do efeito, e nao no topo
 * do arquivo: sao ~150 KB que so interessam a quem abre a tela de contato. O
 * roteador ja separa esta pagina em um pedaco proprio; isto separa o mapa
 * dentro dela.
 *
 * As consultas de endereco passam pela nossa API (ver `lib/endereco.ts`). Os
 * ladrilhos, nao: imagem vem direto do OpenStreetMap, que e o que a CSP
 * (`img-src https:`) permite e o que a licenca deles pede que se faca.
 */

/** Praca da Se, Sao Paulo: centro quando ainda nao ha coordenada. */
const PADRAO: [number, number] = [-23.5505, -46.6333];

export interface MapaDeEnderecoProps {
  tenantId: string;
  latitude: number | null;
  longitude: number | null;
  /** Resumo mostrado no cartao de baixo, vindo dos campos do formulario. */
  resumo: string;
  disabled?: boolean;
  /** Pino solto, sugestao escolhida ou "minha localizacao": tudo passa aqui. */
  onEndereco: (endereco: EnderecoEncontrado) => void;
  /** So a coordenada mudou (arrastar sem conseguir ler o endereco). */
  onCoordenada: (latitude: number, longitude: number) => void;
}

export function MapaDeEndereco({
  tenantId,
  latitude,
  longitude,
  resumo,
  disabled,
  onEndereco,
  onCoordenada,
}: MapaDeEnderecoProps) {
  const caixa = useRef<HTMLDivElement>(null);
  const mapa = useRef<LeafletMap | null>(null);
  const pino = useRef<Marker | null>(null);
  const [pronto, setPronto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [termo, setTermo] = useState('');
  const [sugestoes, setSugestoes] = useState<Array<EnderecoEncontrado & { descricao: string }>>([]);
  const [buscando, setBuscando] = useState(false);

  // Os callbacks numa referencia: sem isso, uma funcao nova a cada render do
  // formulario remontaria o mapa inteiro a cada tecla digitada em qualquer campo.
  const avisos = useRef({ onEndereco, onCoordenada });
  avisos.current = { onEndereco, onCoordenada };

  async function lerEndereco(lat: number, lon: number) {
    setCarregando(true);
    setAviso(null);
    try {
      const encontrado = await enderecoApi.porCoordenada(tenantId, lat, lon);
      avisos.current.onEndereco({
        ...encontrado,
        latitude: arredondarCoordenada(lat),
        longitude: arredondarCoordenada(lon),
      });
    } catch (erro) {
      // A coordenada vale mesmo sem endereco: o pino ficou onde a pessoa
      // soltou, e e isso que o site vai desenhar.
      avisos.current.onCoordenada(arredondarCoordenada(lat), arredondarCoordenada(lon));
      setAviso(erro instanceof ApiError ? erro.message : 'Não foi possível ler o endereço deste ponto.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [L] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
      if (!vivo || !caixa.current || mapa.current) return;

      const centro: [number, number] = latitude !== null && longitude !== null ? [latitude, longitude] : PADRAO;
      /*
        O zoom padrao do Leaflet nasce no canto superior esquerdo, bem embaixo
        da barra de busca -- os dois botoes ficavam cobertos. Aqui ele desce
        para o canto de baixo, onde nao disputa espaco com nada.
      */
      const instancia = L.map(caixa.current, {
        center: centro,
        zoom: latitude !== null ? 17 : 12,
        zoomControl: false,
      });
      L.control.zoom({ position: 'bottomleft' }).addTo(instancia);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        // Exigencia da licenca do OpenStreetMap, e nao enfeite.
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(instancia);

      /*
        O icone padrao do Leaflet aponta para imagens por caminho relativo ao
        CSS; no bundle isso quebra. Um marcador desenhado em HTML evita o
        problema e ainda acompanha o azul da marca.
      */
      const icone = L.divIcon({
        className: '',
        html: '<span class="block size-5 -translate-x-1/2 -translate-y-full rounded-full border-2 border-white bg-brand-600 shadow-[0_2px_8px_rgb(0_0_0/0.4)]"></span>',
        iconSize: [20, 20],
        iconAnchor: [0, 0],
      });
      const marcador = L.marker(centro, { draggable: !disabled, icon: icone, keyboard: true }).addTo(instancia);
      marcador.on('dragend', () => {
        const { lat, lng } = marcador.getLatLng();
        void lerEndereco(lat, lng);
      });
      // Clicar tambem move o pino: arrastar no celular e mais trabalhoso.
      instancia.on('click', (evento) => {
        if (disabled) return;
        marcador.setLatLng(evento.latlng);
        void lerEndereco(evento.latlng.lat, evento.latlng.lng);
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
    };
    // Monta uma vez, de proposito: as mudancas de coordenada entram pelo
    // efeito de baixo, e remontar o mapa a cada uma delas perderia o zoom e a
    // posicao que a pessoa escolheu.
  }, []);

  // Coordenada mudou por fora (CEP, busca, "minha localizacao"): o mapa segue.
  useEffect(() => {
    if (!pronto || latitude === null || longitude === null) return;
    pino.current?.setLatLng([latitude, longitude]);
    mapa.current?.setView([latitude, longitude], Math.max(mapa.current.getZoom(), 16));
  }, [pronto, latitude, longitude]);

  // Busca com espera: 500 ms sem digitar antes de perguntar, como a politica
  // de uso do Nominatim pede.
  useEffect(() => {
    const consulta = termo.trim();
    if (consulta.length < 3) {
      setSugestoes([]);
      return;
    }
    const relogio = setTimeout(async () => {
      setBuscando(true);
      try {
        const { items } = await enderecoApi.buscar(tenantId, consulta);
        setSugestoes(items);
        if (items.length === 0) setAviso('Nenhum endereço encontrado para essa busca.');
      } catch (erro) {
        setAviso(erro instanceof ApiError ? erro.message : 'A busca de endereços não respondeu.');
      } finally {
        setBuscando(false);
      }
    }, 500);
    return () => clearTimeout(relogio);
  }, [termo, tenantId]);

  function centralizar() {
    if (!('geolocation' in navigator)) {
      setAviso('Este navegador não informa a localização.');
      return;
    }
    setCarregando(true);
    navigator.geolocation.getCurrentPosition(
      (posicao) => {
        setCarregando(false);
        void lerEndereco(posicao.coords.latitude, posicao.coords.longitude);
      },
      (erro) => {
        setCarregando(false);
        setAviso(
          erro.code === erro.PERMISSION_DENIED
            ? 'Permissão de localização negada.'
            : 'Não foi possível obter a sua localização.',
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className="grid gap-2">
      {/*
        `isolate` nao e enfeite: sem ele, o `z-[1000]` da barra de busca (que
        precisa vencer as camadas internas do Leaflet, que vao a 800) competia
        com o cabecalho fixo do painel, que e `z-20`, e a busca aparecia POR
        CIMA do cabecalho ao rolar no celular. Com o contexto de empilhamento
        proprio, o que e alto aqui dentro continua preso aqui dentro.
      */}
      <div className="relative isolate overflow-hidden rounded-2xl border border-contorno">
        {/* Busca por texto, sobre o mapa. */}
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
            {buscando ? (
              <Loader2 aria-hidden="true" className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-slate-500" />
            ) : null}
          </div>

          {sugestoes.length > 0 ? (
            <ul className="max-h-48 overflow-auto rounded-xl border border-contorno bg-white shadow-raised">
              {sugestoes.map((sugestao, indice) => (
                <li key={`${sugestao.descricao}-${indice}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onEndereco(sugestao);
                      setSugestoes([]);
                      setTermo('');
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    {sugestao.descricao}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div ref={caixa} className="h-72 w-full bg-slate-100 sm:h-80" aria-label="Mapa do endereço" />

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

      {/* Cartao de baixo: o que foi escolhido, em uma linha, e a confirmacao. */}
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
          loading={carregando}
          onClick={() => {
            if (latitude !== null && longitude !== null) void lerEndereco(latitude, longitude);
          }}
        >
          Confirmar local
        </Button>
      </div>

      {aviso ? <p className="text-xs text-amber-700">{aviso}</p> : null}
    </div>
  );
}
