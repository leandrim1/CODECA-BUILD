# Custos operacionais

Quanto custa manter a CODECA Build funcionando para cada cliente.

> **Situação em 16/11/2026: o custo por cliente ainda não pode ser calculado.**
> Este documento traz o que foi **medido** (quanto cada cliente consome) e a
> **fórmula**. Faltam os preços e o consumo real, que só existem nos painéis e
> contratos da empresa (seção 5). Nenhuma tarifa aqui foi inventada: onde não
> há fonte, está escrito "a informar".

## 1. Como ler

| Marca | Significado |
| --- | --- |
| **Medido** | Observado no código ou em medição desta fase, com a origem indicada |
| **Do contrato** | Vem do plano contratado ou da fatura — a informar |
| **Estimativa** | Cálculo a partir de medido + contrato; só existe quando os dois existem |

Preços dos planos (não alterados): Avaliação grátis por 14 dias; Essencial
R$ 15,90/mês; Profissional R$ 59,90/mês; Empresas R$ 119,90/mês.

## 2. O que cada cliente consome (medido)

### Vercel — funções

| Ação | Chamadas de função | Origem |
| --- | --- | --- |
| Abrir a visão geral do painel | 4 | Navegador real, ambiente local |
| Abrir uma lista de conteúdo | 4 a 5 | idem |
| Abrir "Plano e assinatura" | 3 | idem |
| Visita à página inicial pública | 2 → **1** depois desta fase | A lista de planos passou a ser servida pela borda |
| Cadastro e login | 1 por tela, mais as do envio do formulário | idem |
| Site do cliente lendo a API pública | 1 por leitura; respostas guardadas por 5 s na instância | Código (`PUBLIC_CACHE_TTL_SECONDS`) |
| Tarefas agendadas | 2 por dia, **fixas** — não crescem com clientes | `vercel.json` |
| Webhook da ValidaPay | 1 por evento de cobrança | Código |

Tempo de função por chamada, em produção, hoje: **dominado pela distância até
o banco** (cerca de 115 ms por consulta; ver `performance.md`, seção 9). Uma
chamada com 5 consultas ocupa a função por mais de meio segundo; com função e
banco na mesma região, a estimativa é uma fração disso. Como a Vercel cobra por
tempo de função nos planos pagos, **a região afeta o custo, não só a
velocidade**.

### Vercel — tráfego

| Página | Peso na primeira visita | Origem |
| --- | --- | --- |
| Inicial pública | 367 KB (era 413 KB) | Laboratório local, com compressão |
| Login e cadastro | 194 KB (era 240 KB) | idem |
| Painel | 285 KB (era 332 KB) | idem |

Visitas seguintes reaproveitam os arquivos (cache de um ano em `/assets`).

### Neon — banco

| Item | Valor | Origem |
| --- | --- | --- |
| Consultas por requisição, sessão em cache | 5 | Teste de carga local |
| Consultas por requisição, primeiro acesso | 13 | idem |
| Consultas por webhook de pagamento | 13 a 18 | Medição local |
| Consultas da conciliação diária | 20 + cerca de 1 por assinatura conferida | Medição local, 1 assinatura |
| Conexões por instância | até 5 (`DB_POOL_MAX`) | Código |
| Tamanho do banco e horas de computação | **a informar** | Painel do Neon |

O banco **adormece** depois de alguns minutos sem uso (medido: a primeira
chamada após 6 minutos parada leva de 4,6 a 5,1 s). Mantê-lo acordado melhora a
experiência e **consome horas de computação**: é uma decisão de custo, que
depende do plano contratado.

### Vercel Blob — arquivos

| Item | Valor | Origem |
| --- | --- | --- |
| Limite de armazenamento, Avaliação | 200 MB | `packages/shared/src/plans.ts` |
| Limite, Profissional | 2 GB | idem |
| Limite, Empresas | 10 GB | idem |
| Armazenamento realmente usado por cliente | **a informar** | Painel da Vercel, ou a tela de mídia de cada empresa |

O limite é o **teto** de cada cliente, não o consumo. O custo real vem do uso.

### Resend — e-mails

Por cliente, pelo desenho do sistema (os avisos da Fase 4 estão desligados):

| Momento | E-mails |
| --- | --- |
| Cadastro | 1 (confirmação) + 1 (boas-vindas, quando os avisos forem ligados) |
| Avaliação | até 3 (3 dias, véspera, encerramento) |
| Cliente pagante, por mês | 1 (pagamento confirmado) |
| Cada login com código por e-mail | 1 |
| Recuperação de senha, convite | 1 por pedido |
| Interessado (lead) recebido pelo site | 1 por lead, para a empresa |

