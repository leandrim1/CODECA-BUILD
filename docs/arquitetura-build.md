# CODECA Build — arquitetura da plataforma de gerenciamento

Documento de decisao, anterior a implementacao. Descreve a arquitetura, o
modelo de integracao, a estrutura do banco e a estrategia de autenticacao para
a plataforma administrar sites desenvolvidos sob medida pela CODECA IA.

---

## 1. A mudanca de eixo

O que existe hoje **renderiza** os sites: `packages/site-renderer` monta o
HTML, `api/site.ts` serve por dominio, e o editor visual do painel compoe
paginas por blocos. O conteudo e o visual vivem juntos.

O que foi pedido inverte isso. A CODECA IA desenvolve cada site
separadamente, publica na Vercel, e a plataforma passa a ser o **backend de
conteudo** desse site. Ela deixa de desenhar e passa a responder.

| | Hoje | Alvo |
| --- | --- | --- |
| Quem desenha o site | A plataforma, por blocos | A CODECA IA, em codigo |
| Onde o site roda | Funcao `api/site.ts` | Projeto proprio na Vercel |
| O que a plataforma entrega | HTML | JSON autorizado |
| Identidade visual | Limitada ao tema | Livre, e do codigo do site |

Essa inversao e o requisito de prioridade maxima do pedido: sites diferentes,
com identidade e funcionalidades proprias, compartilhando um sistema central
de gerenciamento.

---

## 2. A entidade que falta: `site`

Hoje `tenant` acumula dois papeis — a empresa cliente e o site dela. Todas as
32 tabelas penduram em `tenant_id`. Isso impede o que o pedido exige: uma
empresa com mais de um site, cada um com segmento, modulos, dominio e
credenciais proprios.

A correcao e introduzir `site` entre a empresa e o conteudo:

```
tenant (empresa cliente)
  └── site (projeto)
        ├── credenciais de integracao
        ├── segmento
        ├── modulos habilitados
        ├── politica de campos editaveis
        ├── dominio
        ├── assinatura
        └── conteudo (imoveis, obras, banners, servicos, institucional...)
```

**Toda tabela de conteudo ganha `site_id`.** O `tenant_id` permanece ao lado,
nao por redundancia mas por defesa: o isolamento entre clientes passa a ser
verificavel em dois niveis, e uma consulta que esqueca um filtro ainda
esbarra no outro. Uma restricao composta garante que o `site_id` pertence ao
`tenant_id` informado.

A migracao cria um `site` por `tenant` existente e preenche o `site_id` do
conteudo atual. Nada se perde.

### Como o banco garante o par

`sites` tem um indice unico sobre `(id, tenant_id)` -- redundante com a chave
primaria a primeira vista, mas e ele que permite as tabelas de conteudo
referenciarem o **par**:

```sql
FOREIGN KEY ("site_id", "tenant_id") REFERENCES "sites"("id", "tenant_id")
```

Com isso, um `site_id` de outra empresa que chegue a uma escrita -- por bug,
por parametro forjado ou por uma consulta que esqueceu um filtro -- e recusado
pelo banco, nao pela revisao de codigo. Tabelas filhas (`property_images`,
`project_updates`, `lead_notes`) nao repetem o `site_id`: o pai ja o carrega e
so se chega a elas por ele.

---

## 3. Modulos e campos editaveis

Este e o ponto em que uma escolha errada compromete tudo o resto.

A leitura literal de "campos configuraveis" leva a um modelo
entidade-atributo-valor: uma tabela de campos, uma de valores, tudo dinamico.
Ele entrega flexibilidade total e **custa caro**: acaba a validacao por tipo,
acabam os indices uteis, acaba a tipagem do SDK, e toda consulta vira
montagem em tempo de execucao. Para um catalogo de imoveis com busca por
preco, cidade e finalidade, isso e perda liquida.

### A proposta: registro tipado no codigo, habilitacao por site no banco

Cada modulo e **declarado em `packages/shared`** com seus campos, tipos e
validacao (Zod). O banco guarda apenas o que varia por projeto:

- `site_modules` — quais modulos o site tem, e a configuracao de cada um.
- `site_field_policies` — quais campos o cliente pode editar, quais a CODECA
  IA mantem travados.

O conteudo fica em **tabelas tipadas** para as entidades de volume (imoveis,
obras, servicos, banners, interessados) e em um **documento validado** para os
modulos de instancia unica (institucional, contato), em JSONB com schema.

Para o que realmente e exclusivo de um projeto, cada modulo tem uma valvula de
escape: `custom_fields` em JSONB, validado contra um schema declarado por
site. Flexibilidade onde ela e necessaria, tipo onde ele paga.

**O que isso entrega:** o painel mostra so o que o site tem; o SDK e tipado
por modulo; a busca de imoveis usa indice; e um campo novo exclusivo de um
cliente nao exige migracao.

