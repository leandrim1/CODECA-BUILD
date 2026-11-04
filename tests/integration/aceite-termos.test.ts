import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { LEGAL_VERSION } from '@codeca/shared';
import { createTestApi, registerAccount, type TestApi } from '../helpers/api.js';

/**
 * Registro do aceite dos termos: quando e qual versao do texto.
 */

let api: TestApi;
let agora: Date;

beforeAll(async () => {
  agora = new Date('2026-11-10T15:00:00Z');
  api = await createTestApi({ now: () => agora });
});
afterAll(async () => {
  await api.close();
});
beforeEach(async () => {
  await api.reset();
});

describe('cadastro por e-mail e senha', () => {
  it('grava o momento e a versao dos documentos aceitos', async () => {
    const conta = await registerAccount(api, { email: 'novo@empresa.test', companyName: 'Empresa Nova' });
    const [user] = await api.db.select().from(schema.users).where(eq(schema.users.id, conta.userId));
    expect(user!.termsAcceptedAt?.toISOString()).toBe(agora.toISOString());
    expect(user!.termsVersion).toBe(LEGAL_VERSION);
  });

  it('sem aceitar, nada e criado (e nada e registrado)', async () => {
    const response = await api.client().post('/api/auth/register', {
      name: 'Responsavel Teste',
      email: 'sem@aceite.test',
      password: 'senhaSegura123',
      companyName: 'Sem Aceite',
      phone: '(19) 99999-0000',
      acceptedTerms: false,
    });
    expect(response.status).toBe(422);
    expect(await api.db.select().from(schema.users)).toHaveLength(0);
  });

  it('usuarios criados sem o formulario (convite) ficam sem aceite, e nao com um aceite falso', async () => {
    const [user] = await api.db
      .insert(schema.users)
      .values({ email: 'convidado@empresa.test', name: 'Convidado' })
      .returning();
    expect(user!.termsAcceptedAt).toBeNull();
    expect(user!.termsVersion).toBeNull();
  });
});
