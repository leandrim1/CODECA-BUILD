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
