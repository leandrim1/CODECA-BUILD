import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Segundo fator por aplicativo autenticador (TOTP, RFC 6238).
 *
 * Escrito aqui, e nao trazido de uma biblioteca, por dois motivos concretos:
 * o algoritmo cabe em cinquenta linhas de `crypto` do proprio Node, e **uma
 * dependencia nova no caminho do login e superficie de ataque permanente** por
 * algo que nao muda desde 2011. Sem custo recorrente, sem pacote a atualizar.
 *
 * Compativel com Google Authenticator, Microsoft Authenticator, 1Password e
 * qualquer aplicativo que siga o padrao: SHA-1, 6 digitos, passo de 30 s --
 * os valores que esses aplicativos assumem quando o QR Code nao diz outra
 * coisa.
 */

/** Tamanho do segredo: 20 bytes (160 bits), o recomendado pela RFC 4226. */
const SECRET_BYTES = 20;
/** Duracao de cada codigo. */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/**
 * Quantos passos de tolerancia para cada lado.
 *
 * 1 = aceita o codigo anterior e o seguinte, ou seja uma janela de 90 s. E o
 * minimo que acomoda relogio de celular fora de hora e a pessoa digitando no
 * fim da contagem; mais que isso alarga a janela de quem tenta adivinhar.
 */
const TOLERANCE_STEPS = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 (RFC 4648, sem preenchimento) -- o formato que os aplicativos leem. */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of buffer) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += BASE32[(valor << (5 - bits)) & 31];
  return saida;
}

export function base32Decode(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const ch of limpo) {
    const indice = BASE32.indexOf(ch);
    if (indice < 0) continue;
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Segredo novo, em base32, pronto para o QR Code. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** O passo (janela de 30 s) a que um instante pertence. */
export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/** O codigo de um passo. Exportado porque os testes precisam gerar codigos. */
export function totpCode(secretBase32: string, step: number): string {
  const chave = base32Decode(secretBase32);
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', chave).update(contador).digest();
  // Truncagem dinamica da RFC 4226.
  const deslocamento = mac[mac.length - 1]! & 0x0f;
  const binario =
    ((mac[deslocamento]! & 0x7f) << 24) |
    ((mac[deslocamento + 1]! & 0xff) << 16) |
    ((mac[deslocamento + 2]! & 0xff) << 8) |
    (mac[deslocamento + 3]! & 0xff);
  return String(binario % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export interface TotpCheck {
  valid: boolean;
  /** O passo aceito. Quem chama guarda, para o mesmo codigo nao servir de novo. */
  step?: number;
}

/**
 * Confere um codigo digitado.
 *
 * `minStep` recusa um passo que ja foi usado: sem isso, o mesmo codigo valeria
 * durante toda a janela de tolerancia, e quem o visse de relance poderia
 * reutiliza-lo.
 */
export function verifyTotp(
  secretBase32: string,
  codigo: string,
  now: Date,
  minStep: number | null = null,
): TotpCheck {
  const limpo = codigo.replace(/\D/g, '');
  if (limpo.length !== TOTP_DIGITS) return { valid: false };

  const atual = totpStep(now);
  for (let delta = -TOLERANCE_STEPS; delta <= TOLERANCE_STEPS; delta += 1) {
    const step = atual + delta;
    if (minStep !== null && step <= minStep) continue;
    const esperado = Buffer.from(totpCode(secretBase32, step), 'utf8');
    const recebido = Buffer.from(limpo, 'utf8');
    if (recebido.length === esperado.length && timingSafeEqual(recebido, esperado)) {
      return { valid: true, step };
    }
  }
  return { valid: false };
}

/**
 * Endereco `otpauth://` do QR Code.
 *
 * O rotulo leva o nome da plataforma e o e-mail da pessoa, que e o que aparece
 * na lista do aplicativo. Nao leva nada alem disso.
 */
export function otpauthUri(input: { secret: string; email: string; issuer: string }): string {
  const rotulo = encodeURIComponent(`${input.issuer}:${input.email}`);
  const parametros = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${rotulo}?${parametros.toString()}`;
}

// ------------------------------------------------- codigos de recuperacao

/** Quantos codigos de recuperacao sao gerados de uma vez. */
export const RECOVERY_CODE_COUNT = 8;

/**
 * Codigo de recuperacao legivel: dois grupos de cinco caracteres.
 *
 * Sem as letras e numeros que se confundem a mao (I, L, O, U, 0, 1): a pessoa
 * vai copiar isto de uma tela para um papel, e depois do papel para um campo.
 */
export function generateRecoveryCode(): string {
  const alfabeto = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const bytes = randomBytes(10);
  const texto = [...bytes].map((b) => alfabeto[b % alfabeto.length]).join('');
  return `${texto.slice(0, 5)}-${texto.slice(5, 10)}`;
}

/** Normaliza o que a pessoa digitou: maiusculas, sem hifen nem espaco. */
export function normalizeRecoveryCode(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Hash do codigo de recuperacao, com a chave da instalacao. */
export function hashRecoveryCode(authSecret: string, codigo: string): string {
  return createHmac('sha256', authSecret).update(`recovery:${normalizeRecoveryCode(codigo)}`).digest('hex');
}

// ------------------------------------------------- chave de cifra do segredo

/**
 * Chave de cifra do segredo TOTP, derivada de `AUTH_SECRET`.
 *
 * Derivada, e nao o proprio `AUTH_SECRET`: o mesmo segredo assina sessao e
 * cifra isto, e dominios separados impedem que um uso enfraqueca o outro.
 * Derivar tambem evita exigir uma variavel de ambiente nova -- que, esquecida,
 * deixaria o segundo fator sem funcionar justo em producao.
 */
export function totpEncryptionKey(authSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(authSecret, 'utf8'), Buffer.from('codeca-totp'), Buffer.from('totp-secret-v1'), 32));
}
