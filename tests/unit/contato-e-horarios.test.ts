import { describe, expect, it } from 'vitest';
import {
  ANO_MINIMO,
  anoAtual,
  anoDeFundacaoValido,
  cepValido,
  contatoDocumentSchema,
  digitosDeAno,
  digitosDeCep,
  errosDosHorarios,
  formatarCep,
  horariosDoTexto,
  horariosVazios,
  institucionalDocumentSchema,
  normalizarDocumento,
  normalizarWhatsApp,
  textoDosHorarios,
  whatsappValido,
  type HorariosDeAtendimento,
} from '@codeca/shared';

/**
 * Campos de contato e institucional: as regras que a tela desenha e o
 * servidor cobra, conferidas na mesma funcao que os dois usam.
 */

describe('ano de fundacao', () => {
  it('guarda so quatro digitos', () => {
    expect(digitosDeAno('19a98')).toBe('1998');
    expect(digitosDeAno('199845')).toBe('1998');
    expect(digitosDeAno('')).toBe('');
  });

  it('aceita de 1800 ao ano de hoje', () => {
    expect(anoDeFundacaoValido(String(ANO_MINIMO))).toBe(true);
    expect(anoDeFundacaoValido(String(anoAtual()))).toBe(true);
    expect(anoDeFundacaoValido('1799')).toBe(false);
    expect(anoDeFundacaoValido(String(anoAtual() + 1))).toBe(false);
    expect(anoDeFundacaoValido('98')).toBe(false);
  });

  it('o schema do institucional cobra o mesmo', () => {
    const base = { companyName: 'Alpha' };
    expect(institucionalDocumentSchema.safeParse({ ...base, foundedYear: '1998' }).data?.foundedYear).toBe(1998);
    expect(institucionalDocumentSchema.safeParse({ ...base, foundedYear: anoAtual() + 1 }).success).toBe(false);
    expect(institucionalDocumentSchema.safeParse({ ...base, foundedYear: 1700 }).success).toBe(false);
    // Vazio continua valendo: o campo e opcional.
    expect(institucionalDocumentSchema.safeParse({ ...base, foundedYear: null }).success).toBe(true);
  });
});

describe('whatsapp', () => {
  it('aceita o link no formato pedido', () => {
    expect(whatsappValido('https://wa.me/5511999999999')).toBe(true);
    expect(normalizarWhatsApp('https://wa.me/5511999999999')).toBe('https://wa.me/5511999999999');
  });

  it('tira espaco ao colar', () => {
    expect(normalizarWhatsApp(' https://wa.me/5511999999999 ')).toBe('https://wa.me/5511999999999');
    expect(normalizarWhatsApp('https://wa.me/55 11 99999-9999')).toBe('https://wa.me/5511999999999');
  });

  /*
    O campo guardava TELEFONE antes desta mudanca. Converter em vez de recusar
    e o que impede o formulario inteiro de travar num site que ja existe.
  */
  it('converte o telefone que ja estava gravado', () => {
    expect(normalizarWhatsApp('(19) 99999-0000')).toBe('https://wa.me/5519999990000');
    expect(normalizarWhatsApp('5519999990000')).toBe('https://wa.me/5519999990000');
    expect(normalizarWhatsApp('wa.me/5519999990000')).toBe('https://wa.me/5519999990000');
  });

  it('recusa outro texto ou outra URL', () => {
    expect(whatsappValido('https://instagram.com/empresa')).toBe(false);
    expect(whatsappValido('fale comigo no zap')).toBe(false);
    expect(whatsappValido('https://wa.me/')).toBe(false);
    // Curto demais para ser numero com DDI.
    expect(whatsappValido('https://wa.me/123')).toBe(false);
  });

  /*
    `http://wa.me/...` nao e recusado: e promovido a `https`.

    O destino e o mesmo, e o que fica guardado e sempre o endereco seguro --
    recusar faria a pessoa editar a mao um link que ja estava certo em tudo
    menos no protocolo.
  */
  it('promove http para https em vez de recusar', () => {
    expect(normalizarWhatsApp('http://wa.me/5511999999999')).toBe('https://wa.me/5511999999999');
    expect(whatsappValido('http://wa.me/5511999999999')).toBe(true);
  });

  it('vazio continua valendo', () => {
    expect(whatsappValido('')).toBe(true);
    expect(contatoDocumentSchema.safeParse({}).data?.whatsapp).toBe('');
  });
});

describe('cep e UF no documento de contato', () => {
  it('guarda o CEP so em digitos e formata para a tela', () => {
    expect(digitosDeCep('13010-000')).toBe('13010000');
    expect(formatarCep('13010000')).toBe('13010-000');
    expect(formatarCep('130')).toBe('130');
    expect(cepValido('1301000')).toBe(false);
  });

  /*
    Quem tira a mascara e `normalizarDocumento`, e nao o schema.

    A limpeza morava dentro do schema e precisou sair: `z.toJSONSchema` nao
    representa `.transform()`, e a API publica gera o `openapi.json` a partir
    destes schemas -- com o transform embutido, o documento inteiro parava de
    ser gerado. A rota (e o importador) chamam a normalizacao antes de
    validar, entao o que chega ao banco continua em digitos.
  */
  it('a normalizacao tira a mascara, e o schema aceita o resultado', () => {
    const limpo = normalizarDocumento('contato', { postalCode: '13010-000' });
    expect(limpo.postalCode).toBe('13010000');
    expect(contatoDocumentSchema.safeParse(limpo).data?.postalCode).toBe('13010000');
  });

  it('a normalizacao tambem arruma WhatsApp e UF antes da validacao', () => {
    const limpo = normalizarDocumento('contato', { whatsapp: '(19) 99999-0000', state: 'sp' });
    expect(limpo.whatsapp).toBe('https://wa.me/5519999990000');
    expect(limpo.state).toBe('SP');
  });

  it('o schema recusa CEP incompleto e UF inexistente', () => {
    expect(contatoDocumentSchema.safeParse({ postalCode: '1301' }).success).toBe(false);
    expect(contatoDocumentSchema.safeParse({ state: 'XX' }).success).toBe(false);
    expect(contatoDocumentSchema.safeParse({ state: 'sp' }).data?.state).toBe('SP');
    expect(contatoDocumentSchema.safeParse({ state: '' }).success).toBe(true);
  });

  it('coordenada fora do intervalo e recusada', () => {
    expect(contatoDocumentSchema.safeParse({ latitude: -23.5, longitude: -46.6 }).success).toBe(true);
    expect(contatoDocumentSchema.safeParse({ latitude: 95 }).success).toBe(false);
    expect(contatoDocumentSchema.safeParse({ longitude: -200 }).success).toBe(false);
    expect(contatoDocumentSchema.safeParse({}).data?.latitude).toBeNull();
  });
});

