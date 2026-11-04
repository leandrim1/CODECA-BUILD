/**
 * Montagem de links de WhatsApp com mensagem contextualizada.
 * O numero e sempre o cadastrado pela propria empresa.
 */

export type WhatsAppContext =
  | { kind: 'generic' }
  | { kind: 'property'; title: string; reference?: string | null; price?: string | null }
  | { kind: 'project'; title: string; stage?: string | null }
  | { kind: 'service'; title: string }
  | { kind: 'quote'; subject?: string | null };

/** Mantem apenas digitos. Numeros brasileiros recebem o prefixo 55 quando ausente. */
export function normalizeWhatsAppNumber(input: string): string | null {
  const digits = input.replace(/\D+/g, '');
  if (!digits) return null;
  const withCountry = digits.length <= 11 ? `55${digits}` : digits;
  if (withCountry.length < 10 || withCountry.length > 15) return null;
  return withCountry;
}

export function isValidWhatsAppNumber(input: string): boolean {
  return normalizeWhatsAppNumber(input) !== null;
}

export function formatWhatsAppNumber(input: string): string {
  const n = normalizeWhatsAppNumber(input);
  if (!n) return input;
  if (n.startsWith('55') && (n.length === 12 || n.length === 13)) {
    const ddd = n.slice(2, 4);
    const rest = n.slice(4);
    const head = rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4);
    const tail = rest.length === 9 ? rest.slice(5) : rest.slice(4);
    return `+55 (${ddd}) ${head}-${tail}`;
  }
  return `+${n}`;
}

export function whatsAppMessage(context: WhatsAppContext, companyName: string): string {
  switch (context.kind) {
    case 'property': {
      const ref = context.reference ? ` (referencia ${context.reference})` : '';
      const price = context.price ? ` Valor anunciado: ${context.price}.` : '';
      return `Olá, ${companyName}! Tenho interesse no imóvel "${context.title}"${ref}.${price} Pode me enviar mais informações?`;
    }
    case 'project': {
      const stage = context.stage ? ` (etapa atual: ${context.stage})` : '';
      return `Olá, ${companyName}! Gostaria de saber mais sobre a obra "${context.title}"${stage}.`;
    }
    case 'service':
      return `Olá, ${companyName}! Gostaria de informações sobre o serviço "${context.title}".`;
    case 'quote':
      return context.subject
        ? `Olá, ${companyName}! Gostaria de solicitar um orçamento sobre ${context.subject}.`
        : `Olá, ${companyName}! Gostaria de solicitar um orçamento.`;
    case 'generic':
    default:
      return `Olá, ${companyName}! Gostaria de falar com a equipe de voces.`;
  }
}

/** Retorna `null` quando a empresa nao tem numero configurado. */
export function whatsAppLink(
  rawNumber: string | null | undefined,
  context: WhatsAppContext,
  companyName: string,
  customMessage?: string | null,
): string | null {
  if (!rawNumber) return null;
  const number = normalizeWhatsAppNumber(rawNumber);
  if (!number) return null;
  const text = customMessage?.trim() ? customMessage.trim() : whatsAppMessage(context, companyName);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
