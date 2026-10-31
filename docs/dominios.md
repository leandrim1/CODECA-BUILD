# Dominios proprios e DNS

Cada construtora pode publicar o site em um dominio seu
(`www.construtorahorizonte.com.br`). Toda a integracao com o provedor acontece
no backend; o navegador apenas mostra o estado e as instrucoes.

## 1. Preparar a plataforma (uma vez)

1. Na Vercel, gere um token em **Account Settings > Tokens** com escopo do time
   ou do projeto.
2. Copie o **Project ID** em **Project Settings > General**. Se o projeto
   pertence a um time, copie tambem o **Team ID**.
3. Defina no ambiente:

```
VERCEL_API_TOKEN="..."
VERCEL_PROJECT_ID="prj_..."
VERCEL_TEAM_ID="team_..."        # apenas se houver time
DOMAIN_A_RECORD_IP="76.76.21.21"
DOMAIN_CNAME_TARGET="cname.vercel-dns.com"
```

`DOMAIN_A_RECORD_IP` e `DOMAIN_CNAME_TARGET` sao os valores que o cliente vera
nas instrucoes. Confirme os atuais em **Project Settings > Domains** na Vercel
antes de implantar — a Vercel ja mudou esses alvos no passado.

Sem `VERCEL_API_TOKEN` e `VERCEL_PROJECT_ID`, o cadastro de dominio continua
funcionando, mas o dominio fica em **Aguardando DNS** e nunca e marcado como
ativo: a plataforma diz isso com todas as letras em vez de simular sucesso.
`GET /api/health` expoe `features.vercelDomains`.

## 2. O que o cliente faz no painel

Em **Dominio proprio**:

1. Digita o dominio. O valor e normalizado no servidor (protocolo, porta,
   caminho, ponto final e caixa alta sao descartados) e validado rotulo por
   rotulo.
2. A plataforma recusa, com mensagem propria:
   - hosts da propria plataforma (`PLATFORM_HOSTS`, `APP_URL`, `*.vercel.app`);
   - subdominios reservados — `app`, `painel`, `admin`, `api`, `blob`, `mail`,
     `smtp`;
   - dominio ja cadastrado nesta empresa;
   - dominio ja vinculado a **outra** empresa — garantido tambem pelo indice
     unico global `domains_hostname_key`, nao so pela checagem da aplicacao.
3. O dominio e registrado no provedor **antes** de ser gravado, para nascer com
   o estado real.
4. O painel mostra os registros de DNS a criar, com nome e valor para copiar.
5. O cliente cria os registros no provedor de DNS dele e volta para
   **Verificar novamente**.

O recurso depende do plano (`custom_domain`) e do limite `maxDomains` — 0 na
Avaliacao, 1 no Essencial, 1 no Profissional, 3 no Empresas. Ambos sao
verificados no servidor.

No Essencial o cliente nao tem painel, entao quem conecta o dominio e a CODECA
IA; o dominio continua incluso no plano.

## 3. Registros de DNS

O que mostrar depende de o dominio ser apex ou subdominio; a logica trata
sufixos de dois niveis comuns no Brasil (`com.br`, `net.br`, ...).

**Apex** (`construtorahorizonte.com.br`):

| Tipo | Nome | Valor |
| --- | --- | --- |
| A | `@` | `76.76.21.21` |

**Subdominio** (`www.construtorahorizonte.com.br`):

| Tipo | Nome | Valor |
| --- | --- | --- |
| CNAME | `www` | `cname.vercel-dns.com` |

Quando o provedor exige comprovacao de propriedade, entra tambem um `TXT`
temporario, com nome e valor vindos do desafio devolvido pela Vercel.

Orientacoes para o cliente:

- Propagacao leva de minutos a algumas horas, conforme o TTL anterior. Baixar o
  TTL para 300 segundos antes da mudanca encurta a espera.
- Nao criar um CNAME na raiz do dominio: o DNS nao permite conviver com os
  registros `NS`/`SOA`. Para apex, use o registro `A`.
- Se houver Cloudflare, deixe o registro **DNS only** (nuvem cinza) durante a
  verificacao; o proxy esconde o DNS real e a verificacao falha.
- O certificado TLS e emitido pela Vercel automaticamente depois que o DNS
  aponta. Nao ha nada a configurar, apenas aguardar.

## 4. Estados

