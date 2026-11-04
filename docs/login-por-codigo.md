# Login por codigo de verificacao (e-mail)

"Entrar com e-mail" em `/entrar` e "Continuar com e-mail" em `/criar-conta`: a
pessoa informa o e-mail, recebe um codigo de 6 digitos e entra **sem senha** e
**sem Google**. Funciona de forma independente dos outros dois jeitos de entrar
(senha e Google) e usa a mesma sessao.

## 1. Rotas da API

Todas sob `/api/auth/code`, `POST`, com verificacao de origem:

| Rota | O que faz | Resposta |
| --- | --- | --- |
| `/request` | gera, guarda (so o hash) e **envia** o codigo | `{ sent, resendAfterSeconds: 60, expiresInSeconds: 600 }`. **Nunca** o codigo. Igual para e-mail com e sem conta |
| `/verify` | confere o codigo | e-mail com conta: `{ status: "authenticated", session, csrfToken, notice }` e cookie de sessao. E-mail novo: `{ status: "registration_required" }` e um comprovante em cookie HttpOnly |
| `/register` | conclui o cadastro de e-mail **novo** (nome, empresa, telefone, termos) | `201 { status: "authenticated", session, csrfToken, tenantId }` |

`GET /api/auth/session` informa `features.emailCodeAuth` (a tela so mostra a opcao
quando e `true`).

## 2. Como cada exigencia esta atendida

| Exigencia | Como |
| --- | --- |
| 6 digitos aleatorios | `crypto.randomInt` (fonte criptografica), com zeros a esquerda preservados |
| Validade de 10 minutos | `expires_at`; conferido no servidor com o relogio do servidor |
| Uso unico | `UPDATE ... WHERE used_at IS NULL RETURNING` -- de varias validacoes simultaneas, so uma passa (teste com 6 em paralelo) |
| Guardado em hash | `code_hash = HMAC-SHA256(AUTH_SECRET, "login-code:<email>:<codigo>")`. Com so 1.000.000 de possibilidades, um hash simples seria quebrado em milissegundos por quem lesse o banco; com o segredo, nao |
| Limite de tentativas | **5 por codigo**; a tentativa e contada **antes** de conferir, de forma atomica (tentativas simultaneas tambem contam). Errou a 5a, o codigo morre, mesmo o certo |
| Limite de pedidos | por e-mail **5/hora** e por IP **15/hora** |
| Intervalo entre reenvios | **60 s** por e-mail; antes disso `429` com quantos segundos faltam |
| Forca bruta | alem das 5 tentativas: validacoes por e-mail **15/hora** e por IP **30/15 min**. Pedir codigo novo nao zera nada |
| Anti-enumeracao | `/request` faz o mesmo trabalho e responde igual para qualquer e-mail; toda falha de `/verify` (errado, vencido, usado, inexistente, esgotado) devolve **a mesma mensagem**. A tabela nao tem `user_id`: existir uma linha nao revela se ha conta |
| Codigo anterior invalidado | pedir um novo marca os anteriores como usados; so o ultimo emitido vale |
| Codigo fora do log | o mailer de console **omite** o corpo dos e-mails `login_code`; o adaptador da Resend so loga o status HTTP; a auditoria nao carrega o codigo. Teste varre `console.*` em um fluxo completo |
| Codigo fora da resposta | a resposta de `/request` tem 3 campos fixos; teste confere o corpo e os cabecalhos |
| So o e-mail nunca autentica | `/verify` exige o codigo (422 sem ele); `/register` exige o comprovante do codigo |
| E-mail "verificado" so depois do codigo | `email_verified_at` passa a valer na primeira prova |
| Sessao | `createSession`, o mesmo caminho da senha e do Google: cookie `codeca_session` HttpOnly, `SameSite=Lax`, `Secure` em producao; nada em `localStorage`; logout e expiracao iguais |
| Limpeza | cada pedido apaga os codigos vencidos ha mais de 1 dia (sem depender de tarefa agendada) |

## 3. Cliente que ja tem conta x cliente novo

- **Conta existente:** entra nela. Empresas, vinculos, papeis, site e assinatura
  ficam **intactos** (testes comparam as tabelas antes e depois). Quem pertence a
  varias empresas ve todas, com os papeis de sempre. Nada concede painel mestre.
- **Convite pendente:** o codigo prova o e-mail e abre a sessao, **mas nao ativa
  o vinculo**: o convite continua valido pelo link dele.
- **E-mail novo:** provar o codigo **nao cria conta**. A tela pede nome, empresa,
  telefone e aceite dos termos; so entao nascem usuario (sem senha, e-mail ja
  verificado), empresa, vinculo de proprietario, site e avaliacao -- o **mesmo
  cadastro de empresa** do e-mail e senha (`createCompanyForUser`).
  - O e-mail do cadastro **sai do comprovante** (cookie HttpOnly assinado, 20 min,
    `Path=/api/auth/code`), nunca do corpo: ninguem cadastra um endereco que nao
    provou.
  - Uso unico: repetir o cadastro nao duplica conta nem empresa.
  - **Nenhum papel de plataforma** e concedido, nem o de "primeira conta da
    instalacao" (que vale so para o cadastro por senha).

### Conta que nunca teve o e-mail verificado ("pre-sequestro")

Alguem poderia abrir uma conta com o e-mail de outra pessoa e uma senha, e nunca
confirmar. Se a dona do e-mail entrasse depois por codigo, a senha plantada
continuaria abrindo a conta. Por isso, **na primeira prova de e-mail** de uma
conta ainda nao verificada: o e-mail passa a verificado, a **senha antiga e
removida** e as **sessoes antigas sao encerradas**. Dados, empresas e vinculos
ficam como estao; a tela mostra um aviso, e a pessoa pode definir nova senha por
"Esqueci minha senha".

