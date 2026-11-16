# Desempenho, escalabilidade e disponibilidade

Este documento registra o que foi medido, o que foi mudado, o que os números
provam e o que eles **não** provam. Os números brutos de cada execução estão em
[`performance-results/`](performance-results/) (um JSON por nível de carga).

> **Regra deste documento:** nenhuma capacidade é afirmada sem teste que a
> comprove. Onde só há extrapolação, está escrito "não provado".

## 1. Resumo

| | Antes | Depois |
| --- | --- | --- |
| Consultas ao banco por requisição (painel e API pública) | **14,0** | **5,0** a 5,6 até 200 usuários |
| p95 com 100 usuários simultâneos | 201 ms | **27 ms** |
| Maior carga com p95 < 500 ms **em uma instância** | 150 usuários (p95 438 ms) | **200 usuários (p95 145 ms)** |
| Vazão máxima de uma instância | ~226 req/s | ~399 req/s |
| Erros 5xx / de rede em todos os níveis | 0 | 0 |
| Acesso cruzado entre empresas / perda / duplicação | 0 | 0 |

E um defeito de integridade encontrado pelo próprio teste de carga e
corrigido (seção 4.9): um `PATCH` com um campo só **despublicava** o conteúdo.

**O que não foi atingido:** com 300, 500 e 1.000 usuários simultâneos, uma
instância não cumpre p95 < 500 ms (seção 6). Escalar além disso depende de
várias instâncias (a Vercel faz isso), o que **não foi exercitado** aqui.

## 2. Como foi medido (e o que isso não é)

- **Alvo:** a API real (`createApp`) sobre PostgreSQL 16 real, com o pool de
  conexões e o mesmo código de produção. Banco local, não o Neon.
- **Máquina:** 4 núcleos, compartilhados entre o servidor, o Postgres e o gerador
  de carga.
- **Usuários virtuais (VUs):** 70% painel (login com scrypt, sessão, visão geral,
  lista, detalhe, módulos, interessados, **edição**, **criação**, **upload**) e
  30% visitantes do site de um cliente (API pública), com pausa de 0,3–0,9 s
  (painel) e 0,7–1,8 s (visitante) entre passos. Cada nível: 30 s de carga
  contínua + rampa de entrada, banco recriado e semeado do zero (60 empresas × 30
  imóveis; 120 empresas no nível de 1.000).
- **Integridade, conferida ao final de cada execução** (não basta "ficou no ar"):
  1. nenhuma linha de outra empresa foi devolvida (cada título carrega a marca
     `T<empresa>`);
  2. tudo que o servidor confirmou com 201 está no banco, sem `slug` repetido;
  3. nenhuma empresa passou do limite do plano com criações concorrentes;
  4. o último título confirmado de cada imóvel editado é o gravado.
- O leitor deve tratar os números como **comparação antes × depois e prova de
  integridade**, não como previsão de capacidade em produção. Não entram: latência
  de rede até o Neon, driver HTTP/WebSocket do Neon, PgBouncer, partida a frio,
  escalonamento horizontal da Vercel.

Repetir: `scripts/loadtest/setup.sh` (uma vez) e
`scripts/loadtest/suite.sh <rotulo> <diretorio-do-codigo> [pool]`.
`LEVELS="150 200"` escolhe os níveis; `LT_ENV_JSON='{"MAX_CONCURRENT_REQUESTS":"120"}'`
liga recursos.

## 3. Diagnóstico: o que estava errado

| # | Achado | Evidência | Gravidade |
| --- | --- | --- | --- |
| 1 | Cada requisição do painel gastava **14 idas ao banco** antes/dentro da rota (sessão, usuário, vínculos, empresa, site, plano, assinatura, google, chave…). Em serverless cada consulta é uma viagem de rede. | contador por rota: `overview` 26, `POST imóvel` 21, `PATCH imóvel` 18 | alta |
| 2 | Nada era guardado entre requisições: as mesmas 8 perguntas ("esta sessão vale? este usuário pertence a esta empresa? o plano inclui o painel?") eram refeitas a cada clique de cada usuário. | idem | alta |
| 3 | `last_used_at` da sessão e da chave gravados a cada requisição: uma **escrita** por clique. | leitura do código | média |
| 4 | Limite de taxa da API pública no banco: 1 leitura + 1 escrita por visita ao site de um cliente. | leitura do código | média |
| 5 | A tela inicial fazia 12 consultas **em sequência**. | `tenants.ts` | média |
| 6 | `rate_limits`, `sessions`, `login_codes`, `user_tokens` nunca eram limpas (`pruneRateLimits` existia e **ninguém a chamava**). | busca no código | média (cresce sem parar) |
| 7 | Cadastro de empresa lia **todos os slugs** da tabela de empresas. | `company.ts` | média (O(N)) |
| 8 | Sem medição: nenhuma contagem de consultas, nenhum log de consulta/requisição lenta, nenhuma métrica. | — | alta (não se otimiza o que não se mede) |
| 9 | Banco indisponível virava **500** ("erro inesperado"), sem `Retry-After`; o painel não repetia leituras. | leitura do código | média |
| 10 | Sem proteção contra sobrecarga: com 500 usuários, **todos** esperavam (p95 3 s). | teste de carga | alta |
| 11 | Pool do Neon sem limite explícito; `Pool` do driver com padrão de 10 por instância. | leitura do código | média |
| 12 | Duplo clique em "salvar"/"criar" enviava a operação duas vezes; envio de várias imagens disparava todas de uma vez; foto de celular (5–12 MB) era recusada pelo limite de 4 MB. | leitura do código | média |
| 13 | **`PATCH` parcial despublicava o conteúdo** (zod `.partial()` mantém os `.default()`). | teste de carga (404 na API pública) e teste de regressão | **alta (integridade)** |
| 14 | Provedor de e-mail fora do ar fazia cada cadastro/login esperar 8 s. | leitura do código | baixa |

