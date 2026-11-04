# Dominios proprios e DNS

Cada empresa pode vincular ao site um dominio seu
(`www.empresahorizonte.com.br`). Toda a integracao com a Vercel acontece no
backend; o navegador apenas mostra o estado e as instrucoes.

## 1. Quem hospeda o site decide o que a plataforma pode afirmar

A especificacao comercial separa duas coisas:

| Plano | Dominio | Hospedagem |
| --- | --- | --- |
| Essencial | incluido | **nao** incluida |
| Profissional | incluido | **nao** incluida |
| Empresas | incluido | incluida |

Entao a plataforma **nao pode assumir que hospeda**. E quando nao hospeda, nao
tem como verificar nem configurar o DNS de um site que esta em outro lugar --
prometer isso seria afirmar o que ela nao sabe.

A regra, em um lugar so (`apps/api/src/lib/hosting.ts`, funcao `decideHosting`):

> O dominio e **gerenciado pela plataforma** se, e somente se, o plano da
> empresa inclui `included_hosting` **e** o site tem um projeto de hospedagem
> configurado pela CODECA IA.

As duas condicoes, e nao uma. O recurso do plano diz que a hospedagem foi
vendida; o projeto diz **onde** ela esta. Com so o primeiro, a plataforma nao
saberia em qual projeto anexar o dominio. Com so o segundo, configurar um
projeto num plano que nao o inclui entregaria hospedagem sem ter sido vendida.

| | **Gerenciado** | **Registro** |
| --- | --- | --- |
| Quando | plano com hospedagem **e** projeto configurado | qualquer outro caso |
| Vercel | chamada, contra o projeto **do site** | **nunca** chamada |
| Estado | vem da Vercel (propriedade + DNS) | `Registrado`, fixo |
| Instrucao de DNS | sim | **nao** -- a plataforma nao sabe o alvo |
| "Verificar novamente" | sim | recusado (400), com a explicacao |
| HTTPS | emitido pela Vercel | a plataforma nao afirma nada |

No modo registro o dominio e guardado -- o endereco pertence a este site e a
mais nenhum --, e o limite do plano e a unicidade global continuam valendo. So
some o que dependia de a plataforma hospedar. A mensagem diz isso com todas as
letras, em vez de deixar um estado "pendente" sugerir que algo vai acontecer:
nada vai.

### O erro que esta regra corrige

Ate 11/2026 o provedor usava um `VERCEL_PROJECT_ID` unico do ambiente -- o
projeto **da propria plataforma**, que serve o painel e a API. Anexar a ele o
dominio de um cliente faria o endereco abrir o login do painel. Quem de fato
respondia por aqueles dominios era o renderizador removido na etapa 0; sem ele,
o codigo seguiu apontando para um destino que nao servia mais site nenhum de
cliente. A secao 7 deste documento ja dizia que "o dominio do cliente **nao
aponta para a plataforma**" -- o codigo e que contradizia.

## 2. Preparar a plataforma (uma vez)

1. Na Vercel, gere um token em **Account Settings > Tokens** com acesso aos
   projetos dos sites. Se eles pertencem a um time, copie tambem o **Team ID**.
2. Defina no ambiente:

```
VERCEL_API_TOKEN="..."
VERCEL_TEAM_ID="team_..."        # apenas se houver time
DOMAIN_A_RECORD_IP="76.76.21.21"
DOMAIN_CNAME_TARGET="cname.vercel-dns.com"
```

**`VERCEL_PROJECT_ID` deixou de existir.** O projeto e de cada site (secao 3).
Pode remove-lo do ambiente; o valor e ignorado.

`DOMAIN_A_RECORD_IP` e `DOMAIN_CNAME_TARGET` sao os valores que o cliente vera
nas instrucoes dos dominios **gerenciados**. Confirme os atuais em **Project
Settings > Domains** na Vercel -- ela ja mudou esses alvos no passado.

Sem `VERCEL_API_TOKEN`, os dominios gerenciados ficam em **Aguardando DNS** e
nunca sao marcados como ativos: a plataforma diz isso com todas as letras em
vez de simular sucesso. Os dominios em modo registro nao dependem dele.
`GET /api/health` expoe `features.vercelDomains`.