### Modulos existentes

`institucional` e `contato` sao documentos de instancia unica, em JSONB
validado. `banners`, `imoveis`, `obras`, `servicos`, `depoimentos`, `equipe`,
`faq`, `produtos`, `categorias` e `galerias` sao colecoes, em tabela tipada com
indice.

`produtos`, `categorias` e `galerias` chegaram na etapa C, e abrem varejo,
restaurante e clinica. Quatro decisoes de modelagem valem registro, porque o
schema nao as explica sozinho:

- **Sem variacao de produto.** Tamanho e cor pediriam `product_variants` com
  preco e disponibilidade por combinacao. Um cardapio e um catalogo de
  servicos nao precisam, e a variante entra depois como tabela filha sem mexer
  em `products`.
- **Categoria em tabela compartilhada**, com `module_key`. Duas tabelas
  especificas dariam relacionamento mais firme, mas cada modulo novo que
  quisesse agrupar conteudo pediria migracao. O slug e unico dentro do modulo,
  nao do site.
- **Sem aninhamento de categoria.** `parent_id` traria ciclo, profundidade e
  arvore no painel; o cardapio que motivou o modulo e plano.
- **`price` em `NUMERIC(14,2)`**, como em `properties`. Nao sao centavos
  inteiros como `plans.price_cents` porque este preco e de **exibicao**, nao
  valor cobrado: centavos inteiros existem la para conversar com a ValidaPay.
  Duas representacoes de dinheiro no mesmo codigo e como comecam erros de
  arredondamento, entao cada uma tem seu motivo escrito. A validacao recusa
  mais de duas casas: `19.999` seria gravado como `20.00` em silencio.

Duas decisoes de **entrega** que o site precisa conhecer: preco sob consulta
nao devolve o valor guardado (a empresa pode ter informado e depois decidido
nao divulgar), e produto esgotado continua na resposta, marcado -- despublicar
faria o cliente recadastrar amanha, e riscar ou esconder e decisao do projeto.

Galeria nao tem coluna de capa: a primeira imagem da ordem e a capa, e uma
coluna separada seria mais um estado a manter coerente com a lista. A listagem
publica traz capa e contagem sem as imagens, porque uma galeria pode ter
duzentas.

`depoimentos`, `equipe` e `faq` chegaram na etapa B. Tinham tabela e tela
no painel desde o inicio, mas **nao eram modulos**: nao estavam no registro,
nem em `/api/v1`, nem no SDK. O cliente editava conteudo que nenhum site
conseguia ler -- o pior dos dois mundos, porque a tela existia e dava a
entender que funcionava.

**Depoimento tem uma regra propria, e ela e sobre dado de terceiro.** Um
depoimento e o nome, a foto e as palavras de outra pessoa. O schema de escrita
ja recusava publicar sem a declaracao de que o autor autorizou; a leitura
publica passou a conferir a mesma coisa, **inclusive em previa**, e nao entrega
`authorizationConfirmed` nem a nota de como a autorizacao foi obtida -- essa
nota pode conter telefone e data, e fica so no painel.

A conferencia na leitura nao e redundante com a da escrita: um rascunho sem
autorizacao e gravavel, a previa le rascunho, e um `UPDATE` feito a mao no
banco nao passa por validacao nenhuma. Qualquer um desses caminhos levaria ao
site o nome de quem nao autorizou. `tests/integration/public-content.test.ts`
cobre os tres.

Dois cuidados que valem registro:

- **O registro e o schema nao podem derivar.** O registro descreve os campos
  que o painel desenha e a politica governa; o schema valida o que entra no
  banco. Afastados, um campo passa a existir na tela sem validacao, ou a ser
  validado sem ninguem poder edita-lo. Um teste confere os dois sentidos, nos
  documentos **e nas colecoes**.

  A verificacao das colecoes nasceu de um caso real: `imoveis`, `obras` e
  `servicos` vieram de antes do registro, e dezenove campos que a API aceitava
  (`currency`, `builtAreaM2`, `showLocation`, `seoTitle`, `sortOrder` entre
  eles) nunca foram declarados. Como `isFieldEditable` nega o que nao foi
  declarado, cada um era um campo gravavel que a politica considerava travado
  -- uma contradicao que so apareceu quando a verificacao passou a valer para
  as colecoes.
- **A politica guarda so as excecoes.** Uma linha por campo de cada site
  repetiria o padrao e envelheceria sozinha: um campo acrescentado hoje
  ficaria invisivel para todo site configurado ontem.

A verificacao de escrita compara **valor a valor**, nao a lista de chaves
enviadas. Um formulario reenvia tudo, e recusar por reenviar o mesmo valor
tornaria a tela impossivel de usar.

### Segmentos

