# Codigo por e-mail: segunda etapa e forma de entrar

Todo login termina no mesmo lugar: um **codigo de 6 digitos enviado ao e-mail da
conta**. A sessao so nasce quando ele e digitado. Tres caminhos chegam la:

```
e-mail + senha  ----\
                      \                codigo de 6 digitos
Google          --------> e-mail ---> (digitado na tela) ---> sessao
                      /
so o e-mail     ----/
```

Nos dois primeiros o codigo e a **segunda etapa**: quem chega ja provou algo, e o
codigo prova que tambem controla a caixa de entrada. No terceiro o codigo **e** a
autenticacao.

> **Por que entrar so com o e-mail nao enfraquece nada:** provar controle da
> caixa de entrada ja basta hoje para **trocar** a senha pela recuperacao. Quem
> controla o e-mail sempre pode entrar; a rota so evita a volta pelo link de
> redefinicao. O que ela nao pode fazer e abrir dois abusos novos -- inundar a
> caixa de terceiros e descobrir quais e-mails tem conta --, e e disso que trata
> a secao 2.

## 1. Rotas da API

| Rota | Quem chama | O que faz |
| --- | --- | --- |
| `POST /api/auth/code/start` | tela `/entrar`, modo "codigo por e-mail" | `{ email, rememberMe }`. Envia o codigo **se existir conta** e abre o comprovante. A resposta e **identica** exista ou nao: `{ sent: true, email, resendAfterSeconds, expiresInSeconds }` |
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

## 2. O comprovante, e os dois abusos fechados

Todas as rotas `/code/*` exceto `start` exigem o **comprovante da etapa em
andamento**: um cookie `HttpOnly` assinado (`codeca_login_pending`,
`Path=/api/auth/code`, 15 min). Dele saem o e-mail, o usuario, o "manter
conectado" e o destino -- **nunca do corpo** da requisicao. Sem isso bastaria
trocar o e-mail no corpo para usar o codigo de outra pessoa.

Consequencias, todas com teste:

- Saber o e-mail (ate o codigo) nao basta: sem o comprovante, `verify`, `resend`
  e `pending` respondem `401` e **nada e enviado**.
- Senha errada, e-mail inexistente e conta sem senha respondem a **mesma**
  mensagem, e nenhum e-mail sai.

### Descobrir quais e-mails tem conta

`start` responde **igual** exista ou nao a conta. Um e-mail sem conta tambem
**gera um codigo** no banco e tambem **consome cota** -- entao nem o intervalo de
reenvio nem a recusa por cota denunciam a diferenca. O comprovante nasce com
`user_id` vazio: se alguem acertar aquele codigo, `verify` responde a mesma
mensagem de codigo invalido e **nao abre sessao** (ha teste que fixa um codigo
conhecido na linha e confirma o `401`).

A unica diferenca observavel que resta e o **tempo** da chamada ao provedor de
e-mail no caso com conta -- a mesma que `POST /api/auth/forgot-password` sempre
teve.

### Encher a caixa de entrada de terceiros

- cota por **IP** (15/hora) e por **e-mail** (5/hora), aplicadas em `start`
  **antes** de saber se a conta existe;
- **60 s** de intervalo minimo entre envios para o mesmo e-mail;
- **reenvio nao envia nada** quando o comprovante e de um e-mail sem conta: senao
  o formulario viraria um disparador contra qualquer endereco digitado.

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
| Intervalo | os 60 s contam a partir do ultimo codigo que **ainda serve** (nao usado e nao vencido). Um codigo ja consumido nao bloqueia um envio novo -- senao quem entrasse, saisse e entrasse de novo em menos de um minuto ficaria sem codigo e veria "codigo incorreto" sem nada ter chegado |
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
| padrao | o login por **senha** segue entrando direto, **sem** a 2a etapa -- senao uma instalacao sem e-mail ficaria trancada para fora. `features.emailCodeAuth` aparece `false`, o botao "Entrar com um codigo por e-mail" **nao aparece** e `POST /code/start` responde `501` |
| `LOGIN_CODE_REQUIRED=true` | **ninguem** entra: o login responde `501` e o Google volta com `not_configured`. Use em producao para nunca cair, sem perceber, num login sem a 2a etapa |

