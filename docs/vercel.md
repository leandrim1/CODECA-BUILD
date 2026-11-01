# Vercel

Um unico projeto hospeda o painel da plataforma, a API e todos os sites dos
clientes. O que diferencia um do outro e o host da requisicao.

## 1. Importar o repositorio

Em <https://vercel.com/new>, importe o repositorio. O `vercel.json` na raiz ja
traz tudo:

| Chave | Valor | Por que |
| --- | --- | --- |
| `buildCommand` | `pnpm run build` | Compila os pacotes internos e depois o painel |
| `installCommand` | `pnpm install --frozen-lockfile` | Falha se o lockfile estiver desatualizado |
| `outputDirectory` | `apps/web/dist` | Saida estatica do Vite |
| `functions` | `api/*.ts` em `@vercel/node@5.1.11` | 1024 MB, 30 s |
| `framework` | `null` | O roteamento e nosso, nao de um preset |

Nao defina um *Root Directory* no painel da Vercel: o build sai da raiz do
monorepo, porque as funcoes em `api/` importam `@codeca/api` pelo workspace.

### Confira o *Production Branch*

A Vercel grava o branch de producao **no momento da importacao** e nao
acompanha mudancas posteriores do branch padrao no GitHub. Se o branch for
renomeado, apagado ou trocado depois, os pushes passam a gerar apenas
implantacoes de *preview*: cada uma com a sua URL propria, enquanto o dominio
de producao continua servindo o ultimo build antigo. O deploy "funciona", o
repositorio esta correto e a tela segue errada.

Na importacao a Vercel costuma gravar `main`. Se o repositorio nao tiver um
branch com esse nome -- ou se ele for renomeado ou apagado depois --, o
*Branch Tracking* da producao aponta para um branch inexistente e **nenhum push
vira producao**: todos viram preview, e o dominio segue servindo o build
anterior indefinidamente.

Em *Settings -> Environments -> Production* (ou *Settings -> Git*, conforme a
versao do painel), confirme que o *Branch Tracking* e o branch que voce
realmente publica. Para checar o que esta no ar sem abrir o painel, veja a
secao 9.

A unica funcao:

- `api/index.ts` — a API (`createApp`), servida em `/api/*`

### Formato dos handlers — nao use `export default`

A funcao exporta **um handler por metodo HTTP**:

```ts
export const GET = handler;
export const POST = handler;
// PUT, PATCH, DELETE, OPTIONS, HEAD
```

Isso nao e estilo. O runtime Node da Vercel trata o `export default` como um
handler `(req, res) => void` e **descarta o valor devolvido**. Como o
`handle()` do Hono devolve uma `Response`, nada chega a ser escrito: a
requisicao fica aberta ate o runtime mata-la, e **toda rota responde 504**. O
log de execucao mostra o aviso em cada invocacao:

```
WARN: default export returned a `Response`.
The default-export signature is `(req, res) => void` -- returns are ignored.
```

Exportar por metodo ativa o modo Web-standard, em que a `Response` devolvida e
de fato enviada. `tests/integration/vercel-handlers.test.ts` prende esse
formato, inclusive a ausencia do `export default`.

## 2. Reescritas

Em `vercel.json`, duas regras, nesta ordem:

```json
"rewrites": [
  { "source": "/api/(.*)", "destination": "/api/index" },
  { "source": "/(.*)", "destination": "/index.html" }
]
```

A primeira entrega a API; a segunda devolve o painel (SPA) para qualquer outro
caminho. A ordem importa: invertida, o painel engoliria as chamadas de API.

Nao ha mais reescrita por host. A plataforma deixou de renderizar os sites dos
clientes -- cada site e um projeto Vercel proprio, com o proprio dominio -- e o
unico host que este projeto atende e o do painel. `PLATFORM_HOSTS` continua
valendo para a politica de origem (CORS) e para os cookies de sessao.

## 3. Variaveis de ambiente

