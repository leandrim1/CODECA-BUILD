---
name: codeca-sdk
description: >-
  Integra um site ao CODECA Build pelo @codeca/sdk, o backend de conteúdo da
  CODECA IA. Use sempre que o trabalho envolver criar ou manter um site de
  cliente que consome conteúdo da plataforma CODECA Build, mesmo que a pessoa
  não cite o SDK pelo nome. Pedidos como "criar o site da clínica", "montar o
  site institucional do cliente", "buscar os imóveis da plataforma", "conectar
  o site ao painel", "o formulário de contato precisa cair no painel" ou "o
  site não atualiza quando edito o conteúdo" são todos deste domínio. Traz um
  ponto de partida em Next.js já integrado e as regras que não estão no código.
---

# Integrar um site ao CODECA Build

A CODECA Build não desenha nem publica o site. Ela é o **backend de conteúdo**:
o site é um projeto próprio, na Vercel, que consome JSON autorizado pela API da
plataforma. Não existe botão "publicar site" — o que se publica é conteúdo.

Entender isso evita o erro mais comum de quem chega: procurar na plataforma um
tema, um editor de páginas ou um botão de deploy. Nada disso existe, e é de
propósito — a identidade visual de cada site é livre porque vem do código dele.

## Começar um site novo

A pasta `assets/` deste skill é um ponto de partida em Next.js (App Router) com
tudo ligado. Copie-a para o projeto novo e ajuste:

```
assets/
├── src/lib/codeca.ts                      cliente do servidor (chave secreta)
├── src/lib/codeca-navegador.ts            cliente do navegador (chave publicável)
├── src/app/page.tsx                       inicial, buscas em paralelo
├── src/app/contato/page.tsx               dados de contato
├── src/components/FormularioDeContato.tsx envio de interessado
├── src/app/api/codeca/webhook/route.ts    aviso de publicação revalida o cache
└── next.config.ts                         libera o domínio das imagens
```

Depois: `cp .env.example .env.local`, preencher com as credenciais de
`/plataforma/sites` (aba **Chaves**), `npm install`, `npm run dev`.

Se o projeto já existe e usa outro framework, copie só `src/lib/` e adapte — o
SDK é um cliente `fetch` sem dependência de runtime, então funciona em qualquer
lugar que tenha `fetch`.

## Instalar o pacote

O `@codeca/sdk` vive no monorepo da plataforma e **não está publicado no npm**.
A via que não depende de serviço de terceiro:

```bash
cd CODECA-BUILD/packages/sdk && npm pack --pack-destination /caminho/do/site
```

No site, aponte a dependência para o arquivo: `"@codeca/sdk": "file:./codeca-sdk-0.1.0.tgz"`.

Também dá para copiar `packages/sdk/src` para `src/codeca/` do site — os
arquivos não importam nada de fora.

## As duas chaves, e por que são duas

A pergunta que organiza a segurança não é "como o site se autentica", e sim
**quem** está chamando.

| | `cb_pub_` publicável | `cb_sec_` secreta |
| --- | --- | --- |
| Onde roda | navegador do visitante | servidor do site |
| Lê rascunho | não | sim |
| Exige origem cadastrada | **sim** | não |
| Pode ser vista depois | sim | **não** — aparece uma vez |

A publicável **não é segredo**: é um identificador com escopo. Vazada, não dá
acesso a nada que já não fosse público — esse é o critério, e não a obscuridade.
Pode ir no código do site.

O SDK tem **dois pontos de entrada** por causa disso: `@codeca/sdk` para o
navegador e `@codeca/sdk/server` para o servidor. A separação não é estética —
`@codeca/sdk/server` aparecendo em código que vai para o navegador é visível na
revisão e no bundle, bem mais do que um argumento trocado. Passar uma chave
secreta no cliente do navegador falha na hora, com mensagem explicando o quê.

**A chave publicável só atende a partir de origem cadastrada**, em
`/plataforma/sites`, aba Origens. Sem nenhuma origem, ela recusa — e esse é o
primeiro lugar a olhar quando o formulário do site "não funciona em produção".

**Nenhuma das duas lê interessados.** O site pode criar um contato pelo
formulário; listar, nunca. Nome e telefone são dado pessoal e ficam atrás do
painel autenticado.

## As chamadas

