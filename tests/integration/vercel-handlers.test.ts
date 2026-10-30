import { describe, expect, it } from 'vitest';
import * as apiFunction from '../../api/index.js';

/**
 * Formato dos handlers da Vercel.
 *
 * O runtime Node da Vercel trata o `export default` como `(req, res) => void`
 * e descarta o valor devolvido. Com `handle()` do Hono, que devolve uma
 * `Response`, nada chegava a ser escrito: toda rota ficava aberta ate o
 * runtime mata-la aos 60 s. O site inteiro respondeu 504 por horas por causa
 * disso, e nenhum teste pegava -- os testes chamam a aplicacao Hono
 * diretamente, nunca o formato do modulo que a Vercel carrega.
 *
 * Estes testes olham para o modulo, nao para a aplicacao.
 */

const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;

describe.each([['api/index.ts', apiFunction as Record<string, unknown>, 'http://app.exemplo.com/api/health']])(
  '%s',
  (_nome, modulo, url) => {
  it('exporta um handler por metodo HTTP', () => {
    for (const metodo of METODOS) {
      expect(typeof modulo[metodo]).toBe('function');
    }
  });

  it('nao tem export default', () => {
    // Um export default reativa a interpretacao `(req, res)` do runtime, e a
    // `Response` volta a ser descartada -- a falha que originou estes testes.
    expect(modulo['default']).toBeUndefined();
  });

  it('o handler devolve uma Response de verdade', async () => {
    // O ponto do modo Web-standard: devolver, em vez de escrever em `res`.
    const handler = modulo['GET'] as (request: Request) => Response | Promise<Response>;
    const response = await handler(new Request(url));
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBeGreaterThanOrEqual(200);
  });
});
