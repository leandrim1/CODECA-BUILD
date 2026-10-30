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

### Modulos da primeira versao

`institucional` e `contato` sao documentos de instancia unica, em JSONB
validado. `banners`, `imoveis`, `obras` e `servicos` sao colecoes, em tabela
tipada com indice.

Dois cuidados que valem registro:

- **O registro e o schema nao podem derivar.** O registro descreve os campos
  que o painel desenha e a politica governa; o schema valida o que entra no
  banco. Afastados, um campo passa a existir na tela sem validacao, ou a ser
  validado sem ninguem poder edita-lo. Um teste confere os dois sentidos.
- **A politica guarda so as excecoes.** Uma linha por campo de cada site
  repetiria o padrao e envelheceria sozinha: um campo acrescentado hoje
  ficaria invisivel para todo site configurado ontem.

A verificacao de escrita compara **valor a valor**, nao a lista de chaves
enviadas. Um formulario reenvia tudo, e recusar por reenviar o mesmo valor
tornaria a tela impossivel de usar.

### Segmentos

`construtora`, `imobiliaria`, `corretor`. Um segmento e um **conjunto padrao
de modulos e campos**, aplicado no cadastro do site e ajustavel depois. Nao e
uma trava: um site de corretor pode habilitar o modulo de obras se o projeto
dele tiver. Adicionar um segmento e declarar um conjunto, nao alterar o
schema.

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
alteracao aparece na proxima visita, sem rebuild. Para sites que venham a usar
renderizacao no servidor com cache, a plataforma envia um **webhook
`content.published`** assinado com HMAC para uma URL configurada no site, que
entao invalida o proprio cache.

O que continua exigindo trabalho da CODECA IA: mudanca de estrutura, de
componente ou de comportamento. Isso e codigo, e segue sendo codigo. A
fronteira fica explicita na documentacao de cada modulo.

---

## 7. Assinatura e suspensao

A assinatura passa a ser **do site**, nao da empresa — o pedido a vincula ao
cliente e ao site contratado. Uma empresa com dois sites pode ter um no plano
pago e outro nao.

A maquina de estados de cobranca que ja existe (`BillingState`,
`PublicationState`, idempotencia em tres camadas, reconciliacao) e reaproveitada
inteira. O que muda e o que a suspensao **faz**.

Hoje a suspensao tira o site do ar. No modelo novo o site e um projeto da
Vercel do cliente, e derruba-lo nao e nem desejavel nem totalmente possivel.
Por isso a suspensao vira **politica configuravel por plano**:

| Eixo | Opcoes |
| --- | --- |
| Site publico | manter servindo \| manter com aviso \| parar de responder |
| Painel | somente leitura \| bloqueado |
| Dados | **nunca apagados** — nao e configuravel |

O padrao proposto: site publico continua no ar, painel em somente leitura.
O cliente ve o que tem, nao perde nada, e volta ao normal ao regularizar.

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

**Em avaliacao** — ver item 10: `pages`, `page_versions`, `navigation_menus`,
`redirects`, `site_settings` pertencem ao renderizador proprio.

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
`site_settings` continuam no banco por ora, sem uso: remove-las e uma migracao
destrutiva, e a regra da secao 5 do `docs/vercel.md` vale aqui tambem --
primeiro o deploy que para de usar, depois o que remove.

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
| 3 | Painel que se adapta aos modulos do site | 2 | pendente |
| 4 | Chaves de integracao, origens, limites e auditoria | 1 | **feita** |
| 5 | API publica `/api/v1` com escopo por chave | 2, 4 | **feita** |
| 6 | `@codeca/sdk` com tipos, documentacao e exemplo integravel | 5 | **feita** |
| 7 | Configuracao por segmento no painel mestre | 2 | pendente |
| 8 | Webhook `content.published` para o site do cliente | 5 | pendente |
| 9 | Assinatura por site e politica de suspensao | 1 | pendente |
| 10 | Cadastro de site no painel mestre, fim a fim | 2, 4, 9 | pendente |

As etapas 1 e 2 sao fundacao: tudo depende delas, e mudar de ideia depois
custa caro. As demais sao incrementais.

---

## 12. Decisoes tomadas

1. **O renderizador proprio** — congelar, manter como produto, ou remover?
   Recomendacao acima: congelar.
2. **Modo hospedado dos dominios** — a plataforma continua provisionando
   dominio para algum cliente, ou isso passa inteiramente para o projeto
   Vercel de cada site?
3. **Previa do rascunho no site do cliente** — **decidido: token de vida
   curta no navegador**, ligado ao site e ao usuario, por minutos. Funciona em
   SPA sem exigir servidor no site do cliente, e nao le dado pessoal.

As tres decisoes estao tomadas. O documento segue como referencia do desenho;
as etapas avancam a partir dele.
