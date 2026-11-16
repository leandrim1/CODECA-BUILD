import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { totpCode, totpStep } from '@codeca/api';
import { createTestApi, registerAccount, verifyEmail, type RegisteredAccount, type TestApi } from '../helpers/api.js';

/**
 * Verificacao em duas etapas por aplicativo autenticador.
 *
 * O que estes testes protegem, em ordem de gravidade:
 *  - o segredo nunca volta depois da configuracao, e nunca aparece em log;
 *  - o mesmo codigo nao entra duas vezes;
 *  - desligar o segundo fator exige provar a identidade de novo;
 *  - quem nao ativou continua entrando exatamente como antes.
 */

let api: TestApi;
let conta: RegisteredAccount;
let relogio = new Date('2027-05-10T12:00:00.000Z');

/** Codigo que o aplicativo mostraria agora. */
const codigoAgora = (segredo: string, delta = 0) => totpCode(segredo, totpStep(relogio) + delta);

beforeAll(async () => {
  api = await createTestApi({ now: () => new Date(relogio) });
});
afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  relogio = new Date('2027-05-10T12:00:00.000Z');
  await api.reset();
  conta = await registerAccount(api, { email: 'dona@padariaaurora.com.br', companyName: 'Padaria Aurora' });
  await verifyEmail(api, conta);
});

/** Configura o segundo fator e devolve o segredo e os codigos de recuperacao. */
async function ativar(account = conta) {
  const setup = await account.client.post('/api/auth/totp/setup');
  expect(setup.status, setup.errorMessage ?? '').toBe(200);
  const segredo = setup.body.secret as string;
  const confirm = await account.client.post('/api/auth/totp/confirm', { code: codigoAgora(segredo) });
  expect(confirm.status, confirm.errorMessage ?? '').toBe(200);
  /*
   * Avanca o relogio uma janela.
   *
   * O codigo que confirmou a configuracao NAO serve para entrar depois: o
   * passo ja foi consumido. E a protecao contra reuso funcionando -- e sem
   * este avanco todo teste de login falharia por ela, escondendo o que ele
   * quer medir. O teste `o mesmo codigo nao entra duas vezes` cobre a regra
   * de proposito.
   */
  relogio = new Date(relogio.getTime() + 60_000);
  return { segredo, recoveryCodes: confirm.body.recoveryCodes as string[] };
}

