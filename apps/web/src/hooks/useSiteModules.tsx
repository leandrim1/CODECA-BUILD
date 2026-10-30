import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useResource } from './useResource.js';
import { useAuth } from './useAuth.js';
import { moduleApi } from '../services/endpoints.js';
import type { SiteModuleFieldView, SiteModuleView } from '../types/index.js';

/**
 * Modulos do site da empresa ativa.
 *
 * O painel nao tem um menu fixo: cada site da CODECA IA e desenvolvido sob
 * medida, e o que o cliente enxerga vem da configuracao daquele projeto. Este
 * contexto carrega essa configuracao uma vez, no lugar de cada tela perguntar
 * por conta propria.
 *
 * Enquanto carrega, `loading` e `true` e `modules` esta vazio -- a moldura
 * usa isso para nao piscar um menu curto antes do menu certo.
 */

interface SiteModulesValue {
  siteId: string | null;
  modules: SiteModuleView[];
  loading: boolean;
  /**
   * `true` quando a assinatura nao esta em dia e o plano pede somente
   * leitura. A tela avisa antes, em vez de deixar o cliente preencher um
   * formulario inteiro para levar 403 ao salvar.
   */
  readOnly: boolean;
  /** `true` quando o plano manda bloquear o painel de conteudo. */
  blocked: boolean;
  /** `true` so quando a resposta chegou e o modulo esta habilitado. */
  enabled: (moduleKey: string) => boolean;
  module: (moduleKey: string) => SiteModuleView | null;
  /** Campos do modulo com a politica do site aplicada. */
  fields: (moduleKey: string) => SiteModuleFieldView[];
  reload: () => void;
}

const SiteModulesContext = createContext<SiteModulesValue | null>(null);

export function SiteModulesProvider({ children }: { children: ReactNode }) {
  const { tenant } = useAuth();
  const tenantId = tenant?.tenantId ?? null;

  const recurso = useResource(
    () => moduleApi.list(tenantId!),
    [tenantId],
    { enabled: tenantId !== null },
  );

  const value = useMemo<SiteModulesValue>(() => {
    const modules = recurso.data?.modules ?? [];
    const porChave = new Map(modules.map((item) => [item.key, item]));
    const suspensao = recurso.data?.suspension ?? null;
    // Com a politica `blocked` esta propria rota e recusada, entao o 403 e o
    // sinal: nao ha resposta para ler, so o erro.
    const bloqueado =
      suspensao?.panel === 'blocked'
      || (recurso.data === null && recurso.error?.status === 403);

    return {
      siteId: recurso.data?.siteId ?? null,
      modules,
      loading: recurso.loading && recurso.data === null,
      readOnly: suspensao !== null && !suspensao.current && suspensao.panel === 'read_only',
      blocked: bloqueado,
      enabled: (moduleKey) => porChave.get(moduleKey)?.enabled ?? false,
      module: (moduleKey) => porChave.get(moduleKey) ?? null,
      fields: (moduleKey) => porChave.get(moduleKey)?.fields ?? [],
      reload: recurso.reload,
    };
  }, [recurso.data, recurso.error, recurso.loading, recurso.reload]);

  return <SiteModulesContext.Provider value={value}>{children}</SiteModulesContext.Provider>;
}

export function useSiteModules(): SiteModulesValue {
  const value = useContext(SiteModulesContext);
  if (!value) throw new Error('useSiteModules precisa estar dentro de <SiteModulesProvider>.');
  return value;
}

/**
 * Politica de um modulo, para as telas de formulario.
 *
 * `editavel` responde a pergunta que a tela faz a cada campo. Quando a
 * configuracao ainda nao chegou, responde `true`: a tela nasce utilizavel e o
 * servidor recusa o que nao pode mesmo ser gravado. O contrario -- travar
 * tudo enquanto carrega -- faria o formulario parecer quebrado.
 */
export function useModulePolicy(moduleKey: string) {
  const { fields, loading, enabled } = useSiteModules();
  const lista = fields(moduleKey);

  return useMemo(() => {
    const porChave = new Map(lista.map((campo) => [campo.key, campo]));
    return {
      loading,
      enabled: enabled(moduleKey),
      field: (fieldKey: string) => porChave.get(fieldKey) ?? null,
      editavel: (fieldKey: string) => porChave.get(fieldKey)?.editable ?? true,
      /** Texto curto para explicar ao cliente por que o campo esta travado. */
      travaExplicada: (fieldKey: string) =>
        porChave.get(fieldKey)?.editable === false
          ? 'Mantido pela CODECA IA neste site.'
          : null,
      /**
       * Remove do corpo os campos que este site nao deixa o cliente definir.
       *
       * Sem isto, um formulario que reenvia tudo -- e e o que todo formulario
       * faz -- mandaria tambem o campo travado e levaria 403 em cada
       * gravacao, mesmo sem o cliente ter tocado nele. O servidor entao usa o
       * proprio valor: a moeda padrao, o endereco derivado do titulo.
       */
      semTravados: <T extends Record<string, unknown>>(corpo: T): Partial<T> => {
        const saida: Record<string, unknown> = {};
        for (const [chave, valor] of Object.entries(corpo)) {
          if (porChave.get(chave)?.editable === false) continue;
          saida[chave] = valor;
        }
        return saida as Partial<T>;
      },
    };
  }, [lista, loading, enabled, moduleKey]);
}
