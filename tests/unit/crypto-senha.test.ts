import { describe, expect, it } from 'vitest';
import { hashPassword, precisaRehashDeSenha, verifyPassword } from '@codeca/shared/server';

/**
 * O custo do hash de senha subiu de 2^14 para 2^16.
 *
 * Duas coisas tinham de continuar valendo, e e o que estes testes travam:
 * senha antiga confere com o custo antigo (ninguem fica trancado para fora), e
 * o hash fraco e reconhecido como tal, para o login poder regrava-lo.
 */

/** Como um hash gravado antes da mudanca -- 2^14, o piso da OWASP. */
const HASH_ANTIGO =
  'scrypt$16384$8$1$c2FsdC1maXhvLWRlLXRlc3Rl$' +
  'MA==';

describe('custo do hash de senha', () => {
  it('a senha nova usa o custo de hoje', async () => {
    const hash = await hashPassword('uma-senha-boa-123');
    const [algoritmo, n, r, p] = hash.split('$');
    expect(algoritmo).toBe('scrypt');
    expect(Number(n)).toBe(65_536);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });

  it('a senha confere com o hash que acabou de ser gerado', async () => {
    const hash = await hashPassword('uma-senha-boa-123');
    expect(await verifyPassword('uma-senha-boa-123', hash)).toBe(true);
    expect(await verifyPassword('outra-senha', hash)).toBe(false);
  });

  /**
   * O ponto que impede o pior resultado possivel desta mudanca: trancar todo
   * mundo para fora. Os parametros saem do hash guardado, nao da constante.
   */
  it('hash gerado com o custo ANTIGO continua conferindo', async () => {
    // Gerado aqui com os parametros antigos, para nao depender de um valor
    // colado que poderia ter sido copiado errado.
    const { scrypt } = await import('node:crypto');
    const { promisify } = await import('node:util');
    const derivar = promisify(scrypt) as (
      s: string, salt: Buffer, len: number, o: { N: number; r: number; p: number },
    ) => Promise<Buffer>;
    const salt = Buffer.from('salt-fixo-de-teste');
    const antigo = await derivar('senha-antiga-456', salt, 64, { N: 16_384, r: 8, p: 1 });
    const guardado = ['scrypt', 16_384, 8, 1, salt.toString('base64'), antigo.toString('base64')].join('$');

    expect(await verifyPassword('senha-antiga-456', guardado)).toBe(true);
    expect(await verifyPassword('senha-errada', guardado)).toBe(false);
  });

  it('reconhece o hash fraco, para o login regravar', async () => {
    expect(precisaRehashDeSenha(HASH_ANTIGO)).toBe(true);
    expect(precisaRehashDeSenha(await hashPassword('x'.repeat(12)))).toBe(false);
  });

  it('hash ausente ou fora do formato nao pede regravacao a toa', () => {
    // Sem senha (conta so com Google) nao ha o que regravar.
    expect(precisaRehashDeSenha(null)).toBe(false);
    // Formato desconhecido: regravar e o lado seguro.
    expect(precisaRehashDeSenha('bcrypt$2b$12$qualquercoisa')).toBe(true);
  });
});
