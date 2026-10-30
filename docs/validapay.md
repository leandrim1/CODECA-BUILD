# Pagamentos e assinaturas (ValidaPay)

Como a cobranca do Codeca Build funciona, o que a API da ValidaPay oferece, o
que ela **nao** oferece, e como configurar sandbox e producao.

Fonte: <https://docs.validapay.com.br>. Os contratos abaixo foram conferidos na
documentacao oficial, e os corpos enviados pela integracao foram validados
contra o schema de cada rota.

## 1. A limitacao que define o desenho

**Nao existe `POST /v1/subscriptions`.** A ValidaPay nao cria assinaturas por
API: uma assinatura **nasce quando uma cobranca com item recorrente e paga**.

Por isso o fluxo de contratacao e este, e nao "criar a assinatura e depois
cobrar":

```
1. Admin cadastra o plano no painel mestre        (banco de dados)
2. Plataforma sincroniza o plano na ValidaPay     POST /v1/products
   -> devolve productId (prod_) e priceId (price_)
3. Empresa escolhe plano + forma de pagamento     (painel da construtora)
4. Backend cria a sessao de checkout              POST /v1/checkout-sessions
   -> devolve a URL hospedada da ValidaPay
5. Empresa paga nessa pagina                      (fora da nossa aplicacao)
6. Webhooks trazem a assinatura:
   subscription.created   -> vincula sub_... a empresa
   payment.success        -> confirma o pagamento
   subscription.activated -> assinatura ativa
7. Publicacao liberada                            (so aqui)
```

Consequencia pratica: **uma assinatura "criada" nao e uma assinatura paga.**
Enquanto o pagamento nao e confirmado, a assinatura fica `pending` e o site
nao e publicado. Nenhum passo da plataforma trata a criacao como sucesso
financeiro.

O cartao e tokenizado na pagina da ValidaPay: dados de cartao **nunca** passam
pelo nosso servidor, e nao ha nada a armazenar. E por isso que a integracao usa
o checkout hospedado em vez do checkout transparente.

## 2. Formas de pagamento e recorrencia

A documentacao e explicita sobre o que renova sozinho:

| Forma | Renovacao | Requisitos |
| --- | --- | --- |
| **Cartao de credito** | Automatica, com regua de retentativas | — |
| **Pix Automatico** | Automatica (debito autorizado no banco do pagador) | **Conta ValidaPay PJ** e valor minimo de **R$ 4,99** por cobranca |
| Pix comum | **Manual**: a ValidaPay emite um Pix por ciclo, o cliente paga cada um | — |
| Boleto | **Manual**: um boleto por ciclo | — |

O painel informa isso ao cliente antes da contratacao, e o backend recusa a
combinacao invalida:

- `400 PIX_AUTOMATICO_PJ_ONLY` quando a conta da plataforma e PF;
- `400 PIX_AUTOMATICO_MIN_AMOUNT` quando o plano custa menos de R$ 4,99 —
  verificado antes mesmo de chamar a API.

**Pix comum nao e assinatura automatica.** A plataforma nao apresenta como se
fosse: `PAYMENT_METHOD_OPTIONS[...].automatic` e `false`, e a tela mostra o
aviso de pagamento manual.

No Pix Automatico, a troca de plano tem limites impostos pela autorizacao
bancaria: valor fixo (`PIX_AUTOMATICO_FIXED_AMOUNT`), valor minimo
(`PIX_AUTOMATICO_MIN_AMOUNT`) e periodicidade
(`RECURRENCE_CHANGE_REQUIRES_NEW_ADHESION`). Cada um volta ao cliente como
mensagem em portugues, explicando que e preciso uma nova autorizacao.

## 3. Autenticacao

OAuth2 `client_credentials`, em um host **diferente** do host da API:

| | API | OAuth2 |
| --- | --- | --- |
| Producao | `https://api.validapay.com.br` | `https://oauth2.validapay.com.br` |
| Sandbox | `https://sandbox.validapay.com.br` | `https://oauth2-sandbox.validapay.com.br` |

```http
POST /auth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=...&client_secret=...&scope=charges/write
```

