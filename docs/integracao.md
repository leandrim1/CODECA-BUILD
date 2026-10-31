# Integracao de um site com o CODECA Build

Como um site desenvolvido pela CODECA IA passa a consumir o conteudo da
plataforma. O SDK vem na etapa 6; o que esta aqui ja funciona por HTTP.

---

## 1. As duas credenciais

A pergunta que organiza a seguranca nao e "como o site se autentica", e sim
**quem** esta chamando.

| | Chave publicavel | Chave secreta |
| --- | --- | --- |
| Prefixo | `cb_pub_` | `cb_sec_` |
| Onde roda | Navegador do visitante | Servidor do site |
| E segredo? | **Nao** | Sim |
| Le rascunho? | Nao | Sim |
| Exige origem autorizada | **Sim** | Nao |
| Pode ser consultada depois | Sim | **Nao** |

A publicavel **nao e um segredo**: e um identificador com escopo. Vazada, ela
nao da acesso a nada que ja nao fosse publico -- esse e o criterio para
considera-la segura, e nao a obscuridade. Por isso ela pode ir no codigo do
site, inclusive em variavel `VITE_*`.

A secreta aparece **uma unica vez**, na resposta que a cria. O banco guarda so
o hash. Perdida, rotaciona-se. Ela nunca vai para o navegador, nunca para uma
variavel `VITE_*` e nunca para o repositorio.

### O que nenhuma das duas le

**Dados de interessados.** Nome, telefone e e-mail sao dado pessoal e ficam
atras do painel autenticado. `leads:write` permite **criar** um interessado
pelo formulario do site; nao existe escopo que permita lista-los. E a
separacao mais importante entre "dado publico do site" e "dado privado da
empresa".

---

## 2. Origens autorizadas

A chave publicavel viaja no navegador, a vista de qualquer um. O que impede um
terceiro de usa-la no proprio site e a origem: o navegador envia `Origin` e
nao deixa a pagina mentir sobre ele.

Cadastre o endereco do site em `/plataforma/sites`, aba **Origens**, antes de
usar a chave. Sem nenhuma origem cadastrada, a chave publicavel **nao
atende** -- falhar assim e melhor do que atender a qualquer um.

A comparacao e **exata** sobre a origem normalizada (esquema + host, porta
padrao removida). Nada de sufixo: `termina com .construtora.com.br`
autorizaria `construtora.com.br.invasor.com`.

Isto nao protege contra um servidor determinado -- `Origin` so existe no
navegador, e quem chama por fora simplesmente nao o envia. E exatamente por
isso que a chave publicavel nao le nada que ja nao seja publico.

---

## 3. O SDK

O jeito recomendado de consumir e o pacote `@codeca/sdk`, documentado em
`packages/sdk/README.md`. Ele cuida do envelope da resposta, do prazo e dos
erros tipados -- e recusa uma chave secreta no navegador antes de ela chegar a
producao.

A secao abaixo descreve o HTTP por baixo dele, para quem precisar chamar
direto.

## 4. Chamando a API

```ts
const resposta = await fetch('https://app.codecabuild.com.br/api/v1/site', {
  headers: { authorization: `Bearer ${import.meta.env.VITE_CODECA_KEY}` },
});
const { data } = await resposta.json();
```

O site **nao** informa qual site ele e: isso vem da credencial. Nao ha
parametro de site para forjar.

### Rotas

| Rota | O que devolve |
| --- | --- |
| `GET /api/v1/site` | Identidade do site, modulos habilitados e escopos da chave |
| `GET /api/v1/content/institucional` | Documento institucional |
| `GET /api/v1/content/contato` | Documento de contato |
| `GET /api/v1/banners` | Banners ativos, ja filtrados pela janela de exibicao |
| `GET /api/v1/properties` | Imoveis publicados, com filtros e paginacao |
| `GET /api/v1/properties/:slug` | Um imovel, com galeria |
| `GET /api/v1/projects` | Obras publicadas |
| `GET /api/v1/projects/:slug` | Uma obra, com galeria |
| `GET /api/v1/services` | Servicos publicados |
| `GET /api/v1/products` | Produtos publicados, com filtros e paginacao |
| `GET /api/v1/products/:slug` | Um produto, com galeria |
| `GET /api/v1/categories` | Categorias de produto, para montar o menu |
| `GET /api/v1/galleries` | Galerias com capa e contagem |
| `GET /api/v1/galleries/:slug` | Uma galeria, com as imagens |
| `GET /api/v1/testimonials` | Depoimentos **autorizados pelo autor** |
| `GET /api/v1/team` | Equipe exibida no site |
| `GET /api/v1/faqs` | Perguntas frequentes publicadas |
| `POST /api/v1/leads` | Recebe o formulario de contato |

