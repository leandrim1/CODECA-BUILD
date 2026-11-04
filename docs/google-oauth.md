# Login com Google

"Continuar com Google" nas telas `/entrar` e `/criar-conta`. Este documento diz
**como funciona**, **o que configurar no Google Cloud e na Vercel** e **como
testar**. As URLs de retorno citadas aqui sao as rotas reais da API (secao 1).

## 1. As rotas reais

Todas na API, sob `/api/auth` (na Vercel, `/api/(.*)` ja e reescrito para a
funcao da API):

| Rota | Quem chama | O que faz |
| --- | --- | --- |
| `POST /api/auth/google/start` | o botao | valida e devolve `authorizationUrl` (state, PKCE e nonce gerados no servidor) |
| `GET /api/auth/google/callback` | **o Google** (redirecionamento do navegador) | troca o codigo, valida o token, decide quem entra, abre a sessao e redireciona |
| `POST /api/auth/google/unlink` | tela *Empresa > Minha conta* | desvincula o Google (exige a senha) |
| `POST /api/auth/company` | tela `/criar-empresa` | cadastra a primeira empresa de quem entrou pelo Google |

**A URL de retorno (a que vai no Google) e a do `callback`:**

| Ambiente | URL a cadastrar no Google |
| --- | --- |
| Desenvolvimento (`pnpm dev`) | `http://localhost:5173/api/auth/google/callback` |
| Producao | `https://<dominio-do-painel>/api/auth/google/callback`, com o mesmo host do `APP_URL` |

Sem `GOOGLE_REDIRECT_URI`, o servidor usa `<APP_URL>/api/auth/google/callback`
(`googleRedirectUri` em `apps/api/src/env.ts`). O Google compara a URL
**caractere por caractere**: barra no fim, `http` x `https` e maiusculas contam.

## 2. Como funciona (e por que e seguro)

```
navegador                    API                               Google
    | POST /google/start ---->|                                    |
    |                         | state aleatorio (hash no banco),   |
    |                         | PKCE e nonce derivados do state    |
    |<-- authorizationUrl ----|   + cookie HttpOnly do state       |
    | --------------------------- redireciona -------------------->|
    |                                          usuario autoriza     |
    |<-------- GET /google/callback?code&state ---------------------|
    | (com o cookie) -------->| confere cookie == state, consome   |
    |                         | o state (uso unico, 10 min)        |
    |                         | POST token (code + secret + PKCE) -->
    |                         |<-- id_token                         |
    |                         | confere assinatura RS256, iss, aud,|
    |                         | exp, nonce, email_verified         |
    |<-- 302 + cookie de sessao HttpOnly (destino interno) ---------|
```

| Requisito | Como esta atendido |
| --- | --- |
| Validar o token no backend | tudo em `apps/api/src/lib/google-oauth.ts`; o navegador nunca ve o `id_token` |
| Assinatura, emissor, audiencia, expiracao | RS256 contra as chaves publicas do Google (`/oauth2/v3/certs`, por `kid`, com cache de 1 h e nova busca se o `kid` for desconhecido); `iss` em `accounts.google.com` / `https://accounts.google.com`; `aud` = nosso client id (com `azp` quando ha varias); `exp` (tolerancia de 60 s); `alg` fixo em RS256 (`none` e HS256 recusados) |
| `state` e CSRF | aleatorio, **so o hash** no banco, uso unico, 10 min, **amarrado ao navegador** por um cookie HttpOnly (`codeca_oauth_state`, `Path=/api/auth/google`, `SameSite=Lax`). Sem o cookie, o retorno e recusado (login CSRF) |
| PKCE | `S256`. O `code_verifier` e derivado do `state` e do `AUTH_SECRET`: nunca vai ao navegador nem ao banco |
| `nonce` | derivado do `state`; o token precisa traze-lo de volta, o que o amarra a ESTA tentativa |
| Segredo do cliente | so `GOOGLE_CLIENT_SECRET`, no servidor. Nenhuma variavel `VITE_*` |
| Tokens nao ficam em lugar nenhum | o `access_token` e descartado; o `id_token` so e lido, nunca guardado. Teste: `nenhum token do Google e guardado em lugar algum` |
| Cookies | a sessao e o mesmo cookie `codeca_session` de sempre: HttpOnly, `SameSite=Lax`, `Secure` em producao. Nada vai para `localStorage` |
| Logout, expiracao | os mesmos da sessao por senha (`POST /api/auth/logout` revoga no banco; sessao expira em `SESSION_TTL_HOURS`) |
| Redirecionamento aberto | o destino (`next`) so aceita `/painel...` e `/plataforma...` |
| Auditoria | `user.google_registered`, `user.google_logged_in`, `user.google_login_blocked` (com o motivo), `user.google_linked`, `user.google_unlinked` |
| Rate limit | por IP, no inicio (20 / 5 min) e no retorno (30 / 5 min) |

