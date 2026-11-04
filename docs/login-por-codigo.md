# Verificacao por e-mail em duas etapas

Todo login tem **duas etapas**: primeiro **e-mail e senha** (ou o **Google**) e,
so depois, um **codigo de 6 digitos enviado ao e-mail da conta**. A sessao so
nasce quando o codigo e digitado. Nao existe entrada so por codigo.

```
1a etapa                              2a etapa
e-mail + senha  ----\                 codigo de 6 digitos
                     >--> e-mail ---> (digitado na tela) ---> sessao
Google          ----/
```

## 1. Rotas da API

| Rota | Quem chama | O que faz |
| --- | --- | --- |
| `POST /api/auth/login` | tela `/entrar` | confere e-mail e senha. Certo: **envia o codigo** e responde `{ status: "code_required", email, resendAfterSeconds, expiresInSeconds }`, **sem sessao**. Errado: `401` generico, nada e enviado |
| `GET /api/auth/google/callback` | o Google | autorizado: envia o codigo e redireciona a `/entrar?etapa=codigo`, **sem sessao** |
| `POST /api/auth/code/verify` | tela do codigo | `{ code }` -> `{ status: "authenticated", session, csrfToken, next }` e cookie de sessao |
| `POST /api/auth/code/resend` | tela do codigo | reenvia (60 s de intervalo, 5/hora) |
| `GET /api/auth/code/pending` | tela vinda do Google | e-mail e segundos para o reenvio |
| `POST /api/auth/code/cancel` | "Entrar com outra conta" | descarta a 1a etapa |

As rotas `/api/auth/code/request` e `/api/auth/code/register` (codigo **sem**
senha), da versao anterior, **foram removidas** (respondem 404). O cadastro de
conta (`POST /api/auth/register`) **nao mudou**: continua devolvendo a sessao no
ato, com o e-mail confirmado pelo link de sempre.

## 2. O codigo nao e uma porta de entrada

As rotas `/code/*` exigem o **comprovante da 1a etapa**: um cookie `HttpOnly`
assinado (`codeca_login_pending`, `Path=/api/auth/code`, 15 min), emitido **so
depois** da senha correta (ou do Google). Dele saem o e-mail, o usuario, o
"manter conectado" e o destino -- **nunca do corpo** da requisicao.

Consequencias, todas com teste:

- Saber o e-mail (ate o codigo) nao basta: sem o comprovante, `verify`, `resend`
  e `pending` respondem `401` e **nada e enviado**.
- Nao existe rota publica para "pedir codigo para este e-mail". Isso tambem fecha
  dois abusos: encher a caixa de entrada de qualquer pessoa e descobrir quais
  e-mails tem conta.
- Senha errada, e-mail inexistente e conta sem senha respondem a **mesma**
  mensagem, e nenhum e-mail sai.

## 3. O codigo

| Exigencia | Como |
| --- | --- |
| 6 digitos aleatorios | `crypto.randomInt`, zeros a esquerda preservados |
| 10 minutos | `expires_at`, conferido no servidor |
| Uso unico | `UPDATE ... WHERE used_at IS NULL RETURNING` (de 6 validacoes simultaneas, so 1 passa) |
| Hash | `HMAC-SHA256(AUTH_SECRET, "login-code:<email>:<codigo>")`. Sem o segredo no calculo, 1.000.000 de possibilidades seriam quebradas em milissegundos por quem lesse o banco |
| Tentativas | **5 por codigo**, contadas **antes** de conferir (tentativas simultaneas tambem contam). Errou a 5a: o codigo morre |
| Forca bruta | alem disso, validacoes por e-mail **15/hora** e por IP **30/15 min** (pedir codigo novo nao zera) |
| Pedidos | por e-mail **5/hora**, por IP **15/hora**, **60 s** entre reenvios |
| Codigo novo | invalida os anteriores |
| Fora do log | o mailer de console omite o corpo dos e-mails de codigo; o adaptador da Resend so loga status HTTP; a auditoria nao o carrega |
| Fora da resposta | nenhuma resposta traz o codigo |
| E-mail verificado | `email_verified_at` passa a valer na primeira prova de codigo |

## 4. Google

O Google e a 1a etapa. Autorizado, o servidor **nao** abre sessao: envia o codigo
e leva a `/entrar?etapa=codigo`. Vale tambem para quem acabou de criar a conta
pelo Google (depois do codigo, segue para cadastrar a empresa). Se o e-mail nao
sai, o Google nao entra: volta a `/entrar?google=code_send_failed`.

## 5. Sem provedor de e-mail: duas politicas

A 2a etapa depende de enviar e-mail (`RESEND_API_KEY`). Sem ele:

| Config | Comportamento |
| --- | --- |
| padrao | o login por **senha** segue entrando direto, **sem** a 2a etapa -- senao uma instalacao sem e-mail ficaria trancada para fora. `features.emailCodeAuth` aparece `false` |
| `LOGIN_CODE_REQUIRED=true` | **ninguem** entra: o login responde `501` e o Google volta com `not_configured`. Use em producao para nunca cair, sem perceber, num login sem a 2a etapa |

