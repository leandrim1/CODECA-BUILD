/**
 * Fila de saida para o Nominatim: no maximo um pedido por segundo.
 *
 * E a politica de uso deles, e e condicao para continuar usando de graca.
 *
 * O enfileiramento aqui e POR INSTANCIA, e em funcao serverless ha varias --
 * por isso ele nao e a unica barreira. A cota global no banco
 * (`RATE_LIMITS.geoProvedor`) e quem conta de verdade entre instancias; esta
 * fila garante o espacamento dentro de uma, que e onde as rajadas nascem (uma
 * pessoa digitando, varios campos pedindo ao mesmo tempo).
 */

const INTERVALO_MS = 1_000;

let ultima = 0;
let corrente: Promise<unknown> = Promise.resolve();

export async function espacar<T>(tarefa: () => Promise<T>): Promise<T> {
  const minha = corrente.then(async () => {
    const agora = Date.now();
    const espera = Math.max(0, ultima + INTERVALO_MS - agora);
    if (espera > 0) await new Promise((resolve) => setTimeout(resolve, espera));
    ultima = Date.now();
    return tarefa();
  });
  // A fila continua mesmo se esta tarefa falhar: um erro nao pode travar as
  // proximas para sempre.
  corrente = minha.catch(() => undefined);
  return minha as Promise<T>;
}

/** Para os testes: esquece o espacamento acumulado. */
export function reiniciarFila(): void {
  ultima = 0;
  corrente = Promise.resolve();
}
