/** Junta classes condicionais, ignorando valores vazios. */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/** Gera um id estavel para associar rotulo e campo. */
let counter = 0;
export function nextId(prefix = 'campo'): string {
  counter += 1;
  return `${prefix}-${counter}`;
}