Um segmento e um **conjunto padrao de modulos**, aplicado no cadastro do site.
Nao e uma trava: um site de corretor pode habilitar o modulo de obras se o
projeto dele tiver.

Os segmentos sao **dados**, nao codigo. A instalacao comeca com `construtora`,
`imobiliaria` e `corretor` porque foi dai que a plataforma nasceu, e nada
depende desses tres: cadastrar "Clinica odontologica" ou "Restaurante" e uma
linha na tabela, pelo painel mestre. Ate a etapa 7 `segments.code` era um enum
do Postgres, e atender um ramo novo pedia `ALTER TYPE` e implantacao --
exatamente o contrario do que este documento afirmava.

Tres regras organizam o resto:

1. **Editar um segmento nunca mexe em site nenhum.** Um projeto configurado ha
   meses pode ter sido ajustado a mao, e tirar um modulo do conjunto nao pode
   esconder do cliente uma tela que ele usa. A trilha de auditoria grava
   `appliedToExistingSites: false` para deixar isso explicito.
2. **Aplicar o conjunto a um site existente e um ato separado**
   (`POST /api/platform/sites/:siteId/apply-segment`), com auditoria propria.
   Ele **habilita** o que falta e nao desliga nada: desligar um modulo em uso
   e decisao site a site, na tela de modulos, onde quem decide ve o que esta
   ligado.
3. **Exatamente um segmento e o padrao** de empresas recem-cadastradas, com
   indice unico parcial no banco. Antes isso era `'construtora'` fixo no
   codigo, e um escritorio de advocacia nascia com os modulos de uma
   construtora.

Remover um segmento so e possivel enquanto nenhum site o usa; com sites, a
resposta e desativar. A chave estrangeira e `on delete set null`, entao
remover desligaria em silencio o segmento de projetos no ar.

**Os modulos sao doze**: `institucional`, `contato`, `banners`, `imoveis`,
`obras`, `servicos`, `depoimentos`, `equipe`, `faq`, `produtos`, `categorias` e
`galerias`. Com produtos e categorias, um segmento de restaurante cadastrado no
painel entrega um cardapio de verdade -- o que faltava na etapa B. Horarios de
funcionamento ainda sao um campo do documento de contato, nao um modulo.

---

## 4. Autenticacao: tres chamadores, nao um

A pergunta que organiza a seguranca nao e "como o site se autentica", e sim
**quem** esta chamando:

| Chamador | Onde roda | Pode guardar segredo? | O que pode fazer |
| --- | --- | --- | --- |
| Navegador do visitante | Site publico do cliente | **Nao** | Ler conteudo publicado; enviar interessado |
| Servidor do site | Vercel do cliente (SSR/ISR) | Sim | O acima, mais rascunho e previa |
| Painel | Plataforma, com sessao | Sim | Escrever, conforme permissao |

Disso saem duas credenciais por site, nao uma.

### Chave publicavel (`cb_pub_...`)

Vai no codigo do site e aparece no navegador. **Nao e segredo** — e um
identificador com escopo. Sozinha, so le conteudo **publicado** do site a que
pertence.

O que a protege de uso indevido por terceiros:

- **Lista de origens autorizadas** por site, verificada em `Origin`;
- **limite de requisicoes** por chave e por IP;
- escopo rigido: nenhuma leitura de rascunho, de dado pessoal ou de outro site.

Uma chave publicavel vazada nao da acesso a nada que ja nao fosse publico.
Esse e o criterio para considera-la segura — nao a obscuridade.

### Chave secreta (`cb_sec_...`)

Somente servidor. Le publicado e rascunho, acessa previa, e executa as poucas
escritas autorizadas por integracao. Guardada **com hash** (SHA-256) no banco;
o valor em claro aparece uma unica vez, na criacao. Rotacao com sobreposicao:
duas chaves validas durante a troca, para a virada nao derrubar o site.

Nunca em variavel `VITE_*`. Nunca no bundle. O painel deixa isso explicito na
tela que gera a chave.

### Interessados enviados pelo navegador

Os sites sao SPAs React+Vite: o formulario de contato roda no navegador. Por
isso a criacao de interessado e a **unica escrita** aceita com chave
publicavel, e vem cercada: origem autorizada, limite por IP, honeypot (ja
existe) e nenhuma leitura de volta. Quem envia nao consegue listar.

### O painel

Continua como esta: sessao com cookie, CSRF, e permissao verificada no
servidor em toda operacao. As chaves de integracao **nao** dao acesso ao
painel, e a sessao do painel **nao** serve para a API publica. Dois mundos
separados de proposito.

### O painel do cliente se adapta ao site

O menu do painel nao e fixo. `GET /api/tenants/:tenantId/modules` responde o
que aquele projeto tem, e a moldura monta o menu a partir dessa resposta --
carregada uma vez, num contexto, e nao tela por tela.

Dois filtros convivem no menu e respondem a perguntas diferentes:

