# Seguranca

Onde cada decisao de seguranca esta implementada, o que ela cobre e o que
continua sendo responsabilidade de quem opera a plataforma.

## 1. Autenticacao

`apps/api/src/lib/session.ts`, `lib/cookies.ts`, `packages/shared/src/server/crypto.ts`

- **Senhas** com `scrypt` (`node:crypto`), salt aleatorio por senha e parametros
  guardados junto do hash (`scrypt$N$r$p$salt$hash`), o que permite elevar o
  custo no futuro sem invalidar as senhas existentes. A comparacao usa
  `timingSafeEqual`.
- **Sessoes opacas**: o cookie carrega um token aleatorio de 32 bytes; o banco
  guarda apenas o HMAC desse token com `AUTH_SECRET`. Um vazamento do banco nao
  permite montar um cookie valido, e o token em claro nao aparece em log algum.
- **Cookies**: `codeca_session` e `HttpOnly`, `SameSite=Lax`, `Path=/` e
  `Secure` em producao. `codeca_csrf` e legivel de proposito (double submit).
- **Expiracao**: 12 horas, ou 30 dias com "manter conectado"
  (`SESSION_TTL_HOURS`, `SESSION_REMEMBER_TTL_HOURS`). Cada sessao guarda o
  hash do IP e o user agent; o usuario ve as sessoes ativas e pode encerrar as
  outras.
- **Verificacao de e-mail, redefinicao de senha e convites** usam tokens de uso
  unico com validade, tambem guardados em hash (`user_tokens`). Operacoes
  sensiveis (cadastrar dominio, por exemplo) exigem e-mail verificado.
- **Enumeracao de contas**: "esqueci minha senha" e o reenvio de verificacao
  respondem igual para e-mail existente ou nao.

## 2. Autorizacao

`apps/api/src/lib/authz.ts`, `packages/shared/src/roles.ts`

A interface esconde controles, mas quem decide e o servidor. Toda rota de
empresa passa por `tenantMiddleware` + `requireCapability(...)`.

- `resolveTenantContext` confere o `tenant_id` da rota contra `memberships`. Sem
  vinculo, responde **404** — nao 403 — para nao revelar que o registro existe.
- Papeis: `viewer` (somente leitura), `editor` (conteudo e publicacao), `admin`
  (equipe, dominios, restauracao) e `owner` (plano, exclusao da empresa).
  Capacidades em `TENANT_CAPABILITIES`.
- `canAssignRole` impede escalada: ninguem concede um papel acima do seu, e so
  um `owner` cria outro `owner`.
- **Ser administrador de uma empresa nao da privilegio global.** O papel de
  plataforma (`platform_role`) e um campo separado do usuario e so o painel
  mestre o verifica (`assertPlatformCapability`).

## 3. Isolamento entre empresas

- `tenant_id` em toda tabela de conteudo, com chave estrangeira e cascata.
- Toda consulta do painel filtra por `tenant_id` vindo da sessao verificada.
  Trocar o ID na URL, no corpo ou em um parametro leva a 404.
- Referencias cruzadas sao conferidas, nao presumidas: `assertMediaBelongsToTenant`
  recusa uma imagem de outra empresa; `blobPathBelongsToTenant` confere o
  prefixo `tenants/<tenantId>/` antes de remover um arquivo.
- Consultas parametrizadas em todo lugar (Drizzle). Onde foi preciso SQL
  literal, os valores entram como parametros.
- `tests/integration/isolation.test.ts` percorre as rotas trocando IDs e espera
  404 em cada uma — e a prova executavel de que o isolamento vale.

## 4. Acesso de suporte

`support_access_grants`

Um `platform_admin` **nao** le dados de empresa por padrao. Para dar suporte e
preciso um registro com empresa, motivo, quem concedeu e validade. O acesso
resultante e **somente leitura** (equivalente a `viewer`), expira sozinho e cada
uso aparece em `audit_logs`. Revogar e imediato.

## 5. Validacao de entrada

`packages/shared/src/validators/*`

- Zod em toda entrada, no servidor, com o mesmo schema que o painel usa — a
  validacao do cliente e conveniencia, nao defesa.
- Erros voltam campo a campo (`fieldErrors`), o que o painel exibe junto de cada
  campo.
- O layout das paginas e validado bloco a bloco contra o schema do tipo, tanto
  ao salvar o rascunho quanto ao publicar. Um bloco desconhecido ou uma
  propriedade fora do schema nao e persistido.
- `safeHrefSchema` aceita `/caminho`, `#ancora`, `http(s)`, `mailto` e `tel`, e
  recusa `javascript:`, `data:` e URLs sem protocolo (`//exemplo.com`).

## 6. XSS e conteudo executavel

- **Nao existe campo de HTML, JavaScript ou CSS livre.** O editor monta blocos a
  partir do catalogo; o conteudo e texto, numero, booleano, escolha em lista,
  cor validada ou referencia a um registro.
