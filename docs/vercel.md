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

As duas funcoes:

- `api/index.ts` — a API (`createApp`), servida em `/api/*`
- `api/site.ts` — os sites publicos (`createSiteApp`), renderizados no servidor

## 2. Ajustar a reescrita por host — passo obrigatorio

Em `vercel.json`:

```json
{
  "source": "/(.*)",
  "destination": "/api/site",
  "missing": [
    {
      "type": "host",
      "value": "(?:app\\.codecabuild\\.com|[^.]+\\.vercel\\.app|localhost(?::\\d+)?|127\\.0\\.0\\.1(?::\\d+)?)"
    }
  ]
}
```

Leia como: *"todo caminho vai para o renderizador dos sites, exceto quando o
host for um host da plataforma"*. Troque `app\.codecabuild\.com` pelo dominio do
seu painel, escapando os pontos. Para mais de um host da plataforma, separe com
`|`:

```
(?:app\.seudominio\.com|admin\.seudominio\.com|[^.]+\.vercel\.app|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)
```

Se esquecer esse ajuste, o dominio do painel passa a ser tratado como site de
cliente e responde 404 — e o sintoma mais comum de uma primeira implantacao.

Mantenha a entrada `*.vercel.app`: e o que faz os deploys de previa abrirem o
painel.

A ordem das reescritas importa: `/api/*` primeiro, os sites publicos depois e,
por fim, `/index.html` para o painel (SPA).

A mesma lista tambem precisa estar em `PLATFORM_HOSTS`, que e o que a API usa
para nao resolver um host da plataforma como site de cliente. O host de
`APP_URL` e os `*.vercel.app` entram automaticamente (ver
`platformHosts()` em `apps/api/src/env.ts`).

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

## 6. Cron da reconciliacao de cobranca

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

O webhook de pagamento chega em `/api/webhooks/validapay` e e servido pela mesma
funcao `api/index.ts`. Ele le o corpo bruto (`c.req.text()`) antes de qualquer
validacao, porque o HMAC cobre os bytes exatos -- nao ha configuracao adicional
a fazer na Vercel para isso.

## 7. Cache e invalidacao

As paginas publicas sao renderizadas no servidor e respondem com:

- `cache-control: public, max-age=0, s-maxage=..., stale-while-revalidate=...` —
  a borda da Vercel serve a copia pronta e revalida em segundo plano, enquanto o
  navegador sempre confere;
- `etag` derivado da versao publicada do site e do caminho, o que permite 304
  sem refazer o HTML.

Publicar incrementa `published_version` em `site_settings`, o que muda o ETag de
todas as paginas daquela empresa e invalida o cache sem tocar em nenhuma outra.
O painel (`/api/*` e a previa) responde `no-store`.

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
| `200` com `status: "ok"` | A API subiu e o banco responde. O problema e outro |
| `503` com `status: "degradado"` | A API subiu, mas o banco nao responde; o bloco `database` diz o que falhou |
| `503` com `status: "misconfigured"` | Falta variavel de ambiente; `issues` lista quais |
| HTML da Vercel, ou `404` | A requisicao nem chegou a API: confira as reescritas por host |

### O bloco `database`

O health **consulta o banco**, e separa duas capacidades que falham por
motivos diferentes:

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
| Cadastro devolve 504 depois de uns 60 s | A transacao nao completa. Veja `database.transaction` em `/api/health` |
| Telas carregam, mas nada que grava funciona | Mesmo caso: consulta por HTTP passa, transacao por WebSocket nao |
| A mensagem de erro na tela nao existe mais no codigo | Mesmo caso acima: o bundle servido e de um commit anterior |
| Cadastro falha com mensagem generica | Variavel obrigatoria ausente; veja `/api/health` |
| `/api/health` responde 503 `misconfigured` | `DATABASE_URL` ausente ou `AUTH_SECRET` com menos de 32 caracteres |
| "Nenhum plano inicial configurado" | `pnpm db:seed` nunca rodou no banco de producao |
| `relation "users" does not exist` nos logs | `pnpm db:migrate` nunca rodou no banco de producao |
| Painel responde 404 | O dominio do painel nao esta na reescrita por host |
| Site do cliente mostra o painel | O host do cliente casa com a regex da plataforma (ou falta `\.` escapado) |
| `Configuracao de ambiente invalida` nos logs | Variavel obrigatoria ausente; a mensagem nomeia quais |
| 401 em toda chamada apos o login | `APP_URL` diferente do dominio acessado: o CORS e o cookie nao batem |
| `ERR_PNPM_OUTDATED_LOCKFILE` | `pnpm-lock.yaml` nao versionado junto com a mudanca de dependencia |
| Cron responde 401 | `CRON_SECRET` ausente ou diferente de `BILLING_RECONCILIATION_SECRET` |
| Webhook da ValidaPay responde 401 | Segredo diferente do cadastrado no painel do provedor |
