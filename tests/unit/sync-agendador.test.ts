import { describe, expect, it } from 'vitest';
import {
  SCHEDULER_BASELINE_MINUTES,
  SCHEDULER_VALIDATION,
  computeSchedulerStatus,
  describeInterval,
  effectiveSchedulerMinutes,
  frequencyExceedsScheduler,
  schedulerNote,
  type SyncRunOrigin,
} from '@codeca/shared';

/**
 * A cadencia que a tela anuncia.
 *
 * A regra que todos estes testes defendem e uma so: **a plataforma nao
 * anuncia o que nao mediu**. Configurar um agendador externo no cron-job.org
 * nao muda nada aqui; o que muda e ele ter chamado, repetidamente e
 * recentemente. Ate la vale o piso dos dois agendamentos da Vercel.
 *
 * O teste importa porque o erro oposto e silencioso e caro: uma tela
 * prometendo "a cada 6 horas" para um cliente cujo cron externo foi apagado
 * ha um mes parece funcionar perfeitamente -- so o conteudo e que chega
 * atrasado, e a culpa cai na plataforma.
 */

const AGORA = new Date('2026-03-10T12:00:00.000Z');

/** Passagens a cada `horas`, terminando em `ate`. */
function passagens(input: {
  horas: number;
  quantidade: number;
  origin: SyncRunOrigin;
  ate?: Date;
}): { origin: SyncRunOrigin; startedAt: Date }[] {
  const fim = (input.ate ?? AGORA).getTime();
  return Array.from({ length: input.quantidade }, (_, i) => ({
    origin: input.origin,
    startedAt: new Date(fim - i * input.horas * 60 * 60_000),
  }));
}

describe('cadencia medida, nao configurada', () => {
  it('sem histórico nenhum, vale o piso e nada é anunciado', () => {
    const status = computeSchedulerStatus({ now: AGORA, runs: [], lastRun: null });

    expect(status.observedMinutes).toBeNull();
    expect(status.externalValidated).toBe(false);
    expect(status.externalRuns).toBe(0);
    expect(effectiveSchedulerMinutes(status)).toBe(SCHEDULER_BASELINE_MINUTES);
    expect(schedulerNote(status)).toContain('uma vez por dia');
  });

  it('só a Vercel rodando não vira cadência de 6 horas', () => {
    // Os dois agendamentos diarios produzem passagens, mas nenhuma externa:
    // a plataforma continua prometendo apenas o piso.
    const status = computeSchedulerStatus({
      now: AGORA,
      runs: passagens({ horas: 12, quantidade: 8, origin: 'vercel' }),
      lastRun: null,
    });

    expect(status.externalRuns).toBe(0);
    expect(status.externalValidated).toBe(false);
    expect(effectiveSchedulerMinutes(status)).toBe(SCHEDULER_BASELINE_MINUTES);
  });

  it('poucas execuções externas ainda não bastam', () => {
    const status = computeSchedulerStatus({
      now: AGORA,
      runs: passagens({ horas: 6, quantidade: SCHEDULER_VALIDATION.minRuns - 1, origin: 'externo' }),
      lastRun: null,
    });

    expect(status.externalValidated).toBe(false);
    expect(effectiveSchedulerMinutes(status)).toBe(SCHEDULER_BASELINE_MINUTES);
  });

  it('agendador externo de 6 em 6 horas é reconhecido', () => {
    const status = computeSchedulerStatus({
      now: AGORA,
      runs: passagens({ horas: 6, quantidade: 12, origin: 'externo' }),
      lastRun: null,
    });

    expect(status.externalRuns).toBe(12);
    expect(status.externalValidated).toBe(true);
    expect(status.observedMinutes).toBe(6 * 60);
    expect(effectiveSchedulerMinutes(status)).toBe(6 * 60);
    expect(schedulerNote(status)).toContain('6 horas');
    // E, reconhecido, a preferencia de 6 horas deixa de merecer aviso.
    expect(frequencyExceedsScheduler('6h', effectiveSchedulerMinutes(status))).toBe(false);
  });

  it('o buraco manda, não a média', () => {
    /**
     * Um agendador que roda de 6 em 6 horas mas pulou uma noite inteira
     * entregou 18 horas naquele intervalo. A media diria 7h e pouco; o
     * cliente precisa ouvir 18, porque e isso que ele vai sentir.
     */
    const base = AGORA.getTime();
    const horas = [0, 6, 12, 30, 36, 42, 48].map((h) => ({
      origin: 'externo' as const,
      startedAt: new Date(base - h * 60 * 60_000),
    }));

    const status = computeSchedulerStatus({ now: AGORA, runs: horas, lastRun: null });

    expect(status.observedMinutes).toBe(18 * 60);
  });

  it('agendador externo que parou envelhece sozinho, sem ninguém desligar nada', () => {
    /**
     * Doze execucoes perfeitas de 6 em 6 horas -- mas a ultima foi ha dois
     * dias. Sem contar o tempo desde entao como um intervalo, a tela
     * continuaria anunciando 6 horas para sempre, apoiada em historia
     * antiga. Este e o teste que prende essa porta.
     */
    const parouEm = new Date(AGORA.getTime() - 48 * 60 * 60_000);
    const status = computeSchedulerStatus({
      now: AGORA,
      runs: passagens({ horas: 6, quantidade: 12, origin: 'externo', ate: parouEm }),
      lastRun: null,
    });

    expect(status.observedMinutes).toBe(48 * 60);
    expect(status.externalValidated).toBe(false);
    expect(effectiveSchedulerMinutes(status)).toBe(SCHEDULER_BASELINE_MINUTES);
    expect(schedulerNote(status)).toContain('uma vez por dia');
  });

  it('execuções fora da janela de observação não contam', () => {
    const antigas = passagens({
      horas: 6,
      quantidade: 20,
      origin: 'externo',
      ate: new Date(AGORA.getTime() - (SCHEDULER_VALIDATION.windowDays + 2) * 24 * 60 * 60_000),
    });

    const status = computeSchedulerStatus({ now: AGORA, runs: antigas, lastRun: null });

    expect(status.externalRuns).toBe(0);
    expect(status.externalValidated).toBe(false);
  });

  it('a cadência anunciada nunca é melhor que a medida', () => {
    // Um agendador externo lento (a cada 30 h) nao pode piorar o piso: a
    // Vercel continua garantindo o dia.
    const status = computeSchedulerStatus({
      now: AGORA,
      runs: passagens({ horas: 30, quantidade: 5, origin: 'externo' }),
      lastRun: null,
    });

    expect(status.externalValidated).toBe(false);
    expect(effectiveSchedulerMinutes(status)).toBe(SCHEDULER_BASELINE_MINUTES);
  });
});

describe('intervalo escrito para uma pessoa', () => {
  it('escreve minutos, horas e dias', () => {
    expect(describeInterval(30)).toBe('30 minutos');
    expect(describeInterval(60)).toBe('uma hora');
    expect(describeInterval(6 * 60)).toBe('6 horas');
    expect(describeInterval(6 * 60 + 5)).toBe('6h05');
    expect(describeInterval(24 * 60)).toBe('um dia');
    expect(describeInterval(48 * 60)).toBe('2 dias');
  });
});
