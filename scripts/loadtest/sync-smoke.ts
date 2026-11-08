/**
 * Diagnostico cru do fluxo de sincronizacao, fora do vitest.
 *
 * O relator do vitest so escreve no fim, o que esconde onde uma execucao
 * demora. Aqui cada passo imprime na hora, com o tempo que levou -- e o que
 * permite dizer "travou em X" em vez de "a suite nao termina".
 *
 * Ferramenta de investigacao: nao entra no build nem na suite.
 */
import { appendFileSync } from 'node:fs';
import { createTestApi, registerAccount, verifyEmail } from '../../tests/helpers/api.js';
import { createMemorySiteFetcher } from '@codeca/api';
import { eq, schema } from '@codeca/database';
import { MODULE_KEYS } from '@codeca/shared';

const t0 = Date.now();
const LOG = process.env.SMOKE_LOG ?? '/tmp/sync-smoke.log';
/**
 * Escrita sincrona, de proposito.
 *
 * `console.log` para arquivo e bufferizado em blocos, e e justamente o que
 * esconde ONDE uma execucao longa esta parada. Com `appendFileSync` cada
 * passo aparece no instante em que acontece.
 */
const passo = (nome: string) => {
  appendFileSync(LOG, `[${String(Date.now() - t0).padStart(7)} ms] ${nome}\n`);
};

const HOME = `<!doctype html><html lang="pt-BR"><head><title>Clínica</title>
<meta name="description" content="Clínica odontológica com atendimento humanizado.">
<script type="application/ld+json">
{"@type":"Dentist","name":"Clínica Sorriso","telephone":"(34) 99999-1111","email":"c@x.com.br",
 "address":{"@type":"PostalAddress","streetAddress":"Rua das Flores, 123","addressLocality":"Uberlândia","addressRegion":"MG"}}
</script></head><body><nav><a href="/servicos">Serviços</a></nav>
<main><h1>Seu sorriso em boas mãos</h1></main></body></html>`;

const SERVICOS = `<html><head><title>Serviços</title></head><body><main><h1>Nossos serviços</h1>
<h2>Clareamento dental</h2><p>Procedimento feito em consultório com acompanhamento do dentista.</p>
</main></body></html>`;

let paginas: Record<string, { body?: string; status?: number }> = {
  'https://siteantigo.com.br/': { body: HOME },
  'https://siteantigo.com.br/servicos': { body: SERVICOS },
};

passo('iniciando createTestApi (migrações PGlite)');
const api = await createTestApi({
  siteFetcher: { fetch: async (u, o) => createMemorySiteFetcher(paginas).fetch(u, o) },
});
passo('createTestApi pronto');

const conta = await registerAccount(api, {
  email: 'contato@siteantigo.com.br',
  companyName: 'Clínica Sorriso',
});
await verifyEmail(api, conta);
passo('conta criada');

const [site] = await api.db
  .select({ id: schema.sites.id })
  .from(schema.sites)
  .where(eq(schema.sites.tenantId, conta.tenantId));
for (const key of MODULE_KEYS) {
  await api.db
    .insert(schema.siteModules)
    .values({ tenantId: conta.tenantId, siteId: site!.id, moduleKey: key, enabled: true, settings: {} })
    .onConflictDoUpdate({
      target: [schema.siteModules.siteId, schema.siteModules.moduleKey],
      set: { enabled: true },
    });
}
passo('módulos habilitados');

const base = `/api/tenants/${conta.tenantId}`;

const abertura = await conta.client.post(`${base}/site-import`, { url: 'https://siteantigo.com.br/' });
passo(`importação aberta: ${abertura.status}`);
const importId = abertura.body.run.id as string;

for (let i = 0; i < 20; i += 1) {
  const r = await conta.client.get(`${base}/site-import/${importId}`);
  passo(`  importação fatia ${i}: working=${r.body.run.working}`);
  if (!r.body.run.working) break;
}

const conf = await conta.client.post(`${base}/site-import/${importId}/confirmar`, {
  confirm: true,
  targets: [],
});
passo(`importação confirmada: ${conf.status} (${conf.body?.result?.imported} itens)`);

const conexao = await conta.client.post(`${base}/sync`, {
  url: 'https://siteantigo.com.br/',
  frequency: 'semanal',
});
passo(`fonte conectada: ${conexao.status} ${conexao.errorMessage ?? ''}`);

const v1 = await conta.client.post(`${base}/sync/verificar`, {});
passo(`1a verificação: ${v1.status} mudanças=${v1.body?.changesFound} msg=${v1.body?.message}`);

paginas = {
  'https://siteantigo.com.br/': { body: HOME.replace('(34) 99999-1111', '(34) 98888-2222') },
  'https://siteantigo.com.br/servicos': { body: SERVICOS },
};

const v2 = await conta.client.post(`${base}/sync/verificar`, {});
passo(`2a verificação: ${v2.status} mudanças=${v2.body?.changesFound} msg=${v2.body?.message}`);

const estado = await conta.client.get(`${base}/sync`);
const tel = (estado.body.changes as any[]).find((c) => c.target === 'contato' && c.fieldKey === 'phone');
passo(`telefone detectado: ${tel ? `${tel.codecaPreview} -> ${tel.sourcePreview} (${tel.type})` : 'NAO ENCONTRADO'}`);

if (tel) {
  await conta.client.patch(`${base}/sync/decisoes`, {
    items: [{ changeId: tel.id, decision: 'aprovada' }],
  });
  const ap = await conta.client.post(`${base}/sync/aplicar`, { confirm: true, targets: [] });
  passo(`aplicado: ${ap.status} ${JSON.stringify(ap.body?.result)}`);

  const [doc] = await api.db
    .select()
    .from(schema.contentDocuments)
    .where(eq(schema.contentDocuments.moduleKey, 'contato'));
  passo(`telefone no painel: ${(doc?.data as any)?.phone}`);

  const v3 = await conta.client.post(`${base}/sync/verificar`, {});
  passo(`3a verificação (não deve repetir): mudanças=${v3.body?.changesFound}`);
}

await api.close();
passo('FIM');
