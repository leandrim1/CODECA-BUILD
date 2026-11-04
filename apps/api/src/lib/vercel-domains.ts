import { AppError } from '@codeca/shared';
import type { Env } from '../env.js';

/**
 * Integracao com a API de dominios da Vercel, sempre pelo backend.
 *
 * A plataforma nunca considera um dominio ativo apenas porque foi cadastrado no
 * painel: o estado vem da resposta da Vercel (propriedade comprovada + DNS
 * apontado). Sem credenciais configuradas, o provedor informa explicitamente
 * que a etapa depende de configuracao externa.
 *
 * ## O projeto e argumento de cada chamada, nao configuracao do provedor
 *
 * Ate novembro de 2026 o projeto vinha de `VERCEL_PROJECT_ID`, um valor unico
 * do ambiente -- o projeto da propria plataforma. Anexar a ele o dominio de um
 * cliente fazia o endereco abrir o login do painel, porque aquele projeto serve
 * o painel e a API, nao o site de ninguem. Quem servia esses dominios era o
 * renderizador removido na etapa 0.
 *
 * O site de um cliente e um projeto Vercel proprio. O token e da CODECA IA (o
 * time e o mesmo); o projeto e de cada site, e o chamador o passa. Assim e
 * impossivel esquecer de escolher: nao existe valor padrao a que recorrer.
 */

export interface DomainVerificationChallenge {
  type: string;
  domain: string;
  value: string;
  reason: string;
}

export interface DomainProviderStatus {
  /** Propriedade do dominio comprovada junto ao provedor. */
  ownershipVerified: boolean;
  /** DNS apontando corretamente para a plataforma. */
  dnsConfigured: boolean;
  /** Certificado TLS emitido. */
  sslActive: boolean;
  challenges: DomainVerificationChallenge[];
  /** Mensagem legivel quando algo precisa de acao do cliente. */
  message: string;
  /** Id do dominio no provedor, quando houver. */
  providerDomainId: string | null;
}

export interface DomainProvider {
  readonly configured: boolean;
  /** `projectId` e o projeto Vercel **do site**, nunca um valor do ambiente. */
  add: (projectId: string, hostname: string) => Promise<DomainProviderStatus>;
  status: (projectId: string, hostname: string) => Promise<DomainProviderStatus>;
  verify: (projectId: string, hostname: string) => Promise<DomainProviderStatus>;
  remove: (projectId: string, hostname: string) => Promise<void>;
}

const UNCONFIGURED_MESSAGE =
  'A integração de domínios da Vercel não está configurada. Defina VERCEL_API_TOKEN no '
  + 'ambiente para que a plataforma registre e verifique o domínio automaticamente. '
  + 'Enquanto isso, o domínio fica aguardando configuração externa.';

function unconfiguredStatus(): DomainProviderStatus {
  return {
    ownershipVerified: false,
    dnsConfigured: false,
    sslActive: false,
    challenges: [],
    message: UNCONFIGURED_MESSAGE,
    providerDomainId: null,
  };
}

export function createUnconfiguredDomainProvider(): DomainProvider {
  return {
    configured: false,
    add: async (_projectId, _hostname) => unconfiguredStatus(),
    status: async (_projectId, _hostname) => unconfiguredStatus(),
    verify: async (_projectId, _hostname) => unconfiguredStatus(),
    remove: async (_projectId, _hostname) => {
      // Nada a desfazer no provedor: o dominio nunca foi registrado lá.
    },
  };
}

interface VercelProjectDomain {
  name: string;
  apexName?: string;
  verified?: boolean;
  verification?: DomainVerificationChallenge[];
}

interface VercelDomainConfig {
  misconfigured?: boolean;
  acceptedChallenges?: string[];
}