O que **já estava bom** e foi mantido: ~130 índices cobrindo as consultas quentes
(sessão, vínculo, chave, listas por empresa/data); paginação nas listas; consultas
sempre filtradas por `tenant_id`; transações onde há mais de uma escrita;
consulta simples por HTTP e transação por WebSocket (driver do Neon); prazos nas
chamadas à ValidaPay e ao Resend; webhook de cobrança gravado de forma durável e
deduplicado.

## 4. O que foi feito

### 4.1 Medição (base de tudo)

- `packages/database/src/instrument.ts`: conta consultas e tempo por requisição e
  no processo; consulta acima de `SLOW_QUERY_MS` vai para o log como JSON
  (`slow_query`) com o **início do SQL, nunca os parâmetros**.
- `middleware/request-log.ts`: uma linha JSON por requisição **lenta ou com erro**
  (rota, status, ms, nº de consultas, consulta mais lenta, requisições em
  andamento). Nunca registra corpo, cabeçalho, cookie ou query string. Todas as
  requisições ganham `X-Request-Id` e `Server-Timing` (tempo no app e no banco).
- `lib/runtime-metrics.ts` + `GET /api/metrics` (protegido por `METRICS_SECRET`;
  sem o segredo a rota responde 404): requisições, p50/p95/p99 recentes,
  em andamento, pico, recusadas, memória e acertos/erros de cada cache.

### 4.2 Banco (Neon)

- Pool de transações com `max` configurável (`DB_POOL_MAX`, padrão 5),
  `idleTimeoutMillis` 10 s e `maxUses` 5.000; erro em conexão ociosa não derruba
  o processo. Consultas simples não usam o pool (HTTP).
- `fetch` do driver com **prazo** (15 s) e **repetição segura**: só repete quando
  a consulta comprovadamente **não foi executada** (conexão recusada, DNS,
  429/503 do gateway), com espera exponencial **com jitter**. Uma escrita nunca é
  duplicada (`resilience.ts`; testado).
- Erros transitórios do banco viram **503 + `Retry-After`** (`service_unavailable`),
  sem vazar a causa; o detalhe vai para o log.
- `visão geral`: 12 consultas independentes passaram a rodar em paralelo.
- Sessão: o vínculo Google entrou na mesma consulta (−1 ida); `last_used_at`
  gravado no máximo a cada 5 min; `touchApiKey` idem.
- `nextTenantSlug` lê só `slug = base OR slug LIKE 'base-%'`, não a tabela inteira.
- **Limpeza** (`lib/housekeeping.ts`, no job diário): sessões vencidas/revogadas há
  30 dias, contadores de limite de taxa, códigos de login, tokens e estados OAuth.
- Índices: revisados; os existentes cobrem os caminhos quentes. Não foi adicionado
  nenhum. `pg_trgm` para busca por texto **não** entrou (os testes rodam em PGlite,
  sem a extensão); ver limitações.

### 4.3 Cache — estratégia e por que não Redis

| Cache (em memória, por instância) | Chave | Pode estar velho por | Invalidação |
| --- | --- | --- | --- |
| sessão | hash do token | `AUTH_CACHE_TTL_SECONDS` (10 s) em **outra** instância; **zero** na mesma | logout, troca/redefinição de senha, verificação de e-mail, convite aceito, código de login |
| empresa + vínculo | `empresa:usuário` | idem | qualquer escrita bem-sucedida (ou 5xx) no painel da empresa |
| plano, assinatura | empresa / site | idem | idem; webhook e job de cobrança limpam tudo |
| chave de integração | hash da chave | idem | qualquer escrita da plataforma |
| resposta da API pública | chave + origem + rota + query | `PUBLIC_CACHE_TTL_SECONDS` (5 s) em outra instância | escrita no painel da empresa |

Garantias, com teste (`tests/integration/performance.test.ts`): empresa nunca vê
dado de outra (a chave de cache inclui empresa/usuário/chave e origem); logout,
revogação de chave e edição no painel valem **na hora** na instância que recebeu a
escrita; `Cache-Control: no-cache` e `preview=true` vão direto ao banco; erro de
carga e respostas não-200 nunca ficam guardados; carga em andamento durante uma
invalidação não "ressuscita" dado velho; cem pedidos simultâneos pela mesma chave
fazem **uma** consulta.

**Por que não CDN para a API pública:** ela autentica por `Authorization`. Um cache
compartilhado indexado pela URL serviria a resposta da empresa A à empresa B. As
respostas continuam `cache-control: no-store`.

**Por que não Redis:** o objetivo era tirar a pergunta repetida do banco, e uma
memória de segundos por instância já tira a maior parte, sem serviço novo, sem
custo e sem outro ponto de falha. Redis só compensaria se a invalidação precisasse
ser instantânea **entre** instâncias, e a janela de 10 s/5 s é aceita (seção 4.3,
tabela). Reavaliar se: a janela deixar de ser aceitável, ou o painel passar a
exigir estado compartilhado (por exemplo, limite de taxa global exato).

Já eram cacheáveis na borda e continuam: `/assets/*` (imutável, 1 ano) e
`/api/public/plans` (dados públicos, sem empresa).