Em **Project Settings > Environment Variables**, cadastre as variaveis de
`.env.example` para *Production* e *Preview*. Todas sao lidas somente no
servidor; nenhuma e exposta ao navegador (nao existe nenhuma variavel
`VITE_*` com segredo no projeto).

Obrigatorias:

| Variavel | Observacao |
| --- | --- |
| `DATABASE_URL` | Conexao *pooled* do Neon |
| `AUTH_SECRET` | 32+ caracteres; trocar invalida todas as sessoes e links de e-mail |
| `APP_URL` | `https://app.seudominio.com` — usado nos links de e-mail e no CORS |
| `PLATFORM_HOSTS` | Os mesmos hosts da reescrita, separados por virgula |

Opcionais; cada uma desliga um recurso de forma explicita quando ausente:

| Variavel | Sem ela |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | A biblioteca de imagens informa que o envio esta indisponivel |
| `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID` (+ `VERCEL_TEAM_ID`) | Dominios ficam aguardando configuracao externa e nunca sao marcados como ativos |
| `RESEND_API_KEY` + `MAIL_FROM` | Confirmacao, redefinicao de senha e convites vao para o log do servidor |
| `VALIDAPAY_CLIENT_ID` + `VALIDAPAY_CLIENT_SECRET` (+ `VALIDAPAY_BASE_URL`) | A contratacao de planos e recusada com mensagem explicita |
| `VALIDAPAY_WEBHOOK_SECRET` | Os webhooks de pagamento sao recusados (401) |
| `BILLING_RECONCILIATION_SECRET` | O job de reconciliacao responde 501 e nao roda |

`GET /api/health` devolve esses tres indicadores em `features`, o que permite
conferir o que esta ativo em um deploy sem abrir o painel.

Em producao, `NODE_ENV` ja vem como `production`, o que liga `Secure` nos
cookies. `COOKIE_SECURE=false` serve apenas para desenvolvimento local em HTTP.

## 4. Dominio do painel

Em **Project Settings > Domains**, adicione `app.seudominio.com` e siga as
instrucoes de DNS da Vercel. Depois:

1. Ajuste `APP_URL` e `PLATFORM_HOSTS`.
2. Confirme que o host aparece na reescrita do `vercel.json`.
3. Faca um novo deploy — `vercel.json` so vale a partir do deploy que o contem.

Os dominios dos clientes **nao** sao adicionados a mao nesse painel: quem os
registra e a API, pelo backend, quando o cliente cadastra o dominio no painel
da empresa. Ver [dominios.md](dominios.md).

## 5. Migracoes no deploy

**O build prepara o banco sozinho.** Antes de compilar o painel, o
`buildCommand` roda `pnpm run db:deploy`, que:

1. aplica as migracoes pendentes;
2. cria os planos padrao **se a tabela estiver vazia**.

Numa instalacao nova isso significa zero passo manual: o deploy sobe com as
tabelas criadas e os planos no lugar, e a primeira conta cadastrada pela tela
assume o painel mestre.

Tres limites deliberados:

| Regra | Por que |
| --- | --- |
| So roda quando `VERCEL_ENV` e `production` | Preview e Development costumam apontar para o mesmo banco; um preview com schema diferente alteraria a producao |
| Sem `DATABASE_URL`, apenas avisa e segue | A aplicacao sobe e informa o que falta em `/api/health`, em vez de deixar quem opera sem nenhum deploy |
| Migracao que falha **derruba o build** | Publicar codigo que espera um schema inexistente e pior do que nao publicar |

Os planos nunca sao sobrescritos: a criacao so acontece com a tabela vazia.
Preco e limites ajustados no painel mestre sobrevivem a qualquer deploy.

### Nao promova um Preview a producao

A primeira regra tem uma consequencia que nao e obvia no painel da Vercel: uma
implantacao construida como *Preview* **nao tem migracao nenhuma aplicada**,
porque o passo foi pulado no build dela. Promove-la a producao (*Promote to
Production*) publica o codigo novo contra um banco que pode nao ter as tabelas
que ele espera -- e a tela volta a falhar, agora por outro motivo.