> **Atencao:** com a verificacao por e-mail ativa (`RESEND_API_KEY`), o Google e so a
> **1a etapa**: depois dele o servidor envia um codigo ao e-mail da conta e a sessao
> so nasce quando o codigo e digitado (retorno em `/entrar?etapa=codigo`). Veja
> [login-por-codigo.md](login-por-codigo.md). Onde este documento diz "abre a
> sessao", leia "abre a sessao depois do codigo".

## 3. Quem entra, quem e criado, quem e barrado

A chave que identifica a pessoa e o **`sub`** do Google (estavel), nunca o
e-mail (que pode mudar e ser reaproveitado).

| Situacao | O que acontece |
| --- | --- |
| `sub` ja vinculado a um usuario | entra **nesse** usuario. Empresas e papeis ficam como estao. Quem ainda nao tem empresa vai a `/criar-empresa` |
| `sub` novo, e-mail livre, verificado pelo Google | cria **so o usuario** (sem senha, e-mail ja confirmado) e leva a `/criar-empresa` |
| `sub` novo, **e-mail ja cadastrado** (com senha, ou convite pendente) | **nao entra e nao vincula**; volta a `/entrar?google=email_in_use` |
| e-mail nao verificado pelo Google | recusa (`unverified_email`) |
| a pessoa cancela no Google | volta a `/entrar?google=cancelled`; nada e criado |
| token invalido, vencido, adulterado, de outro cliente | volta a `/entrar?google=invalid_token`; nada e criado |

### Por que "e-mail igual" nao basta para vincular

Vincular automaticamente por e-mail entregaria a conta a quem controla aquele
Google -- e deixaria de pe uma senha que alguem tenha plantado antes
("pre-sequestro" de conta). Por isso o e-mail so **barra**; nunca **liga**.

### Como quem ja tem conta vincula o Google

Entrando com a senha e usando **Empresa > Minha conta > Entrar com Google**. O
vinculo exige:

1. a sessao aberta; **e**
2. a **senha de novo** (uma sessao emprestada ou roubada nao consegue prender a
   conta a um Google alheio); **e**
3. o Google autorizar no mesmo navegador (o fluxo e amarrado a quem o iniciou:
   se o retorno chegar a outra pessoa, e recusado com `session_mismatch`).

O e-mail do Google **pode ser diferente** do da conta: quem prova a identidade e
a senha. Uma conta Google nao pode estar em dois usuarios, e um usuario so tem
uma conta Google (dois indices unicos no banco).

Desvincular tambem pede a senha, e so existe para quem tem senha: sem ela a conta
ficaria sem nenhuma forma de entrar. Quem so tem o Google define uma senha por
**Esqueci minha senha** (o link vai ao e-mail confirmado).

### O que o Google **nunca** faz

- cria empresa por conta propria: a empresa nasce em `/criar-empresa`, pelo
  **mesmo cadastro** do e-mail e senha (`createCompanyForUser`), depois de a
  pessoa informar o nome e aceitar os termos;
- concede acesso a uma empresa: vinculo so nasce por cadastro de empresa ou
  convite aceito. Um convite pendente continua pendente e valido;
- concede o painel mestre. Na instalacao nova, "a primeira conta vira
  administrador da plataforma" vale **so** para o cadastro por e-mail e senha
  (ver `bootstrap.ts`); o Google nunca promove ninguem;
- altera o e-mail da conta, nem cria usuario duplicado (indice unico em
  `users.email` e em `(provider, sub)`; a corrida entre duas entradas
  simultaneas termina em `email_in_use`, nunca em duplicata).

## 4. Banco de dados

Migracao `0020_login_com_provedores_externos.sql` (so **acrescenta**; nenhuma
linha existente e tocada):

