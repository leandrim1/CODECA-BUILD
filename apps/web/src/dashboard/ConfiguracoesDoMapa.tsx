import { Switch, cx } from '@codeca/ui';
import {
  ALTURAS_DO_MAPA,
  ALTURA_EM_PIXELS,
  FORMATOS_DO_MAPA,
  ICONES_DO_PINO,
  POSICOES_DO_ENDERECO,
  TILE_PROVIDERS,
  linksDeRota,
  type MapSettings,
} from '@codeca/shared';

/**
 * Como o mapa aparece no site do cliente.
 *
 * Tudo aqui e apresentacao, e nenhuma opcao guarda nome de fornecedor: o
 * estilo e o id de um preset da plataforma (`TILE_PROVIDERS`), nao uma URL de
 * ladrilho. Trocar quem serve o mapa nao invalida nenhuma escolha feita aqui.
 */

function Opcoes<T extends string>({
  label,
  valor,
  opcoes,
  disabled,
  onChange,
}: {
  label: string;
  valor: T;
  opcoes: ReadonlyArray<{ valor: T; rotulo: string }>;
  disabled?: boolean;
  onChange: (valor: T) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {opcoes.map((opcao) => (
          <button
            key={opcao.valor}
            type="button"
            disabled={disabled}
            aria-pressed={opcao.valor === valor}
            onClick={() => onChange(opcao.valor)}
            className={cx(
              'rounded-full border px-3.5 py-1.5 text-sm transition-colors',
              opcao.valor === valor
                ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
                : 'border-contorno text-slate-600 hover:border-slate-500',
            )}
          >
            {opcao.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ConfiguracoesDoMapa({
  settings,
  onChange,
  disabled,
  latitude,
  longitude,
}: {
  settings: MapSettings;
  onChange: (settings: MapSettings) => void;
  disabled?: boolean;
  latitude: number | null;
  longitude: number | null;
}) {
  const definir = <K extends keyof MapSettings>(chave: K, valor: MapSettings[K]) =>
    onChange({ ...settings, [chave]: valor });

  const rotas = linksDeRota({ lat: latitude ?? undefined, lng: longitude ?? undefined }, settings.comoChegar);

  return (
    <div className="grid gap-5">
      <Opcoes
        label="Estilo do mapa"
        valor={settings.estilo}
        disabled={disabled}
        opcoes={Object.values(TILE_PROVIDERS).map((p) => ({ valor: p.id, rotulo: p.label }))}
        onChange={(valor) => definir('estilo', valor)}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Opcoes
          label="Altura"
          valor={settings.altura}
          disabled={disabled}
          opcoes={ALTURAS_DO_MAPA.map((a) => ({ valor: a, rotulo: `${a[0]!.toUpperCase()}${a.slice(1)} (${ALTURA_EM_PIXELS[a]}px)` }))}
          onChange={(valor) => definir('altura', valor)}
        />
        <Opcoes
          label="Formato"
          valor={settings.formato}
          disabled={disabled}
          opcoes={FORMATOS_DO_MAPA.map((f) => ({ valor: f, rotulo: f === 'cartao' ? 'Cartão' : 'Largura total' }))}
          onChange={(valor) => definir('formato', valor)}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700">Aproximação inicial</span>
          <input
            type="range"
            min={10}
            max={19}
            value={settings.zoom}
            disabled={disabled}
            onChange={(evento) => definir('zoom', Number(evento.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600"
          />
          <span className="text-xs text-slate-500">
            {settings.zoom <= 12 ? 'Cidade' : settings.zoom <= 15 ? 'Bairro' : 'Rua'} ({settings.zoom})
          </span>
        </label>

        <div className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700">Cor do pino</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Cor do pino"
              value={settings.corDoPino || '#1d4ed8'}
              disabled={disabled}
              onChange={(evento) => definir('corDoPino', evento.target.value)}
              className="size-10 flex-none cursor-pointer rounded-xl border border-contorno bg-white p-0.5"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => definir('corDoPino', '')}
              className="text-sm text-brand-700 hover:underline"
            >
              Usar a cor do site
            </button>
          </div>
        </div>
      </div>

      <Opcoes
        label="Ícone do pino"
        valor={settings.icone}
        disabled={disabled}
        opcoes={ICONES_DO_PINO.map((i) => ({ valor: i, rotulo: `${i[0]!.toUpperCase()}${i.slice(1)}` }))}
        onChange={(valor) => definir('icone', valor)}
      />

      <Opcoes
        label="Endereço ao lado do mapa"
        valor={settings.posicaoDoEndereco}
        disabled={disabled}
        opcoes={POSICOES_DO_ENDERECO.map((p) => ({
          valor: p,
          rotulo: p === 'lado' ? 'Ao lado' : p === 'abaixo' ? 'Abaixo' : 'Não mostrar',
        }))}
        onChange={(valor) => definir('posicaoDoEndereco', valor)}
      />

      <div className="grid gap-1 rounded-xl border border-contorno p-3">
        <Switch
          label="Mostrar controles de zoom"
          checked={settings.mostrarControles}
          disabled={disabled}
          onChange={(v) => definir('mostrarControles', v)}
        />
        <Switch
          label="Mostrar horário de atendimento junto ao mapa"
          checked={settings.mostrarHorario}
          disabled={disabled}
          onChange={(v) => definir('mostrarHorario', v)}
        />
        <Switch
          label='Mostrar botões "Como chegar"'
          checked={settings.mostrarComoChegar}
          disabled={disabled}
          onChange={(v) => definir('mostrarComoChegar', v)}
        />
        <Switch
          label="Carregar o mapa só depois de um clique"
          hint="Mostra um cartão com o endereço e carrega o mapa quando o visitante clicar. Indicado para sites com muito tráfego."
          checked={settings.carregarAoClicar}
          disabled={disabled}
          onChange={(v) => definir('carregarAoClicar', v)}
        />
      </div>

      {settings.mostrarComoChegar ? (
        <div className="grid gap-2 rounded-xl border border-contorno p-3">
          <span className="text-sm font-medium text-slate-700">Aplicativos de rota</span>
          <div className="flex flex-wrap gap-4">
            {(['google', 'waze', 'apple'] as const).map((app) => (
              <label key={app} className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={settings.comoChegar[app]}
                  disabled={disabled}
                  onChange={(evento) =>
                    definir('comoChegar', { ...settings.comoChegar, [app]: evento.target.checked })
                  }
                  className="size-4 rounded border-contorno text-brand-600 focus:ring-brand-500"
                />
                {app === 'google' ? 'Google Maps' : app === 'waze' ? 'Waze' : 'Apple Maps'}
              </label>
            ))}
          </div>
          {/*
            Os links sao montados a partir da coordenada, sem API e sem chave.
            Mostra-los aqui prova que funcionam antes de o site ir ao ar.
          */}
          {rotas.length > 0 ? (
            <p className="truncate text-xs text-slate-500">
              Ex.: <span className="font-mono">{rotas[0]!.url}</span>
            </p>
          ) : (
            <p className="text-xs text-slate-500">Marque o local no mapa para gerar os links.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
