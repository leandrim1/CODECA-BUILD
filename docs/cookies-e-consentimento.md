# Cookies e consentimento

Dois assuntos diferentes no mesmo documento, porque é fácil confundi-los:

1. **O painel do CODECA Build** — cinco cookies, todos necessários, nenhum
   banner. A política pública está em `/cookies`.
2. **Os sites criados pela plataforma** — banner de consentimento, bloqueio
   real de script e registro anônimo da escolha, por conta do `@codeca/sdk`.

A pergunta que separa os dois é *quem responde pelos dados*. No painel, a
CODECA IA. No site de um cliente, o cliente — e por isso nada aqui apresenta a
CODECA como controladora dos dados dos visitantes dos sites dos clientes.

---

## 1. A auditoria, antes de qualquer implementação

A primeira coisa feita foi listar o que existe de fato. O resultado foi curto e
mudou o desenho do resto: **o painel não tem um único cookie opcional e não faz
nenhuma medição no navegador.**

### Os cinco cookies do painel

Todos de primeira parte, todos estritamente necessários.

| Cookie | Onde é definido | Duração | HttpOnly |
| --- | --- | --- | --- |
| `codeca_session` | `apps/api/src/lib/cookies.ts` | 12 h, ou 30 dias com "continuar conectado" | sim |
| `codeca_csrf` | `apps/api/src/lib/cookies.ts` | a mesma da sessão | não, por necessidade (double submit) |
| `codeca_login_pending` | `apps/api/src/lib/login-code.ts` | 15 min | sim |
| `codeca_oauth_state` | `apps/api/src/lib/oauth-state.ts` | 10 min | sim |
| `codeca_ga_state` | `apps/api/src/lib/analytics/oauth-state.ts` | 10 min | sim |

Nenhum guarda senha. Nenhum guarda token de autenticação legível por script: o
`codeca_csrf` é um valor sorteado cuja única função é ser reenviado em um
cabeçalho, e vale apenas junto com a sessão `HttpOnly`.

### As quatro chaves de `localStorage`

Preferências de interface, nunca enviadas ao servidor: `codeca:tema`,
`codeca:tenant-selecionado`, `codeca:menu-grupos-fechados` e
`codeca:plataforma-menu-recolhido`.

### Terceiros

O painel não carrega script de terceiro no navegador. O Google Analytics
aparece no painel como **leitura**: a API da CODECA consulta o GA4 com a
autorização que o cliente concedeu e o painel mostra números. Não há `gtag`, não
há pixel, não há cookie de medição no painel.

### A conclusão que decidiu o resto

Um banner no painel seria teatro: não há nada a recusar. Pedir consentimento
para o indispensável é tratado pela ANPD como padrão enganoso, e a LGPD dispensa
consentimento prévio justamente nesse caso. Então o trabalho todo foi para onde
existe escolha de verdade — **o site do cliente**, via SDK.

---

## 2. O mecanismo, no `@codeca/sdk`

Entrada separada (`@codeca/sdk/consent`): um site que só lê conteúdo não carrega
o gerenciador, e um site que só precisa do banner não carrega o cliente da API.
A primeira visita, que é onde o banner aparece, é a que menos pode pesar.

Sem nenhuma dependência. Um gerenciador de consentimento que arrasta um
framework passa a ser a maior coisa baixada antes do consentimento.

| Arquivo | O que faz |
| --- | --- |
| `consent.ts` | guarda a escolha, avisa quem precisa saber |
| `consent-gate.ts` | segura o que não foi autorizado; ponte com o Consent Mode |
| `consent-ui.ts` | banner e painel de preferências em JS puro |
| `consent-settings.ts` | lê a configuração do painel e liga tudo numa chamada |

### As quatro categorias

`necessarios` (sempre ativa, não é escolha), `preferencias`, `estatisticas`,
`marketing`. As três últimas nascem **desligadas**: caixa pré-marcada não é
consentimento.

### Bloquear é não carregar

```html
<script type="text/plain" data-codeca-consent="estatisticas"
        data-codeca-src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
```

Um `<script type="text/plain">` não executa — e **não passa a executar se o
`type` mudar**: o navegador só avalia um script ao inseri-lo. Por isso
`liberarMarcados()` cria outro elemento com o mesmo conteúdo e o insere no
lugar, depois do "sim".

O caminho fraco é o Consent Mode do Google (`pontearConsentModeDoGoogle`): o
gtag entra com tudo negado e passa a coletar na atualização. Serve a quem precisa
da ferramenta presente antes da escolha. O que não está na página não tem como
coletar; o que está, depende da boa-fé do fornecedor.