## 4. Banco de dados

Migracao `0021_codigos_de_acesso_por_email.sql` (so **acrescenta**; nenhuma linha
existente e tocada). Tabela `login_codes`: `id`, `email`, `code_hash`,
`expires_at`, `attempts`, `used_at`, `request_ip_hash` (so hash), `created_at`.
Indices `(email, created_at)` e `(expires_at)`. Sem `user_id`, de proposito
(anti-enumeracao).

## 5. E-mail: configuracao (o que falta para o envio real)

O recurso reutiliza o servico de e-mail que ja existe (**Resend**, em
`apps/api/src/lib/mailer.ts`). Variaveis, no ambiente do **servidor** (nunca em
`VITE_*`):

| Variavel | Valor |
| --- | --- |
| `RESEND_API_KEY` | chave de API criada em <https://resend.com/api-keys> (permissao de envio) |
| `MAIL_FROM` | `CODECA Build <acesso@seu-dominio-verificado>` |

Passos na Resend:

1. **Domains > Add Domain** e cadastre o dominio de envio.
2. Publique no DNS os registros que a Resend mostrar (**SPF** e **DKIM**; o
   **DMARC** e recomendado) e aguarde a verificacao.
3. **API Keys > Create API Key** (acesso de envio) e coloque em `RESEND_API_KEY`.
4. Defina `MAIL_FROM` com um endereco **desse dominio verificado**. A Resend recusa
   remetente de dominio nao verificado (`403`), e a tela mostra "Nao foi possivel
   enviar o e-mail agora".

Para um teste rapido sem dominio, a Resend permite `onboarding@resend.dev`, mas so
entrega ao e-mail da propria conta dela.

Sem `RESEND_API_KEY`: a opcao **nao aparece** em `/entrar` e `/criar-conta`
(restam senha e Google), `POST /api/auth/code/request` responde **501** com
`integration_not_configured`, e **nada** e escrito no log. Nao ha modo de
desenvolvimento que mostre o codigo: um codigo no log abriria a conta de qualquer
um que lesse o log. Em desenvolvimento, use a chave de teste da Resend.

Se o provedor recusar ou nao responder (prazo de 8 s), o pedido responde `502`, o
codigo recem-criado e **apagado** (ninguem o recebeu) e a pessoa e avisada.

### Como conferir o envio real (a fazer com a chave)

1. Defina as duas variaveis e faca um novo deploy.
2. `GET /api/health` -> `features.transactionalEmail: true` (e `emailCodeAuth`
   em `GET /api/auth/session`).
3. Em `/entrar` > **Entrar com e-mail**, informe um endereco seu. O e-mail deve
   chegar com o assunto **Seu codigo de acesso ao CODECA Build** em poucos
   segundos; olhe tambem o spam na primeira vez.
4. Digite o codigo: deve entrar no painel (conta existente) ou pedir o cadastro
   (e-mail novo).
5. Se nao chegar: painel da Resend > **Logs** mostra o motivo (dominio nao
   verificado, destinatario recusado...), e o log do servidor traz
   `[mailer:resend] falha <status>`.

## 6. Tela

Entrada: **Bem-vindo ao CODECA Build** / *Acesse sua conta para gerenciar seu
site.* / [Continuar com Google] / ou / [Entrar com e-mail], com um link discreto
para entrar com senha (o formulario de senha continua existindo e funcionando).

Fluxo por e-mail:

1. **E-mail** (validacao de formato, "Voltar ao login", botao *Enviar codigo de
   verificacao*).
2. **Codigo**: seis campos com avanco automatico, colar os seis numeros de uma
   vez (de qualquer campo), Backspace volta, autopreenchimento do navegador
   (`autocomplete="one-time-code"`), *Verificar e entrar*, *Reenviar codigo* com
   contador (`1:00`) e *Alterar e-mail*. Errou: campos limpos, foco no primeiro e
   mensagem generica. Clique repetido nao gasta tentativa (uma conferencia por vez).
3. **Cadastro** (so e-mail novo): nome, empresa, telefone, termos.

## 7. Testes

- `tests/integration/login-code.test.ts` (54): envio e texto, resposta sem o
  codigo, hash no banco, igualdade de resposta com e sem conta, e-mail invalido,
  reenvio (60 s) e limites (e-mail, IP, janela), codigo errado/expirado/usado,
  uso unico sob concorrencia, 5 tentativas (inclusive simultaneas), cota de
  validacoes, cliente existente (sem duplicar nada, varias empresas, papeis,
  assinatura, painel mestre), pre-sequestro, convite pendente, cliente novo
  (comprovante, termos, e-mail do corpo ignorado, comprovante falso/vencido/
  adulterado, uso unico, corrida), sessao (recarregar, logout, expirar, CSRF),
  coexistencia com Google e senha, nada em log/auditoria, sem provedor e
  provedor que falha.
- `tests/unit/login-code-mail.test.ts`: geracao, hash, texto do e-mail, log de
  console sem o codigo, **adaptador da Resend** (URL, cabecalho, remetente,
  destino, assunto e texto).
- `tests/integration/migrations.test.ts`: migracao `0021`.
- Verificado no navegador contra a API real (banco em memoria, e-mail em
  memoria): fluxo completo, colar, erro, reenvio com a espera real de 60 s,
  cadastro de cliente novo, recarregar a pagina, celular.

> **O que nao foi exercitado:** a entrega real pela Resend (precisa da chave e de
> um dominio verificado, que este ambiente nao tem). O que sai pela rede e
> conferido por teste (URL, autenticacao, corpo), mas a caixa de entrada de
> verdade so se confirma com o roteiro da secao 5.