Producao se publica com um build de producao: um push no branch de producao, ou
*Redeploy* de uma implantacao que ja era de producao **e** aponta para o commit
desejado. O *Redeploy* reconstroi o commit daquela implantacao, nunca o mais
recente do branch; para publicar o commit mais novo, faca um push.

**Migracao destrutiva continua exigindo cuidado.** Remover uma coluna ou
tabela que o codigo no ar ainda usa quebra a aplicacao entre a migracao e a
troca do codigo. Faca em dois deploys: primeiro o que para de usar, depois o
que remove.

Para aplicar migracoes fora do deploy -- da sua maquina, contra qualquer
banco:

```bash
DATABASE_URL="postgresql://..." pnpm db:migrate
```

## 6. Cron: reconciliacao de cobranca e reenvio de avisos

O `vercel.json` ja agenda o job:

```json
"crons": [{ "path": "/api/billing/reconcile", "schedule": "23 5 * * *" }]
```

### A cadencia depende do plano

No plano **Hobby a Vercel so aceita cron diario**: uma expressao que dispare
mais de uma vez por dia **falha a implantacao**, com erro no momento de
registrar o cron. Como o cron so e registrado em producao, o erro nao aparece
em nenhum preview -- ele surge no primeiro deploy de producao, e foi assim que
apareceu aqui. O horario tambem e aproximado no Hobby: um job marcado para
05:23 roda em algum momento daquela hora.

Por isso o padrao e diario. No plano **Pro**, para reconciliar a cada duas
horas, troque por `"23 */2 * * *"` e faca um novo deploy.

A reconciliacao e uma **rede de seguranca**, nao o caminho principal: quem
atualiza o estado da assinatura em segundos e o webhook. Ela existe para o
caso de um webhook se perder. Com a cadencia diaria, esse caso raro pode levar
ate 24 h para se corrigir sozinho -- inclusive no sentido que mais incomoda, o
de um cliente que pagou e segue suspenso.

Duas saidas cobrem isso sem esperar o cron:

- a empresa tem **Consultar novamente** na propria tela de cobranca, que chama
  `POST /api/tenants/:id/billing/refresh` e reavalia a assinatura na hora;
- o painel mestre tem **Reconciliar agora**, que roda o job inteiro, e um botao
  por empresa para reconciliar so aquela assinatura.

Se a operacao depender de reconciliacao frequente, o plano Pro e o caminho
correto -- ou um agendador externo chamando a rota com o mesmo segredo.

A rota exige `Authorization: Bearer <segredo>`. A Vercel envia esse cabecalho
automaticamente quando a variavel `CRON_SECRET` existe no projeto, por isso
**defina `CRON_SECRET` com o mesmo valor de
`BILLING_RECONCILIATION_SECRET`**. Sem isso, o Cron dispara e recebe 401.

O job tem trabalho limitado por execucao (50 assinaturas e 50 cobrancas) para
caber no tempo da funcao; o que sobra fica para a passagem seguinte.

### O mesmo cron reenvia os avisos de publicacao

A rota faz **duas** coisas sem relacao entre si: reconcilia cobranca e
reenvia os webhooks `content.published` que o site do cliente nao recebeu.
Juntar e deliberado -- no Hobby existe **um** cron, e separar exigiria plano
pago para duas tarefas curtas e independentes.

A consequencia esta documentada na secao 6 de `docs/arquitetura-build.md`: uma
entrega que falha e repetida uma vez por dia. O caso comum nao sente, porque a
primeira tentativa acontece na propria publicacao; um site que ficou fora por
uma hora so recebe o aviso no dia seguinte. No Pro, aumentar a frequencia do
cron resolve sem mudar codigo.

