# Importação automática de sites

O cliente informa o endereço do site que já tem, a plataforma analisa as páginas
públicas, organiza o que encontrar nos módulos do painel e espera a confirmação
antes de gravar qualquer coisa.

Este documento descreve **o que funciona, o que não funciona e por quê**. A
seção "Limitações" não é uma lista de desculpas: é o contrato honesto do que a
funcionalidade entrega.

---

## 1. O fluxo

```
cliente informa a URL
  → validação do endereço (forma + IP)
  → rastreamento das páginas, em fatias
  → identificação dos conteúdos
  → REVISÃO (nada foi gravado ainda)
  → confirmação
  → gravação como rascunho
  → (opcional) desfazer
```

Rotas, todas sob `/api/tenants/:tenantId/`:

| Método e rota | O que faz |
|---|---|
| `POST /site-import` | Valida o endereço e abre a análise. |
| `GET /site-import/:id` | Devolve o estado **e avança a análise um pedaço**. |
| `GET /site-import` | Análise mais recente, histórico e limites. |
| `PATCH /site-import/:id/revisao` | Grava o que o cliente marcou/desmarcou. |
| `POST /site-import/:id/confirmar` | Grava o conteúdo selecionado. |
| `POST /site-import/:id/desfazer` | Reverte uma importação concluída. |
| `POST /site-import/:id/cancelar` | Descarta uma análise em andamento ou em revisão. |

Permissões: `content:write` para analisar, revisar e importar; `content:delete`
para desfazer; `content:read` para acompanhar. Um `viewer` vê o progresso mas
não o empurra e não importa nada.

### Por que a consulta de estado avança o trabalho

A função da Vercel para em **60 s** (`maxDuration` em `vercel.json`) e o plano
permite **um** cron diário, já usado pela reconciliação de cobrança. Não existe
fila na plataforma.

Em vez de introduzir infraestrutura, a análise avança em **fatias** dentro da
requisição que o painel já faria para desenhar a barra de progresso. Cada
consulta lê algumas páginas dentro de um orçamento de ~15 s, grava onde parou
(`site_imports.cursor`) e responde. A fila mora no banco, então uma análise
interrompida — função reiniciada, aba fechada — continua de onde parou na
chamada seguinte, mesmo em outra instância.

---

## 2. Segurança

### Duas barreiras contra SSRF

A primeira olha a **forma** do endereço e roda nos dois lados
(`checkImportUrl`, em `@codeca/shared`): recusa protocolo que não seja
http/https, credenciais embutidas, porta fora de 80/443, `localhost`, sufixos
internos (`.local`, `.internal`), IP privado literal (RFC 1918, loopback,
link-local, CGNAT, multicast) e os endereços de metadados das nuvens.

A segunda confere o **IP de destino** (`apps/api/src/lib/import/fetcher.ts`):
resolve o nome, recusa se **qualquer** registro apontar para rede não roteável,
e então conecta **naquele IP** usando a opção `lookup` do `node:https`.

A segunda não é redundante — é o que pega `interno.exemplo.com` apontando para
`10.0.0.5`. E a conexão pelo IP já validado é o que fecha a janela de DNS
rebinding: validar e depois chamar `fetch(hostname)` deixaria o DNS responder
outra coisa entre a conferência e a conexão. O nome continua indo no SNI e no
cabeçalho `Host`, então hospedagem compartilhada e certificado funcionam.

**Cada salto de redirecionamento passa pelas duas barreiras de novo.** Um site
que responde `302` para `http://169.254.169.254/` é exatamente o ataque que
isso impede.

Prova disso em `tests/unit/import-fetcher.test.ts`: um servidor HTTP real
escutando em `127.0.0.1`, que responde 200 a um `fetch` comum, é recusado pela
busca da importação.

#### O contrato do `lookup`, e o defeito que ele escondeu

