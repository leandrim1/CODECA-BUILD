import { AppError } from '@codeca/shared';
import type { Env } from '../env.js';

/**
 * Integracao com a API de dominios da Vercel, sempre pelo backend.
 *
 * A plataforma nunca considera um dominio ativo apenas porque foi cadastrado no
 * painel: o estado vem da resposta da Vercel (propriedade comprovada + DNS
 * apontado). Sem credenciais configuradas, o provedor informa explicitamente
 * que a etapa depende de configuracao externa.
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
  add: (hostname: string) => Promise<DomainProviderStatus>;
  status: (hostname: string) => Promise<DomainProviderStatus>;
  verify: (hostname: string) => Promise<DomainProviderStatus>;
  remove: (hostname: string) => Promise<void>;
}

const UNCONFIGURED_MESSAGE =
  'A integracao de dominios da Vercel nao esta configurada. Defina VERCEL_API_TOKEN e '
  + 'VERCEL_PROJECT_ID no ambiente para que a plataforma registre e verifique o dominio '
  + 'automaticamente. Enquanto isso, o dominio fica aguardando configuracao externa.';

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
    add: async () => unconfiguredStatus(),
    status: async () => unconfiguredStatus(),
    verify: async () => unconfiguredStatus(),
    remove: async () => {
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
  projectId: string;
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
        'Nao foi possivel contatar a API da Vercel para verificar o dominio.',
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

  async function readStatus(hostname: string): Promise<DomainProviderStatus> {
    const domain = await call<VercelProjectDomain>(
      `/v9/projects/${encodeURIComponent(options.projectId)}/domains/${encodeURIComponent(hostname)}${query}`,
    );
    if (!domain.ok) {
      if (domain.status === 404) {
        return {
          ownershipVerified: false,
          dnsConfigured: false,
          sslActive: false,
          challenges: [],
          message: 'O dominio ainda nao esta registrado no projeto da Vercel.',
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
        ? 'Dominio ativo e servindo com HTTPS.'
        : ownershipVerified
          ? 'Propriedade comprovada. Ajuste os registros de DNS para concluir a ativacao.'
          : 'Aguardando os registros de DNS para comprovar a propriedade do dominio.',
      providerDomainId: domain.data.name,
    };
  }

  return {
    configured: true,

    async add(hostname) {
      const created = await call<VercelProjectDomain>(
        `/v10/projects/${encodeURIComponent(options.projectId)}/domains${query}`,
        { method: 'POST', body: JSON.stringify({ name: hostname }) },
      );
      if (!created.ok && created.code !== 'domain_already_in_use_by_this_project') {
        if (created.code === 'domain_already_in_use') {
          throw AppError.conflict(
            'Este dominio ja esta em uso por outro projeto da Vercel. Remova-o de la antes de vincula-lo aqui.',
          );
        }
        if (created.status === 403) {
          throw AppError.forbidden(
            'O token da Vercel nao tem permissao para adicionar dominios neste projeto.',
          );
        }
        throw new AppError('upstream_error', created.message);
      }
      return readStatus(hostname);
    },

    status: readStatus,

    async verify(hostname) {
      const verified = await call<VercelProjectDomain>(
        `/v9/projects/${encodeURIComponent(options.projectId)}/domains/${encodeURIComponent(hostname)}/verify${query}`,
        { method: 'POST' },
      );
      if (!verified.ok && verified.status !== 400 && verified.status !== 409) {
        throw new AppError('upstream_error', verified.message);
      }
      return readStatus(hostname);
    },

    async remove(hostname) {
      const removed = await call<unknown>(
        `/v9/projects/${encodeURIComponent(options.projectId)}/domains/${encodeURIComponent(hostname)}${query}`,
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
  if (!env.VERCEL_API_TOKEN || !env.VERCEL_PROJECT_ID) return createUnconfiguredDomainProvider();
  return createVercelDomainProvider({
    token: env.VERCEL_API_TOKEN,
    projectId: env.VERCEL_PROJECT_ID,
    teamId: env.VERCEL_TEAM_ID,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