export function createVercelDomainProvider(options: {
  token: string;
  teamId?: string | undefined;
  fetchImpl?: typeof fetch;
}): DomainProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const query = options.teamId ? `?teamId=${encodeURIComponent(options.teamId)}` : '';
  async function call<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ ok: true; data: T } | { ok: false; status: number; code: string; message: string }> {
    let response: Response;
    try {
      response = await doFetch(`https://api.vercel.com${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      throw new AppError(
        'upstream_error',
        'Não foi possível contatar a API da Vercel para verificar o domínio.',
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }

    const text = await response.text();
    const payload: unknown = text ? safeJson(text) : null;
    if (!response.ok) {
      const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
      return {
        ok: false,
        status: response.status,
        code: error?.code ?? 'unknown',
        message: error?.message ?? `A Vercel respondeu ${response.status}.`,
      };
    }
    return { ok: true, data: payload as T };
  }

  async function readStatus(projectId: string, hostname: string): Promise<DomainProviderStatus> {
    const domain = await call<VercelProjectDomain>(
      `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(hostname)}${query}`,
    );
    if (!domain.ok) {
      if (domain.status === 404) {
        return {
          ownershipVerified: false,
          dnsConfigured: false,
          sslActive: false,
          challenges: [],
          message: 'O domínio ainda não está registrado no projeto da Vercel.',
          providerDomainId: null,
        };
      }
      return {
        ownershipVerified: false,
        dnsConfigured: false,
        sslActive: false,
        challenges: [],
        message: domain.message,
        providerDomainId: null,
      };
    }

    const config = await call<VercelDomainConfig>(
      `/v6/domains/${encodeURIComponent(hostname)}/config${query}`,
    );
    const misconfigured = config.ok ? config.data.misconfigured !== false : true;
    const ownershipVerified = domain.data.verified === true;
    const dnsConfigured = ownershipVerified && !misconfigured;

    return {
      ownershipVerified,
      dnsConfigured,
      // A Vercel emite o certificado assim que propriedade e DNS estao corretos.
      sslActive: dnsConfigured,
      challenges: domain.data.verification ?? [],
      message: dnsConfigured
        ? 'Domínio ativo e servindo com HTTPS.'
        : ownershipVerified
          ? 'Propriedade comprovada. Ajuste os registros de DNS para concluir a ativação.'
          : 'Aguardando os registros de DNS para comprovar a propriedade do domínio.',
      providerDomainId: domain.data.name,
    };
  }

  return {
    configured: true,

    async add(projectId, hostname) {
      const created = await call<VercelProjectDomain>(
        `/v10/projects/${encodeURIComponent(projectId)}/domains${query}`,
        { method: 'POST', body: JSON.stringify({ name: hostname }) },
      );
      if (!created.ok && created.code !== 'domain_already_in_use_by_this_project') {
        if (created.code === 'domain_already_in_use') {
          throw AppError.conflict(
            'Este domínio já está em uso por outro projeto da Vercel. Remova-o de lá antes de vinculá-lo aqui.',
          );
        }
        if (created.status === 403) {
          throw AppError.forbidden(
            'O token da Vercel não tem permissão para adicionar domínios neste projeto.',
          );
        }
        throw new AppError('upstream_error', created.message);
      }
      return readStatus(projectId, hostname);
    },

    status: readStatus,

    async verify(projectId, hostname) {
      const verified = await call<VercelProjectDomain>(
        `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(hostname)}/verify${query}`,
        { method: 'POST' },
      );
      if (!verified.ok && verified.status !== 400 && verified.status !== 409) {
        throw new AppError('upstream_error', verified.message);
      }
      return readStatus(projectId, hostname);
    },

    async remove(projectId, hostname) {
      const removed = await call<unknown>(
        `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(hostname)}${query}`,
        { method: 'DELETE' },
      );
      if (!removed.ok && removed.status !== 404) {
        throw new AppError('upstream_error', removed.message);
      }
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createDomainProvider(env: Env, fetchImpl?: typeof fetch): DomainProvider {
  // So o token. O projeto e de cada site e vem do banco, na hora da chamada.
  if (!env.VERCEL_API_TOKEN) return createUnconfiguredDomainProvider();
  return createVercelDomainProvider({
    token: env.VERCEL_API_TOKEN,
    teamId: env.VERCEL_TEAM_ID,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
