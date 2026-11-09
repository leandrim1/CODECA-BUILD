import { describe, expect, it } from 'vitest';
import {
  MISSING,
  SCHEDULER_INTERVAL_MINUTES,
  SYNC_FREQUENCIES,
  SYNC_FREQUENCY_MINUTES,
  compareThreeWay,
  fingerprint,
  frequencyExceedsScheduler,
  keyOfCandidate,
  nextCheckAt,
  normalizeKeyText,
  sideOf,
  syncKey,
  syncNoticeMessage,
  type SyncFrequency,
} from '@codeca/shared';

/**
 * Comparacao de tres pontas.
 *
 * E a peca que decide se o trabalho do cliente sobrevive a uma sincronizacao.
 * Um erro aqui nao trava nada -- ele **apaga em silencio** o texto que a
 * pessoa escreveu no painel. Por isso metade destes testes verifica que
 * **nada** foi sugerido.
 */

const lado = (valor: unknown) => sideOf(valor);

describe('impressao do conteudo', () => {
  it('ignora diferenca que nao muda o que esta escrito', () => {
    expect(fingerprint('Clínica  Sorriso\n')).toBe(fingerprint('Clínica Sorriso'));
    expect(fingerprint('Sobre nós.')).toBe(fingerprint('Sobre nós'));
    expect(fingerprint(' texto ')).toBe(fingerprint('texto'));
  });

  it('distingue caixa, porque trocar a caixa da marca e uma alteracao real', () => {
    expect(fingerprint('Clínica Sorriso')).not.toBe(fingerprint('CLÍNICA SORRISO'));
  });

  it('ignora a ordem das chaves de um objeto', () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  });

  it('respeita a ordem de uma lista, que e conteudo', () => {
    expect(fingerprint(['a', 'b'])).not.toBe(fingerprint(['b', 'a']));
  });

  it('descarta as chaves internas do mapeamento', () => {
    expect(fingerprint({ title: 'X', __imageUrl: 'a' })).toBe(fingerprint({ title: 'X' }));
  });

  it('texto vazio conta como ausente', () => {
    expect(sideOf('').missing).toBe(true);
    expect(sideOf('   ').missing).toBe(true);
    expect(sideOf(null).missing).toBe(true);
    expect(sideOf([]).missing).toBe(true);
    expect(sideOf('x').missing).toBe(false);
  });
});

describe('as quatro combinacoes', () => {
  it('nada mudou em lugar nenhum', () => {
    const v = compareThreeWay({ baseline: lado('A'), source: lado('A'), codeca: lado('A') });
    expect(v.kind).toBe('sem_alteracao');
  });

  /**
   * O caso que o item 7 do pedido descreve, na metade: o cliente editou no
   * painel e a origem **nao** mudou. Nao ha nada a sugerir, e sugerir "volte
   * para o texto do site antigo" seria desfazer o trabalho dele.
   */
  it('so o cliente editou: nao vira alteracao pendente', () => {
    const v = compareThreeWay({
      baseline: lado('Descrição original'),
      source: lado('Descrição original'),
      codeca: lado('Descrição que eu reescrevi'),
    });
    expect(v.kind).toBe('apenas_local');
  });

  it('so a origem mudou: alteracao simples, sem conflito', () => {
    const v = compareThreeWay({
      baseline: lado('(34) 99999-1111'),
      source: lado('(34) 98888-2222'),
      codeca: lado('(34) 99999-1111'),
    });
    expect(v).toEqual({ kind: 'alteracao', type: 'modificado', conflict: false });
  });

  /** O caso completo do item 7: os dois lados mudaram. */
  it('os dois mudaram: conflito', () => {
    const v = compareThreeWay({
      baseline: lado('Descrição original'),
      source: lado('Descrição nova do site antigo'),
      codeca: lado('Descrição que eu reescrevi'),
    });
    expect(v).toEqual({ kind: 'alteracao', type: 'modificado', conflict: true });
  });

  it('os dois mudaram para a mesma coisa: nada a sugerir', () => {
    const v = compareThreeWay({
      baseline: lado('antigo'),
      source: lado('novo'),
      codeca: lado('novo'),
    });
    expect(v.kind).toBe('apenas_local');
  });
});