### A escolha não sai do domínio

Fica no `localStorage` do site, que o navegador já isola por origem. Não há
cookie de terceiro, não há identificador de visitante e o site de um cliente não
enxerga a escolha feita noutro — sem precisar de código para isso.

Política nova invalida a escolha antiga: `policyVersion` diferente faz o banner
voltar. Tratar um "sim" dado a outro texto como "sim" a este é exatamente o que
a lei não aceita.

---

## 3. A configuração por site, no painel mestre

`/plataforma/sites` → aba **Cookies**. Grava em `site_cookie_settings`, uma
linha por site.

| Campo | Para que serve |
| --- | --- |
| `controllerName`, `controllerDocument`, `controllerContact` | quem responde pelos dados daquele site |
| `privacyPolicyUrl`, `cookiePolicyUrl` | links que o banner mostra |
| `policyVersion` | mudou o texto, mude aqui: o banner volta a perguntar |
| `bannerEnabled` | site que só usa o necessário não precisa de banner |
| `recordConsent` | o cliente pode recusar que a CODECA guarde o registro |
| `tools[]` | o que o site carrega, uma a uma, com a categoria de quem instalou |

**O controlador não tem valor padrão nosso.** Campo vazio significa banner sem
afirmação de controlador — e não banner com o nome da plataforma. A tela avisa
em vez de preencher.

**A lista de ferramentas nasce vazia.** A plataforma não sabe o que o site de
cada cliente carrega, e adivinhar aqui viraria uma política de cookies fictícia.

---

## 4. As duas rotas da API

### `GET /api/v1/consent/settings`

Chave publicável, escopo `content:read`. Devolve o que o visitante pode ver —
`recordConsent` fica de fora, porque é decisão entre o cliente e a CODECA.

Fecha o laço entre painel e site: sem isso, corrigir o CNPJ de um cliente
exigiria uma nova publicação do site.

### `POST /api/v1/consent`

**Sem credencial, de propósito.** O registro sai do navegador do visitante, e a
chave publicável estaria ali para ser lida por qualquer um no código-fonte da
página: exigi-la não impediria ninguém de forjar um registro, só acrescentaria
um passo. E prenderia o registro ao estado da assinatura — um site com cobrança
pendente pararia de registrar consentimento, o oposto do que a conformidade do
cliente precisa.

O envio é por `fetch` com `keepalive` e `credentials: 'omit'`. **Não** por
`navigator.sendBeacon`, que parecia a escolha óbvia: ele força o modo de
credenciais em `include`, por especificação e sem como desligar. Isso anexaria
os cookies que o visitante tenha do domínio da plataforma a um registro que
existe justamente para ser anônimo, e faria o preflight exigir
`Access-Control-Allow-Credentials: true` — sem o qual o navegador descarta a
requisição em silêncio. Foi assim que apareceu: no Chromium o banner
funcionava, a escolha era guardada, e o registro nunca chegava ao banco.

O que identifica o site é o `Origin`: o navegador o envia e não deixa a página
mentir sobre ele. A rota o confere contra `site_origins` (índice novo em
`origin`). Proteções:

- Limite de 20 por hora por IP, com o IP cifrado pelo mesmo caminho do resto da
  plataforma — e o contador vence junto com a janela.
- Teto de 4 KB no corpo, antes de ler: o registro inteiro cabe em algumas
  centenas de bytes.
- Origem desconhecida responde **204** e grava nada. Dizer "não conheço este
  endereço" revelaria quais endereços existem.
- Origem cadastrada por mais de um site também não grava: escolher um deles
  atribuiria a escolha ao cliente errado.
- `domain` vem da origem conferida no servidor, **não** do corpo: um visitante
  não pode atribuir a própria escolha ao site de outra empresa.
- `decidedAt` vem do relógio do navegador, limitado ao instante da chegada.
- Reenvio da mesma decisão não vira segunda linha (`siteId` + `consentId`).

### O que a tabela não tem

`site_consent_records` guarda `consentId`, `decidedAt`, `domain`, `granted`,
`denied`, `policyVersion`, `engineVersion` e a hora de chegada. **Não há IP, não
há agente de navegador, não há identificador de visitante e não há nada que
ligue duas linhas à mesma pessoa.** Um teste verifica a lista de colunas
exatamente por isso.

`consentId` é sorteado no navegador e existe só para o reenvio não duplicar.

**O que o registro não prova.** Que um navegador de verdade o enviou. Quem lê o
código-fonte do site pode forjar um, com chave ou sem — a chave publicável está
na página. Ele é prova do que foi reportado, com data e versão da política,
dentro do limite por IP. Não é prova criptográfica, e a documentação não deve
sugerir que seja.