| Filtro | Pergunta | Exemplo |
| --- | --- | --- |
| `capability` | o papel de **quem entrou** alcanca isto? | um editor nao ve Equipe |
| `module` | o **site da empresa** tem isto? | um site institucional nao ve Imoveis |

Midia, interessados, dominio, equipe, plano e empresa nao tem modulo: valem
para todo site, porque nao dependem de como o projeto foi montado.

**Esconder na tela nao e proteger.** O endereco continua digitavel e um link
antigo continua existindo, entao cada rota de modulo tem `RequireModule`, que
explica que o site nao tem aquele modulo em vez de mostrar uma tela vazia. E,
antes disso, a API recusa: `requireModule` nas rotas de imoveis, obras e
servicos, inclusive na **leitura** -- uma lista vazia sugere que poderia ser
preenchida.

#### Campo travado aparece, e sai do corpo

A tela mostra o campo travado com o valor e um cadeado, e nao o esconde: o
cliente que nao ve o dado acha que ele nao existe e pede para cadastrar algo
que ja esta lá.

Na gravacao, porem, o campo travado **sai do corpo**. Todo formulario reenvia
tudo, e reenviar o campo travado levaria 403 em cada gravacao mesmo sem o
cliente ter tocado nele; sem o campo, o servidor usa o proprio valor -- a
moeda padrao do imovel, o endereco derivado do titulo.

Na criacao a conta e diferente da alteracao. `assertEditableCreate` olha o
corpo **como chegou**, nao o resultado do schema: um valor que o Zod preencheu
por omissao nao e escolha do cliente, e tratar o padrao como escolha recusaria
toda criacao de imovel assim que a moeda fosse travada.

#### Os documentos ganham uma tela so

`institucional` e `contato` dividem `DocumentModulePage`, que desenha o
formulario a partir dos campos que a API devolve. Uma tela por modulo
significaria que habilitar um modulo novo exige deploy do painel -- o oposto
do que a secao 6 promete.

#### O que ainda nao e modulo

Depoimentos, equipe e perguntas frequentes continuam no painel, fora do
registro, e por isso aparecem para todo site. Vale registrar o incomodo: como
nao estao no registro, tambem **nao estao em `/api/v1` nem no SDK** -- o
cliente edita um conteudo que nenhum site consegue ler. Transforma-los em
modulo (com rota publica e tipo no SDK) ou retira-los do painel e uma decisao
em aberto.

### A tela de configuracao, em `/plataforma/sites`

E por onde a CODECA IA liga um projeto novo a plataforma, sem `curl` e sem
abrir o banco. A tela lista todos os sites com a empresa dona de cada um e
abre a configuracao em quatro abas:

| Aba | O que decide | Rotas |
| --- | --- | --- |
| Identidade | nome, situacao (`draft`, `active`, `suspended`, `archived`) e nota interna | `GET`/`PATCH /api/platform/sites/:siteId` |
| Modulos e campos | o que o cliente enxerga e o que ele pode editar | `PUT /api/platform/sites/:siteId/modules` |
| Origens | de quais enderecos a chave publicavel e aceita | `GET`/`PUT /api/platform/sites/:siteId/origins` |
| Chaves | emitir, rotacionar e revogar credenciais | `/api/platform/sites/:siteId/keys` |

Tres cuidados que a tela carrega de proposito:

1. **A chave secreta aparece uma vez.** O modal que a mostra diz isso e avisa,
   antes de fechar, que ela nao vai em `VITE_*`, em componente de cliente nem
   no repositorio. Depois dele so existe o hash no banco.
2. **A nota interna e da CODECA IA.** Ela vive em `sites.internal_notes`, que
   nenhuma rota do cliente le -- nem o painel da empresa, nem `/api/v1`.
3. **Revogar derruba; rotacionar nao.** A confirmacao de revogacao explica a
   diferenca e aponta a rotacao, que mantem a chave antiga valendo por uma
   janela.

A situacao do site e um rotulo operacional: mudar para `suspended` nao apaga
documento, imovel, obra nem imagem nenhuma -- `tests/integration/platform-sites.test.ts`
cobre justamente isso.

O segmento do site e escolhido na aba Identidade, junto do botao que aplica o
conjunto de modulos dele.

---

## 5. API publica e SDK

### API

`GET /api/v1/sites/:siteId/...`, autenticada pela chave no cabecalho
`Authorization`. A resposta traz apenas o conteudo publicado daquele site, com
os modulos habilitados. Versionada em `/v1` desde o primeiro dia: o site do
cliente e codigo que nao controlamos de perto, e quebrar contrato quebra o
site dele.

### SDK — `@codeca/sdk`

Pacote instalavel nos sites desenvolvidos pela CODECA IA. Sem dependencia de
framework; funciona em React, em SSR e em script puro.