describe('ativacao', () => {
  it('gera segredo e QR Code, e so vale depois de confirmar um codigo', async () => {
    const antes = await conta.client.get('/api/auth/totp');
    expect(antes.body).toMatchObject({ enabled: false, pending: false, recoveryCodesLeft: 0 });

    const setup = await conta.client.post('/api/auth/totp/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUri).toContain('otpauth://totp/');
    expect(setup.body.otpauthUri).toContain(encodeURIComponent(conta.email));
    expect(setup.body.otpauthUri).toContain('algorithm=SHA1');
    expect(setup.body.otpauthUri).toContain('digits=6');

    // Enquanto nao confirma, o login NAO pede o aplicativo.
    const meio = await conta.client.get('/api/auth/totp');
    expect(meio.body).toMatchObject({ enabled: false, pending: true });

    const confirm = await conta.client.post('/api/auth/totp/confirm', {
      code: codigoAgora(setup.body.secret as string),
    });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(8);
    for (const codigo of confirm.body.recoveryCodes as string[]) {
      expect(codigo).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    }

    const depois = await conta.client.get('/api/auth/totp');
    expect(depois.body).toMatchObject({ enabled: true, pending: false, recoveryCodesLeft: 8 });
  });

  it('codigo errado na confirmacao nao ativa nada', async () => {
    await conta.client.post('/api/auth/totp/setup');
    const confirm = await conta.client.post('/api/auth/totp/confirm', { code: '000000' });
    expect(confirm.status).toBe(400);
    expect((await conta.client.get('/api/auth/totp')).body.enabled).toBe(false);
  });

  it('o segredo e guardado cifrado: quem ler o banco nao gera codigos', async () => {
    const { segredo } = await ativar();
    const [linha] = await api.db.select().from(schema.userTotp).where(eq(schema.userTotp.userId, conta.userId));
    expect(linha?.secret).toBeTruthy();
    expect(linha!.secret).not.toContain(segredo);
    // Os codigos de recuperacao tambem: so o resumo fica.
    const codigos = await api.db.select().from(schema.userRecoveryCodes);
    expect(codigos).toHaveLength(8);
    for (const c of codigos) expect(c.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('o segredo nunca volta depois de configurado', async () => {
    await ativar();
    const estado = await conta.client.get('/api/auth/totp');
    expect(JSON.stringify(estado.body)).not.toContain('secret');
    // Comecar de novo com o fator ativo e recusado: trocar de aparelho passa
    // por desligar com a senha.
    const denovo = await conta.client.post('/api/auth/totp/setup');
    expect(denovo.status).toBe(409);
  });
});

describe('login', () => {
  it('senha correta pede o aplicativo, e o codigo certo abre a sessao', async () => {
    const { segredo } = await ativar();
    const cliente = api.client();

    const login = await cliente.post('/api/auth/login', {
      email: conta.email,
      password: conta.password,
      rememberMe: false,
    });
    expect(login.status).toBe(200);
    expect(login.body.status).toBe('totp_required');
    // A primeira etapa NAO abre sessao.
    expect((await cliente.get('/api/auth/session')).body.session).toBeNull();

    const verify = await cliente.post('/api/auth/code/verify-totp', { code: codigoAgora(segredo) });
    expect(verify.status, verify.errorMessage ?? '').toBe(200);
    expect(verify.body.status).toBe('authenticated');
    expect(verify.body.usedRecoveryCode).toBe(false);
    expect((await cliente.get('/api/auth/session')).body.session).not.toBeNull();
  });

  it('codigo errado nao abre sessao, e o comprovante continua valendo', async () => {
    const { segredo } = await ativar();
    const cliente = api.client();
    await cliente.post('/api/auth/login', { email: conta.email, password: conta.password, rememberMe: false });

    const errado = await cliente.post('/api/auth/code/verify-totp', { code: '000000' });
    expect(errado.status).toBe(401);
    expect((await cliente.get('/api/auth/session')).body.session).toBeNull();

    // Errar nao obriga a digitar a senha de novo.
    const certo = await cliente.post('/api/auth/code/verify-totp', { code: codigoAgora(segredo) });
    expect(certo.status).toBe(200);
  });

  it('o mesmo codigo nao entra duas vezes', async () => {
    const { segredo } = await ativar();
    const codigo = codigoAgora(segredo);

    const primeiro = api.client();
    await primeiro.post('/api/auth/login', { email: conta.email, password: conta.password, rememberMe: false });
    expect((await primeiro.post('/api/auth/code/verify-totp', { code: codigo })).status).toBe(200);

    const segundo = api.client();
    await segundo.post('/api/auth/login', { email: conta.email, password: conta.password, rememberMe: false });
    const repetido = await segundo.post('/api/auth/code/verify-totp', { code: codigo });
    expect(repetido.status).toBe(401);
  });

  it('codigo de uma janela vencida nao serve', async () => {
    const { segredo } = await ativar();
    // Codigo de 5 minutos atras: fora da tolerancia de um passo.
    const velho = totpCode(segredo, totpStep(relogio) - 10);
    const cliente = api.client();
    await cliente.post('/api/auth/login', { email: conta.email, password: conta.password, rememberMe: false });
    expect((await cliente.post('/api/auth/code/verify-totp', { code: velho })).status).toBe(401);
  });

  it('aceita o passo anterior e o seguinte: relogio do celular adiantado ou atrasado', async () => {
    const { segredo } = await ativar();
    for (const delta of [-1, 1]) {
      const cliente = api.client();
      await cliente.post('/api/auth/login', { email: conta.email, password: conta.password, rememberMe: false });
      const r = await cliente.post('/api/auth/code/verify-totp', { code: codigoAgora(segredo, delta) });
      expect(r.status, `delta ${delta}`).toBe(200);
      // Cada passo so vale uma vez: avanca o relogio para o proximo caso.
      relogio = new Date(relogio.getTime() + 120_000);
    }
  });

  it('quem NAO ativou continua entrando como antes', async () => {
    const cliente = api.client();
    const login = await cliente.post('/api/auth/login', {
      email: conta.email,
      password: conta.password,
      rememberMe: false,
    });
    expect(login.status).toBe(200);
    expect(login.body.status).not.toBe('totp_required');
    expect((await cliente.get('/api/auth/session')).body.session).not.toBeNull();
  });

  it('senha errada continua sendo senha errada: o fator nao vaza que a conta existe', async () => {
    await ativar();
    const cliente = api.client();
    const login = await cliente.post('/api/auth/login', {
      email: conta.email,
      password: 'senhaErrada123',
      rememberMe: false,
    });
    expect(login.status).toBe(401);
    expect(JSON.stringify(login.body)).not.toContain('totp');
  });
});

describe('codigos de recuperacao', () => {
  it('entram no lugar do aplicativo, uma vez cada', async () => {
    const { recoveryCodes } = await ativar();
    const codigo = recoveryCodes[0]!;

    const cliente = api.client();
    await cliente.post('/api/auth/login', { email: conta.email, password: conta.password, rememberMe: false });
    const usa = await cliente.post('/api/auth/code/verify-totp', { code: codigo });
    expect(usa.status, usa.errorMessage ?? '').toBe(200);
    expect(usa.body.usedRecoveryCode).toBe(true);
    expect(usa.body.recoveryCodesLeft).toBe(7);

    // O mesmo codigo nao serve de novo.
    const outro = api.client();
    await outro.post('/api/auth/login', { email: conta.email, password: conta.password, rememberMe: false });
    expect((await outro.post('/api/auth/code/verify-totp', { code: codigo })).status).toBe(401);
  });

  it('aceitam hifen, espaco e minuscula: a pessoa copia de um papel', async () => {
    const { recoveryCodes } = await ativar();
    const cliente = api.client();
    await cliente.post('/api/auth/login', { email: conta.email, password: conta.password, rememberMe: false });
    const bagunçado = recoveryCodes[1]!.toLowerCase().replace('-', ' ');
    expect((await cliente.post('/api/auth/code/verify-totp', { code: bagunçado })).status).toBe(200);
  });

  it('gerar uma lista nova invalida a anterior, e exige a senha', async () => {
    const { recoveryCodes } = await ativar();

    const semSenha = await conta.client.post('/api/auth/totp/recovery-codes', {});
    expect(semSenha.status).toBe(422);

    const novos = await conta.client.post('/api/auth/totp/recovery-codes', { password: conta.password });
    expect(novos.status, novos.errorMessage ?? '').toBe(200);
    expect(novos.body.recoveryCodes).toHaveLength(8);
    expect(novos.body.recoveryCodes).not.toContain(recoveryCodes[0]);

    const cliente = api.client();
    await cliente.post('/api/auth/login', { email: conta.email, password: conta.password, rememberMe: false });
    expect((await cliente.post('/api/auth/code/verify-totp', { code: recoveryCodes[0]! })).status).toBe(401);
  });
});

describe('desativacao', () => {
  it('sessao aberta NAO basta: exige senha ou codigo do aplicativo', async () => {
    const { segredo } = await ativar();

    // 422: o corpo nao passa na validacao (nem senha, nem codigo).
    const semProva = await conta.client.post('/api/auth/totp/disable', {});
    expect(semProva.status).toBe(422);
    expect((await conta.client.get('/api/auth/totp')).body.enabled).toBe(true);

    const senhaErrada = await conta.client.post('/api/auth/totp/disable', { password: 'errada123' });
    expect(senhaErrada.status).toBe(401);
    expect((await conta.client.get('/api/auth/totp')).body.enabled).toBe(true);

    const comCodigo = await conta.client.post('/api/auth/totp/disable', { code: codigoAgora(segredo) });
    expect(comCodigo.status, comCodigo.errorMessage ?? '').toBe(200);
    expect((await conta.client.get('/api/auth/totp')).body).toMatchObject({ enabled: false, recoveryCodesLeft: 0 });
  });

  it('desligado, o login volta a ser o de antes e os codigos somem', async () => {
    await ativar();
    expect((await conta.client.post('/api/auth/totp/disable', { password: conta.password })).status).toBe(200);
    expect(await api.db.select().from(schema.userRecoveryCodes)).toHaveLength(0);

    const cliente = api.client();
    const login = await cliente.post('/api/auth/login', {
      email: conta.email,
      password: conta.password,
      rememberMe: false,
    });
    expect(login.body.status).not.toBe('totp_required');
  });
});

describe('isolamento entre contas', () => {
  it('o codigo de uma pessoa nao abre a conta de outra', async () => {
    const { segredo } = await ativar();
    const vizinha = await registerAccount(api, { email: 'dono@oficinasol.com.br', companyName: 'Oficina Sol' });
    await verifyEmail(api, vizinha);
    await ativar(vizinha);

    const cliente = api.client();
    await cliente.post('/api/auth/login', { email: vizinha.email, password: vizinha.password, rememberMe: false });
    // Codigo da Padaria, conta da Oficina.
    expect((await cliente.post('/api/auth/code/verify-totp', { code: codigoAgora(segredo) })).status).toBe(401);
  });

  it('sem sessao, nenhuma rota do segundo fator responde', async () => {
    const anonimo = api.client();
    for (const caminho of ['/api/auth/totp', '/api/auth/totp/setup', '/api/auth/totp/disable']) {
      const metodo = caminho === '/api/auth/totp' ? 'get' : 'post';
      const r = metodo === 'get' ? await anonimo.get(caminho) : await anonimo.post(caminho, {});
      expect(r.status, caminho).toBe(401);
    }
  });
});
