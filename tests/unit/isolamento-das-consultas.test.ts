import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Nenhuma consulta de empresa pode esquecer de dizer de qual empresa e.
 *
 * ## Por que isto existe, e nao RLS
 *
 * A auditoria propos duas saidas para o mesmo risco: Row Level Security no
 * Postgres, ou um padrao central que force o `tenant_id`. A primeira foi
 * medida e **nao cabe nesta arquitetura hoje** -- o porque esta em
 * `SECURITY_REPORT.md`, com o experimento. O resumo: a politica precisaria ler
 * um parametro de sessao, e o parametro **vaza entre requisicoes pelo pool**
 * de conexoes. Prender cada requisicao a uma transacao resolveria o vazamento
 * e criaria outro problema: as rotas de empresa fazem chamadas HTTP externas
 * (Vercel, ValidaPay, Resend, Blob) e segurariam a conexao durante elas.
 *
 * O isolamento, hoje, e de aplicacao: `tenantMiddleware` resolve a empresa a
 * partir do vinculo real, e cada consulta filtra. Isso **funciona** -- a
 * varredura abaixo nao encontra nenhuma excecao. O que faltava era garantia de
 * que continua funcionando: uma rota nova que esqueca o filtro vaza dado entre
 * empresas, e nada avisaria.
 *
 * Este teste e esse aviso. Nao substitui RLS; fecha o caminho pelo qual o
 * defeito entraria.
 *
 * ## O que conta como filtrada
 *
 * Uma consulta passa quando, no handler que a contem, a propria tabela e
 * filtrada por `tenantId`/`siteId`, **ou** quando a instrucao compara algo com
 * `tenant.tenantId`/`tenant.siteId` -- os dois valores que vem do vinculo ja
 * conferido, nunca do navegador.
 *
 * A segunda forma cobre o caso de `sites`, cuja identidade e a coluna `id`:
 * `eq(schema.sites.id, tenant.siteId)` filtra tao bem quanto uma coluna
 * `site_id` filtraria.
 *
 * ## Limite honesto
 *
 * E leitura de texto, nao analise semantica. Nao entende um filtro montado em
 * outro arquivo nem um `and()` recebido por parametro. Erra para o lado de
 * acusar, que e o lado certo: um falso positivo custa um comentario, um falso
 * negativo custa um vazamento.
 */

const RAIZ = 'apps/api/src/routes';

/** Tabelas que pertencem a uma empresa, lidas do schema. */
function tabelasDeEmpresa(): Set<string> {
  const schema = readFileSync('packages/database/src/schema.ts', 'utf-8');
  const donas = new Set<string>();
  for (const m of schema.matchAll(/export const (\w+) = pgTable\(\s*'[a-z_]+',\s*\{([\s\S]*?)\n {2}\},/g)) {
    if (m[2]!.includes("tenantId: uuid('tenant_id')")) donas.add(m[1]!);
  }
  return donas;
}

/** Arquivos de rota montados sob `tenantScoped` em `app.ts`. */
function arquivosDeEmpresa(): string[] {
  const app = readFileSync('apps/api/src/app.ts', 'utf-8');
  const montadas = [...app.matchAll(/tenantScoped\.route\('\/', (\w+)\(\)\)/g)].map((m) => m[1]!);
  return readdirSync(RAIZ)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => {
      const src = readFileSync(`${RAIZ}/${f}`, 'utf-8');
      return montadas.some((fn) => src.includes(`export function ${fn}(`));
    });
}

export interface Achado {
  arquivo: string;
  linha: number;
  tabela: string;
}

/** Varre um arquivo de rota. Exportada para o proprio teste poder se testar. */
export function consultasSemFiltro(src: string, arquivo: string, donas: Set<string>): Achado[] {
  const inicios = [...src.matchAll(/app\.(get|post|put|patch|delete)\(/g)].map((m) => m.index!);
  const achados: Achado[] = [];

  for (const m of src.matchAll(/\.(from|update|delete)\(\s*schema\.(\w+)\s*\)/g)) {
    const tabela = m[2]!;
    if (!donas.has(tabela)) continue;

    const anteriores = inicios.filter((i) => i <= m.index!);
    const inicio = anteriores.length > 0 ? anteriores[anteriores.length - 1]! : 0;
    const seguinte = inicios.find((i) => i > m.index!) ?? src.length;
    const handler = src.slice(inicio, seguinte);

    // A instrucao vai do ponto da tabela ate o `;` fora de parenteses.
    let i = m.index!;
    let profundidade = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '(') profundidade += 1;
      else if (ch === ')') profundidade -= 1;
      else if (ch === ';' && profundidade <= 0) break;
      i += 1;
    }
    const instrucao = src.slice(m.index!, i);

    const filtrada =
      new RegExp(`schema\\.${tabela}\\.(tenantId|siteId)`).test(handler)
      || /tenant\.(tenantId|siteId)/.test(instrucao);

    if (!filtrada) {
      achados.push({ arquivo, linha: src.slice(0, m.index!).split('\n').length, tabela });
    }
  }
  return achados;
}

describe('isolamento entre empresas nas rotas', () => {
  const donas = tabelasDeEmpresa();
  const arquivos = arquivosDeEmpresa();

  it('a varredura encontra as rotas e as tabelas certas', () => {
    // Sem isto, um erro de caminho faria o teste passar varrendo o vazio.
    expect(donas.size).toBeGreaterThan(40);
    expect(arquivos.length).toBeGreaterThan(10);
  });

  it('nenhuma consulta de empresa roda sem filtro de empresa ou site', () => {
    const achados = arquivos.flatMap((arquivo) =>
      consultasSemFiltro(readFileSync(`${RAIZ}/${arquivo}`, 'utf-8'), arquivo, donas),
    );
    const legivel = achados.map((a) => `${a.arquivo}:${a.linha} (${a.tabela})`);
    expect(legivel, 'consulta sem filtro de empresa').toEqual([]);
  });

  /**
   * Um guarda que nunca acusa nao guarda nada.
   *
   * Aqui ele recebe exatamente o defeito que existe para pegar: uma rota de
   * empresa lendo uma tabela de empresa sem dizer de qual.
   */
  it('o guarda sabe acusar: uma rota sem filtro e apanhada', () => {
    const ruim = `
      app.get('/:tenantId/vazamento', async (c) => {
        const ctx = c.get('ctx');
        const rows = await ctx.db.select().from(schema.properties);
        return ok(c, { items: rows });
      });
    `;
    const achados = consultasSemFiltro(ruim, 'falso.ts', new Set(['properties']));
    expect(achados).toHaveLength(1);
    expect(achados[0]!.tabela).toBe('properties');
  });

  it('e sabe absolver: o filtro pela identidade do site conta', () => {
    const bom = `
      app.get('/:tenantId/demo', async (c) => {
        const tenant = c.get('tenant');
        const [site] = await ctx.db.select().from(schema.sites).where(eq(schema.sites.id, tenant.siteId));
        return ok(c, { site });
      });
    `;
    expect(consultasSemFiltro(bom, 'falso.ts', new Set(['sites']))).toEqual([]);
  });

  it('e absolve o filtro montado em variavel, acima da consulta', () => {
    const bom = `
      app.get('/:tenantId/produtos', async (c) => {
        const conditions = [eq(schema.products.siteId, tenant.siteId)];
        const where = and(...conditions);
        const rows = await ctx.db.select().from(schema.products).where(where);
        return ok(c, { items: rows });
      });
    `;
    expect(consultasSemFiltro(bom, 'falso.ts', new Set(['products']))).toEqual([]);
  });
});