> **Recomendado em producao:** defina `RESEND_API_KEY`, `MAIL_FROM` **e**
> `LOGIN_CODE_REQUIRED=true`. Sem a ultima, uma chave de e-mail removida ou
> invalida por engano desliga a 2a etapa em silencio (o provedor recusando um
> envio, ao contrario, **bloqueia** o login com `502` -- nao o libera).

Se o provedor recusar ou nao responder (prazo de 8 s), o login responde `502`, o
codigo recem-criado e **apagado** e a pessoa e avisada.

## 6. Banco de dados

Tabela `login_codes` (migracao `0021_codigos_de_acesso_por_email.sql`, so
acrescenta): `id`, `email`, `code_hash`, `expires_at`, `attempts`, `used_at`,
`request_ip_hash` (so hash), `created_at`. Indices `(email, created_at)` e
`(expires_at)`. Sem `user_id`, de proposito. Cada novo envio apaga os codigos
vencidos ha mais de 1 dia.

## 7. E-mail: configuracao

Reutiliza o servico existente (**Resend**, `apps/api/src/lib/mailer.ts`). No
**servidor** (nunca em `VITE_*`):

| Variavel | Valor |
| --- | --- |
| `RESEND_API_KEY` | chave de envio de resend.com/api-keys |
| `MAIL_FROM` | `CODECA Build <acesso@seu-dominio-verificado>` |
| `LOGIN_CODE_REQUIRED` | `true` (recomendado em producao) |

Na Resend: **Domains > Add Domain**, publique SPF e DKIM no DNS, aguarde a
verificacao, crie a chave. A Resend recusa remetente de dominio nao verificado
(`403`). Para um teste rapido sem dominio ha `onboarding@resend.dev`, que so
entrega ao e-mail da propria conta dela.

### Como conferir o envio real (a fazer com a chave)

1. Defina as variaveis e faca um novo deploy.
2. `GET /api/auth/session` -> `features.emailCodeAuth: true`.
3. Em `/entrar`, informe e-mail e senha de uma conta sua e clique **Continuar**.
   O e-mail **Seu codigo de acesso ao CODECA Build** deve chegar em segundos
   (olhe o spam na primeira vez).
4. Digite o codigo: deve entrar no painel.
5. Nao chegou? Painel da Resend > **Logs**; e no log do servidor,
   `[mailer:resend] falha <status>`.

## 8. Tela

`/entrar`: **Bem-vindo ao CODECA Build** / *Acesse sua conta para gerenciar seu
site.* / [Continuar com Google] / ou / e-mail, senha, **Continuar**.

2a etapa: seis campos com avanco automatico, colar os seis numeros de uma vez
(de qualquer campo), Backspace volta, autopreenchimento do navegador
(`autocomplete="one-time-code"`), **Verificar e entrar**, **Reenviar codigo** com
contador (`1:00`) e **Entrar com outra conta**. Errou: campos limpos, foco no
primeiro, mensagem generica. Clique repetido nao gasta tentativa.

## 9. Testes

- `tests/integration/login-code.test.ts` (45): senha sem sessao, e-mail e texto,
  senha errada sem e-mail e sem diferenca de mensagem, "e-mail + codigo" sem o
  comprovante, comprovante falso/vencido/adulterado, e-mail do corpo ignorado,
  rotas antigas removidas, codigo errado/expirado/usado, uso unico sob
  concorrencia, 5 tentativas (inclusive simultaneas), cotas, reenvio (60 s),
  varias empresas, papeis, assinatura, administrador da plataforma, sessao
  (recarregar, logout, expirar, CSRF), "manter conectado", Google + codigo, sem
  provedor, `LOGIN_CODE_REQUIRED`, provedor que falha, nada em log/auditoria.
- `tests/unit/login-code-mail.test.ts`: geracao, hash, texto, log sem o codigo e
  **adaptador da Resend** (URL, cabecalho, remetente, destino, assunto, texto).
- `tests/integration/migrations.test.ts`: migracao `0021`.
- No navegador, contra a API real (banco e caixa de e-mail em memoria): senha
  errada, senha certa -> codigo, painel barrado sem o codigo, erro, colar,
  entrar, recarregar, retorno do Google, celular.

> **Nao exercitado:** a entrega real pela Resend (precisa de chave e dominio
> verificado). O que sai pela rede e conferido por teste; a caixa de entrada de
> verdade so se confirma com o roteiro da secao 7.

## 10. Limites conhecidos

- O **cadastro** de conta nao passa pela 2a etapa: nasce com sessao, como antes.
  So o **login** passa.
- O convite (`/aceitar-convite`) e a redefinicao de senha usam o proprio link
  enviado ao e-mail como prova da caixa de entrada e nao pedem o codigo.
- O comprovante da 1a etapa vale 15 minutos; vencido, volta-se ao login.
