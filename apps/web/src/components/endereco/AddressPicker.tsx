import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { Alert, Button, CONTROL_CLASSES, Field, Select, TextInput, cx } from '@codeca/ui';
import {
  BRAZIL_STATES,
  CEP_INVALIDO,
  consultaDoEndereco,
  digitosDeCep,
  formatarCep,
  mapSettingsPadrao,
  type MapSettings,
  type NormalizedAddress,
} from '@codeca/shared';
import { useGeo } from './useGeo.js';
import { MapaDoEndereco } from './MapaDoEndereco.js';

/**
 * Endereco completo, em um componente so.
 *
 * Reutilizavel de proposito: ele recebe e devolve `NormalizedAddress`, sem
 * saber de que formulario veio nem para onde vai. Hoje serve o contato do
 * site; o endereco de cobranca ou o de uma unidade usam o mesmo.
 *
 * O mapa e **opcional**: `semMapa` deixa o formulario completo e acessivel
 * sem ele, que e a alternativa para quem navega por teclado, bloqueia scripts
 * ou esta numa conexao ruim. Nenhum dado depende do mapa -- ele e um atalho
 * para preencher coordenada.
 */

export interface AddressPickerProps {
  value: NormalizedAddress;
  onChange: (endereco: NormalizedAddress) => void;
  settings?: MapSettings;
  disabled?: boolean;
  /** Erros vindos do servidor, por campo. */
  erros?: Partial<Record<keyof NormalizedAddress, string>>;
  /** Esconde o mapa: o formulario sozinho preenche tudo, menos a coordenada. */
  semMapa?: boolean;
  escuro?: boolean;
}