function comercial(): HorariosDeAtendimento {
  const h = horariosVazios();
  for (const dia of ['seg', 'ter', 'qua', 'qui', 'sex'] as const) {
    h[dia] = { aberto: true, vinteQuatroHoras: false, periodos: [{ abre: '08:00', fecha: '18:00' }] };
  }
  h.sab = { aberto: true, vinteQuatroHoras: false, periodos: [{ abre: '08:00', fecha: '12:00' }] };
  return h;
}

describe('horario de atendimento', () => {
  it('gera o texto agrupando dias iguais', () => {
    expect(textoDosHorarios(comercial())).toBe('Seg a Sex: 08:00–18:00 · Sáb: 08:00–12:00 · Dom: Fechado');
  });

  it('semana toda fechada nao vira texto', () => {
    expect(textoDosHorarios(horariosVazios())).toBe('');
    expect(textoDosHorarios(null)).toBe('');
  });

  it('mostra intervalo e 24 horas', () => {
    const h = horariosVazios();
    h.seg = {
      aberto: true,
      vinteQuatroHoras: false,
      periodos: [{ abre: '08:00', fecha: '12:00' }, { abre: '13:30', fecha: '18:00' }],
    };
    h.dom = { aberto: true, vinteQuatroHoras: true, periodos: [] };
    expect(textoDosHorarios(h)).toContain('Seg: 08:00–12:00 e 13:30–18:00');
    expect(textoDosHorarios(h)).toContain('Dom: 24 horas');
  });

  it('acusa fechamento antes da abertura, no dia que errou', () => {
    const h = comercial();
    h.ter = { aberto: true, vinteQuatroHoras: false, periodos: [{ abre: '18:00', fecha: '08:00' }] };
    const erros = errosDosHorarios(h);
    expect(Object.keys(erros)).toEqual(['ter']);
    expect(erros.ter).toBe('O fechamento precisa ser depois da abertura.');
  });

  it('acusa intervalo que invade o primeiro periodo', () => {
    const h = horariosVazios();
    h.seg = {
      aberto: true,
      vinteQuatroHoras: false,
      periodos: [{ abre: '08:00', fecha: '12:00' }, { abre: '11:00', fecha: '18:00' }],
    };
    expect(errosDosHorarios(h).seg).toBe('O segundo período precisa começar depois do primeiro.');
  });
});

describe('migracao do horario em texto', () => {
  it('le o proprio texto que gera (ida e volta)', () => {
    const texto = textoDosHorarios(comercial());
    const volta = horariosDoTexto(texto);
    expect(volta).not.toBeNull();
    expect(textoDosHorarios(volta)).toBe(texto);
  });

  it('entende as formas escritas a mao mais comuns', () => {
    const h = horariosDoTexto('Segunda a sexta das 8h as 18h');
    expect(h?.seg).toEqual({ aberto: true, vinteQuatroHoras: false, periodos: [{ abre: '08:00', fecha: '18:00' }] });
    expect(h?.sab.aberto).toBe(false);

    const comIntervalo = horariosDoTexto('Seg a Sex: 08:00 as 12:00 e 13:30 as 18:00');
    expect(comIntervalo?.qua.periodos).toHaveLength(2);

    /*
      Duas regras numa linha so, separadas por virgula: foi o formato que
      apareceu no painel de verdade, e sem a divisao por virgula as quatro
      horas caiam no mesmo dia e a leitura inteira voltava `null`.
    */
    const duasRegras = horariosDoTexto('Segunda a sexta das 8h as 18h, sabado das 8h as 12h');
    expect(duasRegras?.sex.periodos).toEqual([{ abre: '08:00', fecha: '18:00' }]);
    expect(duasRegras?.sab.periodos).toEqual([{ abre: '08:00', fecha: '12:00' }]);
    expect(duasRegras?.dom.aberto).toBe(false);

    // A virgula que NAO separa dias continua dentro da mesma clausula.
    expect(horariosDoTexto('Segunda a sexta, das 8h as 18h')?.qua.periodos).toEqual([
      { abre: '08:00', fecha: '18:00' },
    ]);

    expect(horariosDoTexto('Domingo: 24 horas')?.dom.vinteQuatroHoras).toBe(true);
    expect(horariosDoTexto('Sábado: fechado')?.sab.aberto).toBe(false);
  });

  it('devolve null no que nao da para entender, em vez de inventar', () => {
    expect(horariosDoTexto('consulte nossas redes sociais')).toBeNull();
    expect(horariosDoTexto('')).toBeNull();
    expect(horariosDoTexto('atendemos sob agendamento')).toBeNull();
  });
});
