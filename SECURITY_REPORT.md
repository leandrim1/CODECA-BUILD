# Relatório de segurança — CODECA Build

Auditoria de 23/11/2026, executada em duas fases: diagnóstico sem alterações e
correção na branch `security-hardening`.

**Nada foi publicado em produção.** Todo o trabalho está na branch, atrás de
revisão.

## Stack confirmada

| | |
| --- | --- |
| Monorepo | pnpm 10.28 |
| API | Hono 4, função Node na Vercel |
| Painel | React + Vite (SPA estático), **não** Next.js |
| ORM | Drizzle sobre Neon Postgres (PGlite nos testes) |
| Sessão | cookie opaco + hash no banco, sem JWT |
| Senha | scrypt |
| Arquivos | Vercel Blob, sempre pelo servidor |

---

## Parte A — Limites e armazenamento

### Corrigido

**Corrida entre conferir a vaga e ocupá-la** (`lib/content-slot.ts`). Era o
defeito que custava cobrança: a verificação e a gravação eram comandos
separados, e duas criações simultâneas da mesma empresa liam o mesmo total. O
teto efetivo era o paralelismo, não o plano.

As duas passam a acontecer na mesma transação, com trava de aviso por empresa.
As 11 rotas de criação foram convertidas.

Medido contra PostgreSQL 16 real, com a empresa a uma vaga do teto
(`scripts/limites/corrida.mjs`):

| Código | Disparos | Aceitas | Total final |
| --- | --- | --- | --- |
| antes | 12 | **2** | **101** (teto 100) |
| depois | 12 | 1 | 100 |
| depois | 20 | 1 | 100 |

A suíte não podia provar isso: roda sobre PGlite, que tem uma conexão, e duas
requisições "paralelas" ali acontecem em fila.

**Arquivo que não sai do Blob** (`lib/blob-cleanup.ts`, migração `0034`). A
exclusão tira a linha do banco antes de apagar o arquivo — ordem correta, mas a
falha na segunda metade só ia para o log. A cota é a soma do banco, então já
tinha sido liberada: o arquivo seguia ocupando o balde e **deixava de ser
cobrado**. Agora vira tarefa, o job diário insiste, e a desistência depois de
dez tentativas vira alerta.

### Aberto

| Item | Situação |
| --- | --- |
| **Valores dos planos** | Código: Essencial 20/500 MB e Profissional 100/2 GB. Você informou 40/2 GB e 300/10 GB. **Não corrigido** — depende da sua decisão |
| **Fonte de verdade dos limites** | Três lugares: catálogo em código, `plans.limits` no banco (manda em tempo de execução) e `tenants.limit_overrides`. O deploy só insere com a tabela vazia, então mudar o código **não** muda produção |
| **Relatório de órfãos no Blob** | Exigiria `list` no port do `BlobStorage`, que hoje só tem `put` e `remove`. É diagnóstico; a perda já está estancada |
| **Importação de site** | `lib/import/apply.ts:600` ainda usa a checagem antiga, fora de transação. Janela muito menor (10 importações/hora por empresa), mas existe |
| **Módulo desabilitado** | Conteúdo de módulo desligado sai da contagem. Só o painel mestre desliga, então não é contornável pelo cliente — mas muda a capacidade cobrada em silêncio |

---

## Parte B — Os 20 pontos

| # | Ponto | Antes | Agora | O que mudou |
| --- | --- | --- | --- | --- |
| 1 | Esconder chaves de API | OK | **OK** | — |
| 2 | Segredos no Git | OK | **OK** | Varredura no CI (gitleaks, histórico completo) |
| 3 | Pública × secreta | OK | **OK** | — |
| 4 | Isolamento por linha (RLS) | Parcial | **Parcial, com guarda** | RLS medido e descartado; guarda estática no lugar |
| 5 | Criptografar dados sensíveis | Parcial | **Parcial** | Não mexido; exige migração |
| 6 | Autenticação no servidor | OK | **OK** | — |
| 7 | Acesso aos logs | OK | **OK** | — |
| 8 | Mass assignment | OK | **OK** | — |
| 9 | Cookies da sessão | OK | **OK** | — |
| 10 | Hash das senhas | Parcial | **OK** | scrypt 2^14 → 2^16, com re-hash no login |
| 11 | Limitar tentativas | OK | **OK** | — |
| 12 | Proteção contra bots | Parcial | **OK, desligado** | Turnstile no cadastro e na recuperação |
| 13 | Queries parametrizadas | OK | **OK** | — |
| 14 | Validar entradas | OK | **OK** | — |
| 15 | Escapar conteúdo | OK | **OK** | — |
| 16 | Upload de arquivos | OK | **OK** | — |
| 17 | Respostas enxutas | OK | **OK** | — |
| 18 | Headers de segurança | Parcial | **Parcial** | CSP + HSTS + frame-options no documento, em **report-only** |
| 19 | Forçar HTTPS | Parcial | **OK** | HSTS passa a valer no documento |
| 20 | Dependências | Parcial | **OK** | Dependabot semanal + gitleaks no CI |

### 4 — RLS: por que não, e o que ficou no lugar

RLS no Postgres precisa saber de qual empresa é a requisição. O caminho usual é
um parâmetro de sessão (`app.tenant_id`) lido pela policy. **Medi o
comportamento desse parâmetro com o pool de conexões, contra PostgreSQL 16:**