A opção `lookup` tem uma armadilha que custou a funcionalidade inteira em
produção. O Node chama essa função com `options.all`, e **o formato da
resposta muda conforme esse sinalizador**: com `all: false` espera
`(erro, endereço, família)`; com `all: true` espera
`(erro, [{ address, family }])`. Desde o Node 20 o `autoSelectFamily` (Happy
Eyeballs) vem ligado por padrão, e com ele a conexão sempre pede `all: true`.

A primeira versão respondia sempre no formato de endereço solto. O resultado
não era um erro de rede: o soquete morria com `ERR_INVALID_IP_ADDRESS` antes
de qualquer pacote sair, e a mensagem que chegava ao cliente era o genérico
"Não foi possível acessar o site". **Nenhum site era lido**, nem na
importação nem na sincronização — e o painel mostrava "0 páginas, 1 com
problema" para sites que estavam perfeitamente no ar.

Nada disso aparecia nos testes, e a razão importa mais que o defeito: os
testes de ponta a ponta usam `createMemorySiteFetcher`, que não toca a rede,
e os testes de barreira recusam o endereço **antes** de conectar. O caminho
de conexão real não tinha teste nenhum. Hoje tem: `addressLookup` responde
nos dois formatos, e três testes cobrem o contrato — incluindo uma requisição
de verdade a um servidor local, que só chega se a conexão acontecer.

A correção trouxe junto uma robustez que faltava: a conexão agora recebe
**todos** os endereços validados, não só o primeiro. Um nome com dois
registros A deixa de depender da sorte da ordem do DNS, e a barreira continua
igual — a conexão só alcança endereços que nós aprovamos.

#### Texto que ninguém vê não é conteúdo

Assim que a busca voltou a funcionar, um segundo defeito ficou visível: o
extrator lia texto escondido como se fosse conteúdo do site.

Ao ler `codecabuild.vercel.app`, o único `<h1>` do HTML servido era **"Não
foi possível carregar o painel"** — a mensagem de falha do carregamento, que
fica dentro de um `display:none` e só aparece quando o bundle não executa. A
importação proporia essa frase como texto institucional da empresa.

Não é um caso isolado: página moderna carrega aviso de cookie, modal fechado
e aba inativa no HTML, tudo escondido. Importar isso é pior do que não
importar nada, porque entra no painel do cliente parecendo conteúdo dele.

Agora `textOf`, os blocos, os títulos, os parágrafos e as imagens pulam
elemento (e subárvore) marcado com o atributo `hidden`, `display:none` ou
`visibility:hidden`.

O que **não** é adivinhado: nome de classe. Não há folha de estilo aqui, e
chutar por classe erraria feio — em Tailwind, `hidden md:block` quer dizer
*visível no computador*, e pular esse texto perderia conteúdo de verdade. Só
vale o que o próprio elemento declara.

### SVG é limpo, não recusado

Um JPEG é um retângulo de pixels. Um **SVG é um documento que o navegador
executa**: pode conter `<script>`, `onload`, `<foreignObject>` com HTML
dentro e referências externas. Servir um de origem desconhecida a partir do
domínio do cliente é publicar código de terceiro com a confiança do domínio
dele — um XSS armazenado.

Até aqui a importação recusava todos. Era seguro, e custava caro no caso mais
comum e mais inocente: **o logotipo**, que boa parte dos sites tem em SVG e é
justamente a imagem que o cliente mais quer trazer.

Agora o arquivo passa por `sanitizeSvg`, que reconstrói o documento por
**lista de permissão**: cada tag e cada atributo são copiados do zero, e o que
não estiver explicitamente autorizado não chega à saída. Lista de bloqueio
seria o caminho errado — bastaria um elemento novo no padrão para reabrir o
buraco.

O que sai: `script`, `foreignObject`, `animate`, `set`, `handler`, qualquer
atributo `on*`, `javascript:`, `data:text/html`, `DOCTYPE` (que pode declarar
entidades) e qualquer `url(...)` que não aponte para dentro do próprio
arquivo — um `fill="url(https://…)"` faria o navegador de cada visitante
buscar um recurso de fora, entregando o IP dele a um terceiro.

