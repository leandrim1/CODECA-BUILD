import { z } from 'zod';

/**
 * Horario de atendimento: estrutura para editar, texto para exibir.
 *
 * O campo era um textarea livre, e o que chegava ao site ia de "8h as 18h" a
 * "segunda a sexta das 08:00 as 18:00, sabado meio periodo". Nenhum site
 * consegue desenhar isso, e ninguem consegue responder "esta aberto agora?".
 *
 * Agora o painel grava a ESTRUTURA (`businessHoursSchedule`) e, junto, o
 * TEXTO gerado a partir dela (`businessHours`), que e o campo que o site e o
 * SDK ja liam. Os dois andam juntos: quem le texto continua lendo texto, e
 * quem quiser calcular passa a ter com o que.
 */

export const DIAS_DA_SEMANA = [
  { chave: 'seg', nome: 'Segunda-feira', curto: 'Seg' },
  { chave: 'ter', nome: 'Terça-feira', curto: 'Ter' },
  { chave: 'qua', nome: 'Quarta-feira', curto: 'Qua' },
  { chave: 'qui', nome: 'Quinta-feira', curto: 'Qui' },
  { chave: 'sex', nome: 'Sexta-feira', curto: 'Sex' },
  { chave: 'sab', nome: 'Sábado', curto: 'Sáb' },
  { chave: 'dom', nome: 'Domingo', curto: 'Dom' },
] as const;

export type DiaDaSemana = (typeof DIAS_DA_SEMANA)[number]['chave'];
export const DIAS_UTEIS: DiaDaSemana[] = ['seg', 'ter', 'qua', 'qui', 'sex'];

/** `00:00` a `23:30`, de meia em meia hora: 48 opcoes. */
export const OPCOES_DE_HORA: string[] = Array.from({ length: 48 }, (_, i) => {
  const hora = String(Math.floor(i / 2)).padStart(2, '0');
  const minuto = i % 2 === 0 ? '00' : '30';
  return `${hora}:${minuto}`;
});

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

const periodoSchema = z.object({
  abre: z.string().regex(HORA, 'Horário inválido.'),
  fecha: z.string().regex(HORA, 'Horário inválido.'),
});
export type Periodo = z.infer<typeof periodoSchema>;

const diaSchema = z.object({
  aberto: z.boolean().default(false),
  /** Dia inteiro: dispensa os periodos, e a tela esconde os seletores. */
  vinteQuatroHoras: z.boolean().default(false),
  /** Um periodo normal; dois quando ha intervalo (almoco). */
  periodos: z.array(periodoSchema).max(2).default([]),
});
export type DiaDeAtendimento = z.infer<typeof diaSchema>;

export const horariosSchema = z
  .object(Object.fromEntries(DIAS_DA_SEMANA.map((d) => [d.chave, diaSchema])) as Record<DiaDaSemana, typeof diaSchema>)
  .nullable()
  .default(null);
export type HorariosDeAtendimento = Record<DiaDaSemana, DiaDeAtendimento>;

export function diaFechado(): DiaDeAtendimento {
  return { aberto: false, vinteQuatroHoras: false, periodos: [] };
}

export function horariosVazios(): HorariosDeAtendimento {
  return Object.fromEntries(DIAS_DA_SEMANA.map((d) => [d.chave, diaFechado()])) as HorariosDeAtendimento;
}

