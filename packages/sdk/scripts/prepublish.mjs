#!/usr/bin/env node
/**
 * Conferencia antes de publicar.
 *
 * Roda no `prepublishOnly`, entao vale tanto para `pnpm publish` na mao quanto
 * para o workflow. O que se verifica aqui nao e estilo: e o que torna o pacote
 * **instalavel fora deste repositorio**.
 *
 * Um erro aqui nao e detectado pelos testes do monorepo, porque dentro dele
 * `@codeca/shared` sempre resolve. Quem descobriria seria o site do cliente,
 * no `npm install`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const falhas = [];

const pacote = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));

// 1. Dependencia de workspace quebra a instalacao fora do monorepo.
for (const campo of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [nome, faixa] of Object.entries(pacote[campo] ?? {})) {
    if (String(faixa).startsWith('workspace:') || nome.startsWith('@codeca/')) {
      falhas.push(`${campo}.${nome} = ${faixa}: o SDK precisa ser instalavel sozinho.`);
    }
  }
}

// 2. Import de pacote do monorepo no codigo-fonte. O mesmo motivo, pego antes
//    de virar dependencia declarada.
function arquivosTs(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosTs(caminho);
    return nome.endsWith('.ts') ? [caminho] : [];
  });
}

for (const arquivo of arquivosTs(join(raiz, 'src'))) {
  const texto = readFileSync(arquivo, 'utf8');
  const imports = texto.matchAll(/^\s*(?:import|export)[^;]*?from\s+'([^']+)'/gm);
  for (const [, origem] of imports) {
    if (origem.startsWith('@codeca/')) {
      falhas.push(`${arquivo.slice(raiz.length + 1)} importa ${origem}.`);
    }
  }
}

// 3. O build precisa estar presente: `files` publica `dist`, e um `dist`
//    velho publicaria a versao anterior sem ninguem notar.
//
//    Conferido so com `--require-build`, que o `prepublishOnly` passa. O
//    teste da suite roda este mesmo script para nao duplicar as regras, e nem
//    sempre ha build quando ele roda -- fazer disso uma falha daria um erro
//    confuso a quem rodou `pnpm test` depois de `pnpm clean`.
if (process.argv.includes('--require-build')) {
  for (const alvo of ['dist/index.js', 'dist/index.d.ts', 'dist/server.js', 'dist/server.d.ts']) {
    if (!existsSync(join(raiz, alvo))) falhas.push(`${alvo} nao existe: rode o build antes.`);
  }
}

// 4. A versao precisa estar no changelog, senao quem instala nao tem como
//    saber o que mudou.
const changelog = readFileSync(join(raiz, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## ${pacote.version}`)) {
  falhas.push(`CHANGELOG.md nao tem secao para a versao ${pacote.version}.`);
}

if (falhas.length > 0) {
  console.error('Publicacao interrompida:');
  for (const falha of falhas) console.error(`  - ${falha}`);
  process.exit(1);
}

console.log(`@codeca/sdk ${pacote.version}: conferencias de publicacao ok.`);
