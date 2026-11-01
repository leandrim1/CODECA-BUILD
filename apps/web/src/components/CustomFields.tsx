import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import type { ModuleKey } from '@codeca/shared';
import { Select, Switch, TextArea, TextInput } from '@codeca/ui';
import { useSiteModules } from '../hooks/useSiteModules.js';
import type { SiteModuleFieldView } from '../types/index.js';

/**
 * Campos que a CODECA IA definiu para este site.
 *
 * O formulario de cada modulo desenha os campos tipados a mao -- cada um tem
 * controle proprio -- e delega os personalizados aqui. Nao ha renderizador
 * duplicado: este cobre exatamente os tipos que um campo personalizado pode
 * ter, que e um subconjunto dos tipos do registro (sem imagem, sem dinheiro).
 *
 * Nao desenha nada quando o site nao tem campo personalizado no modulo, entao
 * a chamada pode ficar no formulario sem condicao em volta.
 */
export function CamposPersonalizados({
  moduleKey,
  values,
  onChange,
  errors,
}: {
  moduleKey: ModuleKey;
  values: Record<string, unknown>;
  onChange: (fieldKey: string, valor: unknown) => void;
  /** Erros da API, na forma `customFields.<chave>`. */
  errors?: Record<string, string>;
}) {
  const { fields } = useSiteModules();
  const personalizados = fields(moduleKey).filter((campo) => campo.custom === true);

  if (personalizados.length === 0) return null;

  return (
    <fieldset className="grid gap-4 rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-medium text-slate-700">
        Campos do seu projeto
      </legend>
      <p className="text-xs text-slate-500">
        Campos que a CODECA IA criou para o seu site.
      </p>
      {personalizados.map((campo) => (
        <CampoPersonalizado
          key={campo.key}
          campo={campo}
          valor={values[campo.key]}
          erro={errors?.[`customFields.${campo.key}`]}
          onChange={(valor) => onChange(campo.key, valor)}
        />
      ))}
    </fieldset>
  );
}

function CampoPersonalizado({
  campo,
  valor,
  erro,
  onChange,
}: {
  campo: SiteModuleFieldView;
  valor: unknown;
  erro: string | undefined;
  onChange: (valor: unknown) => void;
}) {
  const travado = !campo.editable;
  // O campo travado aparece, com o valor e um cadeado. Esconde-lo faria o
  // cliente achar que o dado nao existe -- e o mesmo cuidado dos tipados.
  const dica = travado ? 'Mantido pela CODECA IA neste site.' : campo.help;
  const rotulo = (
    <span className="inline-flex items-center gap-1.5">
      {campo.label}
      {travado ? <Lock aria-label="Campo travado" className="size-3.5 text-slate-400" /> : null}
    </span>
  );
  const comum = {
    label: rotulo,
    ...(dica ? { hint: dica } : {}),
    ...(erro ? { error: erro } : {}),
    readOnly: travado,
    disabled: travado,
    required: campo.required ?? false,
  };

  if (campo.type === 'boolean') {
    return (
      <Switch
        label={campo.label}
        {...(dica ? { hint: dica } : {})}
        checked={valor === true}
        disabled={travado}
        onChange={(marcado) => onChange(marcado)}
      />
    );
  }

  if (campo.type === 'select' && campo.options && campo.options.length > 0) {
    return (
      <Select
        {...comum}
        value={typeof valor === 'string' ? valor : ''}
        onChange={(event) => onChange(event.target.value)}
        options={campo.options.map((opcao) => ({ value: opcao, label: opcao }))}
      />
    );
  }

  if (campo.type === 'longText') {
    return (
      <TextArea
        {...comum}
        rows={4}
        value={typeof valor === 'string' ? valor : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (campo.type === 'tags') {
    return (
      <TextArea
        {...comum}
        hint={dica ?? 'Separe por virgula.'}
        rows={2}
        value={Array.isArray(valor) ? (valor as string[]).join(', ') : typeof valor === 'string' ? valor : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  const tipoHtml =
    campo.type === 'email'
      ? 'email'
      : campo.type === 'number'
        ? 'number'
        : campo.type === 'date'
          ? 'date'
          : campo.type === 'url'
            ? 'url'
            : campo.type === 'phone'
              ? 'tel'
              : 'text';

  return (
    <TextInput
      {...comum}
      type={tipoHtml}
      value={typeof valor === 'string' ? valor : valor === null || valor === undefined ? '' : String(valor)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * Converte os valores do formulario na forma que a API espera.
 *
 * `tags` chega como texto separado por virgula e `number` como texto -- o
 * mesmo motivo de sempre: campo numerico vazio vira `NaN` e enviaria valor
 * invalido sem o cliente perceber.
 *
 * Campo travado nao e enviado: a API recusaria, e o valor dele nao mudou.
 */
export function paraApiPersonalizados(
  campos: readonly SiteModuleFieldView[],
  valores: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const personalizados = campos.filter((campo) => campo.custom === true && campo.editable);
  if (personalizados.length === 0) return undefined;

  const saida: Record<string, unknown> = {};
  for (const campo of personalizados) {
    const valor = valores[campo.key];
    if (campo.type === 'boolean') saida[campo.key] = valor === true;
    else if (campo.type === 'tags') {
      saida[campo.key] = Array.isArray(valor)
        ? valor
        : String(valor ?? '')
            .split(/[,\n]/)
            .map((item) => item.trim())
            .filter(Boolean);
    } else if (campo.type === 'number') {
      const texto = String(valor ?? '').trim();
      saida[campo.key] = texto === '' ? null : Number(texto.replace(',', '.'));
    } else saida[campo.key] = typeof valor === 'string' ? valor : (valor ?? '');
  }
  return saida;
}

/**
 * Estado dos campos personalizados de um formulario.
 *
 * Fora do `useForm` de proposito: o generico dele e inferido do objeto
 * inicial, e as chaves aqui sao dados -- nao existem em tempo de compilacao.
 * Um estado separado tambem deixa claro, em cada formulario, o que vai no
 * envelope `customFields`.
 */
export function useCamposPersonalizados(
  moduleKey: ModuleKey,
  inicial: Record<string, unknown> | undefined,
) {
  const { fields } = useSiteModules();
  const campos = fields(moduleKey).filter((campo) => campo.custom === true);
  const [valores, setValores] = useState<Record<string, unknown>>(() => ({ ...(inicial ?? {}) }));

  // O formulario de edicao e montado antes de o registro chegar: sem isto o
  // campo abriria vazio e a gravacao apagaria o valor.
  useEffect(() => {
    setValores({ ...(inicial ?? {}) });
  }, [inicial]);

  return {
    campos,
    valores,
    definir: (fieldKey: string, valor: unknown) =>
      setValores((atual) => ({ ...atual, [fieldKey]: valor })),
    /** `undefined` quando o site nao tem campo personalizado editavel. */
    paraApi: () => paraApiPersonalizados(campos, valores),
  };
}