- `user_identities`: `user_id`, `provider`, `provider_subject`, `email`
  (informativo), `email_verified`, `last_login_at`. Unicos: `(provider,
  provider_subject)` e `(user_id, provider)`. `ON DELETE CASCADE`.
- `oauth_states`: hash do `state`, `intent` (`continue` | `link`), `user_id` (so
  no vinculo), `next_path`, `expires_at`, `consumed_at`. Linhas vencidas sao
  apagadas a cada novo fluxo.

`users.password_hash` ja aceitava nulo; uma conta so-Google cabe no modelo sem
mexer nele. A identidade interna continua sendo `users.id`.

## 5. Configurar no Google Cloud Console

1. **Projeto.** <https://console.cloud.google.com/> > seletor de projeto > **Novo
   projeto**. Nome sugerido: `CODECA Build`.
2. **Tela de consentimento.** *APIs e servicos* > **Tela de permissao OAuth**
   (ou *Google Auth Platform* > **Branding**).
   - Tipo de usuario: **Externo** (qualquer conta Google).
   - Nome do app: `CODECA Build`; e-mail de suporte; logotipo (opcional).
   - **Dominios autorizados:** o dominio raiz de producao (por exemplo
     `codecabuild.com`). Sao necessarios para o Google aceitar a pagina inicial,
     a politica de privacidade e os termos, que o app informa em *Branding*:
     `https://<dominio>/`, `https://<dominio>/privacidade`,
     `https://<dominio>/termos` (rotas reais da plataforma).
   - **Escopos:** apenas `openid`, `.../auth/userinfo.email` e
     `.../auth/userinfo.profile`. Sao escopos **nao sensiveis**: nao exigem
     verificacao do Google. Nao adicione Gmail, Drive nem nenhum outro.
3. **Publicar o app.** Em *Publico* / *Status de publicacao*, **Publicar app**
   (em producao). Em "Teste", so os e-mails cadastrados como *usuarios de teste*
   conseguem entrar (limite de 100) e o consentimento expira em 7 dias.
4. **Credencial.** *APIs e servicos* > **Credenciais** > **Criar credenciais** >
   **ID do cliente OAuth** > tipo **Aplicativo da Web**.
   - **Origens JavaScript autorizadas:** pode ficar **vazio**. O fluxo e todo no
     servidor (redirecionamento), sem Google Identity Services no navegador.
   - **URIs de redirecionamento autorizadas** (exatamente como na secao 1):
     - `http://localhost:5173/api/auth/google/callback`
     - `https://<dominio-do-painel>/api/auth/google/callback`
     - (opcional) a URL do preview que voce queira testar -- ver "Previews".
5. Copie o **ID do cliente** e o **Segredo do cliente**.

> O Google exige HTTPS em redirecionamentos, **exceto** `localhost`. Nao aceita
> curinga: cada URL e cadastrada por inteiro.

## 6. Configurar na Vercel

*Project > Settings > Environment Variables*:

| Variavel | Valor | Ambientes |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | o ID do cliente | Production (e Preview, se for usar) |
| `GOOGLE_CLIENT_SECRET` | o segredo — marque **Sensitive** | idem |
| `GOOGLE_REDIRECT_URI` | opcional; `https://<dominio-do-painel>/api/auth/google/callback` | Production |

Pontos de atencao:

- **`APP_URL` precisa ser o dominio que as pessoas usam.** O cookie do `state`
  e a sessao sao do host acessado; se a pessoa comeca em `www.` e o retorno
  cai em outro host, o cookie nao acompanha e o retorno e recusado
  (`invalid_state`). Escolha **um** host para o painel.
- Variavel nova so vale em um **novo deploy**.
- **Previews (`*.vercel.app`)** mudam de endereco a cada deploy e o Google nao
  aceita curinga. Em preview, ou nao defina as variaveis (o botao some) ou
  cadastre a URL daquele preview e defina `GOOGLE_REDIRECT_URI`.
- Nao crie nenhuma variavel `VITE_GOOGLE_*`: nada do Google e lido no navegador.

## 7. Como testar

**Conferir a configuracao (qualquer ambiente):** `GET /api/health` devolve
`features.googleAuth: true`; com `false`, o botao nao aparece.