```ts
await codeca.site.get();          // inclui `notice`: aviso pronto para exibir, ou null
await codeca.institutional.get();
await codeca.contact.get();
await codeca.banners.list();
await codeca.properties.list({ purpose: 'venda', city: 'Campinas' });
await codeca.properties.get('residencial-aurora');
await codeca.services.list();
await codeca.products.list({ category: 'pratos', availableOnly: true });
await codeca.galleries.get('nossa-estrutura');
await codeca.testimonials.list();
await codeca.team.list();
await codeca.faqs.list();
await codeca.custom('cardapio').list();   // módulos criados para o projeto
```

**As listas não têm todas a mesma forma.** `banners.list()` devolve o array
direto; `services.list()` devolve uma página com `items`. Banner não é paginado,
serviço é. O compilador avisa se trocar — e avisa mesmo: este foi um dos
enganos que a compilação pegou ao montar o template.

A listagem traz a **capa** de cada item; a galeria completa vem no detalhe, por
`slug`.

### Criar um interessado

```ts
await codeca.leads.create({
  name, phone,
  interestType: 'contato',   // obrigatório
  message,
  sourcePath: window.location.pathname,
  honeypot: campoOculto,     // preenchido = robô, a plataforma descarta
  consent: true,             // obrigatório: sustenta o tratamento do dado (LGPD)
});
```

Devolve só a confirmação. Monte a tela de obrigado com o que já está no
formulário — quem envia não lê de volta, de propósito.

## Erros que pedem tratamento diferente

```ts
if (erro instanceof CodecaError) {
  if (erro.isNotFound) return render404();
  if (erro.isNetworkError) return tentarDeNovo();   // a plataforma não respondeu
  if (erro.isRateLimited) return esperar();
  if (erro.isSuspended) return mostrarCache();      // 402: pendência da assinatura
}
```

`isSuspended` merece atenção: a credencial está correta e repetir não resolve —
quem resolve é a empresa, no painel. O conteúdo continua guardado e volta a
responder sozinho. Um site que mostra o cache serve melhor ao visitante do que
uma página de erro, e some sozinho quando a pendência é resolvida.

## Revalidar o cache na publicação

Sem isso, o cliente edita no painel, não vê mudança, e conclui que o painel não
funciona. É a reclamação mais cara de atender.

```ts
const evento = await verifyWebhook({
  rawBody: await request.text(),     // CRU
  signature: request.headers.get(CODECA_SIGNATURE_HEADER),
  secret: process.env.CODECA_WEBHOOK_SECRET!,
});
revalidateTag(ETIQUETA, { expire: 0 });   // Next 16 exige o perfil de cache
```

Duas armadilhas:

**O corpo vai cru.** `await request.text()`, nunca um `request.json()`
reserializado: mudar espaçamento ou ordem das chaves quebra a assinatura, com um
erro que parece de credencial e manda procurar no lugar errado.

**Assinatura inválida vira 401, não 200.** Responder 200 a uma requisição não
assinada deixaria qualquer um na internet invalidar o cache do site quando
quisesse.

O corpo traz `moduleKey`, `action`, `entityId`, `slug` e `publishedAt` — o que
mudou, não o conteúdo. Busque o conteúdo pela API depois.

## O que muda sem ser quebra de contrato

Isto derruba site em produção, e está no README do SDK justamente porque **não**
conta como quebra:

- `site.segment` é **texto livre**. A plataforma atende qualquer ramo e os
  segmentos são cadastrados no painel. Trate valor desconhecido como caso padrão.
- `modules` **cresce**. Ignore o módulo que o site não conhece.
- Os módulos de `custom(chave)` podem ganhar campo, ser renomeados ou desligados
  no painel mestre. `site.get().customModules` diz quais existem agora.
- `customFields` é `Record<string, unknown>`. São campos cadastrados no painel —
  configuração, não contrato. Confira o tipo antes de usar e trate chave ausente
  como não informada.

Código que depende de `segment` ser um de três valores, ou de uma chave de
`customFields` estar sempre presente, vai quebrar.

## Falhar cedo é melhor que servir vazio

O cliente do servidor confere as variáveis de ambiente na partida, não no
primeiro acesso. Um site que sobe sem credencial deve quebrar no build — e não
devolver uma página vazia ao primeiro visitante, que é um defeito silencioso e
caro de descobrir.

Por isso `npm run build` exige credencial válida e rede: a página inicial é
pré-renderizada.

## Versão do Next

O template usa Next 16. A 15.5.4 tem vulnerabilidade conhecida
(CVE-2025-66478), e mesmo a 15.5.29 corrigida ainda arrasta um `postcss` com
falha alta. Na 16 o `npm audit` fecha em zero. Se o projeto precisar ficar na
15, rode `npm audit` e decida conscientemente.