O que fica: o desenho. E com a **grafia exata** que o SVG exige: XML é
sensível a maiúsculas, e um `viewbox` minúsculo faria a imagem perder o
viewport e renderizar no tamanho errado.

Quando a limpeza não deixa desenho nenhum, volta a recusa com o pedido de
envio manual — melhor nenhuma imagem do que uma imagem que executa.

Medido no logotipo real de `codecaia.vercel.app`: passa inteiro, **nada
removido**. Era seguro desde sempre; só estava sendo recusado por categoria.

### Outras proteções

- **Nenhum script do site é executado.** O leitor de HTML
  (`packages/shared/src/import/html.ts`) é um tokenizador: lê texto, devolve
  texto. Dentro de `<script>` e `<style>` o conteúdo é tratado como texto bruto
  e nunca como estrutura.
- **Nenhum conteúdo do site vira instrução.** Não há passo de IA no caminho; o
  conteúdo lido é tratado como dado em todas as camadas.
- **Imagem é decidida pelos bytes**, não pelo `content-type` do servidor de
  origem. Arquivo que se diz PNG mas não é, é recusado.
- **SVG não é importado**, mesmo sendo aceito no upload pelo painel: é
  documento, carrega `<script>` e referência externa, e aqui vem de um site que
  ninguém conferiu. O cliente continua podendo enviar o SVG dele pela
  Biblioteca de imagens.
- **Nenhuma credencial é guardada.** A trilha de auditoria registra só o
  endereço, os números e quem agiu — nunca conteúdo do site analisado.
- **Limites**: 25 páginas, profundidade 2, 40 imagens, 2 MB por página, 4 MB
  por imagem, 10 s por requisição, 3 redirecionamentos, 3 páginas em paralelo.
  Duas cotas de uso: 10 análises/hora por empresa e 20/hora por IP.

### Isolamento entre clientes

Igual ao resto da plataforma, sem exceção:

- `tenant_id` e `site_id` vêm **sempre** da sessão, nunca do corpo ou da URL.
- Chave estrangeira composta `(site_id, tenant_id) → sites(id, tenant_id)` nas
  duas tabelas novas: o banco impede uma linha de análise de uma empresa
  apontar para o site de outra.
- Análise de outra empresa responde **404**, não 403 — 403 confirmaria que ela
  existe.
- Imagens vão para `tenants/<tenantId>/` no Blob, como qualquer upload.

---

## 3. O que a análise consegue identificar

Fontes, em ordem de confiança:

1. **JSON-LD (Schema.org)** — o site declarou os dados. `Organization`,
   `LocalBusiness`, `Dentist`, `Store`, `Service`, `Product`, `FAQPage`,
   `Review`, `Person`, `Apartment`, `RealEstateListing` e afins.
2. **Open Graph e meta tags** — nome do site, descrição, imagem de destaque.
3. **Estrutura do HTML** — cabeçalho e o texto sob ele, listas, `<details>`,
   `<blockquote>` com autor, `<figure>`/`<figcaption>`, `srcset`.
4. **Texto visível** — telefone, e-mail, CEP, cidade/UF, logradouro, horário.

Destino por módulo:

