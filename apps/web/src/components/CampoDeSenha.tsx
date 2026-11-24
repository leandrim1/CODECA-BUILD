import { useId, useState } from 'react';
import { Check, Circle, Eye, EyeOff, X } from 'lucide-react';
import { CONTROL_CLASSES, Field, cx } from '@codeca/ui';
import { REGRAS_DE_SENHA, forcaDaSenha, validarSenha, type StatusDaSenha } from '@codeca/shared';

/**
 * Campo de senha com conferencia das regras em tempo real.
 *
 * O que ele resolve: a dica antiga ("Ao menos 10 caracteres, com letras e
 * numeros") so era lida DEPOIS da recusa do servidor, e nao dizia qual regra
 * faltava. Aqui as cinco regras ficam a vista enquanto se digita, cada uma com
 * o proprio estado.
 *
 * As regras nao sao escritas aqui: vem de `validarSenha`, no pacote
 * compartilhado, que e a mesma funcao que o servidor usa para recusar. Esta
 * tela nunca decide sozinha o que e uma senha valida -- ela so mostra.
 */

/** Quando cada estado aparece, e por que sao tres e nao dois. */
type Estado = 'ok' | 'pendente' | 'faltando';

/**
 * `pendente` (circulo cinza) e `faltando` (x vermelho) sao a MESMA regra nao
 * atendida em dois momentos. Enquanto a pessoa digita, vermelho seria uma
 * reclamacao antecipada: a senha esta sendo construida, e e normal que falte
 * quase tudo no segundo caractere. Depois que ela sai do campo (blur), o que
 * continua faltando deixa de ser "ainda nao" e passa a ser problema.
 */
function estadoDaRegra(atendida: boolean, tocado: boolean): Estado {
  if (atendida) return 'ok';
  return tocado ? 'faltando' : 'pendente';
}

const ICONE = { ok: Check, pendente: Circle, faltando: X } as const;
/**
 * A cor forte fica no ICONE, e nao na linha inteira.
 *
 * `emerald-600` mede 3,76:1 sobre branco: passa para desenho (WCAG 1.4.11
 * pede 3:1) e reprova para texto de 12px (pede 4,5:1). Pintar a frase de verde
 * deixaria a regra atendida mais dificil de ler do que as outras -- o oposto
 * do que a lista quer. O texto fica no cinza de leitura; so o que esta
 * faltando depois do blur herda o vermelho que ja e o tom de erro dos campos.
 */
const COR_DO_ICONE = {
  ok: 'text-emerald-600',
  pendente: 'text-slate-500',
  faltando: 'text-rose-600',
} as const;
const COR_DO_TEXTO = {
  ok: 'text-slate-600',
  pendente: 'text-slate-600',
  faltando: 'text-rose-600',
} as const;
/** Lido so por leitor de tela: o estado nao pode depender da cor nem do desenho. */
const LEITURA = { ok: 'atendida', pendente: 'pendente', faltando: 'não atendida' } as const;

/**
 * Barra de forca: 4px, uma faixa por regra atendida.
 *
 * Mede exatamente o que a lista abaixo cobra -- nao e estimativa de entropia.
 * Por isso as cores acompanham a contagem: vermelho ate a metade, ambar perto
 * do fim, verde so com as cinco.
 */
function BarraDeForca({ status }: { status: StatusDaSenha }) {
  const atendidas = forcaDaSenha(status);
  const total = REGRAS_DE_SENHA.length;
  const tom = atendidas === total ? 'bg-emerald-500' : atendidas >= 3 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="h-1 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
      <div
        className={cx('h-full rounded-full transition-[width,background-color] duration-200', tom)}
        style={{ width: `${(atendidas / total) * 100}%` }}
      />
    </div>
  );
}

export interface CampoDeSenhaProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string | undefined;
  required?: boolean;
  compacto?: boolean;
  autoComplete?: string;
  placeholder?: string;
}

export function CampoDeSenha({
  value,
  onChange,
  label = 'Senha',
  error,
  required,
  compacto,
  autoComplete = 'new-password',
  placeholder,
}: CampoDeSenhaProps) {
  const listaId = useId();
  const [visivel, setVisivel] = useState(false);
  const [focado, setFocado] = useState(false);
  const [tocado, setTocado] = useState(false);
  const status = validarSenha(value);

  /*
    A lista some enquanto o campo esta vazio e fora de foco.

    Nao e enfeite: a tela de cadastro cabe em uma dobra de 720px no desktop, e
    cinco linhas permanentes a empurrariam para o scroll. Quem ainda nao chegou
    no campo nao tem o que conferir; quem chegou ve tudo.
  */
  const mostrarLista = focado || value.length > 0;

  return (
    <div className="grid gap-1.5">
      <Field
        label={label}
        error={error}
        required={required}
        compacto={compacto}
        describedById={mostrarLista ? listaId : undefined}
      >
        {({ inputId, describedBy, invalid }) => (
          <div className="relative">
            <input
              id={inputId}
              type={visivel ? 'text' : 'password'}
              value={value}
              required={required}
              autoComplete={autoComplete}
              placeholder={placeholder}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              // `pr-11` abre espaco para o botao do olho: sem isso o fim da
              // senha fica embaixo do icone.
              className={cx(compacto ? CONTROL_CLASSES.replace('py-2.5', 'py-2') : CONTROL_CLASSES, 'pr-11')}
              onFocus={() => setFocado(true)}
              onBlur={() => {
                setFocado(false);
                setTocado(true);
              }}
              onChange={(event) => onChange(event.target.value)}
            />
            {/*
              `type="button"`: dentro de um <form>, o padrao de um botao e
              ENVIAR -- mostrar a senha mandaria o cadastro.
            */}
            <button
              type="button"
              onClick={() => setVisivel((atual) => !atual)}
              aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
              aria-pressed={visivel}
              className={cx(
                'absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl',
                'text-slate-500 transition-colors hover:text-slate-700',
                'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-600',
              )}
            >
              {visivel ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
          </div>
        )}
      </Field>

      {/*
        A regiao fica SEMPRE no documento, mesmo vazia (altura zero), e so o
        conteudo entra e sai.

        Uma regiao `aria-live` que nasce junto com o texto costuma nao ser
        anunciada: o leitor de tela precisa ja estar observando o elemento
        quando ele muda. Montando-a desde o inicio, a primeira regra atendida
        ja e falada.

        `polite` e nao `assertive`: o aviso espera a pausa na digitacao em vez
        de interromper a cada tecla.
      */}
      <div id={listaId} aria-live="polite" className="grid gap-1">
        {mostrarLista ? (
          <>
            <BarraDeForca status={status} />
            <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
              {REGRAS_DE_SENHA.map((regra) => {
                const estado = estadoDaRegra(status[regra.id], tocado);
                const Icone = ICONE[estado];
                return (
                  <li key={regra.id} className={cx('flex items-center gap-1.5', COR_DO_TEXTO[estado])}>
                    <Icone
                      className={cx('size-3 flex-none', COR_DO_ICONE[estado])}
                      strokeWidth={estado === 'pendente' ? 2 : 3}
                      aria-hidden="true"
                    />
                    <span>{regra.rotulo}</span>
                    <span className="sr-only">: {LEITURA[estado]}</span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