O webhook de pagamento chega em `/api/webhooks/validapay` e e servido pela mesma
funcao `api/index.ts`. Ele le o corpo bruto (`c.req.text()`) antes de qualquer
validacao, porque o HMAC cobre os bytes exatos -- nao ha configuracao adicional
a fazer na Vercel para isso.

## 6b. Armazenamento de imagens (Vercel Blob)

Em **Storage**, crie um Blob store e conecte-o ao projeto. A Vercel define
`BLOB_STORE_ID` sozinha e autentica por **OIDC**: o token e de vida curta e
rotaciona automaticamente, entao **nao ha token para copiar** e nada deve ser
criado a mao.

Stores antigos, e qualquer execucao fora da Vercel (sua maquina, outro
provedor), usam `BLOB_READ_WRITE_TOKEN`, que continua aceito e tem
precedencia quando as duas variaveis existem.

Confirme em `/api/health`: `features.blobStorage` fica `true` com qualquer uma
das duas.

Nao invente um valor para `BLOB_READ_WRITE_TOKEN`. A aplicacao passa a se
considerar configurada e o envio falha no meio, o que e pior que o aviso
honesto de armazenamento indisponivel.

## 7. Cache e invalidacao

A plataforma nao renderiza site nenhum, entao nao ha pagina publica para
cachear aqui. **Toda** resposta da API -- painel e `/api/v1` -- sai com
`cache-control: no-store` (`apps/api/src/middleware/security.ts`). E
deliberado: a resposta depende da chave que autenticou e do que ela pode ler,
e uma copia guardada por intermediario entregaria a um site o conteudo
destinado a outro.

O cache fica no site do cliente, onde o projeto dele decide a estrategia:

- **Site Vite que busca no navegador** nao precisa de nada. Cada visita chama
  a API e a alteracao do cliente aparece sozinha. E o caso da maioria.
- **Site que renderiza no servidor e guarda cache** (Next.js com ISR, por
  exemplo) define o tempo de revalidacao no proprio projeto e, se quiser
  invalidar na hora, cadastra um endereco para receber o webhook
  `content.published` -- ver a secao 6 do `docs/integracao.md`. Sem o aviso o
  conteudo novo entra quando o cache expira, o que para muito site e
  suficiente.

Em nenhum dos dois casos o cliente precisa de um novo deploy para publicar
conteudo, que e o requisito do produto.

### O `index.html` do painel nunca e cacheado

Os arquivos de `/assets` tem hash no nome e saem com
`cache-control: public, max-age=31536000, immutable` -- eles podem ser
guardados para sempre justamente porque o nome muda a cada build.

Isso torna o `index.html` o unico ponto de invalidacao, e por isso ele sai com
`no-cache, must-revalidate`. Sem esse cabecalho a falha e desagradavel: um
`index.html` antigo guardado pelo navegador ou por um intermediario aponta
para hashes que **nao existem mais**, todo arquivo responde 404, e o painel
abre em branco -- sem erro na tela, sem log no servidor, ate o cache expirar
sozinho. O sintoma nao se parece com cache, e e.

Se mesmo assim alguem abrir o painel em branco logo depois de um deploy, um
`Ctrl+F5` confirma em um segundo: se resolver, era isso.

## 8. Limites a observar

| Limite | Valor configurado | Comentario |
| --- | --- | --- |
| Duracao da funcao | 30 s | Publicacao e verificacao de dominio ficam muito abaixo disso |
| Memoria | 1024 MB | Suficiente para o SSR do site inteiro |
| Corpo da requisicao | 4,5 MB (limite da plataforma) | O upload limita o arquivo a 4 MB |

## 9. Diagnostico rapido

Antes de investigar qualquer coisa, pergunte ao proprio deploy:

```bash
curl -s https://app.SEUDOMINIO.com.br/api/health | jq
```