### 4.4 API e abuso

- **Limite de taxa da API pública** em memória por chave (600/min), sem ida ao
  banco; com cache desligado (testes) e nas rotas de autenticação continua o
  limitador persistido no banco (exato entre instâncias).
- **Proteção contra sobrecarga** (`middleware/load-shedding.ts`,
  `MAX_CONCURRENT_REQUESTS`, padrão **0 = desligada**): acima do limite responde
  503 + `Retry-After` sorteado (1–3 s), poupando `/health` e o webhook de
  pagamento. Ver 6.3 sobre quando ligar.
- Erros centralizados (`middleware/error.ts`), corpo validado por Zod, paginação,
  idempotência de webhook (`X-Webhook-Id`), `Retry-After` em 429/503.
- Atualização parcial só toca nos campos enviados (4.9).

### 4.5 Front-end

- `useMutation`: trava síncrona contra duplo clique (a segunda chamada devolve
  `null` sem tocar a API) — `loading` do React só muda no render seguinte.
- Cliente de API: **leituras** (nunca escritas) repetidas até 2 vezes em
  rede/502/503/504, respeitando `Retry-After` (teto 5 s) + sorteio.
- Upload (`MediaPicker`): trava contra solturas duplas, **um arquivo por vez**,
  botão desabilitado durante o envio.
- Carga inicial, code splitting, preload de chunks e cache SWR já existiam (ver
  `docs/navegacao-fluida.md`); não foram alterados.

### 4.6 Vercel Blob

- **Otimização no navegador** antes do envio (`lib/image-optimize.ts`): reduz para
  no máximo 2.560 px no lado maior e converte JPEG/PNG/WebP para **WebP**
  (qualidade 0,85) — só se ficar **menor** que o original; mantém a rotação EXIF e
  a transparência; GIF, SVG, AVIF e PDF passam intactos; qualquer falha envia o
  original. Uma foto de celular de 8 MB passa a caber no limite de 4 MB.
- Validação de tipo, tamanho e cota do plano no servidor (já existia); registro
  órfão no Blob é removido se o `INSERT` falhar (já existia).
- **Não feito — upload direto ao Blob (sem passar pela função).** Hoje o arquivo
  passa pela função: o limite do corpo da Vercel (~4,5 MB) e a memória da função
  são o teto, e `MAX_UPLOAD_BYTES = 4 MB` respeita isso. Mudar para tokens de
  cliente (`@vercel/blob/client`) exige endpoint de emissão de token, callback de
  conclusão (que não roda em desenvolvimento local) e reconciliação de uploads
  interrompidos. É a evolução certa se o limite de 4 MB incomodar; não era
  necessária para os números acima e tem risco próprio. Ver 8.

### 4.7 Resiliência

- `resilience.ts`: classificação de erros (transitório × definitivo), espera
  exponencial com jitter, `withRetry` e **disjuntor** (`CircuitBreaker`).
- Resend: disjuntor (5 falhas seguidas abrem por 30 s; 4xx de recusa não contam).
  Com o provedor fora, cadastro e login respondem na hora "tente reenviar" em vez
  de esperar 8 s; a conta criada nunca é perdida.
- ValidaPay: já tinha prazo e repetição com espera; mantidos.
- Webhook de saída (`content.published`): já tinha fila de entregas pendentes com
  reenvio pelo job; mantido.

### 4.8 Isolamento multiempresa

Preservado e **testado com os caches ligados**: `tests/integration/performance.test.ts`
(404, não 403, entre empresas, mesmo com tudo aquecido; chave de A com origem de B
recusada; respostas públicas nunca misturam sites; `/api/metrics` não expõe dado de
empresa). Nos testes de carga, cada título carrega a marca da empresa e qualquer
vazamento reprovaria a execução — 0 em todas.

### 4.9 Defeito de integridade encontrado: `PATCH` parcial despublicava

`propertyInputSchema.partial()` (e os de obras, serviços, produtos, categorias,
galerias, registros e módulos personalizados, planos) continuava aplicando os
`.default()` do zod 4: um `PATCH { "title": "x" }` chegava ao código com
`publicationStatus: 'draft'` e `commercialStatus: 'disponivel'` e **gravava**. O
site do cliente passava a responder 404 para um imóvel que ninguém despublicou. O
painel envia o formulário inteiro e por isso não costumava disparar; a **API** e
qualquer cliente que mande só o campo alterado, sim.

Correção: `parseJsonPatch`/`parseJsonPatchWithRaw` (`lib/http.ts`) mantêm apenas as
chaves presentes no corpo original; aplicado nos 9 `PATCH` que usam esquema
parcial. Teste de regressão: `tests/integration/patch-parcial.test.ts`.

## 5. Resultados: antes × depois

Uma instância, 30 s por nível, mesma máquina, mesmo gerador. "Antes" = código do
commit anterior à missão (+ a instrumentação, só leitura). "Depois" = caches
ligados (`AUTH_CACHE_TTL_SECONDS=10`, `PUBLIC_CACHE_TTL_SECONDS=5`), pool 10, sem
bloqueio por sobrecarga.