#### Produtos: preco, esgotado e galeria

Tres pontos que mudam o que o site deve desenhar:

- **`price` e `null` quando `priceOnRequest` e `true`.** O valor guardado nao
  viaja: a empresa pode ter informado um preco e depois decidido nao divulgar.
  O texto ("sob consulta", "a combinar") e escolha do projeto.
- **`isAvailable: false` e produto no ar, porem esgotado.** Ele continua na
  resposta de proposito -- despublicar faria o cliente recadastrar amanha.
  Riscar, esmaecer ou esconder e decisao de design; `?availableOnly=true`
  existe para quem prefere nao receber.
- **`gallery` vem vazia na listagem** e preenchida em
  `GET /api/v1/products/:slug`. Carregar as imagens de todos os produtos de
  uma pagina seria uma consulta por linha.

`category` vem embutida, com nome e slug, e nao como `categoryId`: o site quase
sempre exibe o grupo junto do item.

Filtro por categoria usa o **slug**, nao o id: `?category=pratos-principais`.

#### Galerias: a listagem e enxuta

`GET /api/v1/galleries` traz capa e `imageCount`, sem as imagens -- uma galeria
pode ter duzentas, e todas de todas numa resposta seria pesado dos dois lados.
`GET /api/v1/galleries/:slug` traz o conjunto completo, na ordem definida pelo
cliente. **A capa e a primeira imagem da ordem**; nao existe campo de capa
separado.

#### Depoimentos: a autorizacao e condicao de entrega

`GET /api/v1/testimonials` **nunca** devolve depoimento sem a confirmacao de
que o autor autorizou a publicacao -- nem com `preview=true`. Um depoimento e o
nome, a foto e as palavras de outra pessoa, e publicar sem autorizacao dela e
tratar dado pessoal de terceiro sem base legal.

A consequencia pratica para quem integra: **nao ha nada a conferir no site.**
A resposta nao traz `authorizationConfirmed` nem a nota de como a autorizacao
foi obtida -- essa nota pode conter telefone e data, e fica so no painel. O
que chega pode ser exibido.

Um modulo que o site nao tem responde **404**, nao 403: para quem le o site,
ele simplesmente nao existe. Dizer "proibido" revelaria que a rota existe em
outros sites.

### Filtros de imoveis

`purpose`, `type`, `city`, `neighborhood`, `minPrice`, `maxPrice`, `bedrooms`,
`featured`, `search`, `page`, `pageSize` (maximo 50).

A listagem traz apenas a **capa** de cada imovel. A galeria completa vem no
detalhe, por `slug` -- carregar dezenas de imagens que a listagem nao usa
seria desperdicio em toda abertura de pagina.

### Previa de rascunho

`?preview=true` inclui o que ainda nao foi publicado, e exige a chave
**secreta**. Pedir previa com a publicavel responde 403: seria conteudo nao
publicado chegando ao navegador de um visitante.

### Formulario de contato

`POST /api/v1/leads` e a **unica escrita** aceita com chave publicavel, porque
o formulario roda no navegador. A protecao vem da origem autorizada, do limite
por IP e de um campo-armadilha (`honeypot`): preenchido, a API responde sucesso
e nao grava nada -- responder erro ensinaria o robo a contorna-lo.

O consentimento (`consent: true`) e obrigatorio. O IP e guardado apenas como
hash. A resposta confirma o recebimento e **nao devolve o registro**: quem
envia nao consegue ler de volta.

Vinculos (`propertyId`, `projectId`, `serviceId`) sao conferidos contra o
proprio site; um id de outra empresa simplesmente nao cola.

### Preflight

O navegador envia um `OPTIONS` **sem** o cabecalho de autorizacao. A API
responde a ele de forma permissiva, e isso nao abre nada: a requisicao real
que vem depois passa pela conferencia completa, e sem ela o navegador nao
entrega resposta nenhuma a pagina.

---

## 5. Limites

600 requisicoes por minuto por chave. Um site carrega varias chamadas de uma
vez; o limite existe contra abuso, nao contra uso normal. Estourado, a API
responde `429` com `retry-after`.

---

## 6. Aviso de publicacao (opcional)

**Pule esta secao se o site busca o conteudo a cada visita.** Um site Vite ja
mostra a alteracao do cliente sozinho, e cadastrar um aviso nao acrescenta
nada.

Vale a pena quando o site renderiza no servidor e guarda cache -- Next com
ISR, por exemplo. Sem aviso, o site so descobre a mudanca quando o cache
expira.