| Resposta | Significado |
| --- | --- |
| `200` com `status: "ok"` | A API subiu. Com `?db=1`, o banco tambem responde |
| `503` com `status: "degradado"` | So com `?db=1`: a API subiu, mas o banco nao responde; o bloco `database` diz o que falhou |
| `504 FUNCTION_INVOCATION_TIMEOUT` | A funcao nem atendeu. Nao e o banco: veja os logs de execucao da funcao |
| `503` com `status: "misconfigured"` | Falta variavel de ambiente; `issues` lista quais |
| HTML da Vercel, ou `404` | A requisicao nem chegou a API: confira as reescritas por host |

### O bloco `database`

O health **nao toca no banco por padrao**, e isso e deliberado: um health que
consulta a dependencia que monitora trava junto com ela, e quem investiga
perde o unico instrumento. Sem banco no caminho, `/api/health` responde
sempre, e as duas perguntas ficam separadas:

| Pergunta | Como |
| --- | --- |
| A funcao sobe e o roteamento esta certo? | `/api/health` |
| O banco tambem esta de pe? | `/api/health?db=1` |

**Se `/api/health` nao responde, o problema nao e o banco** -- e a funcao ou a
implantacao. Um `FUNCTION_INVOCATION_TIMEOUT` nessa rota significa que a
funcao nem chegou a atender.

Com `?db=1`, a sondagem separa duas capacidades que falham por motivos
diferentes:

```json
{
  "database": {
    "query": "ok",
    "transaction": "falha",
    "latencyMs": 42,
    "code": null,
    "cause": "a consulta simples passa e a transacao nao: ..."
  }
}
```

| `query` | `transaction` | Significado |
| --- | --- | --- |
| `ok` | `ok` | O banco esta saudavel |
| `ok` | `falha` | O driver do Neon nao consegue abrir WebSocket. **Tudo que le funciona; tudo que escreve estoura o tempo** -- cadastro, publicacao e cobranca devolvem 504 |
| `falha` | `nao testada` | O banco nao respondeu: `code` e `cause` dizem se e credencial, host ou outra coisa |

Essa separacao existe porque o driver do Neon resolve consulta simples por HTTP
e so abre WebSocket quando ha transacao. Sem separar, a falha aparece como "o
site as vezes funciona".

A resposta traz o codigo e a causa classificada, nunca a mensagem crua do
driver -- o health e publico. A mensagem completa fica no log da funcao,
prefixada com `[health]`.

Quando o cadastro falha com uma mensagem generica no painel, e quase sempre o
segundo caso: a funcao nao conseguiu iniciar por configuracao incompleta.

### Qual versao esta no ar

As duas respostas acima trazem um bloco `deployment`, preenchido pelas
variaveis de sistema da Vercel:

```json
{
  "deployment": {
    "commit": "f697a34",
    "branch": "claude/friendly-johnson-b0ze15",
    "environment": "production",
    "region": "gru1"
  }
}
```

Compare `commit` com o ultimo commit do seu branch. Esta e a unica forma
confiavel de separar duas falhas que se parecem:

| Observado | Conclusao |
| --- | --- |
| `commit` e antigo | A producao esta presa em outro build. Verifique o *Production Branch* (secao 1) e se o ultimo deploy foi marcado *Production*, nao *Preview* |
| `commit` esta certo, mas a tela erra | O codigo no ar e o atual. O problema e de configuracao ou de dados — ou o navegador guardou o bundle anterior (recarregue com Ctrl+Shift+R) |
| `environment` responde `preview` | Voce abriu a URL de um preview, nao a de producao |
| `deployment` todo `null` | Nao esta rodando na Vercel, ou as *System Environment Variables* foram desligadas no projeto |

O bloco traz apenas metadados de build — commit, branch, ambiente e regiao.
Nenhum segredo passa por ele. Em um repositorio privado, ele revela o nome do
branch e o commit a quem acessar `/api/health`; nao ha nada acionavel nisso,
mas vale saber.