| Usuários | Antes p50 / p95 / p99 (ms) | Depois p50 / p95 / p99 (ms) | req/s antes → depois | consultas/req | erros 5xx+rede |
| ---: | --- | --- | --- | --- | --- |
| 10 | 15 / 31 / 120 | **6 / 17 / 44** | 22 → 23 | 14,0 → 5,0 | 0 → 0 |
| 50 | 14 / 38 / 78 | **5 / 18 / 56** | 114 → 116 | 14,0 → 5,0 | 0 → 0 |
| 100 | 50 / 201 / 302 | **6 / 27 / 63** | 193 → 223 | 14,0 → 5,1 | 0 → 0 |
| 150 | 168 / 438 / 663 | **8 / 55 / 191** | 226 → 317 | 14,0 → 5,2 | 0 → 0 |
| 200 | 376 / 878 / 1.102 | **16 / 145 / 283** | 219 → 399 | 13,9 → 5,6 | 0 → 0 |
| 300 | 750 / 1.625 / 2.228 | 327 / 891 / 1.251 | 215 → 328 | 14,0 → 7,2 | 0 → 0 |
| 500 | 1.344 / 3.048 / 3.763 | 734 / 1.935 / 2.390 | 228 → 342 | 13,8 → 6,4 | 0 → 0 |
| 1.000 | 2.794 / 6.985 / 10.089 | 1.728 / 4.443 / 6.437 | 219 → 361 | 13,8 → 5,3 | 0 → 0 |

(RSS pico: 299–562 MB antes, 301–582 MB depois. Laço de eventos p99: 12–22 ms
antes, 12–27 ms depois — o laço não é o problema; a CPU do processo é.)

Integridade em **todas** as 16 execuções: sem acesso cruzado, sem perda ou
duplicação, limite do plano respeitado, edições preservadas. Nas execuções
"antes" apareceram 404 inesperados (2 a 61 nos níveis de 100 a 500) — são o defeito 4.9; nas "depois", 0.

### 5.1 Com bloqueio por sobrecarga (`MAX_CONCURRENT_REQUESTS=120`)

| Usuários | p50 / p95 / p99 (ms) | req/s | recusas 503 | leituras repetidas | **falhas visíveis ao usuário** |
| ---: | --- | --- | ---: | ---: | ---: |
| 500 | 163 / 697 / 1.002 | 477 | 7.058 | 6.151 | 907 (≈ 6% das operações) |
| 1.000 | 13 / 762 / 1.222 | 655 | 16.490 | 13.138 | 3.352 (≈ 23%) |

O bloqueio mantém a latência de quem entra, mas **troca espera por erro**: as
escritas recusadas não são repetidas (de propósito) e as leituras só duas vezes.
Com uma instância saturada isso viola a meta de erro < 1%. Ver 6.3.

### 5.2 Diagnóstico do teto

Com 500 usuários, pool de 10 e de 30 conexões deram o mesmo resultado (p95 1.935 ×
1.816 ms; 342 × 351 req/s), e durante a execução o processo Node ficou em ~91% de
CPU (um núcleo) com o Postgres quase ocioso. O teto de uma instância é **a CPU do
processo Node** (~340–400 req/s), não o pool. Perfil de CPU: ~21% montagem de
consultas do drizzle, ~11% escrita em socket, ~7% coleta de lixo, sem ponto único
a corrigir — a alavanca era o número de consultas, já reduzido de 14 para ~5.

## 6. Capacidade provada e limitações

### 6.1 O que os testes provam

- **Uma instância**, nesta máquina e com banco local, atende **200 usuários
  simultâneos** (mix painel + site) com **p95 145 ms**, 0% de erro e integridade
  preservada; antes, o limite com p95 < 500 ms era **150** (p95 438 ms).
- Até **500** e **1.000** usuários simultâneos numa só instância a plataforma
  **continua correta** (0 erro, 0 vazamento, 0 perda), porém **lenta** (p95 1,9 s
  e 4,4 s). Degrada com fila, não com falha.
- Meta de **p95 < 500 ms** e **erro < 1%**: cumprida de 10 a 200 usuários por
  instância; **não cumprida** a partir de 300 numa só instância.

### 6.2 O que os testes NÃO provam

- **Capacidade em produção.** Não foi usado Neon, Vercel, Resend, ValidaPay nem
  Blob reais. A latência de rede ao Neon é maior (cada consulta é uma viagem), o
  que torna **ainda mais valiosa** a redução de 14 para 5 consultas, mas não foi
  medido.
- **Escala horizontal.** A Vercel cria instâncias conforme a demanda; dividir 500
  usuários por várias instâncias deve cumprir a meta, mas isso é **extrapolação, não
  prova**. O ponto a verificar em produção é o banco: N instâncias × `DB_POOL_MAX`.
- **1.000 e 5.000+ usuários.** Só a correção foi provada, não a latência. A
  "preparação arquitetural" é: consultas por requisição baixas, cache por instância
  sem estado compartilhado, `Retry-After` com jitter, limites por instância,
  nenhuma dependência de sessão fixa — o que permite adicionar instâncias. Nada
  disso substitui um teste em staging.
- **Edições simultâneas do mesmo registro** são "último grava" (sem bloqueio
  otimista). O teste de carga faz cada usuário editar um registro só dele. Dois
  usuários editando o mesmo imóvel no mesmo instante: o segundo salvamento vence
  sem aviso. Evoluir para `If-Match`/`updated_at` é recomendado (seção 8).

### 6.3 Quando ligar `MAX_CONCURRENT_REQUESTS`

Não ligue "no chute". Em Vercel com Fluid compute, uma instância já recebe várias
requisições ao mesmo tempo, e a plataforma escala instâncias; o bloqueio serve a
**proteger a qualidade de quem já entrou** quando a instância satura. A tabela 5.1
mostra o custo: erro visível. Recomendação: deixar desligado até haver tráfego real;
se ligar, usar um valor próximo de **2× a concorrência em que o p95 ainda é bom**
(aqui, a instância saturava perto de 100–150 em andamento) e acompanhar a taxa de
503 em `/api/metrics` (`requests.shed`).