Cadastre o endereco em `/plataforma/sites`, aba **Avisos de publicacao**. A
plataforma passa a enviar um `POST` assinado a cada publicacao.

```ts
// app/api/revalidar/route.ts
import { revalidatePath } from 'next/cache';
import { verifyWebhook, CODECA_SIGNATURE_HEADER } from '@codeca/sdk/server';

export async function POST(request: Request) {
  // O corpo cru, nao o objeto convertido: reserializar muda espacamento e
  // ordem das chaves, e a assinatura deixa de conferir.
  const corpo = await request.text();

  try {
    const evento = await verifyWebhook({
      rawBody: corpo,
      signature: request.headers.get(CODECA_SIGNATURE_HEADER),
      secret: process.env.CODECA_WEBHOOK_SECRET!,
    });

    if (evento.moduleKey === 'imoveis' && evento.slug) {
      revalidatePath(`/imoveis/${evento.slug}`);
    }
    revalidatePath('/');

    return Response.json({ ok: true });
  } catch {
    // Responder 200 a uma requisicao nao assinada deixaria qualquer um na
    // internet invalidar o cache do site a vontade.
    return new Response('assinatura invalida', { status: 401 });
  }
}
```

O corpo traz **o que mudou, nao o conteudo**:

| Campo | O que e |
| --- | --- |
| `moduleKey` | modulo afetado (`imoveis`, `contato`, ...) |
| `action` | `created`, `updated` ou `removed` |
| `entityId` | registro afetado, ou `null` em documento |
| `slug` | endereco na URL, para invalidar a pagina certa |
| `publishedAt` | instante da publicacao, em ISO 8601 |

Busque o conteudo pela API depois do aviso, com a sua credencial. O webhook
diz **que** mudou; a API diz **o que** e agora.

Tres coisas que valem saber:

- **Rascunho nao avisa.** O aviso sai quando o registro esta publicado antes
  ou depois da alteracao. Remover um registro publicado avisa, com
  `action: 'removed'`.
- **A primeira tentativa e imediata**; o que falha e repetido pelo job diario,
  ate cinco tentativas. Um 4xx da sua rota (fora de 408 e 429) nao e
  repetido: a plataforma entende que o endereco esta errado ou a assinatura
  foi recusada.
- **O segredo aparece uma vez.** Guarde na variavel de ambiente do projeto.
  Quem perder rotaciona -- e a rotacao nao tem janela de sobreposicao, entao
  combine a troca.

---

## 7. Quando a assinatura nao esta em dia

O que acontece depende do plano do site, nao da API. O padrao da plataforma e
**continuar respondendo**: o visitante nao percebe nada e nenhum dado e
apagado, em nenhum plano.

| Politica do plano | O que o site recebe |
| --- | --- |
| servir (padrao) | nada muda |
| servir com aviso | responde normal, e `getSite().notice` traz uma frase pronta para exibir |
| parar de responder | **402 `subscription_required`** nas rotas de conteudo |

O 402 nao e erro do seu codigo: a credencial esta correta e repetir nao
resolve. Por isso o SDK o separa de `isAuthError` -- veja `isSuspended` no
README do pacote. O conteudo continua guardado e volta sozinho, entao o site
faz melhor servindo o que tem em cache do que uma pagina de erro.

Durante o periodo de tolerancia nada disso vale: a API responde normal.

---

## 8. Rotacao

Rotacionar emite uma chave nova e marca a anterior para expirar depois de uma
janela (padrao: 60 minutos).

A sobreposicao existe porque o site do cliente nao troca a credencial no mesmo
instante: revogar na hora derrubaria o site ate alguem publicar o valor novo.
Publique a chave nova no site dentro da janela.

Se uma chave vazou, nao rotacione -- **revogue**. A revogacao vale na hora,
sem janela.

---

## 9. Checklist de um site novo

Tudo abaixo acontece em **`/plataforma/sites`**, na configuracao do projeto.

1. Cadastrar o site no painel mestre (ja acontece com a empresa).
2. Aba **Modulos e campos**: habilitar o que o cliente enxerga e marcar o que
   ele pode editar.
3. Aba **Origens**: cadastrar producao e, se usar, a previa da Vercel.
4. Aba **Chaves**: emitir a chave publicavel e copiar para o codigo do site.
5. Na mesma aba, emitir a chave secreta **apenas se** o site tiver servidor
   proprio -- ela aparece uma unica vez.
6. Conferir `GET /api/v1/site` a partir do site.
7. Aba **Avisos de publicacao**: cadastrar o endereco de revalidacao
   **apenas se** o site renderiza no servidor com cache (secao 6).
8. Aba **Identidade**: trocar a situacao de `draft` para `active`.