describe('conteudo que aparece e some', () => {
  /**
   * O instante mais perigoso da funcionalidade: a primeira verificacao logo
   * depois de conectar. O baseline esta vazio (nunca sincronizamos), mas o
   * conteudo ja esta no painel porque veio da importacao. Se isto virasse
   * "novo conteudo", o cliente receberia dezenas de alteracoes pendentes
   * propondo trazer o que ele acabou de trazer.
   */
  it('primeira verificacao depois de conectar: nao propoe o que ja esta igual', () => {
    const v = compareThreeWay({
      baseline: MISSING,
      source: lado('Clínica Sorriso'),
      codeca: lado('Clínica Sorriso'),
    });
    expect(v.kind).toBe('apenas_local');
  });

  it('apareceu na origem e a CODECA nao tem nada: novo', () => {
    const v = compareThreeWay({ baseline: MISSING, source: lado('Novo serviço'), codeca: MISSING });
    expect(v).toEqual({ kind: 'alteracao', type: 'novo', conflict: false });
  });

  it('apareceu na origem mas a CODECA ja tem outra coisa: conflito', () => {
    const v = compareThreeWay({
      baseline: MISSING,
      source: lado('Horário da origem'),
      codeca: lado('Horário que eu digitei'),
    });
    expect(v).toEqual({ kind: 'alteracao', type: 'novo', conflict: true });
  });

  /**
   * Remocao nunca nasce em conflito. Nao e descuido: a decisao de apagar
   * conteudo de um cliente passa por ele de qualquer forma (item 8), entao
   * marcar conflito aqui so acrescentaria uma pergunta a mais sobre a mesma
   * escolha.
   */
  it('sumiu da origem: remocao, e nunca exclusao automatica', () => {
    const v = compareThreeWay({
      baseline: lado('Serviço antigo'),
      source: MISSING,
      codeca: lado('Serviço antigo'),
    });
    expect(v).toEqual({ kind: 'alteracao', type: 'removido', conflict: false });
  });

  it('sumiu da origem mesmo tendo sido editado na CODECA', () => {
    const v = compareThreeWay({
      baseline: lado('Serviço antigo'),
      source: MISSING,
      codeca: lado('Serviço que eu renomeei'),
    });
    expect(v.kind).toBe('alteracao');
    if (v.kind === 'alteracao') expect(v.type).toBe('removido');
  });
});

describe('imagens', () => {
  it('usa os tipos de imagem quando o conteudo e uma', () => {
    const nova = compareThreeWay({ baseline: MISSING, source: lado({ url: 'a.jpg' }), codeca: MISSING, image: true });
    expect(nova).toMatchObject({ type: 'imagem_nova' });

    const trocada = compareThreeWay({
      baseline: lado({ url: 'a.jpg', hash: '1' }),
      source: lado({ url: 'a.jpg', hash: '2' }),
      codeca: lado({ url: 'a.jpg', hash: '1' }),
      image: true,
    });
    expect(trocada).toMatchObject({ type: 'imagem_modificada' });

    const removida = compareThreeWay({
      baseline: lado({ url: 'a.jpg' }),
      source: MISSING,
      codeca: lado({ url: 'a.jpg' }),
      image: true,
    });
    expect(removida).toMatchObject({ type: 'imagem_removida' });
  });

  /**
   * O arquivo trocado sem o endereco mudar e o caso que uma comparacao por
   * URL deixaria passar -- por isso o valor da imagem carrega o resumo do
   * conteudo quando o verificador consegue baixa-lo.
   */
  it('mesma URL com conteudo diferente conta como alteracao', () => {
    const v = compareThreeWay({
      baseline: lado({ url: 'https://x/logo.png', hash: 'aaa' }),
      source: lado({ url: 'https://x/logo.png', hash: 'bbb' }),
      codeca: lado({ url: 'https://x/logo.png', hash: 'aaa' }),
      image: true,
    });
    expect(v).toMatchObject({ kind: 'alteracao', type: 'imagem_modificada' });
  });
});

