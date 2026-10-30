import { MIGRATIONS_TABLE } from './migrator.js';

/**
 * Traducao de falhas de banco para o log do build.
 *
 * Quando o preparo do banco derruba o deploy, o que aparece no painel da
 * Vercel e uma mensagem de driver -- "password authentication failed", um
 * codigo `42P07` -- sem dizer o que fazer. Quem opera sozinho perde horas ali.
 * Cada caso conhecido vira causa e saida, em uma linha cada.
 *
 * Nada aqui inventa diagnostico: sem reconhecer o erro, a mensagem original e
 * repassada como esta.
 */

/** Esconde credenciais que venham dentro da mensagem do driver. */
export function scrubConnectionStrings(text: string): string {
  return text.replace(/\b(postgres(?:ql)?:\/\/)[^\s@]+@/gi, '$1***@');
}

export interface DatabaseFailure {
  /** Codigo do PostgreSQL ou do socket, quando houver. */
  code: string | null;
  /** Mensagem original, sem credenciais. */
  message: string;
  /** O que aconteceu, em portugues. `null` quando nao reconhecido. */
  cause: string | null;
  /** O que fazer a respeito. `null` quando nao reconhecido. */
  remedy: string | null;
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' && code ? code : null;
}

export function describeDatabaseFailure(error: unknown): DatabaseFailure {
  const code = errorCode(error);
  const message = scrubConnectionStrings(
    error instanceof Error ? error.message : String(error),
  );

  if (code === '28P01' || code === '28000' || /password authentication failed/i.test(message)) {
    return {
      code,
      message,
      cause: 'o banco recusou as credenciais da DATABASE_URL.',
      remedy:
        'Copie a string de conexao atual no painel do Neon e atualize DATABASE_URL na Vercel, '
        + 'nos tres ambientes. Trocar a senha do papel no Neon invalida a string antiga.',
    };
  }

  if (code === '3D000' || /database "[^"]*" does not exist/i.test(message)) {
    return {
      code,
      message,
      cause: 'a DATABASE_URL aponta para um banco que nao existe nesse servidor.',
      remedy: 'Confira o nome do banco no fim da string de conexao do Neon.',
    };
  }

  if (code === '42P07' || code === '42710' || /already exists/i.test(message)) {
    return {
      code,
      message,
      cause:
        `o banco ja tem as tabelas, mas a tabela ${MIGRATIONS_TABLE} nao registra nenhuma `
        + 'migracao: o schema foi criado por fora, com SQL rodado a mao.',
      remedy:
        'Sem dados a preservar, recrie o schema no console do Neon ("drop schema public cascade; '
        + 'create schema public;") e implante de novo -- o build refaz tudo. Havendo dados, '
        + `registre em ${MIGRATIONS_TABLE} os nomes dos arquivos ja aplicados antes de implantar.`,
    };
  }

  if (
    code === 'ENOTFOUND'
    || code === 'EAI_AGAIN'
    || code === 'ECONNREFUSED'
    || code === 'ETIMEDOUT'
    || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(message)
  ) {
    return {
      code,
      message,
      cause: 'o servidor do banco nao respondeu no endereco da DATABASE_URL.',
      remedy:
        'Confira o host na string de conexao e se o projeto do Neon continua ativo. '
        + 'Um projeto removido ou suspenso falha exatamente assim.',
    };
  }

  if (/websocket/i.test(message)) {
    return {
      code,
      message,
      cause: 'o driver do Neon nao conseguiu abrir a conexao WebSocket.',
      remedy:
        'Verifique a versao do Node usada no build: o driver precisa de WebSocket global '
        + '(Node 22+) ou de um construtor configurado.',
    };
  }

  return { code, message, cause: null, remedy: null };
}

/** Bloco pronto para o log do build. */
export function formatDatabaseFailure(error: unknown): string {
  const { code, message, cause, remedy } = describeDatabaseFailure(error);
  const lines = [`[deploy] falha ao preparar o banco: ${message}`];
  if (code) lines.push(`[deploy] codigo: ${code}`);
  if (cause) lines.push(`[deploy] causa provavel: ${cause}`);
  if (remedy) lines.push(`[deploy] o que fazer: ${remedy}`);
  return lines.join('\n');
}
