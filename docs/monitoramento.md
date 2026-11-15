# Monitoramento e alertas

Como a plataforma percebe que algo quebrou, quem ela avisa e o que ainda
depende de um serviço externo.

## 1. O que existe

Um ponto único, `apps/api/src/lib/ops/monitor.ts`, por onde as falhas
operacionais passam. Ele faz duas coisas:

1. **Sempre:** escreve uma linha estruturada (JSON) no log da função, sem dado
   sensível. Fica visível em Vercel → projeto → Logs.
2. **Quando a falha é crítica:** envia um alerta para quem opera.

Não é um rastreador de erros: não agrupa ocorrências, não guarda histórico e
não tem painel. É o mínimo para que uma falha de pagamento ou de login não
passe despercebida — e a base para ligar um serviço desses depois (seção 6).

## 2. Como ligar os alertas

Sem configuração, as falhas vão **só para o log**. Para receber avisos:

| Variável | O que faz |
| --- | --- |
| `OPS_ALERT_WEBHOOK_URL` | Endereço que recebe um `POST` por alerta. Serve um webhook de entrada do Slack, do Discord ou do Teams |
| `OPS_ALERT_EMAIL` | Recebe o mesmo aviso por e-mail (usa o provedor de e-mail da plataforma) |
| `OPS_ALERT_WINDOW_MINUTES` | Janela em que o mesmo alerta não se repete. Padrão: 30 |

O corpo do `POST` traz o texto em `text` (Slack, Teams) e em `content`
(Discord), além do evento estruturado em `event`.

**Use o webhook como canal principal.** O e-mail depende do mesmo provedor que
pode estar com problema — e um alerta de "o e-mail parou" nunca é enviado por
e-mail, de propósito.

**Configurar é alterar variável de ambiente na Vercel**, e isso é com você. Nada
foi configurado em produção.

## 3. O que é monitorado

| Evento | Quando | Gravidade | Alerta? |
| --- | --- | --- | --- |
| `api_error` | Erro que o código não previu (resposta 500) | crítica | sim, um por rota |
| `unhandled_error` | Promessa rejeitada sem tratamento na função | crítica | sim |
| `db_unavailable` | O banco não respondeu a uma requisição | crítica | sim |
| `email_failed` | O provedor não aceitou uma mensagem | crítica | sim (só pelo webhook) |
| `webhook_rejected` | Webhook da ValidaPay recusado (assinatura, tempo) | crítica | sim, um por motivo |
| `webhook_failed` | Evento de cobrança recebido e não aplicado | crítica | sim, um por tipo de evento |
| `webhook_stuck` | Eventos que esgotaram as 10 tentativas automáticas | crítica | sim |
| `webhook_deferred` | Processamento passou do prazo e seguiu em segundo plano | aviso | não |
| `webhook_duplicate` | Entrega repetida de um evento já gravado | informação | não |
| `billing_provider_error` | A conciliação não conseguiu consultar a ValidaPay | crítica | sim |
| `reconcile_failed` | A conciliação diária caiu inteira | crítica | sim |
| `job_failed` | Uma etapa da tarefa diária falhou (domínios, limpeza, sincronização) | crítica | sim, um por etapa |
| `job_missed` | A conciliação não roda há mais de 26 h | crítica | sim |

Ainda **não** passam pelo monitor: falhas de armazenamento (Vercel Blob) fora
de uma requisição que resulte em erro 500, e tentativas de login recusadas
(que são esperadas e já contam para o bloqueio por tentativas). Falha de
armazenamento durante uma requisição aparece como `api_error`.

### A conciliação que não roda

Uma tarefa que falha faz barulho. Uma que **não roda** não faz nenhum. Por isso
a conciliação deixa um registro ao terminar, e a outra tarefa agendada confere
se ele é recente (`lib/ops/heartbeat.ts`). Se as **duas** pararem, nada aqui
dentro percebe — é para isso que serve o monitor externo da seção 5.

## 4. O que nunca é registrado

O contexto de um evento passa por mascaramento antes de qualquer saída:

- campos com nome de segredo (`password`, `senha`, `token`, `authorization`,
  `apiKey`, `secret`, `loginCode`, `card`, `signature`…) têm o valor trocado
  por `[removido]`;
- em texto livre, e-mails viram `***@dominio` e sequências que parecem chave ou
  token são removidas;
- o corpo das requisições, o conteúdo dos e-mails e o código de acesso nunca
  entram no contexto.

Identificadores técnicos ficam: código da requisição, identificador do evento,
rota, número de tentativas, código de erro do provedor.

Testes: `tests/unit/monitor.test.ts` (o que sai e o que não sai) e
`tests/integration/alertas-operacionais.test.ts` (falhas reais dentro da API
gerando alerta).

## 5. Monitor externo de disponibilidade (pendente)

A aplicação não consegue avisar que **ela mesma** está fora do ar. É preciso um
serviço de fora chamando, a cada poucos minutos:

```
GET https://codecabuild.vercel.app/api/health?db=1&ops=1
```

- **200** → função, banco e conciliação em dia.
- **503** → banco fora, ou conciliação parada há mais de 26 h. O corpo diz qual.
- **sem resposta** → função ou Vercel fora do ar.

Qualquer serviço de monitoramento de disponibilidade faz isso; vários têm
plano gratuito suficiente para um único endereço (**confira os limites
atuais antes de escolher**). Não foi contratado nem configurado.

## 6. Rastreador de erros: comparação e recomendação

Não foi criada conta em nenhum serviço. A tabela compara o que importa para o
estágio atual; **preços e limites de plano gratuito mudam e não foram
conferidos nesta data — confirme no site de cada um antes de decidir.**

| Critério | Sentry | Registro + alertas (o que já existe) | Coletor de logs (Axiom, Better Stack e afins) | Observabilidade da Vercel |
| --- | --- | --- | --- | --- |
| O que entrega | Erros agrupados, pilha de chamadas, versão que introduziu, alertas | Linha no log + aviso no chat | Busca e painéis sobre os logs; alguns incluem disponibilidade | Logs, métricas e rastros do próprio projeto |
| Integração com Hono em função Node | SDK oficial para Node; exige inicializar e encaminhar o erro | pronta | recebe os logs por "log drain" da Vercel | nativa |
| Esforço para ligar | médio (dependência + inicialização + mascaramento) | nenhum | baixo a médio | baixo |
| Custo | tem plano gratuito limitado | zero | tem plano gratuito limitado | recursos avançados e "log drains" costumam exigir plano pago da Vercel |
| Dados pessoais (LGPD) | os erros saem para um terceiro: exige mascaramento, escolha de região e inclusão na lista de subprocessadores | nada sai além do alerta já mascarado | os logs saem para um terceiro: mesma exigência | fica no provedor que já hospeda |
| Manutenção | baixa depois de ligado | nenhuma | baixa | nenhuma |

**Recomendação, em duas etapas**

1. **Agora:** ligar os alertas (seção 2) em um canal de chat e contratar um
   monitor externo de disponibilidade (seção 5). Custo zero ou próximo disso, e
   cobre as falhas que custam dinheiro: pagamento, login, banco, tarefas.
2. **Quando houver clientes pagantes em volume:** Sentry. É o que responde "qual
   erro, desde qual versão, quantas vezes". Entra como mais um destino em
   `sinks`, no monitor — as chamadas espalhadas pelo código não mudam. Antes de
   ligar: escolher a região de armazenamento, manter o mascaramento desta
   página e acrescentar o serviço à lista de subprocessadores em
   [lgpd.md](lgpd.md).

A escolha do serviço é sua. Nada além da etapa 1 foi implementado.
