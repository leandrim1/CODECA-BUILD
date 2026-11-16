# Avisos por e-mail sobre a conta

Dez e-mails que a plataforma manda sozinha, em momentos definidos, para os
proprietários de cada empresa. São avisos sobre a conta — não há campanha,
lista de divulgação nem envio disparado por cliente.

> **Situação: implementado e DESLIGADO.** `BILLING_EMAILS_ENABLED` nasce
> `false`. Enquanto a entrega de e-mail não estiver comprovada em produção
> (seção 9), ligar é prometer avisos que podem não chegar.

## 1. Os dez avisos

| # | Aviso (`kind`) | Quando nasce | Chave do evento |
| --- | --- | --- | --- |
| 1 | Boas-vindas (`welcome`) | E-mail da conta confirmado; ou criação da empresa por quem entrou com Google | `welcome:{empresa}:{usuário}` |
| 2 | Avaliação termina em 3 dias (`trial_ending_3d`) | 3 dias de calendário antes do fim | `trial_ending_3d:{empresa}:{fim da avaliação}` |
| 3 | Avaliação termina amanhã (`trial_ending_1d`) | Véspera do fim | `trial_ending_1d:{empresa}:{fim}` |
| 4 | Avaliação encerrada (`trial_ended`) | Primeira passagem depois do fim, sem assinatura paga | `trial_ended:{empresa}:{fim}` |
| 5 | Pagamento confirmado (`payment_confirmed`) | Cobrança gravada como paga | `payment_confirmed:{id da cobrança na ValidaPay}` |
| 6 | Pagamento recusado (`payment_failed`) | Cobrança gravada como recusada | `payment_failed:{id da cobrança}` |
| 7 | Assinatura em atraso (`subscription_overdue`) | Assinatura em atraso, com o acesso ainda liberado | `subscription_overdue:{assinatura}:{fim do ciclo}` |
| 8 | Acesso suspenso (`access_suspended`) | Acesso bloqueado por atraso, estorno ou decisão da plataforma | `access_suspended:{assinatura}:{motivo}:{data}` |
| 9 | Cancelamento confirmado (`subscription_canceled`) | Cancelamento agendado ou efetivado | `subscription_canceled:{assinatura}:{data}` |
| 10 | Exclusão concluída (`account_deleted`) | Depois que a empresa foi de fato excluída | `account_deleted:{empresa}` |

Os textos estão em `apps/api/src/lib/mail/templates.ts` e **foram aprovados
pelo proprietário do produto**. Mudar um texto é decisão dele.

### Regras que valem para todos

- **Quem recebe:** os proprietários ativos da empresa. Administradores,
  editores e o e-mail de contato público da empresa não recebem. A exclusão
  concluída vai para quem pediu a exclusão.
- **Fuso:** "em 3 dias", "amanhã" e todas as datas mostradas são do horário de
  Brasília (`America/Sao_Paulo`).
- **Horário dos avisos de avaliação:** só são criados entre 8h e 20h de
  Brasília — na prática, na tarefa das 14h47. Os de cobrança nascem quando o
  evento chega.
- **Formato:** HTML e texto simples com o mesmo conteúdo. Sem imagem, sem
  pixel de rastreamento, sem link encurtado. Os únicos links apontam para o
  painel (`APP_URL`).
- **O que nunca entra:** senha, token, código de acesso, motivo da recusa,
  bandeira ou número de cartão. O aviso de pagamento recusado não diz o motivo.
- **Nenhum aviso cobra nada.** O fim da avaliação não gera cobrança; os e-mails
  só dizem o que aconteceu e onde contratar.

## 2. De onde nascem

```
webhook da ValidaPay ──► grava assinatura/cobrança ──┐
conciliação (02h23) ───► confirma o estado ──────────┤
tarefa da tarde (14h47) ─────────────────────────────┼─► runAccountNotices
                                                     │     1. cria os avisos devidos (lê o estado gravado)
confirmação de e-mail ──► boas-vindas ───────────────┤     2. envia o que está na vez
exclusão da empresa ────► exclusão concluída ────────┘
```

**Os avisos de cobrança leem o estado já gravado** — as tabelas
`subscriptions` e `charges`, como o webhook e a conciliação as deixaram. Nada
em `lib/mail/notices.ts` interpreta evento da ValidaPay de novo, e nada vem do
navegador: "pagamento confirmado" só existe quando há uma cobrança `paid` no
banco. Abrir o pagamento, gerar Pix ou emitir boleto não gera aviso.

Não foi criado nenhum agendamento novo: os avisos rodam dentro das duas
tarefas que já existiam (`/api/billing/reconcile` e `/api/sync/run`) e depois
de cada webhook de cobrança. `runAccountNotices` **nunca lança**: uma falha nos
avisos é registrada no monitor e não interrompe a conciliação nem o pagamento.