```ts
import { createClient } from '@codeca/sdk';

const codeca = createClient({
  siteId: 'ste_...',
  publishableKey: 'cb_pub_...',
});

const empresa = await codeca.institutional.get();
const banners = await codeca.banners.list();
const imoveis = await codeca.properties.list({ finalidade: 'venda', page: 1 });
```

E, no servidor do site, para previa e rascunho:

```ts
import { createServerClient } from '@codeca/sdk/server';

const codeca = createServerClient({ secretKey: process.env.CODECA_SECRET_KEY });
```

A separacao em dois pontos de entrada e deliberada: importar o cliente de
servidor em codigo de navegador falha no build, em vez de vazar a chave em
producao.

Os tipos saem do mesmo registro de modulos do item 3 — uma unica fonte para o
schema, a validacao, o painel e o SDK.

---

## 6. Alteracao sem novo deploy

O conteudo tem **rascunho** e **publicado**. A API publica so serve o
publicado. Publicar e uma operacao do painel, nao um deploy.

Como os sites sao SPAs Vite, o conteudo e buscado em tempo de execucao: a
alteracao aparece na proxima visita, sem rebuild. **A maioria dos sites nao
precisa de mais nada.**

O que continua exigindo trabalho da CODECA IA: mudanca de estrutura, de
componente ou de comportamento. Isso e codigo, e segue sendo codigo. A
fronteira fica explicita na documentacao de cada modulo.

### O webhook `content.published`

Existe para o site que renderiza no servidor e guarda cache. Sem aviso, esse
site so descobriria a alteracao quando o cache expirasse -- na Vercel, horas
depois de o cliente ter publicado.

A plataforma faz um `POST` assinado para cada endereco ativo do site,
cadastrado em `/plataforma/sites`, aba **Avisos de publicacao**.

**A assinatura reaproveita a convencao dos webhooks que recebemos** da
ValidaPay: `t=<timestamp>,v1=<hmac>`, com o HMAC sobre `<t>.<corpo bruto>`.
Nao inventar outro formato tem valor pratico: quem integra ja viu esse em
qualquer provedor de pagamento, e o verificador cabe em dez linhas. O
instante entra no calculo para que uma entrega capturada em transito nao
valha para sempre.

O verificador vem no SDK, em `@codeca/sdk/server`, e usa **Web Crypto** em vez
de `node:crypto`: o endpoint de revalidacao de um site costuma rodar na borda,
onde `node:crypto` nao existe. Um teste confere a ida e volta -- a plataforma
assina com `node:crypto`, o SDK confere com Web Crypto. Se as duas pontas
divergissem, nenhum site aceitaria nenhum aviso, e a falha apareceria como "o
cache nao invalida", longe da causa.

#### O corpo carrega o que mudou, nao o conteudo

`{ event, siteId, moduleKey, action, entityId, slug, publishedAt }` -- e nada
mais. Duas razoes: o aviso viaja para um endereco que a plataforma nao
controla, e o site busca o conteudo pela API de qualquer forma, com a propria
credencial, que e o que define o que ele pode ler. Mandar o conteudo aqui
duplicaria a regra de visibilidade em dois lugares.

O `slug` vai, e precisa ir: e por ele que o site sabe qual pagina invalidar.

#### Quando o aviso sai

| Modulo | Quando |
| --- | --- |
| `institucional`, `contato` | sempre que salva -- documento nao tem rascunho |
| `banners` | criar, alterar ou remover |
| `imoveis`, `obras`, `servicos` | quando o registro esta publicado antes **ou** depois |

A ultima linha e a regra inteira: rascunho que continua rascunho nao avisa
(avisar a cada tecla digitada gastaria entrega e invalidaria cache sem
motivo), e sair de publicado avisa (uma pagina que deixou de existir precisa
sair do cache tanto quanto uma que mudou).

#### A entrega sobrevive ao processo

Este e o ponto que decide se o recurso vale algo. Em funcao serverless nao
existe fila em memoria: o processo que atende a requisicao pode morrer no
instante seguinte. Entao:

1. A entrega e **gravada** em `webhook_deliveries` antes de qualquer
   tentativa.
2. A tentativa imediata e oportunista -- funciona no caso comum, com o site do
   cliente no ar.
3. O que falhou volta no cron.

E por isso que **a publicacao nunca falha por causa do webhook**. Gravar um
imovel e a operacao que o cliente pediu; avisar o site e consequencia. Se o
aviso derrubasse a gravacao, uma indisponibilidade no site do cliente
impediria o cliente de trabalhar.

Um 4xx do site (fora de 408 e 429) nao e repetido: o endereco esta errado ou a
assinatura foi recusada, e repetir so geraria ruido nos dois lados. 5xx e
falha de rede sao repetidos ate cinco tentativas.

