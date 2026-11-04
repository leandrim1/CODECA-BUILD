# Integração com o Google Analytics 4

Cada cliente conecta a **própria** propriedade GA4 e vê as estatísticas do site no
painel (**Relacionamento › Estatísticas do site**). Este documento diz **como
funciona**, **o que configurar** (Google Cloud e Vercel), **como testar** e **o que
a integração garante e não garante**.

## 1. Relação com o login com Google

Reaproveita **só** as credenciais (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
Tudo o mais é independente e o login não é tocado:

| | Login com Google | Google Analytics |
| --- | --- | --- |
| Para quê | saber *quem* é a pessoa | ler as estatísticas *do site* |
| Escopos | `openid email profile` | `analytics.readonly` (só ele) |
| Tokens | nenhum guardado (`access_type=online`) | refresh token **cifrado**; acesso só em memória |
| Início | `POST /api/auth/google/start` | `POST /api/tenants/:tenantId/analytics/connect/start` |
| Retorno (callback) | `GET /api/auth/google/callback` | `GET /api/integrations/google-analytics/callback` |
| `redirect_uri` | `GOOGLE_REDIRECT_URI` ou `<APP_URL>/api/auth/google/callback` | `GOOGLE_ANALYTICS_REDIRECT_URI` ou `<APP_URL>/api/integrations/google-analytics/callback` |
| `state` | tabela `oauth_states`, cookie `codeca_oauth_state` | tabela `analytics_oauth_states`, cookie `codeca_ga_state` |
| Quando pede autorização | ao clicar em *Continuar com Google* | **só** ao clicar em *Conectar Google Analytics* |

Há testes que provam que o login continua pedindo `openid email profile`, com o
callback dele, e que a autorização do Analytics nunca inclui `openid`, e-mail nem
perfil (`tests/integration/google-analytics.test.ts`).

## 2. As rotas

Sob `/api/tenants/:tenantId/analytics` (sessão + vínculo com a empresa; a empresa
vem **sempre** da rota, nunca do corpo):

| Rota | Capacidade | O que faz |
| --- | --- | --- |
| `GET /` | `analytics:read` | estado da integração (e, para quem gerencia, a URL de retorno a cadastrar) |
| `POST /connect/start` | `analytics:manage` | cria `state`, define cookie e devolve a `authorizationUrl` |
| `GET /properties` | `analytics:manage` | propriedades GA4 a que a conta conectada tem acesso (Admin API) |
| `PUT /property` | `analytics:manage` | vincula uma propriedade **que a conta de fato enxerga** ao site |
| `GET /report?range=7d\|28d\|90d` | `analytics:read` | estatísticas (Data API, `batchRunReports`) |
| `DELETE /` | `analytics:manage` | revoga no Google e apaga a conexão |

Retorno do Google (URL fixa, fora de `/tenants`): `GET /api/integrations/google-analytics/callback`.

`analytics:read` vale para todos os papéis (inclusive o acesso de suporte da
plataforma, que é só leitura); `analytics:manage` é de **proprietário e
administrador**. Em empresa suspensa, as escritas são recusadas como em todo o painel.

## 3. Como funciona (e por que é seguro)

```
painel                         API                                  Google
  | clique "Conectar" -------->| cria state (hash no banco) +        |
  |                            | cookie HttpOnly, PKCE               |
  |<-- authorizationUrl -------|                                     |
  | ------------- redireciona (analytics.readonly, offline) -------->|
  |<------ GET /api/integrations/google-analytics/callback?code&state|
  | (com cookies) ------------>| confere cookie == state, consome    |
  |                            | (uso único, 10 min); confere que a  |
  |                            | sessão é a de quem clicou e que ele |
  |                            | ainda gerencia a empresa            |
  |                            | troca o code (+PKCE) ---------------->
  |                            |<-- access + refresh token ----------|
  |                            | exige o escopo e o refresh token;   |
  |                            | CIFRA o refresh token; grava        |
  |<-- 302 /painel/estatisticas?analytics=connected                  |
```

| Requisito | Como está atendido |
| --- | --- |
| Empresa do retorno | vem da linha de `state` gravada no clique — **nunca** da URL |
| `state` | aleatório, só o hash no banco, uso único atômico, 10 min, amarrado ao navegador por cookie HttpOnly com `Path=/api/integrations/google-analytics` |
| Retorno entregue a outra pessoa | recusado (`session_mismatch`); nada é gravado |
| Perdeu a permissão entre o clique e o retorno | recusado (`forbidden`) |
| PKCE | `S256`; o verifier é derivado do `state` e do `AUTH_SECRET`, nunca guardado |
| Escopo | só `analytics.readonly`. O consentimento é granular: se a pessoa desmarcar, é recusado (`scope_missing`) |
| Refresh token | `access_type=offline` + `prompt=consent`; sem ele a conexão não é criada (`no_refresh_token`) |
| Cifra | AES-256-GCM, IV aleatório por mensagem, chave `INTEGRATIONS_ENCRYPTION_KEY` |
| Isolamento da cifra | o par **empresa + site** entra como dado autenticado (AAD): um token copiado para a linha de outra empresa **não decifra** |
| Token de acesso | nunca gravado; fica em memória (cache de 45 min) e é renovado com o refresh token, com renovações simultâneas unificadas |
| Token no navegador / log / auditoria | nunca. Teste varre banco, respostas da API e auditoria atrás do token |
| Acesso revogado no Google | a renovação falha → conexão vira `needs_reconnect` (409 com `reason`), a propriedade é mantida, e o painel mostra **Reconectar** |
| Desconectar | revoga o token no Google (melhor esforço) e apaga a linha |
| Propriedade | só aceita uma que a conta conectada enxerga (consulta a Admin API na hora) |
| Limites | início/retorno por IP; relatórios (120/h) e listagem (30/h) por empresa; cache de 5 min por conexão+propriedade+período |
| Auditoria | `analytics.connected`, `.property_selected`, `.disconnected`, `.needs_reconnect`, `.connect_blocked` — sem token |

## 4. Banco de dados

Migração `0022_google_analytics.sql` (só **cria** duas tabelas; nada existente muda):

- `analytics_connections`: uma por site (`site_id` único), `status`
  (`pending_property` | `active` | `needs_reconnect`), `refresh_token_enc`,
  propriedade escolhida, quem conectou e quando. O par `(site_id, tenant_id)` tem
  chave estrangeira composta: o banco recusa uma conexão com o site de outra empresa.
- `analytics_oauth_states`: hash do `state`, empresa, site, usuário, validade, consumo.
  Os vencidos há mais de um dia são apagados pelo job diário.

## 5. Configurar

### 5.1 Google Cloud (mesmo projeto do login)

1. **Ativar as duas APIs** (*APIs e serviços › Biblioteca*):
   - **Google Analytics Data API**
   - **Google Analytics Admin API**
2. **Tela de consentimento › Acesso a dados (escopos):** adicionar
   `https://www.googleapis.com/auth/analytics.readonly`.
3. **Credencial OAuth já existente › URIs de redirecionamento:** **acrescentar**
   (sem remover a do login):
   - `https://<dominio-do-painel>/api/integrations/google-analytics/callback`
   - para testar localmente: `http://localhost:5173/api/integrations/google-analytics/callback`

   O Google compara **caractere por caractere** (barra final, `http` × `https`). A
   URL exata que o servidor usa aparece, para quem gerencia, na própria tela
   *Estatísticas do site* (ou em `GET /api/tenants/:id/analytics`, campo `redirectUri`).
4. **Verificação do app.** `analytics.readonly` é um escopo **sensível**: confirme no
   console se o app precisa de verificação do Google para ser usado por clientes.
   Enquanto não for verificado, os clientes veem a tela de "app não verificado" e há
   limite de usuários. Isso não afeta o login (escopos não sensíveis).

### 5.2 Vercel

| Variável | Valor | Obrigatória |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | as do login (já configuradas) | sim |
| `INTEGRATIONS_ENCRYPTION_KEY` | `openssl rand -base64 32` — marque **Sensitive** | **sim** (sem ela a integração fica desligada) |
| `GOOGLE_ANALYTICS_REDIRECT_URI` | só se a URL de retorno não for `<APP_URL>/api/integrations/google-analytics/callback` | não |
| `ANALYTICS_CACHE_TTL_SECONDS` | padrão 300 | não |

Novo deploy após definir. `GET /api/health` mostra `features.googleAnalytics: true`.
Com `false`, a tela diz que a integração não está habilitada e `connect/start` responde 501.

> **Guarde `INTEGRATIONS_ENCRYPTION_KEY` com o mesmo cuidado do `AUTH_SECRET`.**
> Trocá-la torna os tokens guardados ilegíveis: os clientes precisam reconectar
> (a tela pede). Perdê-la tem o mesmo efeito. Por isso ela é separada do
> `AUTH_SECRET`: girar o segredo de sessão não derruba as conexões.

## 6. Como testar

**Automatizado** (sem rede, com Google falso): `pnpm exec vitest run tests/integration/google-analytics.test.ts tests/unit/secret-box.test.ts`.
Cobre: fluxo completo; isolamento entre empresas (inclusive token copiado para a linha
de outra); papéis; `state` forjado, reaproveitado, de outra pessoa ou sem cookie;
consentimento sem o escopo; sem refresh token; revogação; API desativada; integração
desligada; login com Google intacto.

**Manual (produção):** entre como proprietário › *Estatísticas do site* › *Conectar
Google Analytics* › autorize › escolha a propriedade › as estatísticas aparecem.

| Sintoma | Causa provável |
| --- | --- |
| Google mostra `redirect_uri_mismatch` | a URL de 5.1.3 não está cadastrada exatamente como o servidor a usa |
| Volta com "tentativa expirou" | `APP_URL` diferente do host que a pessoa usa (o cookie do `state` não acompanha), ou passou de 10 min |
| "API do Google Analytics não está ativada" | falta ativar a Data API / Admin API (5.1.1) |
| "Nenhuma propriedade GA4" | a conta Google conectada não tem GA4 (só Universal Analytics antigo) |
| "Reconexão necessária" | a pessoa revogou o acesso, trocou a senha do Google, ou o app está em modo de teste (token expira em 7 dias) |
| Botão ausente / "não habilitada" | falta `INTEGRATIONS_ENCRYPTION_KEY` (ou credenciais Google) |
| Preview da Vercel não conecta | o Google não aceita curinga; use produção ou cadastre a URL do preview |

## 7. Limites desta versão

- Uma conexão e uma propriedade **por site**; cada empresa tem um site principal.
- Só leitura e só estas métricas: usuários, sessões, visualizações, engajamento,
  duração, série diária, páginas, canais e dispositivos. Sem eventos personalizados
  nem conversões.
- **A plataforma não instala a tag do GA4 no site do cliente.** O site precisa
  enviar dados ao GA4 por conta própria; sem isso a propriedade existe, mas não
  mostra visitas.
- Não foi exercitado com o Google de verdade (Data/Admin API, tela de consentimento,
  verificação do app): os testes usam um Google falso que reproduz os contratos
  documentados. A primeira conexão real em produção é o teste que falta.
- Relatórios com cache de 5 min por instância; os dados do próprio GA4 podem levar
  horas para refletir.
- Troca da chave de cifra não migra tokens antigos: exige reconexão.