> **Recomendado em producao:** defina `RESEND_API_KEY`, `MAIL_FROM` **e**
> `LOGIN_CODE_REQUIRED=true`. Sem a ultima, uma chave de e-mail removida ou
> invalida por engano desliga a 2a etapa em silencio (o provedor recusando um
> envio, ao contrario, **bloqueia** o login com `502` -- nao o libera).

Se o provedor recusar ou nao responder (prazo de 8 s), o login responde `502`, o
codigo recem-criado e **apagado** e a pessoa e avisada.

### O que mais depende do envio

`POST /api/auth/forgot-password` e `POST /api/auth/resend-verification` passaram
a **recusar com `501`** sem provedor configurado, em vez de responder
`{ sent: true }`. Antes a tela dizia "verifique sua caixa de entrada", o link
ficava no log de uma funcao serverless e a pessoa ficava trancada fora da propria
conta sem nunca saber por que. A recusa depende so da configuracao do servidor,
identica para qualquer e-mail digitado: **nao revela cadastro**.

O cadastro (`POST /api/auth/register`) **nao** recusa: a conta nasce com sessao e
a confirmacao pode esperar. Ele devolve `emailDelivery: { delivered, reason }`
para a tela dizer a verdade.

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

### Como conferir o envio real

Tres niveis, do mais barato ao mais caro.

**1. Validador de linha de comando** -- confere a chave e o dominio sem enviar
nada, e opcionalmente faz um envio de ponta a ponta:

```
RESEND_API_KEY=... MAIL_FROM='CODECA Build <nao-responda@seu-dominio>' \
  pnpm run validate:email            # so leitura: chave + dominios
RESEND_API_KEY=... MAIL_FROM='...' \
  pnpm run validate:email voce@seu-dominio.com   # envia de verdade
```

Sai com codigo 1 e lista os problemas quando algo falta. A chave nunca e
impressa. (Por tras de um proxy corporativo, o `fetch` do Node ignora
`HTTPS_PROXY`: use `NODE_USE_ENV_PROXY=1` e `NODE_EXTRA_CA_CERTS`.)

**2. Painel mestre > Visao geral da plataforma**, cartao **Envio de e-mail**:
mostra o veredito do provedor, cada dominio com a situacao de verificacao, e tem
o botao **Enviar teste para mim** (destino fixo: o e-mail de quem clicou -- a
rota ignora qualquer destinatario no corpo, para o painel nao virar disparador).
A chave nunca aparece na resposta. Rotas: `GET /api/platform/email-status` e
`POST /api/platform/email-test`.

**3. Fluxo de verdade**: em `/entrar`, informe e-mail e senha de uma conta sua e
clique **Continuar**; o e-mail **Seu codigo de acesso ao CODECA Build** deve
chegar em segundos (olhe o spam na primeira vez). Digite o codigo: deve entrar no
painel. Nao chegou? Painel da Resend > **Logs**; e no log do servidor,
`[mailer:resend] falha <status>`.

> Os dois motivos reais de "o e-mail nao chega" sao **chave recusada** e
> **dominio do remetente nao verificado**. "A chave esta configurada" nao
> distingue o segundo: com chave valida e dominio pendente, o provedor aceita a
> chave e recusa o envio. O cartao do painel separa os dois casos.

## 8. Tela

`/entrar`: **Bem-vindo ao CODECA Build** / *Acesse sua conta para gerenciar seu
site.* / [Continuar com Google] / ou / e-mail, senha, **Continuar**, e o link
**Entrar com um codigo por e-mail**.

No modo codigo o campo de senha sai de cena, o botao vira **Enviar codigo** e o
link volta a ser **Entrar com e-mail e senha**. O link so aparece com
`features.emailCodeAuth` -- sem provedor de e-mail ele prometeria um codigo que
nunca chega.

2a etapa: seis campos com avanco automatico, colar os seis numeros de uma vez
(de qualquer campo), Backspace volta, autopreenchimento do navegador
(`autocomplete="one-time-code"`), **Verificar e entrar**, **Reenviar codigo** com
contador (`1:00`) e **Entrar com outra conta**. Errou: campos limpos, foco no
primeiro, mensagem generica. Clique repetido nao gasta tentativa.

