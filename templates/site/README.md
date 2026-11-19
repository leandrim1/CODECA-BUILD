# Site do cliente — ponto de partida

Next.js (App Router) com o `@codeca/sdk` já ligado. Copie esta pasta para
começar um site; o que está aqui funciona e explica o porquê de cada escolha.

## Começar

```bash
cp -r templates/site ../site-do-cliente
cd ../site-do-cliente
cp .env.example .env.local
```

O `.env.example` é um **arquivo oculto**: um `ls` sem `-a` não o mostra.

Preencha o `.env.local` com as credenciais que o painel mestre dá em
`/plataforma/sites`, aba **Chaves**. Depois:

```bash
npm install
npm run dev
```

## O que já vem resolvido

| Arquivo | O quê |
| --- | --- |
| `src/lib/codeca.ts` | Cliente do servidor (chave secreta, lê rascunho) |
| `src/lib/codeca-navegador.ts` | Cliente do navegador (chave publicável) |
| `src/app/page.tsx` | Página inicial, buscas em paralelo, tratamento de suspensão |
| `src/app/contato/page.tsx` | Dados de contato da empresa |
| `src/components/FormularioDeContato.tsx` | Envio de interessado, com armadilha de robô |
| `src/app/api/codeca/webhook/route.ts` | Aviso de publicação revalida o cache |
| `next.config.ts` | Libera o domínio das imagens da plataforma |

## Quatro coisas que não são óbvias

**As duas chaves fazem coisas diferentes.** A publicável (`cb_pub_`) vai para o
navegador e lê só o publicado — e **só atende a partir de uma origem
cadastrada** no painel. Sem nenhuma origem, ela recusa. A secreta (`cb_sec_`)
lê também rascunho e nunca sai do servidor: por isso o SDK tem dois pontos de
entrada, e `@codeca/sdk/server` num arquivo do navegador é visível na revisão.

**O corpo do webhook vai cru.** Use `await request.text()`, nunca
`await request.json()` reserializado: mudar espaçamento ou ordem das chaves
quebra a assinatura, com um erro que parece de credencial.

**As listas não têm todas a mesma forma.** `banners.list()` devolve o array
direto; `services.list()` devolve uma página com `items`. Banner não é
paginado, serviço é. O compilador avisa se trocar.

**A etiqueta de cache entra pelo `fetch` do cliente**, em `src/lib/codeca.ts`,
e não pelo `revalidate` da página — `revalidate` é tempo, não etiqueta. Sem
isso o `revalidateTag` do webhook invalidaria uma etiqueta que ninguém carrega,
e o cliente editaria no painel sem ver mudança.

**Sem credencial, o build falha de propósito.** `src/lib/codeca.ts` confere as
variáveis na partida. Um site que sobe sem credencial deve quebrar no build, e
não servir uma página vazia ao primeiro visitante.

## O que muda sem ser quebra de contrato

Está no README do SDK, e vale repetir porque é o que mais derruba site em
produção:

- `site.segment` é **texto livre** — trate valor desconhecido como caso padrão.
- `modules` **cresce** — ignore o módulo que o seu site não conhece.
- Os módulos de `custom(chave)` podem ser renomeados ou desligados no painel.
- `customFields` é `Record<string, unknown>` — confira o tipo antes de usar e
  trate chave ausente como não informada.

Código que depende de `segment` ser um de três valores, ou de uma chave de
`customFields` estar sempre presente, vai quebrar — e isso **não** conta como
quebra de contrato.

## Instalar o SDK fora do monorepo

O `package.json` aponta para `file:../codeca-sdk.tgz`. Gere o pacote com:

```bash
cd packages/sdk && npm pack --pack-destination ../../..
```

Ou troque por uma das vias do README do SDK (gitpkg, ou copiar `src/`).
Quando o pacote for publicado, vira `pnpm add @codeca/sdk` e esta seção sai.

## O que foi verificado neste template

Numa cópia limpa, com o SDK empacotado por `npm pack`:

- `npm install` — limpo, **zero vulnerabilidades** (`npm audit`).
- `npx tsc --noEmit` — **zero erros** contra os tipos reais do SDK.

A compilação de tipos pegou três enganos antes de isto virar entrega:
`banners.list()` devolve array e não `{ items }`; o serviço tem `description`
e não `shortDescription`; e `leads.create` exige `interestType`.

**O que não foi verificado:** um `next build` completo contra uma plataforma
viva. O build pré-renderiza a página inicial e por isso exige credencial
válida e rede — de propósito, como diz a seção acima. Rode `npm run build` com
o `.env.local` preenchido antes de publicar o primeiro site.