## 3. Configurar o projeto de um site (CODECA IA)

No painel mestre: **Sites > (o site) > Identidade > Projeto de hospedagem
(Vercel)**. Aceita o id (`prj_...`) ou o nome do projeto na Vercel. O valor
entra numa URL da API, entao so se aceita o que nao altera o caminho da chamada
(letras, numeros, `_`, `.` e `-`).

Quatro regras, todas no servidor:

1. **So num plano que inclui hospedagem.** Em outro, a rota recusa (409) dizendo
   qual plano. Sem isso a CODECA IA poderia ligar uma hospedagem que nao foi
   vendida. A tela mostra o motivo no lugar de so desabilitar o campo.
2. **Um projeto pertence a um unico site.** A rota recusa dizendo **qual** site
   ja o usa, e o indice unico `sites_hosting_project_key` e a garantia no banco.
   Dois sites no mesmo projeto anexariam o dominio de uma empresa ao site de
   outra: o endereco do cliente B serviria o conteudo do cliente A.
3. **Ausente nao mexe; `null` desvincula.** Ao contrario dos campos vizinhos,
   que sao reescritos a cada salvamento, este nao pode ser: uma tela que nao o
   envie desvincularia a hospedagem em silencio. A tela so manda o campo quando
   ele mudou.
4. **Desvincular nunca e recusado**, nem depois de um downgrade: tirar o projeto
   nunca da algo a mais.

A auditoria (`site.updated`) registra `hosting: linked | unlinked | unchanged`.

## 4. O que o cliente faz no painel

Em **Dominio proprio**:

1. Digita o dominio. O valor e normalizado no servidor (protocolo, porta,
   caminho, ponto final e caixa alta sao descartados) e validado rotulo por
   rotulo.
2. A plataforma recusa, com mensagem propria:
   - hosts da propria plataforma (`PLATFORM_HOSTS`, `APP_URL`, `*.vercel.app`);
   - subdominios reservados -- `app`, `painel`, `admin`, `api`, `blob`, `mail`,
     `smtp`;
   - dominio ja cadastrado nesta empresa;
   - dominio ja vinculado a **outra** empresa -- garantido tambem pelo indice
     unico global `domains_hostname_key`, nao so pela checagem da aplicacao.
3. **Gerenciado:** o dominio e anexado ao projeto do site **antes** de ser
   gravado, para nascer com o estado real; o painel mostra os registros de DNS e
   o cliente volta para **Verificar novamente**.
   **Registro:** o dominio e gravado como `Registrado` e o painel explica que o
   apontamento e feito no provedor onde o site esta hospedado.

O recurso depende do plano (`custom_domain`) e do limite `maxDomains` -- 0 na
Avaliacao, 1 no Essencial, 1 no Profissional, 3 no Empresas. Ambos sao
verificados no servidor, nos dois modos.

No Essencial o cliente nao tem painel, entao ele nem alcanca esta tela; o
dominio incluido no plano e tratado pela CODECA IA fora da plataforma.

### Registrado antes de a hospedagem existir

Um dominio registrado e depois colocado num site com hospedagem **nao precisa
ser recadastrado**. O proximo "Verificar novamente" o **anexa** ao projeto
(`add`, que e idempotente) em vez de verifica-lo: a Vercel responde 404 a um
`verify` de dominio que o projeto nao conhece. Dali em diante as verificacoes
sao normais.

### Downgrade depois de gerenciado

Se o plano deixa de incluir hospedagem, o dominio ja anexado **nao e removido da
Vercel** (nenhum caminho desta plataforma apaga o que o cliente tem). Ele passa
a se comportar como registro: "Verificar" e recusado. **Desvincular continua
funcionando** e usa o projeto **do site**, e nao o plano atual -- senao o
dominio ficaria preso a um projeto que a plataforma deixou de enxergar.

## 5. Registros de DNS (dominios gerenciados)

O que mostrar depende de o dominio ser apex ou subdominio; a logica trata
sufixos de dois niveis comuns no Brasil (`com.br`, `net.br`, ...).

**Apex** (`empresahorizonte.com.br`):

| Tipo | Nome | Valor |
| --- | --- | --- |
| A | `@` | `76.76.21.21` |

