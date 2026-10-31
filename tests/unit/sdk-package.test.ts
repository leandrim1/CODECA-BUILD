import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * O `@codeca/sdk` precisa ser instalavel **fora** deste repositorio.
 *
 * Dentro do monorepo `@codeca/shared` sempre resolve, entao um acoplamento
 * acidental passa por todos os outros testes. Quem descobriria seria o site do
 * cliente, no `npm install`, com um erro de modulo nao encontrado.
 *
 * A conferencia e a mesma do `prepublishOnly`: este teste **roda o script**,
 * em vez de reimplementar as regras. Uma regra nova entra num lugar so.
 */

const RAIZ = fileURLToPath(new URL('../../packages/sdk/', import.meta.url));
const SCRIPT = `${RAIZ}scripts/prepublish.mjs`;

function manifesto() {
  return JSON.parse(readFileSync(`${RAIZ}package.json`, 'utf8')) as Record<string, unknown>;
}

describe('pacote publicavel', () => {
  it('passa as conferencias de publicacao', () => {
    // Sem `--require-build`: a presenca do `dist` e assunto do publish.
    const saida = execFileSync('node', [SCRIPT], { encoding: 'utf8' });
    expect(saida).toContain('conferencias de publicacao ok');
  });

  it('nao declara dependencia em tempo de execucao', () => {
    const pacote = manifesto();
    // Zero dependencia e escolha, nao acidente: o SDK entra em projeto de
    // cliente, e cada dependencia nossa vira auditoria e atualizacao dele.
    expect(pacote.dependencies ?? {}).toEqual({});
    expect(pacote.peerDependencies ?? {}).toEqual({});
  });

  it('tem o metadado que o registro exige', () => {
    const pacote = manifesto();
    for (const campo of ['name', 'version', 'description', 'license', 'repository', 'author']) {
      expect(pacote[campo], `campo ${campo}`).toBeTruthy();
    }
    expect(pacote.name).toBe('@codeca/sdk');
    expect((pacote.files as string[])).toEqual(
      expect.arrayContaining(['dist', 'README.md', 'CHANGELOG.md']),
    );
  });

  it('a lista de arquivos e uma permissao, nao um curinga', () => {
    const arquivos = manifesto().files as string[];
    // `files` e allowlist: o que nao esta nela nao viaja. Um `.` ou `*`
    // transformaria isso em denylist, e passaria a depender de `.npmignore`
    // estar certo -- o caminho pelo qual segredo vai para registro publico.
    for (const entrada of arquivos) {
      expect(entrada, `entrada ${entrada}`).not.toMatch(/^[.*]$/);
      expect(entrada, `entrada ${entrada}`).not.toContain('*');
    }
  });

  it('publica com acesso restrito por padrao', () => {
    const pacote = manifesto();
    // Pacote com escopo vai como privado a menos que se diga o contrario.
    // Deixar explicito evita publicar no npm publico por engano -- um publish
    // publico nao se desfaz, so se deprecia.
    expect((pacote.publishConfig as Record<string, unknown>).access).toBe('restricted');
  });

  it('os dois pontos de entrada estao declarados', () => {
    const exportacoes = manifesto().exports as Record<string, Record<string, string>>;
    // O ponto de entrada separado e o que torna visivel, na revisao e no
    // bundle, que alguem levou a chave secreta para o navegador.
    expect(exportacoes['.']!.types).toBe('./dist/index.d.ts');
    expect(exportacoes['./server']!.types).toBe('./dist/server.d.ts');
  });

  it('a versao do manifesto esta no changelog', () => {
    const pacote = manifesto();
    const changelog = readFileSync(`${RAIZ}CHANGELOG.md`, 'utf8');
    expect(changelog).toContain(`## ${pacote.version}`);
  });

  it('a regra de compatibilidade esta escrita no README', () => {
    const readme = readFileSync(`${RAIZ}README.md`, 'utf8');
    // Publicar transforma /v1 em promessa a codigo que nao controlamos. A
    // promessa precisa estar legivel por quem instala, nao so combinada.
    expect(readme).toContain('## Compatibilidade');
    expect(readme).toMatch(/minor/);
    expect(readme).toMatch(/major/);
    expect(readme).toMatch(/segment.*texto livre|texto livre.*segment/s);
  });
});