describe('identidade do conteudo entre verificacoes', () => {
  it('campo de documento usa o proprio campo', () => {
    expect(syncKey({ target: 'contato', fieldKey: 'phone' })).toBe('contato:phone');
  });

  it('registro de colecao usa o titulo normalizado', () => {
    expect(syncKey({ target: 'servicos', label: 'Clareamento Dental' })).toBe(
      'servicos:clareamento-dental',
    );
    // Acento e caixa nao mudam a identidade.
    expect(syncKey({ target: 'servicos', label: 'clareamento dental' })).toBe(
      syncKey({ target: 'servicos', label: 'Clareamento Dental' }),
    );
  });

  it('imagem usa o endereco', () => {
    expect(syncKey({ target: 'midia', url: 'https://x/a.png' })).toBe('midia:https://x/a.png');
  });

  it('normaliza texto para chave sem acento nem pontuacao', () => {
    expect(normalizeKeyText('Implante Dentário!')).toBe('implante-dentario');
  });

  it('a chave de um candidato bate com a chave montada a mao', () => {
    expect(
      keyOfCandidate({
        kind: 'documento_campo',
        target: 'institucional',
        fieldKey: 'tagline',
        label: 'Frase',
        value: 'x',
        evidence: { pageUrl: 'u', source: 'texto', excerpt: '' },
      }),
    ).toBe('institucional:tagline');

    expect(
      keyOfCandidate({
        kind: 'colecao_registro',
        target: 'servicos',
        label: 'Clareamento Dental',
        value: {},
        evidence: { pageUrl: 'u', source: 'texto', excerpt: '' },
      }),
    ).toBe('servicos:clareamento-dental');
  });
});

describe('frequencia e agendador', () => {
  const base = new Date('2026-03-01T10:00:00.000Z');

  it.each([
    ['6h', 6 * 60],
    ['12h', 12 * 60],
    ['diaria', 24 * 60],
    ['3dias', 3 * 24 * 60],
    ['semanal', 7 * 24 * 60],
  ] as [SyncFrequency, number][])('%s agenda daqui a %i minutos', (freq, minutos) => {
    const proxima = nextCheckAt(freq, base);
    expect(proxima).not.toBeNull();
    expect(proxima!.getTime() - base.getTime()).toBe(minutos * 60_000);
    expect(SYNC_FREQUENCY_MINUTES[freq]).toBe(minutos);
  });

  it('manual nao agenda nada', () => {
    expect(nextCheckAt('manual', base)).toBeNull();
  });

  /**
   * Honestidade do produto, amarrada ao plano real.
   *
   * O plano gratuito da Vercel dispara cada agendamento uma vez por dia, e e
   * nele que a plataforma roda. Pedir 6 ou 12 horas e legitimo -- a fonte
   * vence no prazo --, mas a entrega e diaria, e a tela precisa dizer isso.
   *
   * O teste guarda as duas pontas: a constante do agendador e a conclusao que
   * a tela tira dela. Mudar uma sem a outra quebra aqui -- que e o lembrete
   * de que, ao migrar para um plano com cron infra-diario, a constante
   * tambem muda.
   */
  it('avisa quando a preferência pede mais do que o agendador entrega', () => {
    expect(SCHEDULER_INTERVAL_MINUTES).toBe(24 * 60);

    expect(frequencyExceedsScheduler('6h')).toBe(true);
    expect(frequencyExceedsScheduler('12h')).toBe(true);
    expect(frequencyExceedsScheduler('diaria')).toBe(false);
    expect(frequencyExceedsScheduler('semanal')).toBe(false);
    // `manual` nao agenda nada: nunca ha o que avisar.
    expect(frequencyExceedsScheduler('manual')).toBe(false);

    // Toda frequência abaixo do intervalo do agendador é avisada, sem exceção.
    for (const freq of SYNC_FREQUENCIES) {
      const minutos = SYNC_FREQUENCY_MINUTES[freq];
      const esperado = minutos !== null && minutos < SCHEDULER_INTERVAL_MINUTES;
      expect(frequencyExceedsScheduler(freq), freq).toBe(esperado);
    }
  });
});

describe('aviso no painel', () => {
  it('sem pendencia, nao ha aviso', () => {
    expect(syncNoticeMessage({ pending: 0, conflicts: 0, removals: 0 })).toBeNull();
  });

  it('usa os numeros reais, no singular e no plural', () => {
    expect(syncNoticeMessage({ pending: 1, conflicts: 0, removals: 0 })).toContain(
      'Encontramos 1 atualização',
    );
    expect(syncNoticeMessage({ pending: 7, conflicts: 0, removals: 0 })).toContain(
      'Encontramos 7 atualizações',
    );
  });

  it('cita conflito e remocao quando existem', () => {
    const msg = syncNoticeMessage({ pending: 7, conflicts: 2, removals: 1 });
    expect(msg).toContain('2 delas conflitam');
    expect(msg).toContain('1 conteúdo saiu do ar');
  });
});
