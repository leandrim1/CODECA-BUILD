# @codeca/sdk

Cliente do CODECA Build para os sites desenvolvidos pela CODECA IA.

Sem dependencia de runtime: o pacote usa apenas `fetch`.

---

## Instalacao

O pacote vive dentro do monorepo da plataforma. Em um site separado, use uma
destas vias:

```bash
pnpm add "https://gitpkg.now.sh/leandrim1/CODECA-BUILD/packages/sdk?main"
```

Ou, mais simples e sem servico de terceiro: `pnpm pack` no pacote e commitar o
tarball no site, ou copiar `packages/sdk/src` para `src/codeca/` do site. Os
arquivos nao importam nada de fora.

---

## Uso no navegador

```ts
import { createClient } from '@codeca/sdk';

export const codeca = createClient({
  baseUrl: 'https://app.codecabuild.com.br',
  publishableKey: import.meta.env.VITE_CODECA_KEY,
});
```

A chave publicavel (`cb_pub_...`) **nao e segredo**: ela so le conteudo
publicado, e so a partir de uma origem cadastrada no painel da plataforma.
Pode ficar no codigo do site.

Passar uma chave secreta aqui falha na hora, com mensagem explicando o que
fazer. E o erro mais facil de cometer e o mais caro.

### Chamadas

```ts
await codeca.site.get();
await codeca.institutional.get();
await codeca.contact.get();
await codeca.banners.list();

await codeca.properties.list({ purpose: 'venda', city: 'Campinas', page: 1 });
await codeca.properties.get('residencial-aurora');

await codeca.projects.list({ status: 'em_andamento' });
await codeca.projects.get('edificio-horizonte');

await codeca.services.list();

await codeca.products.list({ category: 'pratos-principais', availableOnly: true });
await codeca.products.get('lasanha-da-casa');
await codeca.categories.list();

await codeca.galleries.list();
await codeca.galleries.get('nossa-estrutura');

await codeca.testimonials.list();
await codeca.team.list();
await codeca.faqs.list();

await codeca.leads.create({
  name: 'Marina Souza',
  phone: '(19) 98888-7777',
  interestType: 'compra_imovel',
  message: 'Gostaria de visitar o decorado.',
  consent: true,
});
```

A listagem traz a **capa** de cada item; a galeria completa vem no detalhe,
por `slug`.

`leads.create` devolve apenas a confirmacao. Quem envia nao le de volta --
use o que ja esta no formulario para montar a tela de obrigado.

---

## Uso no servidor

```ts
import { createServerClient } from '@codeca/sdk/server';

const codeca = createServerClient({
  baseUrl: process.env.CODECA_BASE_URL!,
  secretKey: process.env.CODECA_SECRET_KEY!,
});

const rascunhos = await codeca.properties.list({ preview: true });

// Depoimentos sao a excecao: a plataforma nunca devolve um sem a autorizacao
// do autor, nem em previa. Nao ha sinalizador a conferir -- o que chega pode
// ir para a tela.
```

A chave secreta (`cb_sec_...`) le tambem rascunho. Ela **nunca** vai para o
navegador: nem em componente de cliente, nem em `VITE_*`, nem no
repositorio.

O ponto de entrada e separado de proposito: `@codeca/sdk/server` aparecendo em
codigo que vai para o navegador e visivel na revisao e no bundle.

---

## Erros

Toda falha chega como `CodecaError`, com o codigo da plataforma e o status.

```ts
import { CodecaError } from '@codeca/sdk';

try {
  const imovel = await codeca.properties.get(slug);
} catch (erro) {
  if (erro instanceof CodecaError) {
    if (erro.isNotFound) return render404();
    if (erro.isNetworkError) return tentarDeNovo();
    if (erro.isRateLimited) return esperar();
    if (erro.isSuspended) return mostrarUltimoConteudoConhecido();
    if (erro.isAuthError) console.error('Credencial ou origem', erro.message);
  }
  throw erro;
}
```

`isNetworkError` significa que a plataforma nao chegou a responder -- vale
repetir. Um `422` repetido daria o mesmo resultado.

`isSuspended` (402 `subscription_required`) e pendencia da assinatura do site,
nao problema do codigo: a credencial esta correta e repetir nao resolve. Quem
resolve e a empresa, no painel. O conteudo continua guardado na plataforma e
volta a responder sozinho, entao o site faz melhor mostrando o que tem em
cache do que uma pagina de erro.

Aparece somente quando o plano do site escolhe `parar de responder` na
suspensao; o padrao da plataforma e continuar servindo.

### O aviso em `getSite()`

`site.get()` devolve `notice`: uma frase pronta para exibir ao visitante, ou
`null`. Vem preenchida quando o plano pede aviso durante uma pendencia. O
texto nao descreve a pendencia nem cita valores -- se o seu site exibe o
`notice`, pode exibi-lo como veio.