## 7. Variáveis de ambiente novas

Todas opcionais (ver `.env.example`).

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `AUTH_CACHE_TTL_SECONDS` | 10 (0 em teste) | validade do cache de sessão/vínculo/plano/assinatura/chave |
| `PUBLIC_CACHE_TTL_SECONDS` | 5 (0 em teste) | validade do cache de respostas da API pública |
| `DB_POOL_MAX` | 5 | conexões de transação por instância (1–50) |
| `MAX_CONCURRENT_REQUESTS` | 0 (desligado) | recusa com 503 acima desse número em andamento |
| `SLOW_QUERY_MS` | 500 | limite do log `slow_query` |
| `SLOW_REQUEST_MS` | 1000 | limite do log `slow_request` |
| `LOG_ALL_REQUESTS` | false | registra toda requisição (só diagnóstico) |
| `METRICS_SECRET` | — | habilita `GET /api/metrics` (mínimo 16 caracteres) |

## 8. Configuração recomendada

### Vercel

- **Fluid compute** ligado (padrão em projetos novos): uma instância atende várias
  requisições, e os caches de memória passam a ser compartilhados por todas elas —
  é o cenário em que eles mais rendem.
- **Região da função = região do Neon.** Cada consulta é uma ida de rede; uma
  região errada soma dezenas de ms a cada uma das ~5 consultas. Definir em
  `vercel.json` (`"regions": ["gru1"]`, por exemplo) conforme o projeto Neon.
- Manter `memory: 1024` e `maxDuration: 60`; não aumentar sem diagnóstico.
- **Observability** (logs e métricas da Vercel): os logs JSON da API
  (`slow_query`, `slow_request`, `request_error`, `db_unavailable`,
  `db_pool_error`) são filtráveis por `event`.
- **Alertas** (Vercel Observability / Log Drain para o destino que a equipe usar):
  taxa de 5xx > 1% em 5 min; `event=db_unavailable` > 0; `event=slow_request` > 5%
  das requisições; `requests.shed` > 0 em `/api/metrics`.
- Cron diário já existente (`/api/billing/reconcile`) agora também faz a limpeza.

### Neon

- `DATABASE_URL` com host **`-pooler`** (PgBouncer): obrigatório para que
  N instâncias × `DB_POOL_MAX` não esgote as conexões do banco.
- **Autosuspend:** em produção, desligar ou usar o maior intervalo que o plano
  permitir; a primeira consulta após suspensão custa centenas de ms (e o
  primeiro usuário do dia sente).
- **Autoscaling:** mínimo suficiente para o trabalho constante e máximo com folga
  para picos; acompanhar CPU e conexões no painel do Neon.
- **Slow queries:** além do log da aplicação, habilitar `pg_stat_statements` e
  consultar as de maior tempo total (a aplicação já loga as acima de 500 ms).
- **Backup e recuperação:** ver [neon.md](neon.md) §6. Em resumo: janela de
  restauração (PITR) do Neon — **confira o período do seu plano** — para erro
  recente; `pg_dump` periódico para armazenamento **fora do Neon** como cópia
  independente; ensaio de restauração em um branch antes de precisar dela;
  branch do Neon imediatamente antes de qualquer migração destrutiva.

### Serviços extras: o que foi avaliado

| Serviço | Decisão | Motivo |
| --- | --- | --- |
| Redis / Upstash | **Não adicionado** | cache em memória resolve o problema medido; ver 4.3 |
| Sentry | **Não adicionado** | logs JSON + Vercel Observability + `/api/metrics` cobrem o necessário agora; adotar quando houver equipe para triar erros agrupados e releases (traz custo por evento) |
| Fila / workers | **Não adicionado** | nenhuma operação provou precisar de assíncrono; o job diário cobre o recorrente |
| CDN para API pública | **Não** | cache por URL vazaria entre empresas (4.3) |

### Próximos passos recomendados (fora do que foi provado)

1. Teste de carga em **staging** com Neon e Vercel reais (mesmos cenários).
2. Bloqueio otimista (`updated_at`/`If-Match`) nas edições, para o caso de dois
   usuários no mesmo registro.
3. Upload direto ao Blob se o limite de 4 MB incomodar (4.6).
4. `pg_trgm` + índice GIN se a busca por texto nas listas crescer (exige extensão
   no Neon; os testes em PGlite precisariam de alternativa).
5. Reavaliar Redis se a janela de 10 s/5 s dos caches deixar de ser aceitável.

---

# Fase 5 — Medição em produção, região, carga e custos (16/11/2026)

Tudo abaixo foi medido no commit `0707bce`. As seções 1 a 8 acima continuam
valendo: são de uma fase anterior, com banco local.

## 9. O achado principal: a função e o banco estão em continentes diferentes

A função da Vercel roda em **`iad1` (Virgínia, EUA)**; o projeto Neon está em
**São Paulo** (confirmado pelo proprietário). Cada consulta atravessa o
Atlântico duas vezes.

**Medido em produção, 40 amostras a cada 20 s, de um cliente nos EUA:**

| O que | Mediana | p95 | Mín–Máx |
| --- | --- | --- | --- |
| `select 1` com a conexão **já aberta** | **117 ms** | 120 ms | 114–122 |
| `select 1` abrindo conexão nova (3 idas e voltas) | 348 ms | 371 ms | 339–378 |
| `/api/health` sem tocar o banco | 126 ms | 224 ms | 100–375 |
| `/api/health?db=1` (função quente, conexão nova) | 1.479 ms | 1.576 ms | 1.148–1.696 |