**Limitacao conhecida:** o plano Hobby da Vercel permite um cron, diario.
Logo, uma entrega que falha e repetida **uma vez por dia**. O caso comum nao
sente -- a primeira tentativa e imediata --, mas um site que ficou fora por
uma hora so recebe o aviso no dia seguinte. Num plano pago, basta aumentar a
frequencia do cron em `vercel.json`; nada no codigo muda.

#### O segredo fica em claro, e por que

Ao contrario das chaves de integracao, que ficam em hash, o segredo de
assinatura e guardado recuperavel: assinar exige o valor a cada entrega, e um
hash nao serve para isso. A contrapartida e estrita -- ele aparece **uma unica
vez**, na criacao ou na rotacao, nunca numa leitura posterior, nunca em log e
nunca na auditoria. Um teste confere que a auditoria registra o endereco e nao
o segredo.

A rotacao nao tem janela de sobreposicao, diferente das chaves: um segredo de
assinatura e conferido pelo site do cliente, e aceitar dois ao mesmo tempo
exigiria que ele tambem aceitasse os dois. Trocar aqui e publicar lá precisa
ser combinado.

---

## 7. Assinatura e suspensao

A assinatura e **do site**, nao da empresa. A unicidade esta no banco
(`subscriptions_site_key`), entao uma construtora com o institucional em um
plano e o portal de lancamentos em outro e o caso normal, nao a excecao.

A maquina de estados de cobranca que ja existia (`BillingState`,
`PublicationState`, idempotencia em tres camadas, reconciliacao) foi
reaproveitada inteira. O que mudou e o que a suspensao **faz**.

Antes, suspender tirava o site do ar: a plataforma servia o site e bastava
parar de servir. Agora o site e um projeto na Vercel do cliente -- a
plataforma entrega conteudo por API e nao hospeda nada. Suspender deixou de
ser um ato e passou a ser **politica do plano**:

| Eixo | Opcoes | Onde vale |
| --- | --- | --- |
| Site publico | servir \| servir com aviso \| parar de responder | `/api/v1` |
| Painel | somente leitura \| bloqueado | rotas do painel, menos cobranca |
| Dados | **nunca apagados** — nao e configuravel | em lugar nenhum |

Padrao: **site no ar, painel em somente leitura**. Derrubar o site de quem
atrasou uma fatura custa ao visitante, que nao tem parte no atraso, e costuma
gerar cancelamento em vez de pagamento.

### Plano sem painel e suspensao sao coisas diferentes

O plano Essencial vende site e dominio **sem** o painel de conteudo: quem
mantem o conteudo e a CODECA IA. Isso bloqueia as mesmas rotas que a
suspensao, e por isso vale escrever onde esta a diferenca:

| | Suspensao | Plano sem painel |
| --- | --- | --- |
| Motivo | assinatura em atraso | plano em dia, mas nao cobre |
| Saida | pagar | upgrade |
| Duracao | ate regularizar | permanente no plano atual |
| Codigo | `subscription_required` | `plan_without_panel` |
| Camada | `enforceSuspension` | `requirePanelPlan` |

Sao duas camadas e dois codigos de proposito. Juntar faria um cliente pagante
ler "regularize sua assinatura" -- e ligar para o suporte em vez de contratar
o plano acima. As duas liberam a tela de cobranca pelo mesmo motivo: bloquear
quem precisa pagar ou fazer upgrade e impedir a propria saida da limitacao.

Sem painel no plano, o cliente ainda alcanca o que e **conta**: cadastro da
empresa, contato, plano e cobranca. Fica de fora tudo o que administra o site.
A escolha de manter o login existindo e deliberada -- sem ele, pedir upgrade
viraria uma ligacao telefonica.

**`cms_panel` controla o painel, nao a integracao.** A API publica continua
respondendo para um site cujo plano nao inclui painel: num projeto do
Essencial e a CODECA IA que mantem o conteudo, e o site precisa ler. Quem
decide se um site do Essencial e integrado e a CODECA IA, ao emitir ou nao a
chave.

### Recursos de plano: quatro, e um deles nao e aplicado

`cms_panel`, `custom_domain`, `lead_export` e `included_hosting`. Sairam
`visual_editor_advanced_blocks`, `version_history`, `multi_page`,
`seo_advanced` e `remove_platform_badge`: os cinco descreviam o editor visual
removido na etapa 0, nenhum era verificado em lugar nenhum, e os planos
seguiam anunciando o que a plataforma nao faz mais.

`included_hosting` e diferente dos outros tres: **a plataforma registra, nao
aplica.** Quem publica o site e o projeto Vercel do cliente, entao nao ha como
garantir hospedagem daqui -- so registrar que foi vendida, para o painel
mestre e a tela de plano mostrarem. A caixa no painel mestre diz isso.

### O dado nunca e apagado