/** Minutos desde a meia-noite, para comparar horarios sem truque de string. */
export function emMinutos(hora: string): number {
  const [h, m] = hora.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Erros por dia, na lingua de quem le.
 *
 * Devolve um mapa (dia -> mensagem) em vez de lancar: a tela precisa mostrar
 * o erro embaixo do dia que errou, nao um aviso geral.
 */
export function errosDosHorarios(horarios: HorariosDeAtendimento | null): Partial<Record<DiaDaSemana, string>> {
  const erros: Partial<Record<DiaDaSemana, string>> = {};
  if (!horarios) return erros;

  for (const { chave, nome } of DIAS_DA_SEMANA) {
    const dia = horarios[chave];
    if (!dia?.aberto || dia.vinteQuatroHoras) continue;

    if (dia.periodos.length === 0) {
      erros[chave] = `Informe o horário de ${nome}.`;
      continue;
    }
    for (const periodo of dia.periodos) {
      if (emMinutos(periodo.fecha) <= emMinutos(periodo.abre)) {
        erros[chave] = 'O fechamento precisa ser depois da abertura.';
        break;
      }
    }
    if (erros[chave]) continue;

    // Dois periodos: o segundo comeca depois do primeiro terminar, senao o
    // "intervalo" se sobrepoe ao expediente.
    const [primeiro, segundo] = dia.periodos;
    if (segundo && primeiro && emMinutos(segundo.abre) < emMinutos(primeiro.fecha)) {
      erros[chave] = 'O segundo período precisa começar depois do primeiro.';
    }
  }
  return erros;
}

export function horariosValidos(horarios: HorariosDeAtendimento | null): boolean {
  return Object.keys(errosDosHorarios(horarios)).length === 0;
}

function textoDoDia(dia: DiaDeAtendimento): string {
  if (!dia.aberto) return 'Fechado';
  if (dia.vinteQuatroHoras) return '24 horas';
  return dia.periodos.map((p) => `${p.abre}–${p.fecha}`).join(' e ');
}

/**
 * O texto legivel, com dias seguidos de horario igual agrupados.
 *
 * "Seg a Sex: 08:00–18:00 · Sáb: 08:00–12:00 · Dom: Fechado" diz em uma linha
 * o que sete linhas diriam -- e e assim que um site escreve.
 */
export function textoDosHorarios(horarios: HorariosDeAtendimento | null): string {
  if (!horarios) return '';
  const partes: string[] = [];
  let inicio = 0;

  while (inicio < DIAS_DA_SEMANA.length) {
    const atual = textoDoDia(horarios[DIAS_DA_SEMANA[inicio]!.chave] ?? diaFechado());
    let fim = inicio;
    while (
      fim + 1 < DIAS_DA_SEMANA.length
      && textoDoDia(horarios[DIAS_DA_SEMANA[fim + 1]!.chave] ?? diaFechado()) === atual
    ) {
      fim += 1;
    }
    const nomes = inicio === fim
      ? DIAS_DA_SEMANA[inicio]!.curto
      : `${DIAS_DA_SEMANA[inicio]!.curto} a ${DIAS_DA_SEMANA[fim]!.curto}`;
    partes.push(`${nomes}: ${atual}`);
    inicio = fim + 1;
  }

  // Semana inteira fechada nao e horario de atendimento, e campo vazio.
  if (partes.length === 1 && partes[0]!.endsWith('Fechado')) return '';
  return partes.join(' · ');
}

/**
 * Tenta entender o texto que ja estava gravado.
 *
 * Nao e um interpretador de linguagem natural, e de proposito: reconhece o
 * formato que esta funcao mesma gera e as formas mais comuns escritas a mao
 * ("Seg a Sex: 08:00 as 18:00", "segunda a sexta 8h as 18h"). O que nao
 * reconhecer volta `null`, e a tela mostra o texto antigo pedindo que a
 * pessoa escolha os horarios -- melhor do que inventar um expediente.
 */
export function horariosDoTexto(texto: unknown): HorariosDeAtendimento | null {
  const bruto = (typeof texto === 'string' ? texto : '').trim();
  if (bruto === '') return null;

  const apelidos: Record<string, DiaDaSemana> = {
    seg: 'seg', segunda: 'seg', 'segunda-feira': 'seg',
    ter: 'ter', terca: 'ter', 'terca-feira': 'ter',
    qua: 'qua', quarta: 'qua', 'quarta-feira': 'qua',
    qui: 'qui', quinta: 'qui', 'quinta-feira': 'qui',
    sex: 'sex', sexta: 'sex', 'sexta-feira': 'sex',
    sab: 'sab', sabado: 'sab',
    dom: 'dom', domingo: 'dom',
  };
  const semAcento = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ordem = DIAS_DA_SEMANA.map((d) => d.chave);

  const horarios = horariosVazios();
  let entendeu = false;

  /*
    Separar as clausulas tambem na VIRGULA, e nao so em `·`, `;` e quebra de
    linha -- mas so quando o que vem depois fala de outro dia.
    "Segunda a sexta das 8h as 18h, sabado das 8h as 12h" sao duas regras numa
    linha so, e sem esta divisao as quatro horas caiam no mesmo dia, formando
    um intervalo invalido (08:00–18:00 e 08:00–12:00) que derrubava a leitura
    inteira. Ja "Segunda a sexta, das 8h as 18h" continua sendo uma clausula,
    porque depois da virgula nao ha dia nenhum.
  */
  const clausulas: string[] = [];
  for (const parte of bruto.split(/[·;\n]+/)) {
    let atual = '';
    for (const pedaco of parte.split(',')) {
      const comeca = semAcento(pedaco).trim().split(/\s+/)[0] ?? '';
      const outroDia = Object.keys(apelidos).some((apelido) => comeca.startsWith(apelido));
      if (atual !== '' && outroDia) {
        clausulas.push(atual);
        atual = pedaco;
      } else {
        atual = atual === '' ? pedaco : `${atual},${pedaco}`;
      }
    }
    if (atual.trim() !== '') clausulas.push(atual);
  }

  for (const trecho of clausulas) {
    const linha = semAcento(trecho).trim();
    if (linha === '') continue;

    const dias: DiaDaSemana[] = [];
    const faixa = /([a-z-]+)\s*(?:a|ate|-)\s*([a-z-]+)/.exec(linha);
    if (faixa && apelidos[faixa[1]!] && apelidos[faixa[2]!]) {
      const de = ordem.indexOf(apelidos[faixa[1]!]!);
      const ate = ordem.indexOf(apelidos[faixa[2]!]!);
      if (de <= ate) dias.push(...ordem.slice(de, ate + 1));
    } else {
      for (const [apelido, chave] of Object.entries(apelidos)) {
        if (new RegExp(`\\b${apelido}\\b`).test(linha) && !dias.includes(chave)) dias.push(chave);
      }
    }
    if (dias.length === 0) continue;

    if (/24\s*h/.test(linha)) {
      for (const dia of dias) horarios[dia] = { aberto: true, vinteQuatroHoras: true, periodos: [] };
      entendeu = true;
      continue;
    }
    if (/fechad|nao abre|sem atendimento/.test(linha)) {
      for (const dia of dias) horarios[dia] = diaFechado();
      entendeu = true;
      continue;
    }

    // `8h`, `08:00`, `8h30` -> `08:00` / `08:30`
    const horas = [...linha.matchAll(/(\d{1,2})\s*(?::|h)\s*(\d{2})?/g)].map((m) => {
      const h = Number(m[1]);
      const min = m[2] ? Number(m[2]) : 0;
      if (h > 23 || min > 59) return null;
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    });
    const validas = horas.filter((h): h is string => h !== null);
    if (validas.length < 2) continue;

    const periodos: Periodo[] = [{ abre: validas[0]!, fecha: validas[1]! }];
    if (validas.length >= 4) periodos.push({ abre: validas[2]!, fecha: validas[3]! });
    for (const dia of dias) horarios[dia] = { aberto: true, vinteQuatroHoras: false, periodos };
    entendeu = true;
  }

  return entendeu && horariosValidos(horarios) ? horarios : null;
}