| Estado | Significado | O que fazer |
| --- | --- | --- |
| **Pendente** | Cadastrado, ainda sem resposta do provedor | Aguardar a primeira verificacao |
| **Aguardando DNS** | Registros ainda nao encontrados (ou integracao nao configurada) | Criar/corrigir os registros e verificar novamente |
| **Verificando propriedade** | Falta o registro `TXT` de comprovacao | Criar o `TXT` mostrado no painel |
| **Erro de configuracao** | Propriedade comprovada, mas o DNS aponta para outro lugar | Conferir A/CNAME; a mensagem do provedor fica em `lastError` |
| **Ativo** | Propriedade comprovada **e** DNS correto | Pode ser definido como principal |
| **Desvinculado** | Removido pelo cliente ou pelo painel mestre | Pode ser cadastrado de novo |

A traducao esta em `mapProviderStatus` (`apps/api/src/routes/domains.ts`):
`active` exige `ownershipVerified && dnsConfigured`. Um dominio **nunca** fica
ativo por estar cadastrado — e por isso que, sem credenciais do provedor, o
estado maximo e "Aguardando DNS".

## 5. Dominio principal

Um dominio por empresa pode ser o principal, e so se estiver **ativo**. Ele e o
endereco que o painel apresenta como "seu site" e a origem usada ao montar URLs
absolutas fora de uma requisicao do site (previa e links do painel). Nas paginas
publicas, a URL canonica vem da origem da propria requisicao, ou do
`canonicalBaseUrl` configurado em **SEO** quando o cliente quiser fixa-la.
A exclusividade e garantida pelo indice unico parcial
`domains_primary_per_tenant_key` e pela transacao em `setPrimary`, que limpa o
anterior e marca o novo.

Desvincular remove o dominio do provedor e da tabela. Se a chamada ao provedor
falhar, o vinculo local e removido de todo modo e a falha fica no log para nova
tentativa — e melhor do que deixar o cliente preso a um dominio que ele nao usa
mais.

## 6. Como uma requisicao chega ao site certo

O dominio do cliente **nao aponta para a plataforma**. Quem responde nele e o
projeto Vercel que a CODECA IA desenvolveu para aquele cliente; a plataforma
entra depois, como origem do conteudo:

```
GET https://www.construtorahorizonte.com.br/imoveis/residencial-aurora
  |
  +-- projeto Vercel do cliente (React/Vite ou SSR, desenvolvido sob medida)
  +-- @codeca/sdk -> GET https://<plataforma>/api/v1/properties/residencial-aurora
  |     +-- chave de integracao do site (cb_pub_... ou cb_sec_...)
  |     +-- site_api_keys: chave valida, nao revogada, escopo content:read?
  |     +-- site_origins: origem autorizada para este site?
  |     +-- assinatura em dia? (senao, conforme a politica do plano)
  |     +-- conteudo publicado daquele site -- e so daquele site
  +-- o proprio projeto renderiza com o design dele
```

Quem decide o que pode ser lido e **a chave**, nunca o dominio da requisicao.
E a diferenca que importa: dominio e cabecalho, e cabecalho se falsifica. O
cadastro de dominio aqui serve para o painel exibir o endereco e montar URLs
--- nao e mecanismo de autenticacao nem de autorizacao.

Em desenvolvimento o site do cliente roda em `localhost` e basta cadastrar essa
origem para o site daquele projeto.

## 7. Painel mestre

**Dominios** no painel mestre lista todos os dominios da plataforma com empresa,
estado, ultima verificacao e ultimo erro — a visao para dar suporte sem precisar
entrar na conta do cliente. Cadastro, verificacao e remocao ficam registrados em
`audit_logs`.

## 8. Problemas comuns

| Sintoma | Causa |
| --- | --- |
| Fica em "Aguardando DNS" para sempre | Integracao nao configurada, ou registros nao criados/propagados |
| "Erro de configuracao" com DNS aparentemente certo | Registro antigo convivendo com o novo, ou proxy da Cloudflare ligado |
| "Este dominio ja esta vinculado a outra empresa" | Outro cliente cadastrou o mesmo host; resolva pelo painel mestre |
| HTTPS com aviso de certificado | DNS apontou ha poucos minutos; a emissao do certificado ainda nao concluiu |
| Dominio ativo mas o site responde 404 | Nenhuma pagina publicada ainda, ou o caminho nao existe e nao ha redirecionamento |