O volume que domina é o de **códigos de login** e o de **leads**, que dependem
do uso — a informar pelo painel do Resend.

### ValidaPay — pagamentos

| Item | Valor | Origem |
| --- | --- | --- |
| Formas aceitas no Essencial | cartão, Pix Automático, Pix (sem boleto) | `plans.ts` |
| Formas aceitas no Empresas | as anteriores + boleto | idem |
| Tarifa por transação (cartão, Pix, boleto) | **a informar** | Contrato com a ValidaPay — não consta na documentação da API |
| Comissão existente | **a informar** | Contrato |

## 3. Tabela de custos (a preencher)

| Serviço | Unidade | Consumo medido | Custo conhecido | Custo estimado | Custo por cliente | Fonte | Confiança |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vercel — funções | chamada e tempo | 3 a 5 chamadas por tela (seção 2) | a informar | — | — | Plano e fatura da Vercel | — |
| Vercel — tráfego | GB transferidos | 194 a 367 KB por primeira visita | a informar | — | — | idem | — |
| Vercel — plano | mensalidade | fixo | a informar | — | custo fixo: não ratear | idem | — |
| Neon — computação | hora de computação | a informar | a informar | — | — | Painel do Neon | — |
| Neon — armazenamento | GB | a informar | a informar | — | — | idem | — |
| Vercel Blob | GB armazenado e GB transferido | a informar (teto por plano na seção 2) | a informar | — | — | Painel da Vercel | — |
| Resend | e-mail | 2 a 5 no cadastro e avaliação; 1 por mês por pagante; + logins e leads | a informar | — | — | Plano do Resend | — |
| ValidaPay | transação | 1 por cliente pagante por mês | a informar | — | — | Contrato | — |
| Trabalho humano (Essencial) | minuto por cliente por mês | a informar | a informar | — | — | Registro interno | — |

## 4. Como calcular quando os dados chegarem

**Custo variável por cliente pagante, por mês** =
tarifa da transação
+ (chamadas de função × preço por chamada e por tempo)
+ (GB de tráfego × preço)
+ (GB de Blob × preço)
+ (e-mails × preço)
+ (minutos de trabalho × custo do minuto).

**Custo fixo** (mensalidades dos serviços, domínio, ferramentas): **não se
divide por cliente de forma arbitrária.** Apresenta-se à parte, e a pergunta
certa é "com quantos clientes a margem variável paga o fixo".

**Custo de aquisição:** não há informação no projeto. Fica fora até existir.

### Plano Essencial (R$ 15,90/mês)

É o plano que exige atenção: nele a CODECA IA mantém o conteúdo, então há
trabalho humano recorrente, e a tarifa de pagamento pesa mais sobre um valor
pequeno (por isso o plano já não aceita boleto).

**Margem por cliente** = 15,90 − tarifa da transação − infraestrutura variável
− (minutos de trabalho no mês × custo do minuto).

**Minutos de trabalho que zeram a margem** =
(15,90 − tarifa − infraestrutura variável) ÷ custo do minuto.

Para decidir qualquer coisa sobre este plano é preciso levantar, por pelo
menos um mês:

1. quantos pedidos de alteração cada cliente Essencial faz;
2. quantos minutos cada pedido toma, do recebimento à publicação;
3. o custo da hora de quem atende;
4. a tarifa efetivamente cobrada pela ValidaPay em cada forma de pagamento.

**Este documento não recomenda mudar preço.** Sem esses quatro números, nem a
favor nem contra.

## 5. O que falta você informar

| Dado | Onde encontrar |
| --- | --- |
| Plano contratado e última fatura da Vercel; invocações, tempo de função e tráfego do mês | Painel da Vercel → Usage |
| Plano do Neon; horas de computação e armazenamento do mês; configuração de suspensão automática | Painel do Neon → Billing e Settings |
| Armazenamento e tráfego do Blob | Painel da Vercel → Storage |
| Plano do Resend e e-mails enviados no mês | Painel do Resend → Usage |
| Tarifas por cartão, Pix e boleto, e a comissão | Contrato ou extrato da ValidaPay |
| Quantidade de clientes por plano | Painel mestre da CODECA Build |
| Minutos de trabalho por cliente Essencial | Registro interno |

Com isso, a seção 3 vira números e o custo por cliente passa a existir.