- O HTML publico sai de componentes React (`renderToStaticMarkup`), que escapam
  texto por construcao. Os poucos trechos montados a mao (metatags, JSON-LD,
  sitemap) passam por `escapeHtml`/`escapeXml`, e o JSON-LD tem `<` escapado como
  `<` para nao fechar o `<script>`.
- O CSS do tema e gerado a partir de valores que passaram pelos schemas: cores
  sao hex ou referencia a token, medidas sao numeros em faixas conhecidas. Um
  valor malicioso em um campo de cor nao vira regra de CSS — ha teste para isso.
- `x-frame-options: DENY` e `cross-origin-opener-policy: same-origin` no painel.
  A previa do editor roda em um iframe escrito pelo proprio painel, com conteudo
  da mesma origem.

## 7. CSRF e CORS

`apps/api/src/lib/csrf.ts`, `middleware/security.ts`

Duas camadas em toda requisicao que altera estado:

1. **Origem**: `Origin` precisa ser o painel (`APP_URL`, mais os enderecos
   locais em desenvolvimento) ou o proprio host.
2. **Double submit**: o valor do cookie legivel precisa voltar no cabecalho
   `x-csrf-token` e bater com o hash guardado na sessao.

O CORS e restritivo: credenciais so para as origens conhecidas; um `OPTIONS` de
origem desconhecida recebe 403. Os sites publicos chamam a API no proprio
dominio e nao precisam de CORS.

Cabecalhos aplicados a todas as respostas: `x-content-type-options: nosniff`,
`referrer-policy: strict-origin-when-cross-origin`,
`permissions-policy: camera=(), microphone=(), geolocation=()`,
`strict-transport-security` em producao e `cache-control: no-store` nas
respostas da API.

## 8. Rate limiting

`apps/api/src/lib/ratelimit.ts`

Janela fixa **persistida no banco** — funcoes serverless nao compartilham
memoria, portanto um contador em processo nao protegeria nada. A chave guarda
apenas o hash do IP com `AUTH_SECRET`.

| Acao | Limite |
| --- | --- |
| Login | 10 / 5 min |
| Cadastro | 5 / hora |
| Redefinicao de senha | 5 / hora |
| Reenvio de verificacao | 5 / hora |
| Formulario publico | 5 / 10 min por IP e 40 / dia por IP e empresa |
| Upload | 120 / hora |
| Verificacao de dominio | 30 / hora |
| Convites | 20 / hora |

O formulario publico tem ainda um campo oculto de armadilha (honeypot): quando
vem preenchido, a resposta e 201 sem gravar nada — um robo nao descobre que foi
recusado.

## 9. Upload de arquivos

O token do Blob fica so no servidor; nao existe upload direto do navegador. Cada
envio passa por sessao, vinculo com a empresa, permissao, mime permitido,
tamanho (4 MB) e limite de armazenamento do plano. O caminho gravado e sempre
`tenants/<tenantId>/...`. Detalhes em [blob.md](blob.md).

## 10. Pagamentos

`apps/api/src/lib/validapay/`, `apps/api/src/lib/billing/`

- **Nenhum dado de cartao chega ao servidor.** A contratacao usa o checkout
  hospedado da ValidaPay, onde o cartao e tokenizado no navegador do comprador.
  Nao ha numero, CVV ou token de cartao em nenhuma tabela, log ou payload desta
  aplicacao.
- **O preco nunca vem do navegador.** A entrada da contratacao aceita apenas
  `planId` e `paymentMethod`; o valor e lido do plano no banco e convertido para
  reais na fronteira da API. Campos como `priceCents` ou `amount` enviados pelo
  cliente sao descartados pelo schema -- ha teste.
- **Credenciais OAuth2 so no servidor.** `VALIDAPAY_CLIENT_ID` e
  `VALIDAPAY_CLIENT_SECRET` nunca aparecem em variavel `VITE_*`. O
  `access_token` fica em memoria do processo e nao e persistido.
- **Webhook autenticado por HMAC.** O corpo bruto e verificado antes de ser
  interpretado, com `timingSafeEqual` e janela de tolerancia no timestamp
  (`VALIDAPAY_WEBHOOK_TOLERANCE_SECONDS`). Assinatura invalida responde 401 e
  nada e gravado.
- **Idempotencia em tres camadas**: id do evento unico, id da cobranca unico e
  estados que so avancam. Uma reentrega nao credita periodo nem cobra de novo.
- **A empresa nunca e deduzida.** O vinculo vem dos nossos registros ou do token
  opaco que enviamos no checkout -- nunca de e-mail ou documento no corpo do
  evento. Um `metadata.tenantId` que contradiga o vinculo gravado e ignorado.
- **Logs sem segredo.** As falhas registram metodo, rota, status e o codigo de
  erro do provedor; nunca o `client_secret`, o token, a assinatura recebida ou o
  corpo do evento. A resposta do `POST /auth/token` nunca e ecoada.