| Módulo | De onde sai |
|---|---|
| Institucional | Nome (JSON-LD → `og:site_name` → título), `h1` da inicial, meta description, seções "História"/"Missão"/"Visão"/"Valores", ano de fundação, logotipo |
| Contato | JSON-LD `PostalAddress`, links `mailto:`/`tel:`/`wa.me`, rodapé, iframe do Google Maps, links de redes sociais |
| Banners | Imagens de abertura (classe/caminho com `hero`, `banner`, `slide`) e `og:image` |
| Serviços | `Service` do Schema.org; blocos da página de serviços; seção de serviços da inicial |
| Produtos | `Product` do Schema.org (com preço e SKU); blocos da página de produtos |
| Imóveis | **Só** com dado estruturado que declare tipo e finalidade |
| Obras e projetos | Blocos da página de portfólio **cuja categoria o texto declara** |
| Galerias | Páginas de galeria com 2+ imagens |
| Depoimentos | `Review` do Schema.org, `<blockquote>` com `<cite>`, blocos com classe `testimonial`/`depoimento` |
| Equipe | `Person` do Schema.org, cartões com foto + nome + cargo |
| Perguntas frequentes | `FAQPage` do Schema.org e `<details>`/`<summary>` |
| Biblioteca de imagens | Todas as imagens de conteúdo (ícones ficam de fora) |

O sitemap (`/robots.txt`, `/sitemap.xml`, `/sitemap_index.xml`) é usado para
descobrir páginas; as páginas de maior valor (sobre, serviços, contato) têm
prioridade na fila, para o limite de 25 páginas não ser gasto com notícias.

---

## 4. As regras que não se dobram

### Nada é inventado

Cada candidato guarda a **página e o sinal** que o produziram
(`site_import_items.evidence`), e a tela de revisão mostra o link "ver no site
atual". O que não dá para atribuir com segurança **não vira candidato** e
aparece na contagem de "texto não identificado".

Consequências concretas e deliberadas:

- **Preço só de dado estruturado.** "a partir de R$ 90" num parágrafo não vira
  preço de produto.
- **Imóvel só com tipo e finalidade declarados.** "Apartamento Jardins" não diz
  se está à venda ou para alugar; pôr na aba errada é pior que não importar.
- **Obra só com categoria no texto.** O campo é obrigatório e sem padrão;
  escolher "residencial" por nós poria a carteira inteira na categoria errada.
- **Ano de fundação só da inicial ou da página Sobre**, e só com a frase que
  afirma ("desde 1998", "fundada em 2005"). "Atende desde 2005" numa bio de
  profissional não é a fundação da empresa.
- **Depoimento só com autor.** Texto elogioso sem assinatura não vira
  depoimento.

### Depoimento entra sem autorização confirmada

Sempre. O campo `authorizationConfirmed` declara que a empresa tem permissão da
pessoa citada. Estar publicado no site antigo não é essa permissão, e marcar
sozinho seria assinar no lugar da empresa sobre a fala e o nome de um terceiro.
O servidor não publica depoimento sem essa marca, então o registro entra
guardado.

### Nada é substituído sem autorização

Campo que já tem conteúdo vira **conflito**: chega desmarcado, com o valor
atual ao lado do encontrado e os botões "Manter o atual" / "Substituir pelo
encontrado". O padrão é manter.

Importação é **parcial por natureza**: no mesmo módulo, campos vazios são
preenchidos e campos preenchidos são preservados.

### Tudo entra como rascunho

`publicationStatus: 'draft'` em todo módulo que tem publicação; banners entram
com `isActive: false`. Nada aparece no site do cliente antes de ele abrir,
conferir e publicar.

### Tudo pode ser desfeito

`site_import_items` guarda o valor anterior de cada campo e o identificador de
cada registro criado. Desfazer apaga os registros e devolve os campos.

Uma ressalva que a tela avisa antes de confirmar: a reversão devolve o valor do
**momento da gravação**. Se o cliente editou aquele campo depois da importação,
a edição também é desfeita. As imagens **não** são apagadas — podem já estar em
uso em outro lugar.

### Nenhuma estrutura paralela

O conteúdo importado vai para as tabelas que o painel já usa
(`content_documents`, `services`, `faqs`, `testimonials`, `team_members`,
`banners`, `galleries`, `products`, `projects`, `properties`, `media_assets`) e
passa pelos **mesmos** schemas Zod, pelo mesmo gerador de slug único, pelo
mesmo limite de conteúdo do plano e pela mesma política de campos por site.