O token vale 3600 s. A integracao o guarda em memoria do processo com um minuto
de margem (`apps/api/src/lib/validapay/client.ts`) e o pede por escopo. Um 401
descarta o token em cache e tenta de novo uma vez.

**Escopos necessarios**, marcados ao criar a credencial em
`app.validapay.com.br/integracao/api`:

`products/read`, `products/write`, `checkouts/read`, `checkouts/write`,
`subscriptions/read`, `subscriptions/write`, `charges/read`.

Uma rota chamada sem o escopo responde 403; a integracao traduz isso para uma
mensagem que nomeia os escopos que faltam.

Credenciais sao **por ambiente**: a de sandbox nao funciona em producao.

## 4. Valores: reais na API, centavos no banco

A API da ValidaPay trabalha em **reais com duas casas** (`199.00`, nunca
`19900`). O banco guarda **centavos inteiros**, que e o correto para dinheiro.

A conversao acontece so na fronteira, em `packages/shared/src/billing/money.ts`,
e nunca por multiplicacao direta de ponto flutuante — `89.9 * 100` resulta em
`8989.999...` em IEEE 754. A conversao passa pelo texto decimal:

```ts
reaisToCents(89.9)   // 8990, nao 8989
centsToReaisString(8990) // "89.90"
```

Ha teste de ida e volta para todos os valores usados, incluindo os centavos
isolados. Nenhum calculo financeiro usa `float`.

## 5. Webhooks

URL a cadastrar em `app.validapay.com.br/integracao/webhooks`:

```
https://app.SEUDOMINIO.com.br/api/webhooks/validapay
```

### Assinatura

O cabecalho `X-Webhook-Signature` **nao** e um HMAC do corpo. Ele e composto:

```
X-Webhook-Signature: t=1757083200000,v1=9f2b8c...
v1 = HMAC_SHA256(VALIDAPAY_WEBHOOK_SECRET, `${t}.${corpo_bruto}`)
```

- `t` esta em **milissegundos**;
- a string assinada inclui o timestamp, um ponto e o **corpo bruto**;
- `JSON.parse` + reserializar muda espacamento e ordem das chaves e quebra o
  HMAC. A rota le `await c.req.text()` antes de qualquer validacao e so
  interpreta o JSON depois de provada a origem.

A verificacao usa `timingSafeEqual` e rejeita timestamps fora da janela de
`VALIDAPAY_WEBHOOK_TOLERANCE_SECONDS` (padrao 300 s), para que uma assinatura
capturada nao valha para sempre.

Cabecalhos lidos: `X-Webhook-Signature`, `X-Webhook-Id` (deduplicacao),
`X-Webhook-Event`, `X-Webhook-Attempt` e `x-access-token` (token estatico
opcional, barreira adicional que nunca substitui a assinatura).

### Ordem das operacoes

```
corpo bruto -> assinatura valida? -> grava o evento -> responde 2xx -> processa
```

Responder 2xx **somente depois da gravacao** garante que nenhum evento aceito
se perde. Se o processamento falhar, o evento fica `failed` com a mensagem
sanitizada e a resposta continua 2xx — devolver 5xx faria a ValidaPay reenviar
por 72 horas sem necessidade. A retomada e feita pelo job de reconciliacao ou
pelo botao de reprocessar no painel mestre.

Assinatura invalida responde **401 e nada e gravado**.

### Idempotencia

A entrega e *at-least-once* e as retentativas vao ate 72 horas (1 min, 3, 7,
15, 31, ~1 h, ~2 h, ~4 h, ~8,5 h, depois a cada 12 h). Tres barreiras
independentes:

1. `webhook_events.external_event_id` e **unico** — o `X-Webhook-Id` e o mesmo
   em todas as tentativas, e a segunda chegada nao reprocessa nada;
2. `charges.external_charge_id` e **unico** — o mesmo pagamento nunca vira duas
   cobrancas;
3. estados de cobranca **so avancam** (`chargeStateAdvances`) — um `pending`
   atrasado nao reabre uma cobranca paga, e `extendAccessOnly` impede que uma
   renovacao encurte o acesso ja pago.

Resultado: reentrega e reprocessamento nao duplicam pagamento nem periodo. Ha
teste para cada uma dessas tres garantias.