`select 1` não faz trabalho nenhum: **117 ms é puro tempo de viagem.** É o piso
de *cada* consulta que a API faz hoje.

Isso multiplica por tudo. Consultas por operação, medidas no teste de carga
local (os tempos de lá não valem para produção; as **quantidades**, sim):

| Operação | Consultas | Só em viagem, a 117 ms |
| --- | --- | --- |
| Lista de conteúdo | 4 | ~0,5 s |
| Visão geral do painel | 9 a 11 | ~1,2 s |
| Salvar um conteúdo | 8 | ~0,9 s |
| Criar um conteúdo | 16 a 17 | ~1,9 s |
| **Webhook de pagamento** | **13 a 18** | **1,5 a 2,1 s** |
| Média por requisição, sessão em cache | 5 | ~0,6 s |
| Média por requisição, primeiro acesso | 13 | ~1,5 s |

O webhook da ValidaPay tem **5 s** de limite. Hoje gasta de 1,5 a 2,1 s só em
viagem, antes de qualquer processamento, e mais ainda se a função ou o banco
estiverem frios. O mecanismo de prazo de resposta da Fase 2 protege contra o
estouro (responde e continua em segundo plano), mas a margem é pequena.

## 10. Partida a frio: separada em função e banco

Duas sondas, ambas em produção.

**Sonda A** — 50 amostras: 40 a cada 20 s e 10 após 6 min de ociosidade.
**Sonda B** — 5 amostras, cada uma após 6 min parada, chamando primeiro
`/api/health` (só a função) e depois `?db=1`.

| Situação | Medido |
| --- | --- |
| Função fria, sem tocar o banco (sonda B) | **2.058 a 2.486 ms** (5 de 5) |
| Banco frio: `select 1` logo após (sonda B) | **928 a 1.438 ms** (uma amostra: 3.199 ms) |
| Função já quente, conexão nova | 586 a 624 ms, `select 1` em 122 ms |
| Tudo frio, de ponta a ponta (sonda A, 9 amostras) | mediana **4.561 ms**, faixa 3.897–5.051 |

Distribuição das 50 primeiras chamadas da sonda A: mediana 1.490 ms, média
2.006 ms, p95 4.623 ms, p99 5.017 ms, máx 5.051 ms. A média é maior que a
mediana porque as caudas frias a puxam.

**Conclusão: a amostra de 952 ms da auditoria não era "o Neon adormecido".** São
três causas somáveis, e a maior é a função:

1. **função fria: ~2,0 a 2,5 s** — o maior componente, e **não** é do Neon;
2. **banco adormecido: +0,8 a 1,1 s** na primeira consulta;
3. **distância, sempre: 117 ms por consulta**, frio ou quente.

## 11. Web Vitals

### 11.1 Páginas públicas em produção

Lighthouse 12, celular simulado (Moto G Power), rede 4G lenta, CPU 4× mais
lenta, cache frio, mediana de 3 execuções. **Cliente nos EUA** — um visitante no
Brasil tem latência maior (ver 11.4).

| Página | LCP | FCP | CLS | TBT | TTFB | Peso | Requisições | Nota |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Inicial | 3,6 s | 1,2 s | 0 | 103 ms | 153 ms | 442 KB | 16 | 89 |
| Cadastro | 2,2 s | 1,1 s | 0 | 93 ms | 178 ms | 263 KB | 7 | 98 |
| Login | 3,0 s | 1,1 s | 0,084 | 94 ms | 146 ms | 263 KB | 7 | 92 |

- Único recurso que bloqueia a renderização: o CSS (15 KB). Aceitável.
- O LCP é sempre **texto**, que só aparece depois de baixar o pacote principal
  e o da tela. Não é imagem lenta: é JavaScript em fila.
- O CLS de 0,084 no login vem do campo de e-mail; está abaixo do limite de
  0,1, mas é o pior da plataforma.

### 11.2 Painel autenticado, ambiente local

Playwright, celular simulado (412×823), 4G lenta, CPU 4×, mediana de 3
execuções. **O TTFB local (3–4 ms) não representa produção**; o resto, sim.

| Tela | LCP | FCP | CLS | Peso | Requisições | Chamadas de API |
| --- | --- | --- | --- | --- | --- | --- |
| Visão geral | 1,85 s | 0,58 s | 0 | 332 KB | 43 | 4 |
| Serviços | 2,62 s | 0,58 s | 0 | 332 KB | 43 | 4 |
| Imóveis | 2,60 s | 0,58 s | 0 | 332 KB | 44 | 5 |
| Mídia | 2,13 s | 0,58 s | 0,001 | 331 KB | 43 | 4 |
| Plano | 2,10 s | 0,57 s | 0 | 332 KB | 42 | 3 |

As 43 requisições não são peso: a maioria é o pré-carregamento ocioso das telas
do menu (`routePreload.ts`), que acontece **depois** da tela aparecer.

### 11.3 INP do painel (laboratório)

12 interações roteirizadas, celular simulado, CPU 4×:

| Interação | INP (3 execuções) |
| --- | --- |
| Abrir o menu | 56, 64, 112 ms |
| Navegar pelo menu | 72, 96, 64 ms |
| Abrir um item para editar | 104, 144, **240 ms** |
| Digitar no título | 56, 64, 64 ms |

Tudo abaixo de 200 ms (limite do "bom"), exceto uma abertura de item que chegou
a 240 ms. Com CPU 4× mais lenta, em celular real é comparável a um aparelho
modesto.