- **Job de reconciliacao protegido** por segredo proprio em `Authorization:
  Bearer`, comparado em tempo constante. Estar autenticado no painel nao
  substitui o segredo.
- **Acao administrativa nao reescreve dinheiro.** Uma suspensao manual grava uma
  decisao em `admin_hold`, com justificativa e autor, ao lado -- e nao em vez --
  do estado confirmado pela ValidaPay.
- **Suspensao nao apaga dados.** Inadimplencia e suspensao afetam a publicacao
  do site; conteudo, imagens e acesso ao painel permanecem.

## 11. Segredos

- Todas as variaveis sao lidas somente no servidor. Nao existe segredo em
  variavel `VITE_*` — o que o navegador recebe e apenas o bundle do painel.
- `.env.example` traz **somente nomes e exemplos ficticios**. `.env` esta no
  `.gitignore`.
- `AUTH_SECRET` protege tokens de sessao, tokens de e-mail e os hashes de IP do
  rate limiting. Trocar invalida sessoes e links pendentes.
- Rotacao: altere na Vercel e faca um novo deploy. Para o Blob e a API da Vercel,
  gere o token novo, troque a variavel, implante e so depois revogue o antigo.

## 12. Logs e auditoria

- Os logs **nao** registram senha, token em claro, cookie nem IP em claro (o IP
  e sempre hash). Erros de servidor saem com `requestId`, metodo e caminho.
- `audit_logs` registra quem fez, em qual empresa, em qual entidade, quando, de
  qual IP (em hash) e com quais metadados — publicacoes, restauracoes, convites,
  mudanca de papel, dominios, midia, suspensao de empresa e acesso de suporte.
- O painel mestre tem a visao global; `admin` e `owner` veem o log da propria
  empresa (`audit:read`).

## 13. Erros

`apps/api/src/middleware/error.ts`, `packages/shared/src/errors.ts`

Resposta padronizada `{ error: { code, message, details? } }`, com os codigos de
`ErrorCode`: `bad_request`, `validation_error`, `unauthenticated`,
`email_not_verified`, `forbidden`, `not_found`, `conflict`,
`plan_limit_reached`, `storage_limit_reached`, `rate_limited`,
`payload_too_large`, `unsupported_media_type`, `integration_not_configured`,
`upstream_error` e `internal_error`. Cada um tem status HTTP e mensagem em
portugues; erros de validacao trazem `fieldErrors`. Erro inesperado responde 500
com mensagem generica, e o detalhe fica no log do servidor com o `requestId` —
nunca stack trace para o navegador.

`integration_not_configured` existe para ser honesto quando um recurso depende
de configuracao externa (Blob, dominios, e-mail), em vez de responder sucesso
sem fazer nada.

## 14. Privacidade dos interessados (LGPD)

- Dados de contato e observacoes internas ficam no painel. O payload publico do
  site **nao** inclui `leads` nem `lead_notes` — so o necessario para renderizar
  o site, e ha teste cobrindo isso.
- O formulario declara a finalidade e exige consentimento explicito
  (`consent: true` e obrigatorio no schema), gravado em `leads.consent_at`.
- A auditoria do envio registra o evento e o tipo de interesse, **nao** o nome,
  telefone ou mensagem. O IP e guardado em hash.
- Exclusao de um interessado (direito de eliminacao) e feita pelo painel e
  remove tambem as observacoes, por cascata. A exclusao fica em `audit_logs`
  pelo id, sem reintroduzir o dado pessoal.
- `tenants.contact_email` e publico de proposito: aparece no site e recebe o
  aviso de novo interessado. Como ele e preenchido com o e-mail de quem cadastrou
  a empresa, vale orientar o cliente a trocar por um endereco institucional.

## 15. Backup e recuperacao

Historico continuo do Neon, com restauracao no tempo, e `pg_dump` antes de
migracoes destrutivas. Procedimento em [neon.md](neon.md#6-backup-e-restauracao).
Os arquivos no Blob nao sao versionados: um arquivo removido precisa ser
reenviado.

## 16. O que depende de quem opera

Nem toda defesa cabe no codigo:

- **`AUTH_SECRET` forte e unico por ambiente.** Nao reutilize o de
  desenvolvimento em producao.
- **Acesso ao projeto na Vercel e ao Neon** com 2FA e o minimo de pessoas.
- **Revisar `support_access_grants`** periodicamente: concessoes expiram, mas
  conceder demais e um risco operacional, nao um bug.
- **WAF/anti-DDoS na borda** fica a cargo da Vercel; o rate limiting da
  aplicacao protege os endpoints, nao a banda.
- **Retencao de dados de interessados**: defina um prazo e aplique. A plataforma
  nao exclui nada por conta propria.
- **Varredura de dependencias** (`pnpm audit`) no seu ciclo de manutencao.