**Desenvolvimento**

1. No `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (e `APP_URL` como
   `http://localhost:5173`, o padrao).
2. `pnpm dev` e abra `http://localhost:5173/entrar` (use **localhost**, nao
   `127.0.0.1`: a URL de retorno cadastrada e a de `localhost`).
3. Clique em **Continuar com Google** com uma conta que **nao** esteja
   cadastrada: deve cair em `/criar-empresa`. Cadastre a empresa e confira o painel.
4. Saia, entre de novo pelo Google: deve ir direto ao painel.
5. Com uma conta que **ja** tem cadastro por senha: deve voltar a `/entrar` com a
   explicacao. Entre pela senha e vincule em *Empresa > Minha conta*.

**Producao (Vercel)**

1. Variaveis definidas, novo deploy feito, URL de retorno cadastrada no Google.
2. `https://<dominio>/api/health` com `googleAuth: true`.
3. Repita os passos 3 a 5 acima em `https://<dominio>/entrar`. O cookie da sessao
   deve estar `Secure; HttpOnly; SameSite=Lax` (DevTools > Application > Cookies).
4. Auditoria: no painel mestre, as acoes `user.google_*` aparecem na trilha.

**Automatizados** (`pnpm test`; o Google e simulado, com PKCE validado de ponta a
ponta e `id_token` assinado em RS256):

- `tests/integration/google-auth.test.ts` -- usuario novo, usuario existente,
  e-mail ja cadastrado, convite pendente, conta Google ja vinculada, mais de uma
  empresa, cancelamento, state invalido/expirado/repetido, token adulterado
  (emissor, audiencia, expiracao, nonce, assinatura, algoritmo), logout, sessao.
- `tests/integration/google-auth-env.test.ts` -- sem credenciais; como na Vercel
  (HTTPS, cookie `Secure`, `GOOGLE_REDIRECT_URI`).
- `tests/integration/migrations.test.ts` -- migracao `0020`.
- `tests/unit/google-oauth.test.ts` -- URL de retorno, PKCE, destino seguro.

> O que os testes **nao** cobrem: a conversa com o Google real e a tela de
> consentimento. Isso so se confirma com as credenciais reais (passos acima).

## 8. Problemas comuns

| Sintoma | Causa provavel |
| --- | --- |
| Google mostra `Erro 400: redirect_uri_mismatch` | a URL cadastrada no Google nao e **identica** a de `GOOGLE_REDIRECT_URI` / `<APP_URL>/api/auth/google/callback` (barra no fim, `http` x `https`, host diferente) |
| `Erro 403: access_denied` / "app nao verificado" | app ainda em "Teste" e o e-mail nao esta na lista de usuarios de teste; publique o app |
| volta a `/entrar?google=invalid_state` | cookies bloqueados, ou o inicio e o retorno aconteceram em hosts diferentes; ou o `state` demorou mais de 10 minutos |
| volta com `invalid_token` | `GOOGLE_CLIENT_ID` do servidor diferente do usado na autorizacao; relogio do servidor muito errado |
| volta com `failed` | o Google nao respondeu, ou `GOOGLE_CLIENT_SECRET` incorreto (`invalid_client`); veja `[auth:google]` no log |
| botao nao aparece | falta `GOOGLE_CLIENT_ID` **ou** `GOOGLE_CLIENT_SECRET`, ou nao houve novo deploy |
| `email_in_use` | o e-mail ja tem conta: entre com a senha e vincule (secao 3) |

## 9. Limites conhecidos

- **Sessao do Google nao tem "manter conectado"**: vale `SESSION_TTL_HOURS`
  (12 h), como o cadastro. A tela de entrada por senha tem a opcao; o Google nao.
- Cada pessoa vincula **uma** conta Google; trocar e desvincular e vincular.
- Quem foi **convidado** para uma empresa usa o link do convite (que define a
  senha); depois, pode vincular o Google. O convite nao e aceito pelo Google.
- Nao ha login por outros provedores; a tabela `user_identities` ja comporta,
  mas cada um exigiria o seu proprio fluxo e as mesmas regras desta secao 3.
- O Google nao e a prova de que a pessoa **pertence a empresa**: so de que
  controla aquele e-mail. O acesso a empresa continua sendo decidido por
  vinculo e papel, em toda requisicao.
