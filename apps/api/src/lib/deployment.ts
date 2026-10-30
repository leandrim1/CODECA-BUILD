/**
 * Identidade da implantacao em execucao.
 *
 * Sem isso, descobrir qual versao do codigo esta no ar exige deduzir pelo
 * comportamento da tela -- foi assim que um deploy preso em um commit antigo
 * passou despercebido por horas, enquanto o repositorio ja tinha a correcao.
 *
 * A Vercel publica estes valores como variaveis de sistema em tempo de
 * execucao. Fora dela, tudo responde `null`: a ausencia e informacao legitima
 * ("isto nao esta rodando na Vercel"), nao um erro.
 *
 * Sao metadados de build -- commit, branch, ambiente e regiao. Nenhum segredo
 * passa por aqui.
 */

export interface DeploymentInfo {
  /** Commit publicado, abreviado. `null` fora da Vercel. */
  commit: string | null;
  /** Branch de origem do deploy. Revela se a producao aponta para onde se espera. */
  branch: string | null;
  /** `production`, `preview` ou `development`. */
  environment: string | null;
  /** Regiao que atendeu a requisicao. */
  region: string | null;
}

type EnvSource = Record<string, string | undefined>;

function read(source: EnvSource, name: string): string | null {
  const value = source[name]?.trim();
  return value ? value : null;
}

export function deploymentInfo(source: EnvSource = process.env): DeploymentInfo {
  const commit = read(source, 'VERCEL_GIT_COMMIT_SHA');
  return {
    commit: commit ? commit.slice(0, 7) : null,
    branch: read(source, 'VERCEL_GIT_COMMIT_REF'),
    environment: read(source, 'VERCEL_ENV'),
    region: read(source, 'VERCEL_REGION'),
  };
}
