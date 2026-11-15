import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { MIGRATIONS_TABLE, readMigrations } from './migrator.js';

/**
 * Conferencia de um banco restaurado.
 *
 * ## Para que serve
 *
 * Restaurar um banco e descobrir depois que ele veio incompleto e o pior
 * desfecho de um incidente. Esta conferencia responde, antes de alguem apontar
 * a aplicacao para o banco restaurado: a estrutura bate com a do codigo? os
 * dados estao la? ha registro apontando para o que nao existe?
 *
 * ## O que ela NAO faz
 *
 * **Nao escreve nada.** Toda consulta e `SELECT`, e a transacao e aberta como
 * somente leitura -- se uma versao futura tentar escrever por engano, o banco
 * recusa. Pode ser rodada contra qualquer banco sem risco, inclusive o de
 * producao (embora o uso previsto seja um ramo restaurado, separado).
 *
 * Tambem nao compara com o banco original: nao ha como saber, daqui, quantas
 * empresas "deveriam" existir. Os numeros sao mostrados para uma pessoa
 * conferir contra o que ela espera.
 */

export interface RestoreCheck {
  nome: string;
  ok: boolean;
  detalhe: string;
}

export interface RestoreReport {
  /** `true` quando nenhuma conferencia reprovou. */
  ok: boolean;
  checks: RestoreCheck[];
  /** Linhas por tabela principal, para conferencia humana. */
  contagens: Record<string, number>;
  duracaoMs: number;
}

/** Tabelas cuja contagem uma pessoa consegue conferir de cabeca. */
const TABELAS_PRINCIPAIS = [
  'tenants',
  'users',
  'memberships',
  'sites',
  'plans',
  'subscriptions',
  'charges',
  'webhook_events',
  'media_assets',
  'leads',
  'audit_logs',
] as const;

/** Referencias que precisam existir: (tabela, coluna) -> (tabela, coluna). */
const REFERENCIAS = [
  { de: 'subscriptions', coluna: 'tenant_id', para: 'tenants', alvo: 'id' },
  { de: 'subscriptions', coluna: 'plan_id', para: 'plans', alvo: 'id' },
  { de: 'sites', coluna: 'tenant_id', para: 'tenants', alvo: 'id' },
  { de: 'memberships', coluna: 'tenant_id', para: 'tenants', alvo: 'id' },
  { de: 'memberships', coluna: 'user_id', para: 'users', alvo: 'id' },
  { de: 'charges', coluna: 'tenant_id', para: 'tenants', alvo: 'id' },
  { de: 'media_assets', coluna: 'tenant_id', para: 'tenants', alvo: 'id' },
  { de: 'tenants', coluna: 'plan_id', para: 'plans', alvo: 'id' },
] as const;

type Linhas = Array<Record<string, unknown>>;

function linhasDe(resultado: unknown): Linhas {
  if (Array.isArray(resultado)) return resultado as Linhas;
  const comRows = resultado as { rows?: Linhas } | null;
  return comRows?.rows ?? [];
}