**Subdominio** (`www.empresahorizonte.com.br`):

| Tipo | Nome | Valor |
| --- | --- | --- |
| CNAME | `www` | `cname.vercel-dns.com` |

Quando a Vercel exige comprovacao de propriedade, entra tambem um `TXT`
temporario, com nome e valor vindos do desafio que ela devolve.

Orientacoes para o cliente:

- Propagacao leva de minutos a algumas horas, conforme o TTL anterior. Baixar o
  TTL para 300 segundos antes da mudanca encurta a espera.
- Nao criar um CNAME na raiz do dominio: o DNS nao permite conviver com os
  registros `NS`/`SOA`. Para apex, use o registro `A`.
- Se houver Cloudflare, deixe o registro **DNS only** (nuvem cinza) durante a
  verificacao; o proxy esconde o DNS real e a verificacao falha.
- O certificado TLS e emitido pela Vercel automaticamente depois que o DNS
  aponta. Nao ha nada a configurar, apenas aguardar.

## 6. Estados

| Estado | Significado | O que fazer |
| --- | --- | --- |
| **Registrado** | Guardado nesta conta; a hospedagem e externa e a plataforma **nao verifica DNS** | Apontar o DNS no provedor onde o site esta hospedado |
| **Pendente** | Cadastrado, ainda sem resposta da Vercel | Aguardar a primeira verificacao |
| **Aguardando DNS** | Registros ainda nao encontrados (ou integracao nao configurada) | Criar/corrigir os registros e verificar novamente |
| **Verificando propriedade** | Falta o registro `TXT` de comprovacao | Criar o `TXT` mostrado no painel |
| **Erro de configuracao** | Propriedade comprovada, mas o DNS aponta para outro lugar | Conferir A/CNAME; a mensagem da Vercel fica em `lastError` |
| **Ativo** | Propriedade comprovada **e** DNS correto | Pode ser definido como principal |
| **Desvinculado** | Reservado; nenhum caminho o usa hoje | -- |

`Registrado` nao e `Pendente`: nao ha nada aguardando, a plataforma so guarda o
endereco. Por isso a visao geral do painel mestre conta os dois separadamente --
somar os registrados a fila de pendentes inflaria o trabalho de quem opera com
dominios que nunca vao mudar de estado.

A traducao dos estados da Vercel esta em `mapProviderStatus`
(`apps/api/src/routes/domains.ts`): `active` exige
`ownershipVerified && dnsConfigured`. Um dominio **nunca** fica ativo por estar
cadastrado, e no modo registro nunca fica ativo, porque a plataforma nao tem
como saber.

## 6.1 Reverificacao automatica

O estado "Ativo" so diz que o dominio estava certo **quando foi verificado**.
Por isso o job diario (`/api/billing/reconcile`, o mesmo cron da cobranca e dos
avisos de publicacao -- o plano Hobby da Vercel permite um so) reconsulta a
Vercel dos dominios e grava o estado novo pelas mesmas regras do botao "Verificar
novamente" (`apps/api/src/lib/domain-status.ts`).

| Situacao | O que acontece |
| --- | --- |
| Dominio aguardando DNS ou propriedade, e o cliente ja ajustou | vira **Ativo** sem ninguem voltar ao painel; auditoria `domain.verified` com `source: recheck` |
| Dominio ativo cujo DNS deixou de apontar | vira **Configuracao incorreta**, com o motivo em "ultimo erro"; auditoria `domain.verification_lost` e aviso no log (`[domains] ... deixaram de funcionar`) |
| Dominio que continua como estava | so `lastCheckedAt` anda; nada na auditoria |
| A Vercel falha (rede, 5xx, limite) | **o estado nao muda**; so `lastCheckedAt` anda, para o dominio que falha sempre nao ficar na frente da fila |
| Dominio em modo registro (hospedagem fora) ou desvinculado | nunca consultado |
| Sem `VERCEL_API_TOKEN` | nada consultado: sem provedor tudo viraria "aguardando DNS" e rebaixaria dominio ativo por falta de configuracao **nossa** |