### 11.4 O que NÃO foi medido

- **Nenhuma medição a partir do Brasil.** Este ambiente fica nos EUA. Um
  visitante brasileiro soma a latência Brasil–Virgínia a todos os números da
  11.1. Há um roteiro pronto para o proprietário rodar no navegador dele.
- **Nenhum dado real de usuário (campo).** A plataforma não coleta Web Vitals,
  então não existe INP de gente de verdade — só laboratório.
- **Site de cliente conectado:** não há site real em produção para medir.

## 12. API e banco

Rotas do painel, medidas localmente com `Server-Timing` (11 chamadas por rota;
a 1ª separada das seguintes, para ver o efeito do cache de sessão):

Nenhuma rota do painel fez mais que uma consulta por entidade listada; **não foi
encontrado N+1**. A visão geral já paraleliza suas consultas (`Promise.all`).
As consultas por requisição caem de 12,8 para 5,0 quando os caches de sessão
(10 s) e de resposta pública (5 s) estão ligados, como em produção.

**Webhooks e tarefas, medidos localmente:**

| Evento | Consultas | Tempo de app (local) |
| --- | --- | --- |
| `payment.success`, 1º pagamento | 18 | 47 ms |
| Mesmo evento repetido (deduplicado) | 2 | 5 ms |
| `payment.success`, renovação | 15 | 15 ms |
| `payment.failed` | 13 | 17 ms |
| Assinatura inválida (recusado) | 0 | 2 ms |
| Conciliação diária | 20 + ~1 por assinatura | 33 ms |
| Tarefa de sincronização | 6 | 9 ms |

A deduplicação funciona: o evento repetido custa 2 consultas e não reprocessa.
Assinatura inválida é recusada sem tocar o banco.

**Índices:** nenhum índice ausente foi identificado. As consultas das listas
usam os índices por `(tenant_id, …)` já existentes, e nenhuma varredura
sequencial apareceu nos tempos. **Nenhuma migração é proposta nesta fase.**

## 13. Carga (10, 25, 50, 100 usuários simultâneos)

Ambiente **local**: Postgres 16 local, uma instância, `DB_POOL_MAX=5`, 30 s por
nível, mix de 70% painel e 30% visitantes do site. Com os caches na
configuração de produção:

| Usuários | Vazão | p50 | p95 | p99 | Erros | Consultas/req | Pico de pool |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 24 req/s | 4 ms | 11 ms | 29 ms | 0 | 4,9 | 5/5 |
| 25 | 58 req/s | 4 ms | 12 ms | 41 ms | 0 | 5,1 | 5/5 |
| 50 | 114 req/s | 3 ms | 10 ms | 25 ms | 0 | 5,0 | 5/5 |
| 100 | 224 req/s | 3 ms | 11 ms | 36 ms | 0 | 5,1 | 5/5 |

Sem os caches (primeiro acesso de cada pessoa): 12,8 consultas por requisição e
p95 de 64 ms com 100 usuários — ainda 0 erro.

Integridade conferida ao final de **todos** os níveis: nenhum acesso entre
empresas, nenhuma perda, nenhuma duplicação, limites de plano respeitados,
edições preservadas.

**O que isto NÃO prova:** capacidade em produção. Não há Neon, Vercel, Blob nem
provedores reais aqui, e o ambiente de prévia não existe (o ramo de trabalho é o
de produção). Some ~117 ms por consulta a cada número acima para ter uma ideia
do que muda com o banco em São Paulo e a função nos EUA — e **isso é
extrapolação, não medição**.

## 14. Região: três cenários

| | A — manter | B — função no Brasil (`gru1`) | C — banco nos EUA |
| --- | --- | --- | --- |
| Consulta | 117 ms | **~2 a 10 ms** (estimado) | ~2 a 10 ms |
| Painel (5 consultas) | ~0,6 s só de viagem | ~0,05 s | ~0,05 s |
| Webhook (18 consultas) | 1,5 a 2,1 s | ~0,2 s | ~0,2 s |
| Visitante brasileiro | função longe | função perto | função longe |
| Dados pessoais | saem do Brasil a cada consulta | **ficam no Brasil** | banco vai para fora |
| Custo | — | mesma função, só muda a região | migração de banco |
| Risco | — | **baixo**: uma linha em `vercel.json`, reversível | **alto**: migrar banco com dados reais |
| Trabalho | nenhum | um envio, janela curta | migração completa |

**Recomendação: cenário B.** É o único que melhora os dois lados (velocidade e
permanência dos dados no Brasil) com risco baixo. O cenário C resolveria a
latência, mas tira os dados do país e exige migrar o banco — desproporcional.

Ressalvas do cenário B, honestamente:
- Os "2 a 10 ms" são **estimativa**, não medição: não posso medir daqui. A
  prova vem depois de aplicar.
- `gru1` precisa estar disponível no plano contratado da Vercel. **Confirme
  antes.**
- Chamadas para ValidaPay e Resend passam a sair do Brasil: diferença
  desprezível, e provavelmente melhor para a ValidaPay.
- A primeira execução depois da mudança recria a função (uma partida a frio).

**Nada foi alterado.** A mudança está preparada em um commit separado, não
enviado.

## 15. Otimizações aplicadas nesta fase

Todas localizadas, reversíveis e com medição antes/depois.

### 15.1 Logotipo: 70 KB → 23 KB

Era 960×235 px para ser exibido com 44 px de altura. Reduzido para 560 px de
largura, que ainda cobre telas de alta densidade.