export function AddressPicker({
  value,
  onChange,
  settings = mapSettingsPadrao(),
  disabled,
  erros = {},
  semMapa = false,
  escuro = false,
}: AddressPickerProps) {
  const geo = useGeo();
  const [cepTocado, setCepTocado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const ultimoCep = useRef('');

  /*
    O valor mais recente, numa referencia.

    As consultas sao assincronas e demoram o bastante para a pessoa continuar
    digitando: mesclar sobre o `value` do render que disparou a consulta
    desfaria o que ela escreveu nesse meio-tempo. Foi exatamente o que um
    teste pegou -- o oitavo digito do CEP sumia, porque a resposta chegava
    mesclando sobre o estado de sete digitos.
  */
  const atual = useRef(value);
  atual.current = value;

  function aplicar(patch: Partial<NormalizedAddress>) {
    onChange({ ...atual.current, ...patch });
  }

  /**
   * Preenche a partir de uma consulta, sem apagar o que a pessoa escreveu.
   *
   * O provedor nao conhece complemento nem sala, e erra numero com frequencia:
   * sobrescrever tudo trocaria dado bom por dado generico.
   */
  function aplicarEncontrado(encontrado: NormalizedAddress, manterNumero = true) {
    const patch: Partial<NormalizedAddress> = {};
    if (encontrado.street) patch.street = encontrado.street;
    if (encontrado.neighborhood) patch.neighborhood = encontrado.neighborhood;
    if (encontrado.city) patch.city = encontrado.city;
    if (encontrado.state) patch.state = encontrado.state;
    if (encontrado.postalCode) patch.postalCode = encontrado.postalCode;
    if (typeof encontrado.lat === 'number') patch.lat = encontrado.lat;
    if (typeof encontrado.lng === 'number') patch.lng = encontrado.lng;
    if (!manterNumero && encontrado.number) patch.number = encontrado.number;
    onChange({ ...atual.current, ...patch });
  }

  /**
   * CEP completo: busca o endereco e, se o CEP nao trouxer coordenada,
   * geocodifica o que veio para posicionar o pino.
   */
  async function buscarPorCep(cep: string) {
    setAviso(null);
    const encontrado = await geo.porCep(cep);
    if (!encontrado) {
      setAviso(geo.aviso ?? 'CEP não encontrado. Preencha o endereço à mão.');
      return;
    }
    if (typeof encontrado.lat === 'number' && typeof encontrado.lng === 'number') {
      aplicarEncontrado(encontrado);
      return;
    }
    aplicarEncontrado(encontrado);
    const [primeiro] = await geo.buscar(consultaDoEndereco({ ...encontrado, number: atual.current.number }));
    if (primeiro) {
      aplicar({ ...encontrado, lat: primeiro.lat, lng: primeiro.lng });
    }
  }

  // CEP preenchido de fora (documento carregado) nao dispara busca: so a
  // digitacao dispara, e so uma vez por CEP.
  useEffect(() => {
    ultimoCep.current = value.postalCode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function usarMinhaLocalizacao() {
    if (!('geolocation' in navigator)) {
      setAviso('Este navegador não informa a localização. Preencha o endereço à mão.');
      return;
    }
    if (!window.isSecureContext) {
      // O navegador so entrega localizacao em HTTPS; dizer isso e melhor do
      // que um erro silencioso.
      setAviso('A localização só funciona em conexão segura (HTTPS).');
      return;
    }
    setAviso(null);
    navigator.geolocation.getCurrentPosition(
      async (posicao) => {
        const encontrado = await geo.porCoordenada(posicao.coords.latitude, posicao.coords.longitude);
        if (encontrado) aplicarEncontrado(encontrado, false);
        else setAviso('Não encontramos um endereço nesta localização. Preencha à mão.');
      },
      (erro) => {
        setAviso(
          erro.code === erro.PERMISSION_DENIED
            ? 'Permissão de localização negada. Libere nas configurações do navegador ou preencha à mão.'
            : erro.code === erro.TIMEOUT
              ? 'A localização demorou demais para responder. Tente de novo ou preencha à mão.'
              : 'Não foi possível obter a sua localização. Preencha o endereço à mão.',
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  const erroDeCep = erros.postalCode
    ?? (cepTocado && value.postalCode !== '' && value.postalCode.length !== 8 ? CEP_INVALIDO : undefined);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="CEP" error={erroDeCep}>
          {({ inputId, describedBy, invalid }) => (
            <div className="relative">
              <input
                id={inputId}
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                placeholder="00000-000"
                maxLength={9}
                disabled={disabled}
                value={formatarCep(value.postalCode)}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className={cx(CONTROL_CLASSES, 'pr-11')}
                onChange={(evento) => {
                  const cep = digitosDeCep(evento.target.value);
                  aplicar({ postalCode: cep });
                  setAviso(null);
                  if (cep.length === 8 && cep !== ultimoCep.current && !disabled) {
                    ultimoCep.current = cep;
                    void buscarPorCep(cep);
                  }
                }}
                onBlur={() => setCepTocado(true)}
              />
              {geo.carregando ? (
                <span className="absolute inset-y-0 right-0 flex w-11 items-center justify-center">
                  <Loader2 aria-hidden="true" className="size-4 animate-spin text-slate-500" />
                  <span className="sr-only">Consultando o CEP…</span>
                </span>
              ) : null}
            </div>
          )}
        </Field>

        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={usarMinhaLocalizacao}
            icon={<MapPin aria-hidden="true" className="size-4" />}
          >
            Usar minha localização atual
          </Button>
        </div>
      </div>

      {aviso ? <Alert tone="warning">{aviso}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <TextInput
          label="Endereço"
          autoComplete="street-address"
          disabled={disabled}
          value={value.street}
          error={erros.street}
          onChange={(evento) => aplicar({ street: evento.target.value })}
        />
        <TextInput
          label="Número"
          inputMode="numeric"
          disabled={disabled}
          value={value.number ?? ''}
          error={erros.number}
          onChange={(evento) => aplicar({ number: evento.target.value })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Complemento"
          hint="Sala, bloco, referência."
          disabled={disabled}
          value={value.complement ?? ''}
          error={erros.complement}
          onChange={(evento) => aplicar({ complement: evento.target.value })}
        />
        <TextInput
          label="Bairro"
          disabled={disabled}
          value={value.neighborhood ?? ''}
          error={erros.neighborhood}
          onChange={(evento) => aplicar({ neighborhood: evento.target.value })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <TextInput
          label="Cidade"
          autoComplete="address-level2"
          disabled={disabled}
          value={value.city}
          error={erros.city}
          onChange={(evento) => aplicar({ city: evento.target.value })}
        />
        <Select
          label="Estado"
          disabled={disabled}
          value={value.state}
          error={erros.state}
          placeholder="UF"
          options={BRAZIL_STATES.map((uf) => ({ value: uf, label: uf }))}
          onChange={(evento) => aplicar({ state: evento.target.value })}
        />
      </div>

      {semMapa ? null : (
        <MapaDoEndereco
          geo={geo}
          settings={settings}
          latitude={value.lat ?? null}
          longitude={value.lng ?? null}
          endereco={value}
          disabled={disabled}
          escuro={escuro}
          onEndereco={(encontrado) => aplicarEncontrado(encontrado, false)}
          onCoordenada={(lat, lng) => aplicar({ lat, lng })}
        />
      )}
    </div>
  );
}
