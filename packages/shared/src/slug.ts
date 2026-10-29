/** Geracao e validacao de slugs usados em URLs publicas. */

const DIACRITICS = /[̀-ͯ]/g;

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 96);
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: string): boolean {
  return value.length >= 1 && value.length <= 96 && SLUG_PATTERN.test(value);
}

/**
 * Slugs que a plataforma reserva para si dentro de um site publico, para nao
 * colidir com rotas internas do renderizador.
 */
export const RESERVED_PAGE_SLUGS = new Set([
  'api',
  'admin',
  'painel',
  'dashboard',
  'login',
  'logout',
  'cadastro',
  'imoveis',
  'obras',
  'projetos',
  'sitemap.xml',
  'robots.txt',
  '_assets',
  '_preview',
]);

export function isReservedPageSlug(slug: string): boolean {
  return RESERVED_PAGE_SLUGS.has(slug.toLowerCase());
}

/**
 * Garante unicidade acrescentando um sufixo numerico.
 * `taken` deve conter os slugs ja usados no mesmo escopo (por exemplo, no mesmo tenant).
 */
export function uniqueSlug(desired: string, taken: Iterable<string>): string {
  const base = slugify(desired) || 'item';
  const used = new Set([...taken].map((s) => s.toLowerCase()));
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
