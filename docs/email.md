# Envio de e-mail

O que a plataforma envia, por onde, o que ela sabe sobre a entrega — e o que
falta para afirmar que os e-mails chegam.

> **Estado em produção: não comprovado.** Há uma chave de provedor configurada
> (`/api/health` informa `transactionalEmail: true`). Não há evidência de que
> um e-mail chegou à caixa de entrada de um cliente. Enquanto isso não for
> verificado (seção 6), trate o login por código como um risco.

## 1. O que existe

| Item | Situação |
| --- | --- |
| Provedor | **Resend**, um só. Chamada direta a `api.resend.com/emails` (`apps/api/src/lib/mailer.ts`) |
| Formato | Texto puro. Não há versão HTML |
| Mensagens | Confirmação de cadastro, recuperação de senha, convite, aviso de novo interessado, código de acesso, alerta operacional |
| Prazo | 8 s por tentativa |
| Nova tentativa | Uma, e só em falha passageira que voltou rápido (rede, 5xx, 429) |
| Proteção contra duplicidade | As duas tentativas levam a mesma chave de idempotência |
| Disjuntor | Depois de 5 falhas seguidas, recusa por 30 s sem esperar o provedor |
| Registro | Linha no log por envio aceito: tipo, identificador no provedor, tentativa. Nunca o destinatário nem o conteúdo |
| Alerta | `email_failed` quando o provedor não aceita ([monitoramento.md](monitoramento.md)) |
| Diagnóstico | Painel da plataforma → cartão "Envio de e-mail"; `pnpm run validate:email` |

### Variáveis

| Variável | Para quê |
| --- | --- |
| `RESEND_API_KEY` | Sem ela não há envio: o login por senha entra sem a segunda etapa e a recuperação de senha recusa |
| `MAIL_FROM` | Remetente. **Precisa ser de um domínio verificado no Resend.** O padrão (`nao-responda@localhost`) é recusado por qualquer provedor |
| `LOGIN_CODE_REQUIRED` | `true`: sem provedor, ninguém entra. Vazio: sem provedor, entra só com senha |

## 1.1 A segunda etapa do login está DESLIGADA por padrão

`LOGIN_CODE_ENABLED` nasce `false`. A chave do Resend sozinha **não** liga mais
o código de 6 dígitos no login.

**Por quê:** exigir no login um canal cuja entrega nunca foi comprovada tranca
todo mundo para fora. Foi o que aconteceu em 17/11/2026 — com a chave presente
e o domínio ainda não verificado no Resend, a senha correta parava em "Não foi
possível enviar o e-mail agora", e não havia como entrar. O mesmo valeria numa
queda do provedor.

**Para ligar**, depois de comprovar a entrega (seções 4 e 6):

```
LOGIN_CODE_ENABLED=true
```

**Quem quer uma segunda etapa agora**, sem depender de e-mail: o aplicativo
autenticador já funciona, não depende de entrega e é mais forte. Ver
[`seguranca-da-conta.md`](./seguranca-da-conta.md).

## 2. O que a plataforma sabe sobre uma mensagem — e o que não sabe

| Estado | A plataforma sabe? | Como |
| --- | --- | --- |
| Enviada ao provedor | sim | a chamada foi feita |
| **Aceita pelo provedor** | **sim** | resposta de sucesso da API — é o que o código chama de `delivered` |
| Rejeitada pelo provedor | sim | resposta 4xx (chave, remetente, destinatário) |
| Entregue na caixa de entrada | **não** | o Resend avisa por webhook (`email.delivered`), que ainda não é recebido |
| Atrasada | **não** | `email.delivery_delayed` |
| Devolvida (endereço inexistente, caixa cheia) | **não** | `email.bounced` |
| Marcada como spam pelo destinatário | **não** | `email.complained` |

**"Aceita" não é "entregue".** Uma resposta de sucesso da API quer dizer que o
Resend recebeu o pedido. A entrega acontece depois, e pode falhar.

### Devolução e reclamação de spam

Implementado **para os avisos da conta** (boas-vindas, avaliação, cobrança),
que passam pela fila: a rota `/api/webhooks/resend` valida a assinatura do
Resend, registra o que aconteceu com cada mensagem e tira dos avisos o endereço
que devolve em definitivo ou marca como spam. Ver
[`avisos-por-email.md`](./avisos-por-email.md).

Os e-mails pedidos pela própria pessoa (código de acesso, recuperação de senha,
confirmação de e-mail, convite) **não** passam pela fila e não têm esse
registro: a situação deles continua sendo consultada no painel do Resend, pelo
identificador que aparece no log (`providerMessageId`). Eles continuam sendo
tentados mesmo para um endereço fora dos avisos — bloqueá-los trancaria a
pessoa fora da conta.

## 3. Dois provedores: o que é possível

**Não encontramos serviço de envio de e-mail próprio da Vercel** — nem no
código, nem na documentação consultada. A Vercel hospeda a aplicação; o envio
é sempre de um provedor de e-mail. Se a intenção era "Resend + Vercel", o que
existe é a integração do Resend dentro da Vercel, que continua sendo o Resend.
Se você tem a referência de um serviço da Vercel para isso, envie para
conferirmos.

**O código já admite outro provedor.** Tudo que envia usa a interface `Mailer`
(`send` e `configured`); o Resend é uma implementação dela. Um segundo provedor
é mais uma implementação, escolhida por variável de ambiente.

