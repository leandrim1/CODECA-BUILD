import { describe, expect, it } from 'vitest';
import {
  MAX_DELIVERY_ATTEMPTS,
  deliveryWorthRetrying,
  nextAttemptDelayMinutes,
} from '@codeca/shared';
import { signOutboundWebhook } from '@codeca/shared/server';
import { verifyWebhook } from '@codeca/sdk/server';

/**
 * Assinatura dos webhooks de saida.
 *
 * O teste que importa e o de ida e volta: a plataforma assina com
 * `node:crypto` e o site do cliente confere com Web Crypto, em outro
 * processo e possivelmente em outro runtime. Se as duas pontas discordarem,
 * nenhum site aceita nenhum aviso -- e a falha aparece como "o cache nao
 * invalida", longe da causa.
 */

const SEGREDO = 'cb_whsec_segredo_de_teste_com_bastante_entropia';
const AGORA = 1_800_000_000_000;

function corpoDeExemplo() {
  return JSON.stringify({
    event: 'content.published',
    siteId: '11111111-1111-4111-8111-111111111111',
    moduleKey: 'imoveis',
    action: 'updated',
    entityId: '22222222-2222-4222-8222-222222222222',
    slug: 'apartamento-jardim',
    publishedAt: new Date(AGORA).toISOString(),
  });
}

describe('a plataforma assina e o site confere', () => {
  it('aceita a assinatura que a plataforma produziu', async () => {
    const corpo = corpoDeExemplo();
    const assinatura = signOutboundWebhook(SEGREDO, AGORA, corpo);

    const evento = await verifyWebhook({
      rawBody: corpo,
      signature: assinatura,
      secret: SEGREDO,
      nowMs: AGORA,
    });

    expect(evento.event).toBe('content.published');
    expect(evento.moduleKey).toBe('imoveis');
    expect(evento.slug).toBe('apartamento-jardim');
  });

  it('recusa o corpo alterado em um unico caractere', async () => {
    const corpo = corpoDeExemplo();
    const assinatura = signOutboundWebhook(SEGREDO, AGORA, corpo);
    const adulterado = corpo.replace('apartamento-jardim', 'apartamento-jardins');

    await expect(
      verifyWebhook({ rawBody: adulterado, signature: assinatura, secret: SEGREDO, nowMs: AGORA }),
    ).rejects.toMatchObject({ code: 'assinatura_invalida' });
  });

  it('recusa a assinatura feita com outro segredo', async () => {
    const corpo = corpoDeExemplo();
    const assinatura = signOutboundWebhook('cb_whsec_outro_segredo_qualquer', AGORA, corpo);

    await expect(
      verifyWebhook({ rawBody: corpo, signature: assinatura, secret: SEGREDO, nowMs: AGORA }),
    ).rejects.toMatchObject({ code: 'assinatura_invalida' });
  });

  it('recusa uma entrega antiga reenviada', async () => {
    const corpo = corpoDeExemplo();
    const assinatura = signOutboundWebhook(SEGREDO, AGORA, corpo);

    // Dez minutos depois: a assinatura continua correta, mas a janela passou.
    // Sem esta conferencia, uma requisicao capturada valeria para sempre.
    await expect(
      verifyWebhook({
        rawBody: corpo,
        signature: assinatura,
        secret: SEGREDO,
        nowMs: AGORA + 10 * 60 * 1000,
      }),
    ).rejects.toMatchObject({ code: 'assinatura_expirada' });
  });

  it('o timestamp faz parte do que e assinado', async () => {
    const corpo = corpoDeExemplo();
    const assinatura = signOutboundWebhook(SEGREDO, AGORA, corpo);
    // Trocar so o `t` do cabecalho, mantendo o HMAC: se o instante nao
    // entrasse no calculo, isto passaria e a janela nao protegeria nada.
    const comOutroInstante = assinatura.replace(`t=${AGORA}`, `t=${AGORA + 1000}`);

    await expect(
      verifyWebhook({
        rawBody: corpo,
        signature: comOutroInstante,
        secret: SEGREDO,
        nowMs: AGORA + 1000,
      }),
    ).rejects.toMatchObject({ code: 'assinatura_invalida' });
  });

  it('recusa requisicao sem assinatura', async () => {
    await expect(
      verifyWebhook({ rawBody: corpoDeExemplo(), signature: null, secret: SEGREDO, nowMs: AGORA }),
    ).rejects.toMatchObject({ code: 'assinatura_ausente' });
  });

  it('recusa cabecalho em formato inesperado', async () => {
    await expect(
      verifyWebhook({
        rawBody: corpoDeExemplo(),
        signature: 'nao-e-uma-assinatura',
        secret: SEGREDO,
        nowMs: AGORA,
      }),
    ).rejects.toMatchObject({ code: 'assinatura_malformada' });
  });

  it('recusa evento que esta versao nao conhece', async () => {
    const corpo = JSON.stringify({ event: 'algo.que.nao.existe', siteId: 'x' });
    const assinatura = signOutboundWebhook(SEGREDO, AGORA, corpo);

    await expect(
      verifyWebhook({ rawBody: corpo, signature: assinatura, secret: SEGREDO, nowMs: AGORA }),
    ).rejects.toMatchObject({ code: 'evento_desconhecido' });
  });
});

describe('politica de retentativa', () => {
  it('repete o que pode melhorar e desiste do que nao pode', () => {
    // 5xx e falha de rede valem repetir: o site pode estar reiniciando.
    expect(deliveryWorthRetrying(500)).toBe(true);
    expect(deliveryWorthRetrying(503)).toBe(true);
    expect(deliveryWorthRetrying(0)).toBe(true);
    expect(deliveryWorthRetrying(408)).toBe(true);
    expect(deliveryWorthRetrying(429)).toBe(true);

    // Um 4xx do site nao melhora com repeticao: o endereco esta errado ou a
    // assinatura foi recusada. Insistir so gera ruido nos dois lados.
    expect(deliveryWorthRetrying(400)).toBe(false);
    expect(deliveryWorthRetrying(401)).toBe(false);
    expect(deliveryWorthRetrying(404)).toBe(false);
  });

  it('o intervalo entre tentativas cresce', () => {
    const atrasos = Array.from({ length: MAX_DELIVERY_ATTEMPTS }, (_, i) =>
      nextAttemptDelayMinutes(i + 1),
    );

    for (let i = 1; i < atrasos.length; i += 1) {
      expect(atrasos[i]).toBeGreaterThanOrEqual(atrasos[i - 1]!);
    }
    expect(atrasos[0]).toBeGreaterThan(0);
  });
});
