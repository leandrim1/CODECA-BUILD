/**
 * Dinheiro.
 *
 * O banco guarda centavos inteiros; a API da ValidaPay trabalha em reais com
 * duas casas ("10.00", nunca 1000). A conversao acontece so na fronteira com o
 * provedor, e nunca por multiplicacao direta de ponto flutuante: `89.9 * 100`
 * resulta em 8989.999... em IEEE 754. Aqui a parte decimal e lida do texto.
 */

export const CENTS_IN_REAL = 100;

/** Converte centavos inteiros para o numero em reais aceito pela API. */
export function centsToReais(cents: number): number {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`Valor em centavos deve ser inteiro: recebido ${cents}.`);
  }
  // Divisao por 100 e exata o suficiente para valores monetarios; o
  // arredondamento final garante exatamente duas casas.
  return Math.round(cents) / CENTS_IN_REAL;
}

/** Formata centavos como string de reais com duas casas, para enviar na API. */
export function centsToReaisString(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`Valor em centavos deve ser inteiro: recebido ${cents}.`);
  }
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.trunc(absolute / CENTS_IN_REAL);
  const fraction = absolute % CENTS_IN_REAL;
  return `${negative ? '-' : ''}${whole}.${String(fraction).padStart(2, '0')}`;
}

/**
 * Converte um valor em reais recebido do provedor para centavos inteiros.
 *
 * Aceita numero ou string. A conversao passa pelo texto decimal para nao
 * herdar o erro de representacao do ponto flutuante: `reaisToCents(89.9)`
 * devolve 8990, nao 8989.
 */
export function reaisToCents(value: number | string): number {
  if (value === null || value === undefined || value === '') {
    throw new TypeError('Valor em reais ausente.');
  }

  const text = typeof value === 'number' ? decimalText(value) : value.trim().replace(',', '.');
  const match = /^(-?)(\d+)(?:\.(\d{1,}))?$/.exec(text);
  if (!match) {
    throw new TypeError(`Valor em reais invalido: ${String(value)}`);
  }

  const [, sign, whole, rawFraction = ''] = match;
  const fraction = rawFraction.padEnd(3, '0');
  const centavos = Number(whole) * CENTS_IN_REAL + Number(fraction.slice(0, 2));
  // A terceira casa decide o arredondamento (meio para cima, como no comercio).
  const rounded = Number(fraction[2] ?? '0') >= 5 ? centavos + 1 : centavos;
  return sign === '-' ? -rounded : rounded;
}

/** Texto decimal de um numero, sem notacao cientifica. */
function decimalText(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError(`Valor em reais invalido: ${value}`);
  // 6 casas cobrem qualquer valor monetario e eliminam o residuo binario.
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
}

/** `R$ 1.234,56` a partir de centavos. */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    centsToReais(cents),
  );
}