export async function verifyRestoredDatabase(db: Database, migrationsDir?: string): Promise<RestoreReport> {
  const inicio = Date.now();
  const checks: RestoreCheck[] = [];
  const contagens: Record<string, number> = {};

  await db.transaction(
    async (tx) => {
      const consultar = async (texto: string): Promise<Linhas> => linhasDe(await tx.execute(sql.raw(texto)));

      // 1. O banco responde.
      const [ping] = await consultar('select 1 as ok');
      checks.push({
        nome: 'conexao',
        ok: Number(ping?.ok) === 1,
        detalhe: 'O banco aceitou a conexão e respondeu a uma consulta.',
      });

      // 2. As migracoes aplicadas sao exatamente as do repositorio.
      const esperadas = (await readMigrations(migrationsDir)).map((migracao) => migracao.name);
      let aplicadas: string[] = [];
      try {
        aplicadas = (await consultar(`select name from ${MIGRATIONS_TABLE}`)).map((linha) => String(linha.name));
      } catch {
        // Sem a tabela de controle, nenhuma migracao consta como aplicada.
      }
      const faltando = esperadas.filter((nome) => !aplicadas.includes(nome));
      const sobrando = aplicadas.filter((nome) => !esperadas.includes(nome));
      checks.push({
        nome: 'migracoes',
        ok: faltando.length === 0 && sobrando.length === 0,
        detalhe:
          faltando.length === 0 && sobrando.length === 0
            ? `${aplicadas.length} migração(ões) aplicadas, as mesmas do repositório.`
            : [
                faltando.length > 0 ? `Faltam no banco: ${faltando.join(', ')}.` : '',
                sobrando.length > 0
                  ? `O banco tem migrações que este código não conhece: ${sobrando.join(', ')} -- `
                    + 'o código em uso é mais antigo que o banco.'
                  : '',
              ]
                .filter((parte) => parte !== '')
                .join(' '),
      });

      // 3. As tabelas principais existem.
      const existentes = new Set(
        (
          await consultar(
            "select table_name from information_schema.tables where table_schema = 'public'",
          )
        ).map((linha) => String(linha.table_name)),
      );
      const ausentes = TABELAS_PRINCIPAIS.filter((tabela) => !existentes.has(tabela));
      checks.push({
        nome: 'tabelas',
        ok: ausentes.length === 0,
        detalhe:
          ausentes.length === 0
            ? `${existentes.size} tabela(s) no banco; todas as principais presentes.`
            : `Tabelas ausentes: ${ausentes.join(', ')}.`,
      });

      // 4. Contagens, para conferencia humana.
      for (const tabela of TABELAS_PRINCIPAIS) {
        if (!existentes.has(tabela)) continue;
        const [linha] = await consultar(`select count(*)::int as total from "${tabela}"`);
        contagens[tabela] = Number(linha?.total ?? 0);
      }

      // 5. Um banco restaurado vazio nao e um banco restaurado.
      checks.push({
        nome: 'dados',
        ok: (contagens.plans ?? 0) > 0,
        detalhe:
          (contagens.plans ?? 0) > 0
            ? `${contagens.tenants ?? 0} empresa(s), ${contagens.users ?? 0} usuário(s), `
              + `${contagens.subscriptions ?? 0} assinatura(s). Confira contra o esperado.`
            : 'Não há nenhum plano cadastrado: o banco parece vazio.',
      });

      // 6. Nada aponta para o que nao existe.
      const orfaos: string[] = [];
      for (const ref of REFERENCIAS) {
        if (!existentes.has(ref.de) || !existentes.has(ref.para)) continue;
        const [linha] = await consultar(
          `select count(*)::int as total from "${ref.de}" f `
            + `where f."${ref.coluna}" is not null `
            + `and not exists (select 1 from "${ref.para}" p where p."${ref.alvo}" = f."${ref.coluna}")`,
        );
        const total = Number(linha?.total ?? 0);
        if (total > 0) orfaos.push(`${total} em ${ref.de}.${ref.coluna}`);
      }
      checks.push({
        nome: 'referencias',
        ok: orfaos.length === 0,
        detalhe:
          orfaos.length === 0
            ? 'Nenhum registro aponta para uma empresa, usuário ou plano inexistente.'
            : `Registros órfãos: ${orfaos.join('; ')}.`,
      });

      // 7. Toda empresa tem ao menos um proprietario para entrar.
      if (existentes.has('tenants') && existentes.has('memberships')) {
        const [linha] = await consultar(
          'select count(*)::int as total from "tenants" t where not exists '
            + `(select 1 from "memberships" m where m."tenant_id" = t."id" and m."role" = 'owner')`,
        );
        const total = Number(linha?.total ?? 0);
        checks.push({
          nome: 'proprietarios',
          ok: total === 0,
          detalhe:
            total === 0
              ? 'Toda empresa tem ao menos um proprietário.'
              : `${total} empresa(s) sem proprietário: ninguém conseguiria administrá-las.`,
        });
      }
    },
    { accessMode: 'read only' },
  );

  return {
    ok: checks.every((check) => check.ok),
    checks,
    contagens,
    duracaoMs: Date.now() - inicio,
  };
}
