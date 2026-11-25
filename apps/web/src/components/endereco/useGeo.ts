import { useCallback, useRef, useState } from 'react';
import type { GeoResult, NormalizedAddress } from '@codeca/shared';

/**
 * Cliente das rotas `/api/geo`.
 *
 * E o unico lugar do painel que sabe que existe uma rota de geolocalizacao --
 * e nem ele sabe quem responde do outro lado. Os componentes recebem
 * `NormalizedAddress` e `GeoResult`, que e o formato da plataforma, nao o de
 * nenhum provedor.
 */

/** Envelope das rotas de geo: `ok` separa "falhou" de "nao achou". */
type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function pedir<T>(url: string, signal?: AbortSignal): Promise<Envelope<T>> {
  try {
    const resposta = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    const corpo = (await resposta.json().catch(() => null)) as Envelope<T> | null;
    if (corpo && typeof corpo === 'object' && 'ok' in corpo) return corpo;
    return { ok: false, error: { code: 'erro', message: 'O serviço de endereços não respondeu.' } };
  } catch (erro) {
    // Cancelamento nao e erro: a tela desistiu da busca antiga de proposito.
    if (erro instanceof DOMException && erro.name === 'AbortError') {
      return { ok: false, error: { code: 'cancelado', message: '' } };
    }
    return { ok: false, error: { code: 'rede', message: 'Sem conexão com o serviço de endereços.' } };
  }
}

export interface Geo {
  /** Mensagem do ultimo problema, ou `null`. Some sozinha na proxima consulta. */
  aviso: string | null;
  limparAviso: () => void;
  carregando: boolean;
  porCep: (cep: string) => Promise<NormalizedAddress | null>;
  porCoordenada: (lat: number, lng: number) => Promise<NormalizedAddress | null>;
  buscar: (termo: string) => Promise<GeoResult[]>;
}

export function useGeo(): Geo {
  const [aviso, setAviso] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  // Uma busca por vez: a anterior e cancelada quando a pessoa continua digitando.
  const buscaEmCurso = useRef<AbortController | null>(null);

  const tratar = useCallback(<T,>(envelope: Envelope<T>, vazio: T): T => {
    if (envelope.ok) {
      setAviso(null);
      return envelope.data;
    }
    if (envelope.error.code !== 'cancelado') setAviso(envelope.error.message);
    return vazio;
  }, []);

  const porCep = useCallback(
    async (cep: string) => {
      setCarregando(true);
      try {
        return tratar(await pedir<NormalizedAddress>(`/api/geo/cep/${encodeURIComponent(cep)}`), null);
      } finally {
        setCarregando(false);
      }
    },
    [tratar],
  );

  const porCoordenada = useCallback(
    async (lat: number, lng: number) => {
      setCarregando(true);
      try {
        return tratar(await pedir<NormalizedAddress>(`/api/geo/reverse?lat=${lat}&lng=${lng}`), null);
      } finally {
        setCarregando(false);
      }
    },
    [tratar],
  );

  const buscar = useCallback(
    async (termo: string) => {
      buscaEmCurso.current?.abort();
      const controle = new AbortController();
      buscaEmCurso.current = controle;
      setCarregando(true);
      try {
        const envelope = await pedir<GeoResult[]>(`/api/geo/search?q=${encodeURIComponent(termo)}`, controle.signal);
        return tratar(envelope, []);
      } finally {
        if (buscaEmCurso.current === controle) {
          buscaEmCurso.current = null;
          setCarregando(false);
        }
      }
    },
    [tratar],
  );

  return { aviso, limparAviso: () => setAviso(null), carregando, porCep, porCoordenada, buscar };
}