Com a API no ar e o cadastro ainda falhando, os dois suspeitos seguintes sao o
banco sem migracoes e o banco sem planos. O build de producao cuida dos dois
(secao 5), entao isto so acontece quando aquele build nao rodou com o
`DATABASE_URL` certo — por exemplo, se a variavel foi criada ou corrigida
depois dele. **Um novo deploy resolve**, e e o caminho preferido.

Se precisar aplicar na mao, contra o banco de producao:

```bash
DATABASE_URL="postgresql://..." pnpm db:migrate
```

```bash
DATABASE_URL="postgresql://..." pnpm db:seed
```

Sem planos nao existe o de avaliacao, e o cadastro responde "Nenhum plano
inicial configurado. Rode o seed de planos.". Note a diferenca entre os dois
caminhos: o build **cria** os planos padrao apenas quando a tabela esta vazia,
enquanto `db:seed` **reescreve** os planos existentes — use-o apenas se nao
houver precos ajustados no painel mestre que voce queira preservar.

## 10. Problemas comuns

| Sintoma | Causa |
| --- | --- |
| Corrigi o codigo, fiz deploy e nada mudou | A producao esta em outro build. Confira `deployment.commit` em `/api/health` e o *Production Branch* |
| Build falha em `prepare-db` / `[deploy] falha ao preparar o banco` | O log traz `causa provavel` e `o que fazer` logo abaixo. Os dois casos comuns sao a `DATABASE_URL` desatualizada (codigo `28P01`) e o schema criado a mao (codigo `42P07`) |
| Build falha ao registrar o Cron | No plano Hobby o cron precisa ser diario (secao 6) |
| **Toda** rota `/api/*` responde 504, inclusive `/api/health` | Handler exportado como `export default`: a Vercel descarta a `Response`. Veja "Formato dos handlers", secao 1 |
| Cadastro devolve 504 depois de uns 60 s | Veja `database.transaction` em `/api/health?db=1` |
| `/api/health` (sem `?db=1`) devolve 504 | A funcao nao esta atendendo. O banco nao entra nessa rota: o problema e da funcao ou da implantacao |
| Telas carregam, mas nada que grava funciona | Mesmo caso: consulta por HTTP passa, transacao por WebSocket nao |
| A mensagem de erro na tela nao existe mais no codigo | Mesmo caso acima: o bundle servido e de um commit anterior |
| Cadastro falha com mensagem generica | Variavel obrigatoria ausente; veja `/api/health` |
| `/api/health` responde 503 `misconfigured` | `DATABASE_URL` ausente ou `AUTH_SECRET` com menos de 32 caracteres |
| "Nenhum plano inicial configurado" | `pnpm db:seed` nunca rodou no banco de producao |
| `relation "users" does not exist` nos logs | `pnpm db:migrate` nunca rodou no banco de producao |
| Painel abre em branco, com "Carregando o painel..." parado | O bundle nao chegou ao navegador. Quase sempre `index.html` antigo em cache: `Ctrl+F5` confirma. Veja tambem se o ultimo build terminou |
| Painel abre com "O painel encontrou um erro" | Erro de renderizacao. A mensagem na tela e a do erro; o rastro completo esta no console do navegador |
| Painel responde 404 | O dominio do painel nao esta na reescrita por host |
| Site do cliente mostra o painel | O host do cliente casa com a regex da plataforma (ou falta `\.` escapado) |
| `Configuracao de ambiente invalida` nos logs | Variavel obrigatoria ausente; a mensagem nomeia quais |
| 401 em toda chamada apos o login | `APP_URL` diferente do dominio acessado: o CORS e o cookie nao batem |
| `ERR_PNPM_OUTDATED_LOCKFILE` | `pnpm-lock.yaml` nao versionado junto com a mudanca de dependencia |
| Cron responde 401 | `CRON_SECRET` ausente ou diferente de `BILLING_RECONCILIATION_SECRET` |
| Webhook da ValidaPay responde 401 | Segredo diferente do cadastrado no painel do provedor |