---

## Aviso de publicacao

Opcional, e so faz sentido para site que renderiza no servidor com cache. O
verificador fica em `@codeca/sdk/server` -- nunca no ponto de entrada do
navegador, porque conferir a assinatura exige o segredo.

```ts
import { verifyWebhook, CODECA_SIGNATURE_HEADER } from '@codeca/sdk/server';

const evento = await verifyWebhook({
  // O corpo cru. Reserializar muda espacamento e ordem das chaves, e a
  // assinatura deixa de conferir.
  rawBody: await request.text(),
  signature: request.headers.get(CODECA_SIGNATURE_HEADER),
  secret: process.env.CODECA_WEBHOOK_SECRET!,
});

// evento.moduleKey, evento.action, evento.slug
```

Lanca `CodecaError` quando a assinatura nao confere, esta fora da janela de
tolerancia (cinco minutos) ou o evento e desconhecido. Deixe o erro virar
401: responder 200 a uma requisicao nao assinada deixaria qualquer um na
internet invalidar o cache do site.

Usa **Web Crypto**, nao `node:crypto` -- funciona na borda (Vercel Edge,
Cloudflare) e no Node. O corpo traz `moduleKey`, `action`, `entityId`, `slug`
e `publishedAt`: o que mudou, nao o conteudo. Busque o conteudo pela API
depois, com a sua credencial.

---

## Prazo

Dez segundos por padrao, ajustavel em `timeoutMs`. Sem prazo, uma plataforma
lenta travaria a renderizacao do site ate o navegador desistir sozinho.

---

## Tipos

Todos os tipos de conteudo sao exportados (`PublicProperty`, `PublicProject`,
`PublicService`, `PublicBanner`, `InstitutionalContent`, `ContactContent`...).

O pacote carrega a propria copia deles para nao depender de nada. Uma
verificacao de contrato no monorepo compara essa copia com o que a API entrega
**em tempo de compilacao**: se um campo mudar de um lado so, o build da
plataforma quebra antes de qualquer site receber a versao errada.

A excecao e `customFields`, que e `Record<string, unknown>`: os campos
personalizados de um projeto sao dados cadastrados no painel mestre, e nao ha
tipo estatico possivel para eles. Confira o tipo do valor antes de usar, e
trate chave ausente como nao informada.

## Compatibilidade

O site do cliente e codigo que a CODECA IA desenvolve mas nao revisa todo dia.
Publicar este pacote transforma `/api/v1` numa promessa, entao a promessa fica
escrita.

### O que pode mudar num `minor` (`0.1.0` -> `0.2.0`)

- **Campo novo** numa resposta. Seu codigo ignora o que nao le.
- **Rota nova**, metodo novo, modulo novo.
- **Parametro de filtro novo**, sempre opcional.
- Mensagem de erro, texto de aviso, ordem de campo no JSON.

### O que exige um `major`

- Remover ou renomear campo de resposta.
- Mudar o tipo de um campo -- inclusive deixar de aceitar `null`.
- Remover rota ou metodo.
- Tornar obrigatorio um parametro que era opcional.
- Mudar o significado de um valor existente.

### Tres coisas que **nao** sao mudanca de contrato

- **`site.segment` e texto livre.** A plataforma atende qualquer ramo, e
  segmentos sao cadastrados no painel. Trate valor desconhecido como caso
  padrao; um segmento novo nao e versao nova do SDK.
- **`modules` cresce.** Um modulo que seu site nao conhece aparece na lista e
  deve ser ignorado.
- **`customFields` muda sem avisar.** Sao os campos que a CODECA IA definiu
  para aquele projeto, e sao configuracao, nao contrato: um campo pode ser
  criado, renomeado no rotulo ou removido no painel mestre. O tipo e
  `Record<string, unknown>` porque o conjunto e dado, nao codigo.

Codigo que depende de `segment` ser um de tres valores, de `modules` ter
exatamente os modulos de hoje, ou de uma chave de `customFields` estar sempre
presente, vai quebrar sem que isto seja uma quebra de contrato -- e por isso
esta dito aqui.

### Versao da API e versao do pacote

Sao independentes. `/api/v1` so vira `/api/v2` numa mudanca que nenhum `major`
do SDK resolveria, e as duas versoes responderiam em paralelo durante a
transicao. Enquanto `/v1` existir, qualquer versao deste pacote fala com ela.

## Licenca

`UNLICENSED`: nenhum direito de uso e concedido por padrao. O pacote e pensado
para os projetos que a CODECA IA desenvolve, e o campo deve ser trocado pela
licenca escolhida se ele passar a ser instalado por terceiros.
