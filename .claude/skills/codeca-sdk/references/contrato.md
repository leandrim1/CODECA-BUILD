# Contrato do @codeca/sdk, por inteiro

Leia este arquivo quando precisar de um filtro, do formato exato de uma
resposta ou de um campo que o SKILL.md não cita. O SKILL.md tem o caminho
comum; aqui está a superfície toda.

## Índice

1. Recursos e formatos de resposta
2. Filtros por recurso
3. Campos que merecem atenção
4. Limites conhecidos da plataforma
5. Erros

---

## 1. Recursos e formatos de resposta

Três formatos diferentes, e a diferença importa porque o código muda:

**Página** (`{ items, page, pageSize, total, totalPages }`):
`properties.list`, `projects.list`, `services.list`, `products.list`,
`galleries.list`, `testimonials.list`, `team.list`, `faqs.list`,
`custom(chave).list`.

**Array direto**: `banners.list`, `categories.list`.

**Objeto único**: `site.get`, `institutional.get`, `contact.get`,
`properties.get`, `projects.get`, `products.get`, `galleries.get`,
`custom(chave).get`.

```ts
const { items, totalPages } = await codeca.properties.list({ page: 2 });
const banners = await codeca.banners.list();      // array, sem .items
const categorias = await codeca.categories.list(); // array, sem .items
```

`custom(chave).list()` devolve a página **mais** `module: { key, name, kind }`.

### Obras e projetos

Módulo próprio, fácil de esquecer porque o nome no painel é "Obras e
projetos":

```ts
await codeca.projects.list({ status: 'em_andamento', city: 'Campinas' });
await codeca.projects.get('edificio-horizonte');
```

### Módulos criados para o projeto

```ts
const { items, module } = await codeca.custom('cardapio').list();
const registro = await codeca.custom('cardapio').get('lasanha');
```

Num módulo de tipo `document` o registro único vem na `list()` e **não tem
endereço próprio** — `get(slug)` não se aplica (`slug` vem vazio).
`site.get().customModules` diz o `kind` de cada um.

**A forma de um registro é fixa; o conteúdo dele, não:**

```ts
interface PublicCustomRecord {
  id: string;
  title: string;         // sempre existe, e é o rótulo do registro
  slug: string;          // vazio num módulo `document`
  data: Record<string, unknown>;   // os campos do projeto, sem tipo possível
  featured: boolean;
  sortOrder: number;
  publishedAt: string | null;
}
```

Só `title` é texto garantido. Tudo que a CODECA IA definiu para o projeto —
preço, descrição, imagem — está em `data`, com chaves que **só existem naquele
site**. Não há `image` nem `coverImage` prontos: se o módulo tem imagem, ela é
uma chave de `data` e, sendo documento de projeto, pode não trazer URL.

```ts
const { items } = await codeca.custom('cardapio').list();
const preco = items[0]?.data.preco;
if (typeof preco === 'number') { /* usar */ }
```

Descubra as chaves com quem configurou o projeto no painel mestre, ou lendo um
registro real — não as adivinhe, e não escreva leitura defensiva aceitando
três nomes possíveis: isso esconde o erro em vez de resolvê-lo.

---

## 2. Filtros por recurso

Todos aceitam `page`, `pageSize` e `preview`.

| Recurso | Filtros próprios |
| --- | --- |
| `properties` | `purpose`, `type`, `city`, `neighborhood`, `minPrice`, `maxPrice`, `bedrooms`, `featured`, `search` |
| `projects` | `status`, `category`, `city`, `featured`, `search` |
| `products` | `category` (slug, como vem de `categories.list()`), `availableOnly`, `search` |
| os demais | só os três comuns |

**`preview: true` exige a chave secreta.** Ele inclui rascunhos, e a API
recusa o parâmetro vindo da publicável. Use só em código de servidor — numa
página de pré-visualização, por exemplo.

**`pageSize` vai de 1 a 50, e o padrão é 12.** Pedir 100 é recusado pela
validação, não truncado — não dá para "buscar tudo de uma vez" para montar um
filtro de cidades.

**`minPrice` e `maxPrice` são em reais, e inclusivos** (o preço é
`NUMERIC(14,2)` no banco, nunca centavos). Imóvel com `price: null` — sem
preço publicado ou `priceOnRequest` — **não entra** num intervalo de preço.

**Não há ordenação configurável.** A ordem é fixa: destaque primeiro, depois a
ordem definida no painel, depois a data de publicação. Não existe `sort` nem
`orderBy`.