Fatos antigos não viram aviso: cobranças e cancelamentos com mais de 3 dias e
suspensões com mais de 7 são ignorados. É o que impede uma rajada de avisos
atrasados no dia em que o recurso for ligado.

## 3. A fila (`email_outbox`)

Cada aviso é um registro, gravado antes de qualquer tentativa de envio.

| Situação | Significado |
| --- | --- |
| `pending` | Aguardando a vez (ou a próxima tentativa, em `next_attempt_at`) |
| `sending` | Reservado por um processo, sendo enviado |
| `sent` | **Aceito pelo provedor.** Não quer dizer que chegou |
| `failed` | Recusa definitiva, 5 tentativas esgotadas ou prazo de 48 h vencido |
| `suppressed` | Endereço fora dos avisos (devolveu em definitivo ou marcou como spam) |

Cada registro guarda: tipo, chave, destinatário, assunto, dados do modelo,
tentativas, próximo horário, provedor, identificador no provedor, último erro
(sem endereço de e-mail), situação de entrega e datas.

**É uma tabela do Postgres, e não Redis ou serviço de fila.** O volume é de
dezenas de e-mails por dia; o banco já existe, já tem backup e é transacional.
Custo adicional: nenhum. Nenhuma dependência nova foi instalada.

### Idempotência

`dedupe_key` é única no banco e é formada pela **chave do evento** (tabela da
seção 1) mais o resumo do destinatário. O mesmo evento — vindo do webhook, de
uma reentrega, da conciliação ou das duas tarefas no mesmo dia — só consegue
criar um registro por pessoa. O endereço de e-mail sozinho nunca é a chave.

No provedor, a chave de idempotência é o `id` do registro: uma nova tentativa
do mesmo registro não vira um segundo e-mail.

### Tentativas e falhas

| Resposta do provedor | O que acontece |
| --- | --- |
| Aceitou | `sent`, com o identificador do provedor |
| Falha passageira (5xx, 429, rede, circuito aberto) | Volta para `pending`; novas tentativas em 1, 5, 30 e 120 minutos; na 5ª falha, `failed` |
| Recusa da mensagem (4xx: endereço ou conteúdo inválido) | `failed` na hora, sem nova tentativa |
| Recusa por chave ou domínio (401, 403) | Tratada como passageira: resolve-se na configuração, e a mesma mensagem passa |
| Provedor não configurado | Nada é tentado; os registros esperam (até o prazo de 48 h) |

Aviso parado há mais de 48 h não é mais enviado: "sua avaliação termina amanhã"
entregue três dias depois é uma informação errada.

### Concorrência e recuperação

Dois processos podem esvaziar a fila ao mesmo tempo: cada registro é reservado
com `FOR UPDATE SKIP LOCKED` e marcado `sending` na mesma transação. Se o
processo morrer no meio, o registro fica `sending`; depois de 10 minutos, a
próxima passagem o devolve para `pending`.

## 4. Eventos de entrega (webhook do Resend)

`POST /api/webhooks/resend` — pública, autenticada pela assinatura do Resend
(padrão Svix: `svix-id`, `svix-timestamp`, `svix-signature`), conferida sobre o
corpo bruto, com janela de 5 minutos. Sem `RESEND_WEBHOOK_SECRET`, recusa tudo.

| Evento | Efeito |
| --- | --- |
| `email.delivered` | `delivery_status = delivered` — só aqui se pode dizer que chegou |
| `email.delivery_delayed` | `delivery_status = delayed` |
| `email.bounced` | `bounced`; se a devolução for **definitiva**, o endereço sai dos avisos |
| `email.complained` | `complained`; o endereço sai dos avisos |

Eventos repetidos ou fora de ordem não mudam o resultado (um "entregue"
atrasado não apaga uma devolução). Evento de e-mail que não é da fila é
confirmado e ignorado.

**Endereço fora dos avisos** fica em `email_suppressions`, que guarda só o
resumo (HMAC) do endereço. Ele deixa de receber os dez avisos. Código de
acesso e recuperação de senha **continuam sendo tentados**.

> **Não verificado contra a documentação do Resend.** Os nomes dos campos
> usados (`type`, `data.email_id`, `data.bounce.type`) e o padrão de assinatura
> foram implementados de memória: a documentação do Resend não estava
> acessível deste ambiente. **Antes de ligar, confira com um evento real** — o
> painel do Resend tem um botão de envio de teste do webhook. Se o campo que
> diz que a devolução é definitiva tiver outro nome, a devolução é registrada,
> mas o endereço não é retirado dos avisos.