### Eventos tratados

| Evento | Efeito na plataforma |
| --- | --- |
| `subscription.created` | Vincula `sub_...` a empresa; estado `pending`, **sem publicar** |
| `subscription.trial` | Periodo de teste, com `accessUntil` no fim do trial |
| `subscription.activated`, `payment.success`, `subscription.renewed` | Confirma pagamento, estende o acesso ate `nextChargeDate`, publica |
| `payment.overdue` | Estado `past_due`; o site segue no ar durante a tolerancia |
| `payment.failed`, `payment.retry` | Registra a recusa e o motivo; **nao** cancela |
| `charge.created`, `charge.expired` | Atualiza a cobranca (aqui o `status` da raiz e o da **cobranca**) |
| `subscription.cancel_scheduled` | `cancel_at_period_end`; o site fica no ar ate o fim do periodo |
| `subscription.canceled` | Cancelada; publicacao so enquanto houver periodo pago |
| `subscription.expired` | Encerrada por falta de pagamento |
| `subscription.upgraded`, `downgrade_scheduled`, `item_added`, `item_removed` | Registra a mudanca de plano |
| `refund.requested`, `refund.confirmed`, `refund.failed` | Estorno total suspende o site para revisao; parcial fica registrado; recusado mantem a cobranca paga |

Eventos nao tratados (por exemplo `onboarding.*`, `med.*`, `dda.*`) sao
gravados como `ignored`, nunca descartados silenciosamente.

**Armadilha do contrato, codificada no codigo:** em `payment.*` e
`subscription.*` o `status` da raiz e o da **assinatura**, e o da cobranca esta
em `currentCycle.status`; em `charge.created` e `charge.expired` o `status` da
raiz e o da **cobranca**. Ver `chargeStatusForEvent` em
`apps/api/src/lib/billing/events.ts`.

Quatro dos eventos listados (`subscription.upgraded`, `item_added`,
`item_removed`, `downgrade_scheduled`) **nao aparecem na tela de webhooks do
painel**: para assina-los e preciso enviar o nome no array `events` de
`POST /v1/users/webhooks`.

### Como a empresa e identificada

Nunca por e-mail ou documento — dois clientes podem compartilhar um e-mail de
contato, e um evento nao prova a quem pertence. A ordem e:

1. `subscriptionId` ja vinculado em `subscriptions.external_subscription_id`;
2. `metadata.intentToken` — token opaco que **nos** enviamos na sessao de
   checkout e que volta no evento;
3. `chargeId` de uma cobranca ja registrada (caminho dos eventos `refund.*`,
   que nao trazem `subscriptionId`).

Se nada resolver, o evento fica `unresolved` para reconciliacao, e aparece no
painel mestre. A plataforma **nao** atribui pagamento por aproximacao. Um
`metadata.tenantId` que contradiga o vinculo gravado e ignorado (ha teste).

## 6. Estados

Quatro coisas distintas, propositalmente separadas
(`packages/shared/src/billing/states.ts`):

1. **Assinatura na ValidaPay**: `PENDING` `TRIALING` `ACTIVE` `PAST_DUE`
   `DEFAULT` `EXPIRED` `CANCELED` `COMPLETED` `ARCHIVED`
2. **Cobranca na ValidaPay**: `PENDING` `PROCESSING` `AWAITING_PAYMENT` `PAID`
   `FAILED` `EXPIRED` `CANCELED` `ARCHIVED` `DISPUTE` `REFUNDED`
   `PARTIALLY_REFUNDED` `CHARGED_BACK`
3. **Estado comercial na plataforma**: `pending` `trialing` `active` `past_due`
   `cancel_at_period_end` `canceled` `expired` `completed` `suspended`
4. **Estado de publicacao**: `allowed` `blocked_pending` `blocked_overdue`
   `blocked_canceled` `blocked_dispute` `blocked_admin`

O status cru do provedor fica em `subscriptions.provider_status`, sem traducao,
ao lado do estado comercial. `DEFAULT` e `PAST_DUE` caem ambos em `past_due` —
a diferenca continua visivel na coluna crua. `suspended` nunca vem do provedor:
so o painel mestre o define.

### Regras de publicacao