### Prazo de guarda

Três anos (`CONSENT_RECORD_RETENTION_DAYS`), apagados pela limpeza diária
(`pruneExpiredRecords`). A lei não fixa um número: guardar para sempre contraria
o artigo 15 da LGPD, e guardar de menos deixa a empresa sem como provar o
consentimento que praticou.

---

## 5. Papéis, e o que ainda depende de decisão jurídica

| Tratamento | Controlador | Operador |
| --- | --- | --- |
| Conta, sessão, cobrança, suporte | CODECA IA | — |
| Conteúdo do site do cliente | empresa cliente | CODECA IA |
| Escolha de cookies do visitante do site | empresa cliente | CODECA IA |

A implementação técnica está pronta e verificada. **A definição das
responsabilidades de tratamento continua precisando de revisão conforme os
serviços realmente usados pela CODECA e por cada cliente** — e os textos em
`apps/web/src/legal/` são rascunho técnico, a ser revisado por assessoria
jurídica. Nada aqui substitui essa revisão.

---

## 6. Os cenários verificados

| # | Cenário | Onde |
| --- | --- | --- |
| 1 | Nada opcional começa ligado | `tests/unit/consentimento.test.ts` |
| 2 | Recusar é tão fácil quanto aceitar (três botões de igual peso) | unidade + navegador |
| 3 | Script marcado não entra na página sem o "sim" | unidade + navegador |
| 4 | Script liberado entra depois do "sim", uma vez só | unidade |
| 5 | Revogar apaga a escolha e limpa os cookies da ferramenta | unidade + navegador real |
| 6 | Política nova derruba a escolha antiga | unidade |
| 7 | Escolha de um site não vaza para o site de outro | unidade + dois servidores locais |
| 8 | Consent Mode entra negado e atualiza no "sim" | unidade |
| 9 | Armazenamento bloqueado não trava o banner | unidade |
| 10 | Registro chega anônimo, sem IP nem identificador | `tests/integration/cookies-consentimento.test.ts` |
| 11 | Corpo não decide de que site a escolha é | integração |
| 12 | Configuração de um site não vaza para outro | integração |

E a ligação entre as duas pontas, que só o navegador mostra:

| Cenário | Onde |
| --- | --- |
| A configuração do painel chega ao banner do site, em outra origem | `fim-a-fim.mjs` |
| A versão de política do painel vence a do código do site | `fim-a-fim.mjs` |
| A escolha volta para a plataforma e é gravada | `fim-a-fim.mjs` |
| O que é gravado traz só o reportado, com o domínio conferido no servidor | `fim-a-fim.mjs` |

O percurso de navegador roda em Chromium de verdade, com dois domínios locais:

```bash
pnpm --filter @codeca/sdk build
node scripts/consentimento/provar.mjs
```

38 conferências, entre elas a que nenhum teste de unidade alcança: **a lista de
requisições externas da página, que tem de estar vazia antes do "sim"**. A
página importa `packages/sdk/dist` direto — um harness que testa uma cópia
envelhece sem avisar.

Foi ele que encontrou o defeito do `[hidden]`: o banner continuava interceptando
cliques porque o `display: flex` da própria regra vencia a regra do navegador.

O segundo percurso prova a ligação inteira — painel, API, navegador, banco:

```bash
node scripts/consentimento/fim-a-fim.mjs   # com o painel local no ar
```

Configura os cookies de um site pelo painel mestre, abre o site do cliente em
outra origem e confere que a configuração chega ao banner e que a escolha volta
para a plataforma. Foi ele que encontrou o defeito do `sendBeacon`.

---

## 7. O que falta, declarado

- **Política de cookies gerada por site.** Hoje o cliente informa a URL da
  política dele; a plataforma não gera a página a partir de `tools[]`. Os dados
  para gerá-la já estão guardados.
- **Verificação em um site publicado.** O caminho inteiro foi provado em
  Chromium real contra a API real, com o site do cliente numa origem separada
  (`scripts/consentimento/fim-a-fim.mjs`) — mas com o painel local, não com um
  site publicado na Vercel contra `codecabuild.vercel.app`. O que muda lá é o
  HTTPS e o domínio próprio; o resto do caminho é o mesmo exercitado aqui.
- **Nenhuma integração contorna o consentimento.** Verificado no que existe: as
  requisições externas da página são registradas e a lista está vazia antes do
  "sim". A afirmação vale para o template e para o que o SDK controla; um
  script que alguém acrescente ao site sem os atributos de bloqueio continua
  carregando, e isso é responsabilidade de quem monta o site.
