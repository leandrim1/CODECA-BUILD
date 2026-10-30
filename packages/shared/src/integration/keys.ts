/**
 * Credenciais de integracao de um site.
 *
 * A pergunta que organiza tudo aqui nao e "como o site se autentica", e sim
 * **quem** esta chamando:
 *
 * - O **navegador do visitante** nao guarda segredo. Recebe uma chave
 *   publicavel, que so le conteudo publicado e so a partir de uma origem
 *   autorizada. Vazada, ela nao da acesso a nada que ja nao fosse publico --
 *   esse e o criterio para considera-la segura, nao a obscuridade.
 * - O **servidor do site** guarda segredo. Recebe uma chave secreta, que le
 *   tambem rascunho e previa. Dela so o hash fica no banco.
 */

export const API_KEY_KINDS = ['publishable', 'secret'] as const;
export type ApiKeyKind = (typeof API_KEY_KINDS)[number];

export const API_KEY_SCOPES = ['content:read', 'content:draft', 'leads:write'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * Escopos que cada tipo recebe por padrao.
 *
 * `leads:write` fica com a publicavel porque o formulario de contato roda no
 * navegador: e a unica escrita aceita sem segredo, e vem cercada por origem
 * autorizada e limite por IP. Ler interessado nao esta em escopo nenhum --
 * nome, telefone e e-mail sao dado pessoal e ficam atras do painel.
 */
export const DEFAULT_SCOPES: Readonly<Record<ApiKeyKind, readonly ApiKeyScope[]>> = {
  publishable: ['content:read', 'leads:write'],
  secret: ['content:read', 'content:draft', 'leads:write'],
};

export const API_KEY_PREFIXES: Readonly<Record<ApiKeyKind, string>> = {
  publishable: 'cb_pub',
  secret: 'cb_sec',
};

/** Caracteres do trecho que localiza a chave no banco. */
export const API_KEY_LOOKUP_LENGTH = 12;

export interface ParsedApiKey {
  kind: ApiKeyKind;
  lookup: string;
  secret: string;
}

/**
 * Separa o token apresentado em localizador e segredo.
 *
 * O localizador viaja em claro e tem indice proprio: sem ele, conferir uma
 * chave exigiria ler e comparar o hash de todas as chaves do banco. Devolve
 * `null` para qualquer coisa fora do formato, sem lancar -- a entrada aqui vem
 * da internet.
 */
export function parseApiKey(token: string): ParsedApiKey | null {
  const texto = token.trim();
  for (const kind of API_KEY_KINDS) {
    const prefixo = `${API_KEY_PREFIXES[kind]}_`;
    if (!texto.startsWith(prefixo)) continue;

    // Posicao fixa, e nao `indexOf('_')`: o alfabeto base64url inclui `_`, e
    // um localizador que contivesse um deles faria a busca cortar no lugar
    // errado -- a chave existiria no banco e nao seria reconhecida.
    const resto = texto.slice(prefixo.length);
    if (resto[API_KEY_LOOKUP_LENGTH] !== '_') return null;

    const lookup = resto.slice(0, API_KEY_LOOKUP_LENGTH);
    const secret = resto.slice(API_KEY_LOOKUP_LENGTH + 1);
    if (!/^[A-Za-z0-9_-]+$/.test(lookup) || secret.length < 24) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(secret)) return null;

    return { kind, lookup, secret };
  }
  return null;
}

/** Como a chave aparece no painel depois de criada: nunca o segredo inteiro. */
export function maskApiKey(kind: ApiKeyKind, lookup: string): string {
  return `${API_KEY_PREFIXES[kind]}_${lookup}_${'•'.repeat(8)}`;
}