`decidePublication` e uma funcao **pura**, usada pelo webhook, pela
reconciliacao, pelo painel e pelo renderizador do site — uma unica fonte da
verdade:

- suspensao administrativa vence tudo;
- estorno ou contestacao em revisao suspende;
- `pending` nunca publica, mesmo com data futura;
- atraso publica durante a tolerancia (padrao 5 dias, ajustavel por empresa) e
  suspende quando ela vence;
- cancelamento respeita o periodo pago, **sem** tolerancia extra;
- o acesso so avanca com pagamento confirmado — nunca pela criacao da
  assinatura.

O renderizador avalia essa funcao com o relogio da requisicao, por isso uma
tolerancia vencida suspende o site **sem depender de nenhum job ter rodado**.

### Suspender nao apaga nada

Suspensao afeta a publicacao do site, e so. Conteudo, imoveis, obras, imagens e
configuracoes continuam no banco, o painel continua acessivel para a empresa
regularizar, e a previa autenticada continua funcionando. Ha teste para cada um
desses pontos.

## 7. Reconciliacao

`POST` ou `GET /api/billing/reconcile`, com
`Authorization: Bearer $BILLING_RECONCILIATION_SECRET`.

Cada execucao, com trabalho limitado para caber no tempo da funcao:

1. recalcula a publicacao de todas as assinaturas (trial vencido, tolerancia
   esgotada) — funciona **sem** credenciais do provedor;
2. reprocessa eventos `pending`, `failed` e `unresolved`;
3. reconsulta cobrancas em aberto (`GET /v1/charges/{id}/status`);
4. reconsulta assinaturas (`GET /v1/subscriptions/{id}`), corrige divergencias
   e grava o historico;
5. para uma contratacao paga sem webhook, confere a sessao de checkout e
   localiza a assinatura — aceitando o vinculo **somente** quando a assinatura
   aponta para a nossa sessao (`checkoutId`).

Nada duplica: a reconciliacao passa pelas mesmas funcoes monotonicas do
webhook. Uma suspensao administrativa nao e desfeita por ela.

Na Vercel, o `vercel.json` ja agenda `23 5 * * *` -- diario, porque o plano
Hobby so aceita cron diario e recusa a implantacao com qualquer expressao mais
frequente. No plano Pro, `23 */2 * * *` reconcilia a cada duas horas. Defina
`CRON_SECRET` com o mesmo valor de `BILLING_RECONCILIATION_SECRET`: o Cron
envia esse cabecalho automaticamente.

A cadencia do cron nao define quanto tempo um cliente espera: o webhook
continua atualizando a assinatura em segundos, e o botao **Consultar
novamente**, na tela de cobranca da empresa, reavalia a assinatura sob
demanda.

## 8. Configuracao

### Sandbox

1. No painel da ValidaPay, troque para o ambiente de **sandbox**.
2. **Integracao > API > Criar Credencial**, com os sete escopos da secao 3.
3. Defina no `.env`:
   ```
   VALIDAPAY_CLIENT_ID=...
   VALIDAPAY_CLIENT_SECRET=...
   VALIDAPAY_BASE_URL=https://sandbox.validapay.com.br
   ```
   `VALIDAPAY_AUTH_URL` pode ficar vazio: o host do OAuth2 e derivado.
4. **Integracao > Webhooks**, cadastre a URL e copie o segredo para
   `VALIDAPAY_WEBHOOK_SECRET`. Para desenvolvimento local, exponha
   `http://localhost:5173` com um tunel e use a URL publica.
5. Gere `BILLING_RECONCILIATION_SECRET` com `openssl rand -hex 32`.
6. No painel mestre, em **Cobranca**, sincronize cada plano cobravel.

### Producao

As mesmas etapas, no ambiente de producao e com credencial propria:

```
VALIDAPAY_BASE_URL=https://api.validapay.com.br
```

Rotacao de credencial: crie a nova, troque a variavel, implante, e so depois
remova a antiga — a remocao e imediata e derruba quem ainda a usa.

## 9. Checklist de sandbox

Cada item e verificavel no painel e no banco.

- [ ] `GET /api/health` mostra `features.billing`, `features.billingWebhooks` e
      `features.billingReconciliation` como `true`.
