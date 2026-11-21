# Prova do consentimento em navegador

```bash
pnpm --filter @codeca/sdk build
node scripts/consentimento/provar.mjs
```

Sobe dois servidores locais (4101 e 4102), abre cada um em Chromium real — no
tamanho de computador e de celular — e confere 38 coisas. A que justifica o
harness existir: **toda requisição externa da página é registrada, e a lista tem
de estar vazia antes do consentimento.** Um teste de unidade verifica o que o
código faz; só o navegador verifica o que sai para a rede.

Duas portas porque o navegador isola o `localStorage` por origem: é isso que
prova que a escolha feita no site de um cliente não vale no de outro.

A página importa `packages/sdk/dist` direto, e não uma cópia. Sem o SDK
compilado, o script para com a instrução de compilá-lo.

As capturas vão para `saida/` (fora do versionamento). `SAIDA_DA_PROVA` troca o
destino; `PLAYWRIGHT` troca o caminho do Playwright, quando não for o do
ambiente padrão.

## Prova do caminho inteiro

```bash
# em outro terminal, com o painel local no ar em http://localhost:4010
VN=$(ls -d node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs | head -1)
node "$VN" --config vitest.config.ts scripts/loadtest/ui-import-server.ts
```

```bash
node scripts/consentimento/fim-a-fim.mjs
```

Configura os cookies de um site pelo painel mestre, emite a chave publicável,
abre o site do cliente **em outra origem** (`localhost:4101`) e confere que a
configuração do painel chega ao banner e que a escolha volta para a plataforma.

Foi este percurso que encontrou o defeito do `navigator.sendBeacon`: oito
conferências passavam, o banner funcionava, a escolha era guardada — e o
registro nunca aparecia no banco, porque o navegador descartava a requisição em
silêncio. Nenhum teste de unidade alcança isso.

O painel precisa estar em `http://localhost:4010`: é o `APP_URL` daquele
servidor, e por `127.0.0.1` toda escrita autenticada falha na conferência de
origem.