Esta e a unica regra do capitulo que nao e configuravel, e ela esta em codigo
em tres lugares: `SuspensionEffect.dataDeleted` e do tipo `false`, o schema do
plano nao tem esse eixo, e `tests/unit/suspension.test.ts` percorre todas as
combinacoes de estado e politica para confirmar. `suspensionEffect` tambem nao
tem caminho que remova nada -- ela so decide o que responder.

Ate esta etapa a promessa estava apenas escrita aqui. Agora
`tests/integration/billing-suspension.test.ts` cria um imovel, aplica a
politica mais severa possivel (`stop` + `blocked`), confere que a linha
continua no banco com o mesmo titulo e situacao, e que ela volta a aparecer ao
regularizar.

### A funcao pura, e por que ela existe

`suspensionEffect(publication, policy)` traduz o estado de publicacao na
restricao que vale agora. E pura pelo mesmo motivo que `decidePublication`: a
API publica, o painel e as telas decidem pela mesma regra. Duas
implementacoes divergem no primeiro caso de borda, e aqui o caso de borda
custa o site de um cliente no ar, ou um cliente trancado fora do painel.

A tolerancia nao chega aqui: `decidePublication` devolve `allowed` durante
ela, entao a politica nem e consultada. Um cartao recusado que o cliente
resolve em dois dias nao derruba nada.

### A cobranca nunca e bloqueada

`enforceSuspension` recebe uma lista de isencoes, e ela tem um item:
`/billing`. Bloquear quem precisa pagar impede a propria regularizacao -- o
cliente ficaria sem como sair da suspensao.

Isso tambem decide onde o painel descobre a propria situacao. Com a politica
`blocked`, `GET /modules` e recusado junto com o resto; `GET /billing`, nao.
Por isso e essa rota que carrega `suspension` e `suspensionPolicy`, e e para
`/painel/plano` que o aviso aponta.

### O que o visitante ve

Com `serve_with_notice`, `GET /v1/site` passa a trazer `notice`. O texto e
neutro de proposito: chega ao navegador por uma chave **publicavel**, que e
publica por definicao, e o visitante nao tem parte na pendencia nem deve
saber dela. Um teste confere que o aviso nao contem "inadimplente",
"pagamento", "assinatura", valor nem data.

Com `stop`, as rotas respondem **402 `subscription_required`** -- nao 403. A
diferenca importa para quem integra: 403 manda conferir a credencial, e aqui
nao ha nada a corrigir no codigo do site. O SDK expoe `error.isSuspended`.

### Suspender um site nao suspende a empresa

A rota administrativa passou a receber `siteId`. Antes ela tambem marcava a
**empresa** como suspensa, o que fazia sentido quando a assinatura era unica
por empresa e os dois conceitos coincidiam; agora derrubaria os outros sites
da mesma construtora e trancaria o painel inteiro. Suspender a empresa
continua possivel, pela rota de empresas, que e onde essa decisao mora.

`sites.status` tambem fica intacto: e o rotulo operacional da CODECA IA
(`draft`, `active`, ...), e sobrescreve-lo faria um site em desenvolvimento
virar "no ar" ao liberar a cobranca. Publicacao e situacao do projeto sao
eixos diferentes, como `publicationStatus` e `commercialStatus` num imovel.

---

## 8. Banco

Sobre as 32 tabelas atuais, em migracoes versionadas:

**Novas**

`sites`, `segments`, `site_modules`, `site_field_policies`, `site_api_keys`,
`site_origins`, `banners`, `content_documents` (modulos de instancia unica),
`integration_events` (entrega de webhooks para o site do cliente).

**Alteradas**

Conteudo (`properties`, `projects`, `services`, `leads`, `media_assets`,
`testimonials`, `team_members`, `faqs`, `domains`) ganha `site_id` com indice
e restricao composta contra o `tenant_id`. `subscriptions` e `charges` ganham
`site_id`.

**Mantidas como estao**

`users`, `memberships`, `sessions`, `user_tokens`, `plans`, `audit_logs`,
`rate_limits`, `webhook_events`, `billing_audit_logs`.

**Removidas** — `pages`, `page_versions`, `navigation_menus`, `redirects` e
`site_settings` pertenciam ao renderizador proprio e sairam na migracao
`0007_remove_tabelas_do_renderizador.sql`.

Cada migracao e aplicada pelo build, como ja acontece. As destrutivas ficam
para um deploy posterior ao que para de usar a coluna.

---

## 9. Seguranca e LGPD

O que ja existe e permanece: permissao verificada no servidor, auditoria,
isolamento por empresa, upload validado por tipo, tamanho e limite de plano,
caminho do Blob prefixado por empresa.

O que a integracao acrescenta:

- Chave guardada com hash; valor em claro so na criacao.
- Escopo por chave, verificado a cada requisicao — nunca o `siteId` enviado
  pelo cliente sozinho.
