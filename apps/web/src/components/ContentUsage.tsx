import { Link } from 'react-router-dom';
import { MODULE_REGISTRY, isModuleKey } from '@codeca/shared';
import { Alert } from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useResource } from '../hooks/useResource.js';
import { useSiteModulesIfAny } from '../hooks/useSiteModules.js';
import { tenantApi } from '../services/endpoints.js';

/**
 * Uso do limite geral de conteudos cadastrados.
 *
 * O limite do plano e **um so**, para todos os modulos: uma loja gasta as vagas
 * em produtos, uma clinica em servicos e profissionais, uma imobiliaria em
 * imoveis. Estes dois componentes mostram esse numero onde ele importa.
 */

/** Nome de um modulo na lista de uso: do registro, ou o que a CODECA IA deu ao personalizado. */
export function useNomeDoModulo() {
  // Sem provedor (painel mestre, vendo outra empresa), o modulo personalizado
  // aparece pela chave: o nome dele vive na configuracao daquele site.
  const modulos = useSiteModulesIfAny();
  return (chave: string): string => {
    if (chave.startsWith('custom:')) {
      const chaveProprio = chave.slice('custom:'.length);
      return modulos?.customModule(chaveProprio)?.name ?? chaveProprio;
    }
    return isModuleKey(chave) ? MODULE_REGISTRY[chave].name : chave;
  };
}

/** De onde vem o uso: modulo a modulo, do maior para o menor. */
export function ContentUsageBreakdown({ byModule }: { byModule: Record<string, number> }) {
  const nome = useNomeDoModulo();
  const itens = Object.entries(byModule)
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (itens.length === 0) return null;

  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-medium text-slate-600">De onde vem o uso</p>
      <ul className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
        {itens.map(([chave, total]) => (
          <li key={chave} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate">{nome(chave)}</span>
            <span className="tabular-nums text-slate-500">{total}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        Rascunhos e arquivados contam; o que voce exclui libera a vaga na hora.
      </p>
    </div>
  );
}

/**
 * Aviso nas telas de conteudo, quando o limite se aproxima ou foi atingido.
 *
 * Fica quieto abaixo de 80%: um aviso permanente em toda lista seria ruido.
 * Atingido o limite, diz o que fazer -- e **o que nao acontece**: nada do que ja
 * esta cadastrado e apagado ou escondido.
 */
export function ContentLimitNotice() {
  const tenantId = useTenantId();
  const { can } = useAuth();
  // `staleTime: 0`: o numero muda a cada cadastro, e um aviso velho e pior que nenhum.
  const uso = useResource('tenantApi.contentUsage', () => tenantApi.contentUsage(tenantId), [tenantId], {
    staleTime: 0,
  });

  const dados = uso.data;
  if (!dados || dados.max <= 0) return null;

  const percentual = dados.used / dados.max;
  if (percentual < 0.8) return null;

  const cheio = dados.used >= dados.max;

  return (
    <Alert tone={cheio ? 'warning' : 'info'} title={cheio ? 'Limite de conteudos atingido' : 'Voce esta perto do limite'}>
      O plano {dados.planName} permite ate <strong>{dados.max}</strong> conteudos cadastrados, somando todos os
      modulos do site, e voce ja usa <strong>{dados.used}</strong>.{' '}
      {cheio
        ? 'Nada do que esta cadastrado e apagado ou escondido; para cadastrar novos, exclua o que nao usa mais ou atualize o plano.'
        : 'Rascunhos e arquivados tambem contam.'}{' '}
      {can('billing:read') ? (
        <Link to="/painel/plano" className="link">
          Ver plano
        </Link>
      ) : null}
    </Alert>
  );
}
