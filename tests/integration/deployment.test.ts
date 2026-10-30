import { describe, expect, it } from 'vitest';
import { createConfigErrorApp, deploymentInfo, parseEnv } from '@codeca/api';

/**
 * Identidade da implantacao.
 *
 * Um deploy preso em um commit antigo e indistinguivel de um bug: a tela erra,
 * o repositorio esta certo e nada no ar diz qual das duas versoes esta
 * respondendo. O `/api/health` passa a dizer, e e por ele que se decide se o
 * proximo passo e corrigir codigo ou corrigir a implantacao.
 */

/** Ambiente da Vercel como chega a funcao em producao. */
const VERCEL_PRODUCTION = {
  VERCEL_GIT_COMMIT_SHA: 'f697a34cfe0cf737faa591007b1bebc1b1a1b90b',
  VERCEL_GIT_COMMIT_REF: 'claude/friendly-johnson-b0ze15',
  VERCEL_ENV: 'production',
  VERCEL_REGION: 'gru1',
};

describe('identidade da implantacao', () => {
  it('abrevia o commit e informa branch, ambiente e regiao', () => {
    expect(deploymentInfo(VERCEL_PRODUCTION)).toEqual({
      commit: 'f697a34',
      branch: 'claude/friendly-johnson-b0ze15',
      environment: 'production',
      region: 'gru1',
    });
  });

  it('distingue um deploy de preview da producao', () => {
    // O sintoma que motivou isto: a producao continuava servindo um build
    // antigo porque os pushes viravam preview. Com o branch e o ambiente a
    // vista, a diferenca aparece sem abrir o painel da Vercel.
    const preview = deploymentInfo({ ...VERCEL_PRODUCTION, VERCEL_ENV: 'preview' });
    expect(preview.environment).toBe('preview');
    expect(preview.commit).toBe('f697a34');
  });

  it('fora da Vercel responde nulo, sem inventar valores', () => {
    expect(deploymentInfo({})).toEqual({
      commit: null,
      branch: null,
      environment: null,
      region: null,
    });
  });

  it('trata variavel vazia como ausente', () => {
    // A Vercel entrega string vazia quando o deploy nao vem do git.
    expect(deploymentInfo({ VERCEL_GIT_COMMIT_SHA: '', VERCEL_ENV: '  ' })).toEqual({
      commit: null,
      branch: null,
      environment: null,
      region: null,
    });
  });

  it('o health de ambiente incompleto tambem diz qual commit respondeu', async () => {
    // Justamente quando falta configuracao e preciso saber se o build e
    // recente: uma variavel criada depois do ultimo build nao esta nele.
    let error: unknown;
    try {
      parseEnv({ NODE_ENV: 'production' });
    } catch (caught) {
      error = caught;
    }

    const app = createConfigErrorApp(error);
    const body = (await (await app.request('http://app.localhost/api/health')).json()) as {
      data: { status: string; deployment: Record<string, string | null> };
    };

    expect(body.data.status).toBe('misconfigured');
    expect(body.data.deployment).toHaveProperty('commit');
    expect(body.data.deployment).toHaveProperty('branch');
    expect(body.data.deployment).toHaveProperty('environment');
  });
});