- [ ] Painel mestre > Cobranca: cada plano cobravel aparece como sincronizado,
      com `price_...`.
- [ ] Contratar o plano Essencial com cartao abre a pagina da ValidaPay.
- [ ] Antes de pagar: assinatura `pending`, publicacao
      `blocked_pending`, site fora do ar (com a avaliacao vencida).
- [ ] Pagar com `4111111111111111` (aprovado no sandbox).
- [ ] Chegam `subscription.created`, `payment.success` e
      `subscription.activated`; a assinatura fica `active` e o site publica.
- [ ] O historico de cobrancas mostra a cobranca paga, com valor correto em
      reais.
- [ ] Recusa: contratar com `4000000000000002` gera `payment.failed`; a
      assinatura **nao** e cancelada e o motivo aparece no painel.
- [ ] Pix: criar a cobranca e confirmar com
      `POST /v1/wallet/pay/{chargeId}` (apenas sandbox) — o webhook de
      confirmacao chega e a baixa acontece.
- [ ] Reentrega: reenviar o mesmo evento (mesmo `X-Webhook-Id`) pelo painel da
      ValidaPay nao cria segunda cobranca nem estende o periodo.
- [ ] `POST /api/billing/reconcile` com o segredo responde 200 e o relatorio
      traz `subscriptionsChecked`.
- [ ] Sem o segredo, a mesma rota responde 401.
- [ ] Cancelar pelo painel da empresa: com periodo pago, o cancelamento e
      agendado e o site continua no ar.
- [ ] Suspender pelo painel mestre: o site sai do ar, o conteudo permanece e a
      auditoria registra autor e justificativa.

## 10. Checklist de ativacao em producao

- [ ] Credenciais de **producao** nas variaveis da Vercel (Production e
      Preview, se o preview usar sandbox, com valores diferentes).
- [ ] `VALIDAPAY_BASE_URL=https://api.validapay.com.br`.
- [ ] Webhook de producao cadastrado na URL do dominio do painel, com segredo
      proprio (diferente do sandbox).
- [ ] Assinar tambem os quatro eventos que nao aparecem no painel
      (`POST /v1/users/webhooks` com o array `events`), se a plataforma for
      usar troca de plano e itens adicionais.
- [ ] `BILLING_RECONCILIATION_SECRET` e `CRON_SECRET` com o mesmo valor.
- [ ] Planos sincronizados no ambiente de producao — os `price_` do sandbox
      **nao** valem aqui.
- [ ] Uma contratacao real de ponta a ponta, com valor baixo, conferindo a
      liberacao da publicacao e a cobranca no extrato.
- [ ] Monitorar `Painel mestre > Cobranca > Eventos` nos primeiros dias:
      nenhum evento deve ficar em `failed` ou `unresolved`.
- [ ] Conferir que a conta ValidaPay e **PJ** antes de oferecer Pix Automatico.
- [ ] Confirmar com a ValidaPay as taxas por forma de pagamento (aparecem em
      `lastCharge.fees` na consulta de assinaturas).

## 11. Problemas comuns

| Sintoma | Causa |
| --- | --- |
| `integration_not_configured` ao contratar | `VALIDAPAY_CLIENT_ID`/`SECRET` ausentes |
| Webhook responde 401 | Segredo diferente do cadastrado, ou corpo alterado por um proxy |
| Webhook responde 401 com "tolerancia" | Relogio do servidor fora de hora, ou reentrega muito antiga |
| 403 em uma rota da API | Escopo faltando na credencial |
| `PRICE_NOT_FOUND` / `PRICE_INACTIVE` | Plano nao sincronizado, ou sincronizado no outro ambiente |
| Assinatura fica `pending` apos o pagamento | Webhook nao chega: confira a URL cadastrada e rode a reconciliacao |
| Evento `unresolved` no painel | Assinatura criada fora do nosso checkout; vincule pela reconciliacao |
| Pix Automatico recusado | Conta PF (`PIX_AUTOMATICO_PJ_ONLY`) ou valor abaixo de R$ 4,99 |
| Site fora do ar com assinatura ativa | Suspensao administrativa ou estorno em revisao; veja o painel mestre |