As duas tabelas novas (`site_imports`, `site_import_items`) registram a
**operação**, não o conteúdo. Nada nelas é lido pela API pública nem pelo site
do cliente.

---

## 4b. Sites que montam o conteúdo no navegador

A análise tenta três estratégias, da mais segura para a menos:

| | Estratégia | Executa script? | Resolve |
|---|---|---|---|
| 1 | HTTP + leitura das tags | não | HTML tradicional, WordPress, Wix |
| 2 | Estado serializado no próprio HTML | não | Next.js, Nuxt, Apollo/Redux, RSC |
| 3 | Navegador headless | **sim** | o resto |

A segunda é a que mais rende sem custo: frameworks serializam os dados da
página dentro do HTML para o buscador indexar, e ler esse bloco é análise de
JSON como texto — nunca avaliação. Medido numa casca Next típica: 4 frases e 2
imagens onde antes vinha zero, com `buildId` e `chunkHash` descartados.

Confirmado contra servidores HTTP reais em
`tests/integration/import-tecnologias-real.test.ts`: Next.js, Vite+React e
Nuxt+Vue chegam ao conteúdo pela estratégia 2 (`fromEmbeddedState`), WordPress e
Angular pela 1, e **nenhuma das cinco precisou de navegador**.

> **Corrigido aqui:** uma página lida pelo estado serializado reportava
> `textLength: 0`, porque o número contava só o texto do DOM. Isso não era
> cosmético: o rastreador usa `textLength` para decidir se vale abrir o
> navegador, e zero numa página que rendeu conteúdo mandava executar o
> JavaScript de terceiro sem necessidade — justamente o que a estratégia 2
> existe para evitar.

### O navegador, e por que ele é opcional

A seção 2 do pedido quer Playwright; a seção 9 proíbe executar scripts do site
analisado. As duas não valem juntas — renderizar é executar. A saída foi deixar
o navegador **desligado por padrão** e ligá-lo por configuração explícita, de
modo que quem o liga está aceitando conscientemente rodar código de terceiros.

| Variável | Valores |
|---|---|
| `IMPORT_RENDER_MODE` | `nenhum` (padrão), `remoto`, `local` |
| `IMPORT_RENDER_URL` | endpoint do serviço, no modo `remoto` |
| `IMPORT_RENDER_SECRET` | enviado em `Authorization: Bearer` |
| `IMPORT_RENDER_MODULE` | pacote a carregar no modo `local` (padrão `playwright`) |

**O Chromium não entra no pacote da função da Vercel.** O pacote tem teto de
tamanho, e somar um navegador arrisca estourá-lo e derrubar o deploy do site
inteiro. Por isso:

- `remoto` chama um serviço próprio por HTTP. Zero peso no pacote. É o caminho
  na Vercel. O contrato é mínimo: entra `{ url }`, sai `{ html }`.
- `local` usa Playwright no processo, por `import()` dinâmico com o nome do
  módulo em variável — nem o compilador nem o empacotador o resolvem, então ele
  só é procurado onde existir. Serve para self-hosted e desenvolvimento.

Limite de `maxRenderedPages` (8) por análise, e a renderização só substitui a
leitura simples **quando rende mais**: um navegador que devolve a mesma casca
vazia não pode piorar o que já havia.

Medido contra `codecaia.vercel.app`, com navegador real: HTML de 2.741 para
70.658 bytes, texto visível de 0 para 6.612 caracteres, 23 títulos e 34
parágrafos onde antes não havia nenhum.

### Segmento sugerido, nunca aplicado

A análise estima o ramo da empresa a partir dos dados estruturados (peso
maior), das palavras do título e dos cabeçalhos, e dos papéis das páginas. A
confiança sai da **distância para o segundo colocado**, não do total de
pontos: um site com muitos pontos em dois ramos é um site ambíguo, e dizer
"alta confiança" ali configuraria o painel errado.

