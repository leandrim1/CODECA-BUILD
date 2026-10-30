import { describe, expect, it } from 'vitest';
import {
  describeDatabaseFailure,
  formatDatabaseFailure,
  scrubConnectionStrings,
} from '@codeca/database';

/**
 * Falhas de banco no build.
 *
 * O preparo do banco derruba o deploy de proposito. O custo disso so e
 * aceitavel se o log bastar para resolver: quem le e quem opera, no painel da
 * Vercel, sem acesso ao codigo.
 */

/** Erro do driver `pg`, que carrega o codigo do PostgreSQL em `code`. */
function pgError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('diagnostico de falha do banco', () => {
  it('reconhece credencial recusada e manda atualizar a DATABASE_URL', () => {
    const failure = describeDatabaseFailure(
      pgError('password authentication failed for user "neondb_owner"', '28P01'),
    );
    expect(failure.code).toBe('28P01');
    expect(failure.cause).toMatch(/credenciais/i);
    expect(failure.remedy).toMatch(/DATABASE_URL/);
    expect(failure.remedy).toMatch(/Neon/);
  });

  it('reconhece schema criado a mao, que e o caso sem erro obvio', () => {
    // As tabelas existem, mas o registro de migracoes esta vazio: acontece
    // quando o SQL foi rodado no console em vez de pelo deploy.
    const failure = describeDatabaseFailure(
      pgError('relation "tenants" already exists', '42P07'),
    );
    expect(failure.cause).toMatch(/__codeca_migrations/);
    expect(failure.cause).toMatch(/a mao/);
    expect(failure.remedy).toMatch(/drop schema public cascade/);
  });

  it('separa servidor inalcancavel de credencial errada', () => {
    const failure = describeDatabaseFailure(
      pgError('getaddrinfo ENOTFOUND ep-exemplo.neon.tech', 'ENOTFOUND'),
    );
    expect(failure.cause).toMatch(/nao respondeu/i);
    expect(failure.remedy).toMatch(/host/i);
  });

  it('nao inventa diagnostico para erro desconhecido', () => {
    const failure = describeDatabaseFailure(new Error('algo totalmente novo'));
    expect(failure.message).toBe('algo totalmente novo');
    expect(failure.cause).toBeNull();
    expect(failure.remedy).toBeNull();
  });

  it('nunca repete a senha da conexao no log do build', () => {
    // O log do build e visivel; uma credencial vazada ali e permanente.
    const texto = scrubConnectionStrings(
      'could not connect to postgresql://neondb_owner:npg_SENHA_REAL@ep-x.neon.tech/neondb',
    );
    expect(texto).not.toContain('npg_SENHA_REAL');
    expect(texto).toContain('postgresql://***@ep-x.neon.tech/neondb');
  });

  it('o bloco do log traz mensagem, codigo, causa e saida', () => {
    const texto = formatDatabaseFailure(
      pgError('password authentication failed for user "neondb_owner"', '28P01'),
    );
    expect(texto).toMatch(/\[deploy\] falha ao preparar o banco:/);
    expect(texto).toMatch(/\[deploy\] codigo: 28P01/);
    expect(texto).toMatch(/\[deploy\] causa provavel:/);
    expect(texto).toMatch(/\[deploy\] o que fazer:/);
  });

  it('erro desconhecido rende so a mensagem, sem linhas vazias', () => {
    const texto = formatDatabaseFailure(new Error('algo totalmente novo'));
    expect(texto.split('\n')).toHaveLength(1);
  });
});

/**
 * O Drizzle embrulha a falha do driver em `Failed query: <o SQL inteiro>` e
 * guarda a original em `cause`. Um log que mostrasse apenas a camada de fora
 * imprimiria paginas de SQL sem dizer o que aconteceu -- e no caso de uma
 * migracao que se recusou a apagar dado, esconderia justamente a instrucao de
 * como seguir.
 */
describe('erro embrulhado pelo driver', () => {
  /** Como o Drizzle entrega: mensagem propria por fora, erro do pg em `cause`. */
  function drizzleError(interno: Error): Error {
    return Object.assign(new Error('Failed query: select 1 from tenants'), { cause: interno });
  }

  it('diagnostica pelo erro de dentro, nao pelo embrulho', () => {
    const failure = describeDatabaseFailure(
      drizzleError(pgError('password authentication failed for user "neondb_owner"', '28P01')),
    );
    expect(failure.code).toBe('28P01');
    expect(failure.message).toMatch(/password authentication failed/);
    expect(failure.message).not.toMatch(/Failed query/);
    expect(failure.cause).toMatch(/credenciais/i);
  });

  it('desce mais de uma camada de cause', () => {
    const failure = describeDatabaseFailure(
      drizzleError(drizzleError(pgError('relation "tenants" already exists', '42P07'))),
    );
    expect(failure.code).toBe('42P07');
    expect(failure.cause).toMatch(/__codeca_migrations/);
  });

  it('nao trava numa cadeia circular', () => {
    const circular = new Error('volta em si mesmo');
    (circular as { cause?: unknown }).cause = circular;
    expect(describeDatabaseFailure(circular).message).toBe('volta em si mesmo');
  });

  it('mostra o HINT da instrucao que falhou', () => {
    // E o caminho da guarda da migracao 0007: o RAISE EXCEPTION explica o que
    // aconteceu e o HINT diz o que fazer. Sem esta linha, a guarda existiria e
    // ninguem leria o motivo.
    const interno = Object.assign(
      new Error('Migracao 0007 interrompida: ainda ha conteudo do editor antigo em pages (3 linha(s)); '),
      { code: 'P0001', hint: 'Exporte o que interessa e esvazie as tabelas com TRUNCATE.' },
    );
    const texto = formatDatabaseFailure(drizzleError(interno));

    expect(texto).toMatch(/Migracao 0007 interrompida/);
    expect(texto).toMatch(/\[deploy\] o banco informou: Exporte o que interessa/);
    expect(texto).not.toMatch(/Failed query/);
  });

  it('nao vaza credencial que venha dentro do DETAIL', () => {
    const interno = Object.assign(new Error('falhou'), {
      code: 'P0001',
      detail: 'ao conectar em postgresql://usuario:npg_SENHA@ep-x.neon.tech/neondb',
    });
    const texto = formatDatabaseFailure(drizzleError(interno));
    expect(texto).not.toContain('npg_SENHA');
    expect(texto).toContain('postgresql://***@ep-x.neon.tech/neondb');
  });
});