## 9. Testes

- `tests/integration/login-code.test.ts` (56): senha sem sessao, e-mail e texto,
  senha errada sem e-mail e sem diferenca de mensagem, "e-mail + codigo" sem o
  comprovante, comprovante falso/vencido/adulterado, e-mail do corpo ignorado,
  rotas antigas removidas, codigo errado/expirado/usado, uso unico sob
  concorrencia, 5 tentativas (inclusive simultaneas), cotas, reenvio (60 s),
  varias empresas, papeis, assinatura, administrador da plataforma, sessao
  (recarregar, logout, expirar, CSRF), "manter conectado", Google + codigo, sem
  provedor, `LOGIN_CODE_REQUIRED`, provedor que falha, nada em log/auditoria.
  Mais, de `start`: entrar so com o e-mail de ponta a ponta; e-mail sem conta com
  resposta identica e **nenhum** envio; codigo conhecido de e-mail sem conta que
  **nao** abre sessao; cota por e-mail valendo igual sem conta; reenvio que nao
  escreve para terceiros; conta bloqueada por senha entrando pelo codigo; `501`
  sem provedor; codigo de uma conta recusado em outra. E o intervalo: codigo
  **usado** libera envio novo, codigo **valendo** nao.
- `tests/integration/email-diagnostico.test.ts` (9): o cartao do painel mestre --
  nao configurado, chave aceita, chave recusada, dominio pendente, dominio
  ausente, a chave fora da resposta, teste de envio so para quem pediu
  (destinatario do corpo ignorado) e `403`/`401` para quem nao e administrador da
  plataforma.
- `tests/integration/auth.test.ts`: recuperacao de senha com provedor
  configurado, e a **recusa `501`** sem provedor (sem criar token de
  redefinicao), identica para e-mail existente e inexistente.
- `tests/unit/login-code-mail.test.ts`: geracao, hash, texto, log sem o codigo e
  **adaptador da Resend** (URL, cabecalho, remetente, destino, assunto, texto).
- `tests/integration/migrations.test.ts`: migracao `0021`.
- No navegador, contra a API real (banco e caixa de e-mail em memoria): senha
  errada, senha certa -> codigo, painel barrado sem o codigo, erro, colar,
  entrar, recarregar, retorno do Google, celular.

> **Nao exercitado em teste automatizado:** a entrega real pela Resend. Os testes
> substituem a rede de proposito -- eles provam o prazo, o disjuntor, o
> tratamento de erro e o que sai pelo fio, mas nao provam que a chave desta
> instalacao vale nem que o dominio esta verificado. Isso e trabalho do validador
> da secao 7, que fala com o provedor de verdade.

## 10. Limites conhecidos

- O **cadastro** de conta nao passa pela 2a etapa: nasce com sessao, como antes.
  So o **login** passa.
- `start` nao cria conta: um e-mail sem cadastro recebe silencio, e quem digitar
  um codigo ali ve a mensagem generica de codigo invalido. Criar conta continua
  sendo `/criar-conta`.
- Uma conta bloqueada por erros de **senha** ainda entra pelo codigo, de
  proposito: o bloqueio existe contra forca bruta de senha, o codigo tem os seus
  proprios limites, e a recuperacao de senha ja funcionava assim.
- Durante uma **queda do provedor de e-mail**, `start` responde `502` para quem
  tem conta e `200` para quem nao tem: enquanto durar a queda, a diferenca
  revela cadastro. Igualar isso significaria esconder a falha de quem esta
  tentando entrar, o que e pior.
- A diferenca de **tempo** de resposta entre e-mail com e sem conta (a chamada ao
  provedor) nao foi igualada. Um atraso artificial seria fragil e so deslocaria o
  sinal; `forgot-password` tem a mesma propriedade desde sempre.
- O convite (`/aceitar-convite`) e a redefinicao de senha usam o proprio link
  enviado ao e-mail como prova da caixa de entrada e nao pedem o codigo.
- O comprovante da 1a etapa vale 15 minutos; vencido, volta-se ao login.