## 5. Variáveis de ambiente

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `BILLING_EMAILS_ENABLED` | `false` | Liga os avisos. Desligado, nada entra na fila nem é enviado |
| `SUPPORT_EMAIL` | vazio | Contato mostrado nos avisos. Vazio: a linha de suporte é omitida |
| `RESEND_WEBHOOK_SECRET` | vazio | Segredo do webhook de entrega (`whsec_…`) |
| `RESEND_API_KEY`, `MAIL_FROM` | — | Já existiam: provedor e remetente. Ver [`email.md`](./email.md) |

Valor vazio ou inválido nas três primeiras é ignorado, com aviso no log — não
derruba a API.

## 6. Guarda de dados

O registro de envio contém o e-mail do destinatário. Depois de **90 dias**, o
endereço é apagado dos registros já resolvidos (a conciliação diária faz isso);
o resumo e o histórico ficam. Isso vale mesmo com os avisos desligados.

## 7. Como investigar

| Pergunta | Onde olhar |
| --- | --- |
| "O cliente diz que não recebeu" | `email_outbox` pela empresa (`tenant_id`) e pelo tipo (`kind`). `status` diz se foi aceito; `delivery_status`, se chegou; `last_error`, por que não |
| Não há registro | Os avisos estavam desligados; o fato era antigo; a pessoa não é proprietária ativa; ou (avaliação) a tarefa da tarde não rodou |
| `suppressed` | O endereço devolveu ou marcou como spam. Para voltar a enviar, apague a linha dele em `email_suppressions` — só com pedido da pessoa |
| `failed` com 5 tentativas | O provedor ficou fora. Veja o painel do Resend e os alertas `email_failed` |
| Muitos `sending` antigos | Um processo morreu; a próxima passagem recupera. Se não recuperar, as tarefas agendadas não estão rodando |
| O que a última passagem fez | A resposta de `/api/billing/reconcile` traz `notices` (criados, enviados, repetidos, falhos) |

Reenviar um aviso `failed`: volte o registro para `pending`, com `attempts = 0`
e `next_attempt_at = now()`. A chave de idempotência no provedor é a mesma, então
não há risco de duplicar.

## 8. Como testar

Os testes usam **relógio simulado**: o teste decide que horas são e dispara as
tarefas agendadas como o agendador faria. Nenhum e-mail sai de verdade.

```bash
pnpm vitest run tests/integration/avisos-por-email.test.ts tests/unit/email-modelos.test.ts
```

Em um cenário novo:

```ts
let clock = new Date('2027-03-02T15:00:00Z');
const mailer = createScriptedMailer();                    // tests/helpers/mail.ts
const api = await createTestApi({
  now: () => new Date(clock),
  mailer,
  env: { BILLING_EMAILS_ENABLED: 'true' },
});
clock = new Date('2027-03-13T17:47:00Z');                 // 14h47 de Brasília
await runJob(api, 'sync');                                // a tarefa da tarde
mailer.failNext(TRANSIENT);                               // roteiriza a próxima resposta do provedor
```

## 9. Antes de ligar em produção

1. **Comprovar a entrega** (pendência da Fase 2): domínio verificado no Resend,
   SPF, DKIM e DMARC conferidos e um teste de recebimento real em Gmail e
   Outlook. Ver [`email.md`](./email.md), seções 4 e 6.
2. **Definir o contato de suporte** (`SUPPORT_EMAIL`). Sem ele, os avisos de
   pagamento recusado, acesso suspenso e exclusão dizem "fale com a equipe da
   CODECA Build" sem dizer por onde.
3. **Cadastrar o webhook no Resend** apontando para
   `https://<domínio>/api/webhooks/resend`, com os eventos `email.delivered`,
   `email.delivery_delayed`, `email.bounced` e `email.complained`, e gravar o
   segredo em `RESEND_WEBHOOK_SECRET`.
4. **Conferir o formato real** de um evento de devolução (aviso da seção 4).
5. Só então, `BILLING_EMAILS_ENABLED=true`.

## 10. Onde está no código

| Peça | Arquivo |
| --- | --- |
| Textos e formatação | `apps/api/src/lib/mail/templates.ts` |
| Fila, tentativas, supressão, eventos de entrega | `apps/api/src/lib/mail/outbox.ts` |
| Gatilhos (quem recebe o quê, quando) | `apps/api/src/lib/mail/notices.ts` |
| Assinatura do webhook do Resend | `apps/api/src/lib/mail/svix.ts` |
| Rota do webhook de entrega | `apps/api/src/routes/webhooks.ts` |
| Tabelas | `packages/database/migrations/0030_fila_de_emails.sql` |
| Testes | `tests/integration/avisos-por-email.test.ts`, `tests/unit/email-modelos.test.ts` |