| | Antes | Depois |
| --- | --- | --- |
| `logo.webp` | 69.838 B | 23.066 B |
| `logo-branca.webp` | 71.410 B | 23.792 B |
| Peso do login/cadastro | 240 KB | **194 KB** |
| Peso do painel | 332 KB | **285 KB** |
| Peso da página inicial | 413 KB | **367 KB** |

Conferido visualmente, lado a lado, em densidade 3×: sem diferença perceptível.

### 15.2 Lista pública de planos guardada pela borda

`/api/public/plans` já mandava o navegador guardar por 5 min, mas **não a
borda da Vercel** (faltava `s-maxage`): cada visitante novo da página inicial
acordava a função e o banco. Medido em produção antes da mudança: 230 a 815 ms,
`X-Vercel-Cache: BYPASS`, 1 consulta ao banco por visita.

Depois: a borda responde às visitas seguintes sem tocar função nem banco.
Efeito em custo: uma chamada de função a menos por visita. Risco: uma mudança de
preço leva até 5 min para aparecer (para o navegador já era assim).

### 15.3 Separação do `vendor` corrigida

A configuração pedia React, React DOM e o roteador em um arquivo próprio, mas a
regra casava `react-dom` e o painel importa `react-dom/client`: **o React DOM
inteiro (41% do pacote principal) ficava no arquivo que muda a cada
publicação.** Trocado por uma função que casa o diretório do pacote.

| | Antes | Depois |
| --- | --- | --- |
| `index` | 483 KB (146 KB gzip) | 277 KB (82 KB gzip) |
| `vendor` | 50 KB (18 KB gzip) | 255 KB (81 KB gzip) |
| **Total na primeira visita** | **164 KB gzip** | **163 KB gzip** |

**A primeira visita não melhora** — é a mesma quantidade de código, redistribuída.
O ganho é para **quem volta depois de uma publicação**: antes baixava 146 KB de
novo; agora baixa 82 KB, e os 81 KB do `vendor` vêm do cache. Registrado aqui
porque "reduzimos o bundle principal de 483 para 277 KB" seria enganoso.

### 15.4 Pré-carregamento da tela: testado e DESCARTADO

Hipótese: o LCP espera dois downloads em fila (pacote principal, depois o da
tela). Implementei um script no `index.html` que pede o arquivo da tela já no
início, e medi 9 execuções de cada lado:

| | LCP mediana | FCP |
| --- | --- | --- |
| Sem o pré-carregamento | 2.044 ms | 580 ms |
| Com o pré-carregamento | 1.960 ms (−4%) | 668 ms (**+15%**) |

4% de ganho no LCP ao custo de 15% de piora no FCP, dentro da variação natural
entre execuções. **Não compensa a complexidade: removido.** Fica registrado para
não ser tentado de novo sem evidência.

## 16. Metas, agora que há linha de base

Nenhuma meta foi inventada antes de medir. "Atual" é o medido nesta fase.

| O que | Atual | Meta | Por quê | Prioridade | Custo | Risco |
| --- | --- | --- | --- | --- | --- | --- |
| Consulta ao banco | 117 ms | < 15 ms | É o piso de toda operação | **Crítica** | uma linha; janela | Baixo |
| Webhook de cobrança | 1,5–2,1 s só de viagem | < 0,5 s | Limite de 5 s da ValidaPay | **Crítica** | o mesmo acima | Baixo |
| Partida a frio completa | 4,6 s (mediana) | < 2,5 s | Primeiro acesso do dia | **Alta** | região + decisão sobre suspensão do Neon | Médio (custo Neon) |
| LCP da página inicial, celular | 3,6 s (dos EUA) | < 2,5 s | Primeira impressão | **Alta** | medir do Brasil primeiro | Baixo |
| LCP do painel | 1,9–2,6 s (local) | < 2,5 s em produção | Tela de trabalho diária | Média | depende da região | Baixo |
| INP do painel | até 240 ms | < 200 ms sempre | Uma interação passou do limite | Média | investigar a abertura do item | Baixo |
| CLS do login | 0,084 | < 0,05 | Pior da plataforma, mas aprovado | **Baixa** | ajuste de layout | Baixo |
| Peso da primeira visita | 163 KB gzip | manter | Já está bom | Baixa | — | — |
| Consultas por requisição | 5 (cache) / 13 (1º acesso) | manter | Reduzir mexe no isolamento entre empresas | **Baixa** | alto | **Alto** |

**O que separa usuário de vaidade técnica:** as duas primeiras linhas afetam
toda pessoa em toda ação. As duas últimas não teriam efeito perceptível —
depois da mudança de região, 5 consultas custarão ~50 ms, e otimizá-las
economizaria milissegundos ao preço de mexer no código que separa uma empresa da
outra. **Não vale.**

## 17. Limitações desta fase

1. **Nenhuma medição a partir do Brasil**, que é onde estão os clientes.
2. **Nenhum dado real de usuário**: a plataforma não coleta Web Vitals.
3. **Carga só em ambiente local.** Não existe prévia: o ramo de trabalho é o de
   produção. Os números de carga não se extrapolam.
4. **Custos não calculados:** faltam os painéis e contratos. Ver
   [`custos-operacionais.md`](custos-operacionais.md).
5. **Os "2 a 10 ms" do cenário B são estimativa**, não medição.
6. **Uma amostra da sonda B (3.199 ms no `select 1`)** destoa das outras quatro;
   pode ter sido uma suspensão mais profunda do Neon ou rede. Fica registrada,
   não descartada.