Cada execucao verifica no maximo `limit` dominios (padrao 50, maximo 200), do
verificado ha mais tempo para o mais recente; o que sobra fica para a proxima
passagem. O resultado vem no campo `domains` da resposta do job. A frequencia
e a do cron em `vercel.json` (diaria no Hobby); num plano pago basta aumentar,
sem mudar codigo.

## 7. Dominio principal

Um dominio por empresa pode ser o principal, e so se estiver **ativo** -- o que,
na pratica, so acontece em dominios gerenciados. Ele e o endereco que o painel
apresenta como "seu site". A exclusividade e garantida pelo indice unico parcial
`domains_primary_per_tenant_key` e pela transacao em `setPrimary`, que limpa o
anterior e marca o novo.

Desvincular remove o dominio da Vercel (quando ele foi la colocado, o que o
`vercel_domain_id` indica) e da tabela. Se a chamada a Vercel falhar, o vinculo
local e removido de todo modo e a falha fica no log para nova tentativa -- e
melhor do que deixar o cliente preso a um dominio que ele nao usa mais.

## 8. Como uma requisicao chega ao site certo

O dominio do cliente **nao aponta para a plataforma**. Quem responde nele e o
projeto Vercel que a CODECA IA desenvolveu para aquele cliente; a plataforma
entra depois, como origem do conteudo:

```
GET https://www.empresahorizonte.com.br/imoveis/residencial-aurora
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
cadastro de dominio aqui serve para o painel exibir o endereco -- nao e
mecanismo de autenticacao nem de autorizacao. Cadastrar um dominio **nao**
autoriza a origem dele na API publica; isso e `site_origins`, configurado no
painel mestre.

Em desenvolvimento o site do cliente roda em `localhost` e basta cadastrar essa
origem para o site daquele projeto.

## 9. Painel mestre

**Dominios** lista todos os dominios da plataforma com empresa, estado, ultima
verificacao e ultimo erro -- a visao para dar suporte sem precisar entrar na
conta do cliente. Cadastro, verificacao e remocao ficam registrados em
`audit_logs`; o cadastro grava tambem se o dominio nasceu **gerenciado**.

## 10. Migrando uma instalacao que ja existia

A migracao `0016` acrescenta a coluna e o estado; a `0017` converte para
`Registrado` os dominios que **nunca chegaram a Vercel** -- os que esperavam
"Aguardando DNS" para sempre por falta de credenciais. Nao toca em dominio que a
Vercel conhece (`vercel_domain_id` preenchido) nem em site que ja tenha projeto.

Um passo manual, **antes ou logo depois** do deploy: abra o projeto Vercel **da
plataforma** (o que serve o painel) em **Settings > Domains** e confira se ha
dominio de **cliente** anexado ali. Se houver, o endereco dele esta abrindo o
login do painel. Remova-o de la; se o site do cliente tem projeto proprio, anexe
ao projeto dele (pelo painel mestre, configurando o projeto do site e pedindo
"Verificar novamente").

## 11. Problemas comuns

| Sintoma | Causa |
| --- | --- |
| Dominio fica em "Registrado" e nao muda | E o esperado: o site e hospedado fora da plataforma ou falta o projeto de hospedagem. Veja o motivo na aba Identidade do site |
| Campo "Projeto de hospedagem" desabilitado | O plano da empresa nao inclui hospedagem; troque o plano antes |
| "Este projeto de hospedagem ja esta vinculado ao site ..." | Dois sites nao dividem projeto: o dominio de um abriria o site do outro |
| Fica em "Aguardando DNS" para sempre (gerenciado) | `VERCEL_API_TOKEN` ausente, ou registros nao criados/propagados |
| "Erro de configuracao" com DNS aparentemente certo | Registro antigo convivendo com o novo, ou proxy da Cloudflare ligado |
| "Este dominio ja esta vinculado a outra empresa" | Outro cliente cadastrou o mesmo host; resolva pelo painel mestre |
| "Verificar novamente" responde 400 | O site nao e gerenciado pela plataforma (plano sem hospedagem, sem projeto, ou downgrade) |
| HTTPS com aviso de certificado | DNS apontou ha poucos minutos; a emissao do certificado ainda nao concluiu |
| Dominio ativo mas o site mostra o login do painel | O dominio esta anexado ao projeto **da plataforma** -- veja a secao 10 |