```
conexao reutilizada enxerga o valor de outra requisicao: "EMPRESA-A"
SET LOCAL dentro da transacao: "EMPRESA-B"
depois do COMMIT, na mesma conexao: "EMPRESA-A"
```

A primeira linha condena o desenho: o valor **vaza entre requisições**. A
requisição seguinte que pegasse aquela conexão sem definir o próprio valor
seria filtrada pela empresa errada — e o sintoma não é erro, é dado faltando.

`SET LOCAL` resolve o vazamento (morre no commit), mas só vale dentro de uma
transação. Isso exigiria envolver **cada requisição de empresa numa transação
única** — e as rotas de empresa fazem chamadas HTTP externas: `domains.ts`
(API da Vercel), `billing.ts` (ValidaPay), `media.ts` (Blob), `members.ts`
(Resend). Segurar uma conexão do Neon durante essas chamadas troca um risco de
isolamento por um risco de disponibilidade.

**Conclusão:** RLS aqui exige antes separar a camada de dados das chamadas
externas. É trabalho real, não um ajuste — e entregá-lo pela metade daria a
sensação de proteção sem a proteção.

**O que foi feito no lugar**, e que era a segunda saída proposta na Fase 1:
`tests/unit/isolamento-das-consultas.test.ts` varre as 18 rotas montadas sob
`tenantScoped` e exige que toda consulta a tabela de empresa esteja amarrada ao
contexto verificado. Hoje: **nenhuma exceção**. O teste também prova que sabe
acusar, recebendo o defeito que existe para pegar.

Isso não substitui RLS: não protege contra SQL executado fora da aplicação. O
que ele fecha é o caminho pelo qual o defeito entraria — uma rota nova que
esqueça o filtro para de passar no CI.

Vale registrar o que o banco **já** garante: as 36 tabelas que têm `site_id` e
`tenant_id` têm a chave estrangeira composta `(site_id, tenant_id)`. Uma linha
não consegue apontar para o site de outra empresa, nem por escrita direta no
banco.

### Detalhe dos que mudaram

**10 — Senhas.** O custo saiu do piso da OWASP. Medido: 2^14 = 42 ms/16 MB;
2^16 = 173 ms/64 MB; 2^17 = 347 ms/128 MB. Escolhido 2^16 — 2^17 estreitaria
demais a margem numa função de 1 GB que atende todo o resto. Ninguém fica
trancado para fora: `verifyPassword` lê os parâmetros do próprio hash guardado,
e o login regrava quando o custo é menor que o de hoje.

**12 — Bots.** Desligado sem as duas chaves; com elas, o token é conferido no
servidor. Provedor fora do ar deixa passar, de propósito: trancar o cadastro
inteiro porque um terceiro caiu seria estrago maior do que o que o desafio
evita.

**18 — Headers.** O CSP está em **report-only** porque não consegui medir
`img-src` contra o host real do Vercel Blob — o ambiente local serve
`blob.test` e tem o Blob desligado. Aplicado, mediria 11 telas sem nenhuma
violação; promovê-lo sem confirmar as imagens arriscaria apagar todas elas.

---

## Ações manuais que dependem de você

1. **Confirmar os limites dos planos em produção** (painel mestre → Planos, ou
   leitura em `plans.limits`). A etapa 4 não começa sem isso.
2. **Decidir a fonte de verdade dos limites**: código reescrevendo o banco no
   deploy, ou painel mestre como autoridade.
3. **Promover o CSP** de report-only para aplicado, depois de abrir o painel em
   produção e confirmar no console que nenhuma imagem é bloqueada. É trocar
   `content-security-policy-report-only` por `content-security-policy` em
   `vercel.json`.
4. **Turnstile**: criar as chaves em dash.cloudflare.com e definir
   `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` na Vercel. Enquanto não
   existirem, nada muda.
5. **Dependabot**: ligar em Settings → Code security do repositório.
6. **Rotação de chaves: nada a fazer.** A varredura não encontrou segredo
   exposto no histórico.

## Não feito, e por quê

| Etapa | Motivo |
| --- | --- |
| **4 — Alinhar limites** | Depende da sua resposta. Reduzir limite bloqueia novos cadastros de quem já passou |
| **7 — Cifrar lead** | Exige migração de dados e mexe em busca por e-mail. Combinado: paro e aviso antes |
| **8 — RLS literal** | Medido e descartado: não cabe nesta arquitetura hoje. Ver abaixo |
| **3 (metade) — Órfãos** | Exige `list` no port do Blob. É diagnóstico, não correção |

## Riscos remanescentes

| Prioridade | Risco |
| --- | --- |
| **Alto** | Limites de plano possivelmente divergentes do contratado (cobrança) |
| **Médio** | Sem RLS: SQL executado fora da aplicação não tem barreira no banco. O caminho pela aplicação está guardado por teste |
| **Médio** | Dados de lead (nome, e-mail, telefone) em texto claro |
| **Médio** | CSP ainda não aplicado |
| **Baixo** | Corrida na importação de sites |
| **Baixo** | Arquivos no Blob em URL pública não adivinhável |

## Verificação

| | |
| --- | --- |
| `pnpm typecheck` | verde |
| `pnpm build` | verde |
| Suíte completa | **109 arquivos, 1890 testes, 0 falhas** |
| Isolamento das consultas | 18 rotas varridas, 0 exceções |
| Corrida de limites | 1 aceita de 20 disparos, teto respeitado |
| CSP em Chromium | 11 telas, 0 violações |

Não há script de lint neste projeto — o `typecheck` é a verificação estática
que existe.
