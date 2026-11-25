import { useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { Button, Switch, cx } from '@codeca/ui';
import {
  DIAS_DA_SEMANA,
  DIAS_UTEIS,
  OPCOES_DE_HORA,
  diaFechado,
  errosDosHorarios,
  horariosVazios,
  textoDosHorarios,
  type DiaDaSemana,
  type DiaDeAtendimento,
  type HorariosDeAtendimento,
} from '@codeca/shared';

/**
 * Horario de atendimento sem digitar.
 *
 * O campo era um textarea livre, e o que chegava ao site ia de "8h as 18h" a
 * frases inteiras. Aqui cada dia tem o mesmo par de perguntas -- abre? de que
 * hora a que hora? -- e o texto que o site exibe e GERADO a partir disso.
 *
 * O texto antigo nao e jogado fora: quem nao conseguiu ser interpretado
 * aparece num aviso acima da grade, para a pessoa poder copiar o que estava
 * escrito enquanto escolhe os horarios.
 */

function Seletor({
  rotulo,
  valor,
  onChange,
  disabled,
}: {
  rotulo: string;
  valor: string;
  onChange: (valor: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-slate-500">{rotulo}</span>
      <select
        value={valor}
        disabled={disabled}
        onChange={(evento) => onChange(evento.target.value)}
        aria-label={rotulo}
        className={cx(
          'rounded-lg border border-contorno bg-white px-2.5 py-1.5 text-sm text-slate-900',
          'focus:border-brand-500 focus:outline-2 focus:outline-brand-500/40 disabled:bg-slate-50',
        )}
      >
        {OPCOES_DE_HORA.map((hora) => (
          <option key={hora} value={hora}>
            {hora}
          </option>
        ))}
      </select>
    </label>
  );
}

function LinhaDoDia({
  chave,
  nome,
  dia,
  erro,
  disabled,
  onChange,
  onCopiar,
}: {
  chave: DiaDaSemana;
  nome: string;
  dia: DiaDeAtendimento;
  erro?: string | undefined;
  disabled?: boolean;
  onChange: (dia: DiaDeAtendimento) => void;
  onCopiar: () => void;
}) {
  const periodos = dia.periodos.length > 0 ? dia.periodos : [{ abre: '08:00', fecha: '18:00' }];

  function mudarPeriodo(indice: number, patch: Partial<{ abre: string; fecha: string }>) {
    const proximos = periodos.map((p, i) => (i === indice ? { ...p, ...patch } : p));
    onChange({ ...dia, periodos: proximos });
  }

  return (
    <div
      className={cx(
        'grid gap-3 rounded-xl border p-3 sm:grid-cols-[11rem_1fr]',
        erro ? 'border-rose-300 bg-rose-50/40' : 'border-contorno',
      )}
    >
      <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start sm:justify-start">
        <Switch
          label={nome}
          checked={dia.aberto}
          disabled={disabled}
          onChange={(aberto) =>
            onChange(
              aberto
                ? { aberto: true, vinteQuatroHoras: false, periodos: [{ abre: '08:00', fecha: '18:00' }] }
                : diaFechado(),
            )
          }
        />
        <span className="text-xs text-slate-500 sm:hidden">{dia.aberto ? 'Aberto' : 'Fechado'}</span>
      </div>

      {dia.aberto ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-end gap-3">
            {dia.vinteQuatroHoras ? (
              <p className="text-sm text-slate-600">Aberto 24 horas.</p>
            ) : (
              periodos.map((periodo, indice) => (
                <div key={indice} className="flex items-end gap-2">
                  <Seletor
                    rotulo={indice === 0 ? 'Abre às' : 'Reabre às'}
                    valor={periodo.abre}
                    disabled={disabled}
                    onChange={(valor) => mudarPeriodo(indice, { abre: valor })}
                  />
                  <span aria-hidden="true" className="pb-2 text-slate-400">—</span>
                  <Seletor
                    rotulo={indice === 0 ? 'Fecha às' : 'Fecha às'}
                    valor={periodo.fecha}
                    disabled={disabled}
                    onChange={(valor) => mudarPeriodo(indice, { fecha: valor })}
                  />
                  {indice === 1 ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange({ ...dia, periodos: [periodos[0]!] })}
                      aria-label={`Remover o segundo período de ${nome}`}
                      className="mb-1.5 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-rose-600"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label className="flex items-center gap-2 text-slate-600">
              <input
                type="checkbox"
                checked={dia.vinteQuatroHoras}
                disabled={disabled}
                onChange={(evento) =>
                  onChange({
                    ...dia,
                    vinteQuatroHoras: evento.target.checked,
                    periodos: evento.target.checked ? [] : [{ abre: '08:00', fecha: '18:00' }],
                  })
                }
                className="size-4 rounded border-contorno text-brand-600 focus:ring-brand-500"
              />
              24 horas
            </label>

            {/* Intervalo = segundo periodo no mesmo dia. */}
            {!dia.vinteQuatroHoras && periodos.length === 1 ? (
              <button
                type="button"
                disabled={disabled}
                /*
                  O intervalo PARTE o expediente, em vez de acrescentar um
                  periodo solto: de 08:00–18:00 saem 08:00–12:00 e 13:00–18:00.
                  Um segundo periodo com horario fixo nasceria invadindo o
                  primeiro, e o dia abriria ja com erro na tela.
                */
                onClick={() =>
                  onChange({
                    ...dia,
                    periodos: [
                      { abre: periodos[0]!.abre, fecha: '12:00' },
                      { abre: '13:00', fecha: periodos[0]!.fecha },
                    ],
                  })
                }
                className="inline-flex items-center gap-1.5 text-brand-700 hover:underline"
              >
                <Plus aria-hidden="true" className="size-3.5" />
                Intervalo
              </button>
            ) : null}

            <button
              type="button"
              disabled={disabled}
              onClick={onCopiar}
              className="inline-flex items-center gap-1.5 text-brand-700 hover:underline"
            >
              <Copy aria-hidden="true" className="size-3.5" />
              Copiar para todos os dias
            </button>
          </div>

          {erro ? <p className="text-xs font-medium text-rose-600">{erro}</p> : null}
        </div>
      ) : (
        <p className="self-center text-sm text-slate-500">Fechado neste dia.</p>
      )}
    </div>
  );
}

export function CampoDeHorarios({
  label,
  valor,
  onChange,
  disabled,
  textoAntigo,
}: {
  label: string;
  valor: HorariosDeAtendimento | null;
  onChange: (horarios: HorariosDeAtendimento) => void;
  disabled?: boolean;
  /** Texto gravado antes desta tela que nao deu para interpretar. */
  textoAntigo?: string | null;
}) {
  const horarios = valor ?? horariosVazios();
  const erros = errosDosHorarios(horarios);
  const [copiado, setCopiado] = useState<string | null>(null);

  function definirDia(chave: DiaDaSemana, dia: DiaDeAtendimento) {
    onChange({ ...horarios, [chave]: dia });
  }

  function copiarPara(chave: DiaDaSemana, destinos: DiaDaSemana[], aviso: string) {
    const modelo = horarios[chave];
    const proximos = { ...horarios };
    for (const destino of destinos) proximos[destino] = { ...modelo, periodos: [...modelo.periodos] };
    onChange(proximos);
    setCopiado(aviso);
  }

  const previa = textoDosHorarios(horarios);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => copiarPara('seg', DIAS_UTEIS, 'Segunda copiada para os dias úteis.')}
        >
          Aplicar segunda a sexta
        </Button>
      </div>

      {textoAntigo ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">O horário anterior estava escrito assim:</p>
          <p className="mt-1 whitespace-pre-wrap">{textoAntigo}</p>
          <p className="mt-2 text-xs">
            Não deu para transformar esse texto em horários automaticamente. Escolha os horários abaixo; o
            texto antigo continua aqui até você salvar.
          </p>
        </div>
      ) : null}

      <div className="grid gap-2">
        {DIAS_DA_SEMANA.map((dia) => (
          <LinhaDoDia
            key={dia.chave}
            chave={dia.chave}
            nome={dia.nome}
            dia={horarios[dia.chave] ?? diaFechado()}
            erro={erros[dia.chave]}
            disabled={disabled}
            onChange={(proximo) => definirDia(dia.chave, proximo)}
            onCopiar={() =>
              copiarPara(
                dia.chave,
                DIAS_DA_SEMANA.map((d) => d.chave).filter((c) => c !== dia.chave),
                `${dia.nome} copiada para os outros dias.`,
              )
            }
          />
        ))}
      </div>

      {copiado ? (
        <p aria-live="polite" className="text-xs text-slate-500">
          {copiado}
        </p>
      ) : null}

      {/*
        A previa e o texto que o site vai exibir -- gerado, nunca digitado.
        Mostra-lo aqui evita a pergunta "e como isso aparece la?".
      */}
      <div className="rounded-xl bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">No site aparece assim</p>
        <p className="mt-1 text-sm text-slate-700">{previa || 'Sem horário informado.'}</p>
      </div>
    </div>
  );
}