**O que não recomendamos: troca automática em caso de falha.** Parece
prudente e é a forma mais fácil de mandar o mesmo e-mail duas vezes: quando a
resposta do primeiro provedor se perde, a mensagem pode ter saído; reenviar
por outro provedor entrega o código de acesso em dobro (e a chave de
idempotência não vale entre provedores). O desenho seguro é:

| Peça | Como |
| --- | --- |
| Provedor principal | uma variável de escolha, como `MAIL_PROVIDER` (**ainda não existe**: hoje o provedor é sempre o Resend) |
| Provedor alternativo | configurado e **parado**; entra por decisão de uma pessoa, trocando a variável |
| Falha | nova tentativa **no mesmo provedor**, com a mesma chave de idempotência |
| Registro | o provedor usado vai no log de cada envio (`provider`) |
| Por ambiente | cada ambiente da Vercel com a própria chave e o próprio remetente |

Um segundo provedor só vale a pena depois de o primeiro estar comprovadamente
entregando. Não foi implementado, e o provedor de produção não foi alterado.

## 4. Domínio: SPF, DKIM e DMARC

Sem domínio verificado, o Resend só entrega para o e-mail do dono da conta.

**É preciso um domínio próprio** (por exemplo, o da CODECA IA).
`codecabuild.vercel.app` não serve: o DNS dele não é seu.

### Passo a passo

1. **Resend → Domains → Add Domain.** Informe o domínio (ou um subdomínio só
   para envio, como `mail.seudominio.com.br` — recomendado, porque isola a
   reputação do envio).
2. O Resend mostra os registros a criar. **Copie os valores de lá**: eles são
   gerados para o seu domínio, e nenhum documento pode adivinhá-los.
3. **No painel de quem administra o DNS do domínio** (o registrador, ou o
   serviço para onde os servidores de nome apontam), crie os registros:

   | Finalidade | Tipo | O que é |
   | --- | --- | --- |
   | **SPF** | TXT (e um MX de retorno) | Autoriza os servidores do Resend a enviar em nome do domínio. Valor fornecido pelo Resend |
   | **DKIM** | TXT | Chave pública que assina as mensagens. Nome e valor fornecidos pelo Resend |
   | **DMARC** | TXT em `_dmarc.seudominio.com.br` | Diz aos provedores o que fazer com mensagens que falham em SPF/DKIM. **Este você define** |

4. **DMARC, valor inicial sugerido:**

   ```
   v=DMARC1; p=none; rua=mailto:dmarc@seudominio.com.br
   ```

   `p=none` só observa (não bloqueia nada) e envia relatórios para o endereço
   em `rua`. Depois de algumas semanas sem falhas legítimas nos relatórios,
   suba para `p=quarantine` e então `p=reject`. Começar em `reject` pode
   derrubar e-mails legítimos de outros sistemas que usam o mesmo domínio.

5. **Atenção ao SPF já existente.** Um domínio só pode ter **um** registro SPF.
   Se já existe um (do e-mail corporativo, por exemplo), o do Resend entra no
   subdomínio de envio ou é combinado com o existente — nunca um segundo
   registro ao lado.

6. De volta ao Resend, **Verify**. A propagação do DNS pode levar de minutos a
   algumas horas.

7. Na Vercel, `MAIL_FROM` passa a usar um endereço **desse** domínio.

### Como validar

| O quê | Como |
| --- | --- |
| Domínio verificado | Resend → Domains: situação "Verified"; ou o cartão "Envio de e-mail" no painel da plataforma |
| Registros publicados | `dig TXT _dmarc.seudominio.com.br +short` e os nomes indicados pelo Resend |
| SPF, DKIM e DMARC na prática | Envie um teste para uma conta do Gmail → "Mostrar original": as três linhas devem dizer `PASS` |

Nenhum registro de DNS foi criado ou alterado por este trabalho.

## 5. Evitar envio duplicado

| Situação | Proteção |
| --- | --- |
| Nova tentativa depois de falha de rede | Mesma chave de idempotência nas duas tentativas |
| Pessoa pede o código duas vezes | Intervalo mínimo entre códigos e cota por e-mail e por IP |
| Dois provedores | Sem troca automática (seção 3) |
| Alertas operacionais | Um por janela, por tipo de problema |

## 6. Teste real de recebimento (pendente)

Só pode ser feito depois de o domínio estar verificado. Roteiro:

1. Três caixas de teste **suas**, de provedores diferentes: uma do Gmail, uma
   do Outlook/Hotmail e uma terceira (Yahoo, iCloud ou o e-mail corporativo).
   Nunca endereços de clientes.
2. Para cada uma, pelo painel da plataforma (cartão "Envio de e-mail" envia só
   para o e-mail de quem clica) ou pelo fluxo real de "entrar com código".
3. Para cada uma, anote:

   | Provedor | Chegou? | Onde (entrada / spam / promoções) | Atraso | SPF | DKIM | DMARC |
   | --- | --- | --- | --- | --- | --- | --- |
   | Gmail | | | | | | |
   | Outlook | | | | | | |
   | Outro | | | | | | |

4. O teste só está concluído com as três linhas preenchidas a partir do que
   **chegou na caixa**. Resposta de sucesso da API não conta.

Nenhum envio de teste foi feito nesta fase: não há domínio verificado para
enviar a partir dele.