- Origem autorizada por site.
- Limite de requisicoes por chave.
- Auditoria de uso e de rotacao de chave.
- **Dados de interessados nao saem pela chave publicavel.** Nome, telefone e
  e-mail sao dado pessoal: ficam atras do painel autenticado. Essa e a
  separacao mais importante entre "dado publico do site" e "dado privado da
  empresa", e e o ponto em que uma API de conteudo descuidada vira incidente
  de LGPD.

---

## 10. O que acontece com o que ja existe

Honestamente: o editor visual por blocos e o renderizador publico
(`packages/site-renderer`, `api/site.ts`, `pages`, `page_versions`, o editor
do painel) sao exatamente o "construtor visual generico" que o pedido diz para
**nao** ser. E codigo que funciona, testado, e que o novo modelo nao usa.

Tres caminhos, com custos diferentes:

1. **Manter como modo opcional.** Clientes sem site sob medida recebem um site
   hospedado pela plataforma. Custo: manter dois caminhos de publicacao.
2. **Congelar.** O codigo fica, sem evoluir, atras de um sinalizador. Custo
   baixo agora, divida depois.
3. **Remover.** Codebase menor e mais coerente. Custo: trabalho ja feito vai
   fora, e nao ha volta barata.

**Decidido: remover.** A opcao escolhida foi a 3. O renderizador, o editor
visual, as paginas por blocos, o tema e a previa sairam do codigo na etapa 0;
o painel ficou so com o que gerencia conteudo.

As tabelas `pages`, `page_versions`, `navigation_menus`, `redirects` e
`site_settings` sairam na migracao `0007_remove_tabelas_do_renderizador.sql`,
o segundo dos dois deploys que a secao 5 do `docs/vercel.md` exige: primeiro o
que para de usar (esta etapa 0), depois o que remove.

Como a remocao nao tem volta e o banco de producao nao pode ser inspecionado
daqui, a migracao **confere antes**: se alguma das cinco tabelas tiver linhas,
ela interrompe com a instrucao de exportar e esvaziar, e o deploy falha sem
apagar nada -- a versao no ar continua servindo, porque nenhum codigo le essas
tabelas desde a etapa 0. Num banco vazio, que e o caso esperado, ela passa em
silencio. `tests/integration/migrations.test.ts` exercita os dois caminhos.

Os dominios tambem mudam de papel: no modelo novo quem aponta o dominio e o
projeto Vercel do cliente, nao a plataforma. **Decidido: so registro.**
`domains` guarda qual dominio pertence a qual site, para exibir no painel e
montar URLs; o provisionamento sai.

---

## 11. Etapas

Cada etapa entrega codigo funcional, documentacao e testes, e deixa a
plataforma utilizavel ao final.

| # | Entrega | Depende de | Estado |
| --- | --- | --- | --- |
| 0 | Remocao do renderizador e do editor visual | — | **feita** |
| 1 | Entidade `site`, migracao e isolamento em dois niveis | — | **feita** |
| 2 | Registro de modulos, habilitacao e politica de campos por site | 1 | **feita** |
| 3 | Painel que se adapta aos modulos do site | 2 | **feita** |
| 4 | Chaves de integracao, origens, limites e auditoria | 1 | **feita** |
| 5 | API publica `/api/v1` com escopo por chave | 2, 4 | **feita** |
| 6 | `@codeca/sdk` com tipos, documentacao e exemplo integravel | 5 | **feita** |
| 7 | Configuracao por segmento no painel mestre | 2 | **feita** |
| 8 | Webhook `content.published` para o site do cliente | 5 | **feita** |
| 9 | Assinatura por site e politica de suspensao | 1 | **feita** |
| 10 | Cadastro de site no painel mestre, fim a fim | 2, 4 | **feita** |

As etapas 1 e 2 sao fundacao: tudo depende delas, e mudar de ideia depois
custa caro. As demais sao incrementais.

---

## 12. Decisoes tomadas

1. **O renderizador proprio** — **decidido: remover** (item 10). O codigo saiu
   na etapa 0 e as tabelas na migracao
   `0007_remove_tabelas_do_renderizador.sql`. Manter dois caminhos de
   publicacao custaria mais do que o trabalho perdido.
2. **Modo hospedado dos dominios** — **decidido: so registro** (item 10). Quem
   aponta o dominio e o projeto Vercel de cada site; `domains` guarda qual
   dominio pertence a qual site, para o painel exibir e montar URLs. O
   provisionamento saiu.
3. **Previa do rascunho no site do cliente** — **decidido: token de vida
   curta no navegador**, ligado ao site e ao usuario, por minutos. Funciona em
   SPA sem exigir servidor no site do cliente, e nao le dado pessoal.

As tres decisoes estao tomadas. O documento segue como referencia do desenho;
as etapas avancam a partir dele.