**Não há endpoint de cidades nem de facetas.** Para um filtro de cidade, a
opção honesta é um campo de texto livre (ou `datalist`) em vez de um `select`
que esconderia o que não está na amostra.

---

## 3. Campos que merecem atenção

### Os nomes dos campos, que não se adivinham

Três enganos que um teste real cometeu, e que o compilador só pega depois de o
SDK estar instalado:

| Adivinhação comum | O nome de verdade |
| --- | --- |
| `image` | **`cover`** (`PublicImage \| null`) |
| `images` | **`gallery`** (`PublicImage[]`) |
| `city`, `neighborhood` no topo | **`address.city`**, `address.neighborhood` |

Um imóvel (`PublicProperty`) tem, entre outros: `id`, `slug`, `title`,
`reference`, `description`, `shortDescription`, `type`, `purpose`, `price`,
`priceOnRequest`, `condoFee`, `iptu`, `currency`, `address` (objeto com
`street`, `number`, `complement`, `neighborhood`, `city`, `state`,
`postalCode`), `builtAreaM2`, `landAreaM2`, `bedrooms`, `suites`, `bathrooms`,
`parkingSpots`, `floor`, `features`, `cover`, `gallery`, `commercialStatus`,
`featured`, `deliveryDate`, `videoUrl`, `seo`, `publishedAt`, `customFields`.

Obra, serviço, produto, galeria, depoimento e integrante seguem o mesmo
desenho: `cover`/`gallery` para imagem, `customFields` no fim. Quando precisar
do nome exato de um campo, leia `packages/sdk/src/types.ts` — é o contrato, e
está a um `grep` de distância. **Não escreva leitura defensiva aceitando dois
nomes possíveis:** isso troca um erro de compilação por um campo vazio em
produção.

**`PublicImage`** traz `url`, `alt`, `width` e `height` — pronto para
`next/image` sem medir nada.

**`site.get()`** devolve mais do que identidade:

```ts
const info = await codeca.site.get();
info.site.segment       // texto livre, pode ser null
info.modules            // os módulos da plataforma habilitados
info.customModules      // os criados para este projeto
info.scopes             // o que esta credencial alcança
info.notice             // aviso pronto para exibir, ou null
```

`notice` vem preenchido quando o plano do site pede aviso durante uma
pendência de assinatura. O texto já chega pronto: não descreve a pendência nem
cita valores, então pode ir para a tela como veio.

**Produto**: `price` é `null` quando não há preço publicado ou quando
`priceOnRequest` está ligado — o texto ("sob consulta") é escolha do projeto.
`isAvailable` falso é produto no ar porém esgotado: riscar, esmaecer ou
esconder também é decisão do projeto.

**Galeria**: `galleries.list()` traz capa e contagem; as imagens vêm em
`galleries.get(slug)`.

**Depoimentos**: a plataforma nunca devolve um sem autorização do autor, nem
em prévia. Não há sinalizador a conferir — o que chega pode ir para a tela.

**`customFields`** existe nos itens de coleção (imóveis, obras, serviços,
produtos, equipe, depoimentos). É `Record<string, unknown>`: confira o tipo
antes de usar.

**Contato**: `social` é um mapa parcial por rede — trate chave ausente como
não informada.

---

## 4. Limites conhecidos da plataforma

Dois, verificados no código da API. Não desenhe um site em cima deles.

**IDs de imagem do institucional não se resolvem.** `logoImageId`,
`coverImageId` e `galleryImageIds` chegam como IDs, e a API pública **não tem
endpoint de mídia**. Os módulos de coleção resolvem a imagem no servidor e
devolvem `PublicImage` com URL; os documentos (institucional e contato) não.
Para logotipo e imagens de capa do site, use um asset do próprio projeto ou um
banner.

**Campos personalizados de documento não chegam ao site.** O painel permite
definir campo personalizado no institucional e no contato, mas
`/content/:moduleKey` devolve só `data` e `updatedAt`. Campos personalizados
só são legíveis nos módulos de coleção.

---

## 5. Erros

`CodecaError` com `code`, `status` e estes sinalizadores:

| Sinalizador | Status | O que fazer |
| --- | --- | --- |
| `isNotFound` | 404 | página 404 |
| `isNetworkError` | 0 | a plataforma não respondeu — vale repetir |
| `isRateLimited` | 429 | esperar |
| `isSuspended` | 402 | pendência da assinatura: mostrar cache, não erro |
| `isAuthError` | 401/403 | credencial ou origem — repetir não resolve |

O prazo padrão é de dez segundos, ajustável em `timeoutMs`. Sem prazo, uma
plataforma lenta travaria a renderização até o navegador desistir sozinho.