O palpite nunca é aplicado sozinho — trocar o segmento muda os módulos que o
painel abre, e essa decisão é de quem conhece o negócio.

---

## 5. Limitações conhecidas

Estas são reais e testadas, não hipóteses.

### Site que monta o conteúdo no navegador

A análise **não executa JavaScript**. Um site React/Vue/Angular sem renderização
no servidor entrega uma casca (`<div id="root">`) e o conteúdo entra depois.

O que ainda é aproveitado: `<title>`, meta description, Open Graph, JSON-LD e
`<noscript>` — que é onde muitos desses sites publicam os dados da empresa.

Quando a maioria das páginas lidas vem sem texto, a análise marca
`likelyClientRendered` e a tela avisa explicitamente, em vez de entregar uma
importação vazia sem explicação.

**Por que não usamos um navegador automatizado:** o backend roda em função
serverless na Vercel, com 60 s de limite e restrição de tamanho do pacote. Um
Chromium não cabe ali. Suportar isso exigiria um serviço separado — decisão de
infraestrutura e custo, fora do escopo desta entrega.

### Outras

- **Login.** Só conteúdo público é lido. Página atrás de senha não é acessada.
- **Bloqueio pelo site.** Se o site responde 403 a clientes automatizados
  (Cloudflare, WAF), a análise registra a falha por página e segue.
- **SVG** não é importado (ver Segurança).
- **AVIF**: o arquivo é importado, mas largura e altura não são lidas — exigiria
  um leitor de ISOBMFF, e a dimensão é opcional.
- **Sem redimensionamento.** O arquivo vai para o Blob exatamente como estava no
  site, preservando a qualidade original. Do `srcset` escolhemos a maior
  largura declarada.
- **Deduplicação de imagem** é por conteúdo (SHA-256), dentro da análise e entre
  análises da mesma empresa. Uma imagem enviada manualmente antes pelo painel
  não é reconhecida como duplicata.
- **Categorias** (o módulo) não recebe importação: nada no HTML de um site
  comum identifica uma taxonomia com segurança.
- **Limite do plano.** A importação usa o mesmo `assertContentLimit` do painel.
  No plano inicial (5 conteúdos), um site com mais conteúdo que isso importa
  parcialmente, e os itens que não couberam falham com a mensagem do plano.

---

## 6. Testes

| Arquivo | O que prova |
|---|---|
| `tests/unit/import-fetcher.test.ts` | Um servidor real em `127.0.0.1` é recusado; metadados de nuvem, IP privado, protocolo, porta e credenciais recusados; redirecionamento revalidado; tipo de imagem pelos bytes; dimensão real |
| `tests/unit/import-extract.test.ts` | Tokenizador (script não vira estrutura, HTML quebrado, entidades); telefone/e-mail/CEP/cidade/endereço/horário, com os falsos positivos recusados (CNPJ, CEP e valor não viram telefone); classificação de página; sitemap; mapeamento por segmento (clínica, loja, prestador, imobiliária, construtora, uma página, SPA, formatos de imagem) |
| `tests/integration/site-import.test.ts` | Fluxo completo sobre PostgreSQL real: análise em fatias, resumo com números reais, gravação campo a campo no módulo certo, rascunho, conflito preservado e substituído sob autorização, reversão, limite do plano, módulo não habilitado, imagem indisponível, arquivo que não é imagem, SPA sinalizado, isolamento entre empresas, auditoria |
| `tests/integration/import-http-real.test.ts` | **Conexão de verdade**: soquete, corpo em pedaços sem `content-length`, latin-1, 404, requisição condicional e 304, redirecionamento seguido e revalidado a cada salto, prazo, `content-length` acima do limite, corte no limite, tipo recusado, imagem como bytes |
| `tests/integration/import-tecnologias-real.test.ts` | O fluxo inteiro sobre HTTP real, cinco tecnologias (WordPress, Next.js, Vite+React, Nuxt+Vue, Angular), site que não responde, e a sincronização detectando uma mudança feita no servidor |

