import { sql, type Database } from '@codeca/database';
import { assertContentCapacity } from './content-usage.js';
import { loadEffectivePlan } from './plan-limits.js';

/**
 * Conferir a vaga e ocupa-la, sem brecha entre as duas coisas.
 *
 * ## O defeito que isto corrige
 *
 * A verificacao do limite e a gravacao eram comandos separados. Duas criacoes
 * simultaneas da mesma empresa liam o mesmo total -- "39 de 40" para as duas --
 * e gravavam as duas. Com N requisicoes em paralelo, N conteudos entravam
 * acima do limite. Nao era preciso forjar nada: bastava clicar rapido, ou um
 * cliente com script proprio. O teto efetivo era o paralelismo, nao o plano.
 *
 * ## Como fica
 *
 * A conferencia e a gravacao passam a acontecer dentro da MESMA transacao,
 * protegidas por uma trava de aviso por empresa. Quem chegar depois espera a
 * primeira terminar e entao le o total ja atualizado.
 *
 * ## Por que trava de aviso, e nao `FOR UPDATE`
 *
 * Nao ha uma linha unica para travar: a contagem atravessa onze tabelas. Dar
 * `FOR UPDATE` na linha da empresa em `tenants` funcionaria, mas prenderia a
 * fila de conteudo a uma tabela que existe para outra coisa -- qualquer
 * atualizacao de cadastro passaria a disputar com a criacao de conteudo. A
 * trava de aviso e um nome combinado entre quem cria conteudo, e mais nada.
 *
 * `pg_advisory_xact_lock` solta sozinha no commit ou no rollback. Nao ha
 * caminho em que ela fique presa -- nem com erro, nem com tempo esgotado.
 *
 * ## Por que o preparo fica de fora
 *
 * Gerar slug, conferir imagem e categoria nao mexem na contagem. Deixa-los
 * fora da transacao mantem a trava curta: o que ela cobre e so ler o total e
 * gravar a linha. Empresas diferentes nunca se esperam -- a chave e por
 * empresa.
 */

/**
 * Espaco de nomes das travas deste projeto.
 *
 * `pg_advisory_xact_lock(klass, objid)` usa dois inteiros de 32 bits. O
 * primeiro separa este uso de qualquer outro que venha a existir no mesmo
 * banco; o segundo identifica a empresa.
 */
const CLASSE_CONTEUDO = 0x0c0d_0eca | 0;

/**
 * Identificador de 32 bits da empresa, a partir do UUID.
 *
 * Colisao entre duas empresas nao gera erro: faz uma esperar a outra sem
 * precisar. Com 32 bits e dezenas de empresas, e evento raro e barato.
 */
function chaveDaEmpresa(tenantId: string): number {
  const hex = tenantId.replace(/-/g, '').slice(0, 8);
  // `| 0` leva para inteiro com sinal de 32 bits, que e o que o Postgres espera.
  return Number.parseInt(hex, 16) | 0;
}

/**
 * Executa `gravar` com a vaga de conteudo ja conferida e reservada.
 *
 * Lanca `AppError.planLimit` antes de chamar `gravar` quando nao ha vaga. O
 * `tx` recebido **precisa** ser usado na gravacao: gravar por fora da
 * transacao deixaria a linha fora da trava e traria o defeito de volta.
 */
export async function comVagaDeConteudo<T>(
  db: Database,
  tenantId: string,
  gravar: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CLASSE_CONTEUDO}, ${chaveDaEmpresa(tenantId)})`);

    const plan = await loadEffectivePlan(tx as Database, tenantId);
    await assertContentCapacity(tx as Database, tenantId, plan);

    return gravar(tx as Database);
  });
}