### Por que existem testes sobre HTTP real

Até aqui, **toda** a suíte de importação falava com `createMemorySiteFetcher`,
que substitui a rede. Isso cobre rastreamento, extração e gravação — e deixa
sem cobertura exatamente a camada que abre conexão. Foi ali que morou o defeito
que manteve a importação inoperante em produção: `addressLookup` respondia ao
`options.lookup` do Node na forma errada, nenhum teste chegava a abrir um
soquete, e 1.400 testes passavam com o recurso principal do produto quebrado.

`createSiteFetcher({ testOrigins })` recebe um **mapa fechado** `host da URL →
ip:porta`, como um arquivo de hosts, e só para teste:

- quem não está no mapa — inclusive o destino de um redirecionamento vindo de
  quem está — continua passando pelas duas barreiras. É por isso que existe um
  teste provando, **sobre HTTP real**, que um site que responde `302` para
  `169.254.169.254` é recusado;
- `NODE_ENV=production` descarta o mapa, mesmo se alguém o preencher;
- um teste percorre `apps/` e falha se qualquer arquivo da aplicação passar a
  opção.

Mapear o **nome** (e não apenas dispensar o endereço) é o que permite exercitar
o caminho completo: `http://clinicasorriso.test/` passa pela validação da rota
como um endereço público qualquer, e só no fetcher vira `127.0.0.1:41234`. O
cabeçalho `Host` continua levando o nome original.

### Custo conhecido: a barra no fim do endereço

`canonicalPageUrl` remove a barra final para deduplicar — `/sobre` e `/sobre/`
são a mesma página —, e é o endereço já normalizado que vai para a rede. Contra
um WordPress, cujo endereço canônico **tem** barra, cada página interna custa
então um salto de `301` a mais. Funciona (o teste prova que funciona), e o
custo é um round-trip por página. Um site que não redirecione a forma sem barra
responderia 404 nessas páginas.

### Conferência em navegador

`scripts/loadtest/ui-import-server.ts` sobe a API real sobre um PostgreSQL
local e serve o painel compilado, com um site de exemplo em memória. Foi assim
que a tela foi conferida: análise de 5 páginas → 4 imagens, 17 informações
institucionais, 1 banner, 3 serviços, 1 depoimento, 2 pessoas, 2 perguntas →
28 itens importados, 2 ignorados (os dois conflitos) → os 3 serviços aparecendo
como rascunho na tela de Serviços. Sem erro de console e sem transbordo
horizontal em 390 px de largura.

```bash
# requer PostgreSQL local; não faz parte do build
bash scripts/loadtest/setup.sh
createdb codeca_ui
pnpm --filter @codeca/web build
node node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs \
  --config vitest.config.ts scripts/loadtest/ui-import-server.ts
# abra http://localhost:4010/__entrar
```

---

## 7. Arquivos

**Compartilhado** (`packages/shared/src/import/`) — sem dependência nova:
`types.ts` (estados, candidatos, limites), `url.ts` (primeira barreira),
`html.ts` (tokenizador), `extract.ts` (leitura de uma página),
`mapping.ts` (destino de cada coisa).

**Backend** (`apps/api/src/lib/import/`): `fetcher.ts` (segunda barreira),
`crawler.ts` (fatias), `analyzer.ts` (condução), `apply.ts` (gravação pelos
schemas do painel), `images.ts` (Blob), `importer.ts` (confirmar e desfazer),
`store.ts` (banco). Rotas em `apps/api/src/routes/site-import.ts`.

**Banco**: `site_imports` e `site_import_items`
(`packages/database/migrations/0024_importacao_de_sites.sql`).

**Painel**: `apps/web/src/dashboard/ImportSitePage.tsx`, rota `/painel/importar`.

Nenhuma dependência foi adicionada ao projeto.
