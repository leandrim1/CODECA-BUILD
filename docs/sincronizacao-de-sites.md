# Sincronização inteligente com o site de origem

Depois da primeira importação, a plataforma passa a acompanhar o site que a
empresa já tem: verifica periodicamente, descobre o que mudou lá, e oferece ao
cliente — sempre a ele — a decisão de trazer ou não.

Este documento descreve **o que funciona, o que não funciona e por quê**. A
seção 3 é a mais importante: ela diz uma coisa que a tela também diz, e que
seria fácil omitir.

---

## 1. O fluxo

```
conectar o site de origem
  → a plataforma verifica sozinha (sem o painel aberto)
  → alterações aparecem como PENDENTES
  → o cliente vê o antes e o depois, decide uma a uma ou por categoria
  → aplica
  → pode desfazer
```

Rotas, sob `/api/tenants/:tenantId/`:

| Método e rota | O que faz |
|---|---|
| `GET /sync` | Estado da fonte, alterações e histórico. |
| `POST /sync` | Conecta o site de origem. |
| `PATCH /sync` | Muda a frequência, pausa ou retoma. |
| `POST /sync/verificar` | Antecipa uma verificação. |
| `PATCH /sync/decisoes` | Grava as decisões do cliente. |
| `POST /sync/aplicar` | Aplica o que foi aprovado. |
| `POST /sync/alteracoes/:id/desfazer` | Desfaz uma alteração aplicada. |
| `DELETE /sync` | Desconecta a origem. |

E o job, protegido pelo mesmo segredo da reconciliação:

| Rota | O que faz |
|---|---|
| `GET` ou `POST /api/sync/run` | Processa as fontes vencidas. |

Permissões: `content:write` para conectar, configurar, verificar, decidir e
aplicar; `content:delete` para desconectar e desfazer; `content:read` para
acompanhar. Um `viewer` vê, mas não muda nada.

---

## 2. A proteção contra conflito: comparação de três pontas

Esta é a peça central, e a razão de a funcionalidade não destruir o trabalho do
cliente.

Comparar a origem com a CODECA Build **não basta**. Os dois lados divergem
tanto quando a origem mudou quanto quando o cliente editou no painel, e tratar
os dois casos igual faria a sincronização propor desfazer todo texto que ele
reescreveu.

Por isso guardamos uma terceira ponta: o **baseline**, que é o que a origem
dizia na última sincronização (tabela `sync_baseline`). Com as três pontas a
pergunta deixa de ser "estão diferentes?" e passa a ser "quem mudou?":

| origem × baseline | CODECA × baseline | conclusão |
|---|---|---|
| igual | igual | nada aconteceu |
| igual | diferente | **só o cliente editou** — não vira alteração pendente |
| diferente | igual | só a origem mudou — alteração simples |
| diferente | diferente | **conflito** — a tela mostra as três versões |

A segunda linha é a que protege o cliente. A quarta é o cenário descrito no
item 7 do pedido, e nela a plataforma não escolhe: mostra o conteúdo original,
o da origem e o da CODECA, e oferece "Manter a versão da CODECA Build" ou
"Usar a versão do site de origem".

Detalhe que fecha o ciclo: quando só o cliente editou, o baseline avança
guardando a impressão atual da CODECA. Sem isso o mesmo campo apareceria como
conflito para sempre.

---

## 3. A frequência: o que a plataforma entrega hoje

**O plano da Vercel em uso permite um agendamento, uma vez por dia**, e ele já
existe (`/api/billing/reconcile`, às 05:23). A verificação das fontes entrou
nesse mesmo job — que é o que faz a funcionalidade rodar **hoje**, sem aba
aberta, sem serviço novo e sem mudar configuração.

Consequência, dita com todas as letras:

> As opções "a cada 6 horas" e "a cada 12 horas" **não executam nessa cadência
> na infraestrutura atual**. A fonte realmente vence a cada 6 horas e entra na
> fila, mas só é atendida na passagem seguinte do agendador — ou seja, uma vez
> por dia.

Isso não fica escondido. A tela mostra o aviso ao lado da frequência escolhida
(`schedulerNote`), e `frequencyExceedsScheduler` decide quando exibi-lo. O
cliente que escolhe 6 horas sabe o que vai receber.

**Como obter a cadência real.** O endpoint `/api/sync/run` já existe e é
protegido pelo mesmo segredo. Basta um agendamento a mais apontando para ele:

```json
{
  "crons": [
    { "path": "/api/billing/reconcile", "schedule": "23 5 * * *" },
    { "path": "/api/sync/run", "schedule": "17 */6 * * *" }
  ]
}
```

Isso exige um plano da Vercel que permita mais de um cron e execução
infra-diária. Qualquer agendador externo serve igualmente — a chamada é um
`POST` com `Authorization: Bearer <BILLING_RECONCILIATION_SECRET>`.

Nenhuma linha de código muda nos dois casos.

---

## 4. Como a verificação é barata para o site do cliente

Uma fonte conectada é visitada **para sempre**. Três mecanismos evitam que isso
vire tráfego indesejado contra o site de um terceiro:

1. **Requisição condicional.** Guardamos `ETag` e `Last-Modified` por página
   (`sync_page_states`). Na visita seguinte mandamos `If-None-Match` /
   `If-Modified-Since`; uma página que não mudou responde **304 sem corpo**, e
   é pulada inteira — sem download, sem extração, sem comparação.
2. **Resumo do texto extraído.** Muitos servidores não oferecem validador, e
   vários oferecem um que muda a cada resposta (data no rodapé, contador de
   visitas). Então o resumo é do **texto extraído**, não do HTML: mudança de
   marcação que não muda o que está escrito não conta como alteração.
3. **Adiamento progressivo.** Depois de uma falha, o intervalo dobra a cada
   nova falha (até 24 h), e após 5 falhas seguidas a fonte se pausa sozinha,
   com o motivo visível na tela.

Imagens só são baixadas **quando a alteração é aprovada**. A prévia na tela de
revisão aponta para o site de origem (com `referrerPolicy="no-referrer"`), para
não gastar o armazenamento do plano com algo que o cliente pode descartar.

---

## 5. As regras que não se dobram

### Nada é alterado sem aprovação

`decision` nasce `pendente` em toda alteração. Aplicar só toca o que está
`aprovada`. Conflito sem escolha feita não entra.

### Conteúdo removido nunca é apagado sozinho

Quando algo some da origem, a alteração é do tipo `removido` e oferece três
ações: **manter** (padrão), **arquivar** (sai do site, fica no painel) ou
**excluir**. Sem `removalAction` explícito, a remoção é ignorada. `excluir` só
acontece quando o pedido disse `excluir`, e a tela pede confirmação antes.

### Página fora do ar não é conteúdo removido

O cuidado que evita o pior resultado possível. Só conta como sumido o que vinha
de uma página que **respondeu**. Se a página de serviços deu tempo esgotado, os
serviços dela não sumiram — a plataforma simplesmente não olhou. Tratar os dois
casos igual proporia apagar a carteira inteira de um cliente por causa de uma
instabilidade de dez minutos.

### A mesma alteração não notifica duas vezes

Um índice único parcial (`sync_changes_pending_key`, sobre as pendentes) faz a
verificação seguinte **atualizar** a alteração pendente em vez de empilhar
outra igual.

### Tudo entra como rascunho, e pode ser desfeito

Conteúdo novo entra com `publicationStatus: 'draft'` (banner, `isActive: false`).
Cada alteração aplicada guarda o valor que estava na CODECA no momento da
gravação (`revert_value`), e pode ser desfeita.

Ressalva que a tela avisa: a reversão devolve o valor **do momento da
gravação**. Se o cliente editou aquele campo depois, a edição também é
desfeita.

### Nenhuma estrutura paralela

O conteúdo sincronizado vai para as tabelas que o painel já usa, pelas
**mesmas** funções da importação (`applyDocumentFields`,
`applyCollectionRecord`), pelos mesmos schemas Zod, mesmo gerador de slug,
mesmo limite de plano e mesma política de campos.

As cinco tabelas novas registram o **acompanhamento**, não o conteúdo:
`sync_sources`, `sync_page_states`, `sync_baseline`, `sync_checks`,
`sync_changes`. Todas com `tenant_id` + `site_id` e a chave estrangeira
composta para `sites(id, tenant_id)`.

Desconectar apaga o acompanhamento, não o conteúdo: o que já foi aplicado virou
conteúdo do cliente no momento em que ele aprovou.

---

## 6. Segurança

Reaproveita integralmente as barreiras da importação, e acrescenta uma razão
para elas serem ainda mais importantes aqui: uma fonte conectada é visitada
periodicamente, sozinha, para sempre.

- **Duas barreiras contra SSRF.** Forma do endereço (nos dois lados) e IP de
  destino (resolve, valida todos os registros, conecta **naquele IP** pela
  opção `lookup` do `node:https` — o que fecha a janela de DNS rebinding). Cada
  salto de redirecionamento passa pelas duas de novo.
- **Nenhum script do site é executado.** O leitor de HTML é um tokenizador.
- **Nenhum conteúdo externo vira instrução.** Não há passo de IA no caminho.
- **Imagem decidida pelos bytes**, não pelo `content-type` da origem. SVG não é
  importado.
- **Limites**: 20 fontes por passagem, 45 s por passagem, 20 s por fonte, 6
  verificações manuais por hora por empresa, 300 alterações por verificação.
- **Isolamento**: empresa e site vêm sempre da sessão. Fonte de outra empresa
  responde 404, não 403. A única consulta sem sessão é a fila do agendador, que
  lê o par (empresa, site) da própria linha e o carrega dali em diante.
- **Auditoria**: conectar, configurar, verificar, aplicar, desfazer e
  desconectar. Nenhuma linha carrega conteúdo do site de origem.

### Falha de um cliente não afeta os outros

Cada fonte roda dentro do próprio `try` em `checkOneSource`. Um site fora do
ar, um HTML gigante ou um erro inesperado derrubam **aquela** verificação e
nada mais.

A reserva da fila (`claimDueSources`) empurra `next_check_at` na mesma
instrução que seleciona: duas passagens simultâneas não pegam a mesma fonte, e
uma passagem que morra no meio não deixa fonte travada — ela volta a vencer no
ciclo seguinte, sem precisar de limpeza.

---

## 7. Limitações conhecidas

- **Cadência infra-diária exige configuração.** Ver a seção 3.
- **Site renderizado no navegador.** A análise não executa JavaScript —
  mesma limitação da importação, documentada em `docs/importacao-de-sites.md`.
- **Renomear conteúdo na origem aparece como removido + novo.** A identidade de
  um registro de coleção é o título normalizado. Casar por semelhança de texto
  resolveria alguns casos e erraria outros em silêncio — e aqui errar significa
  sobrescrever o serviço errado.
- **Imagem trocada no mesmo endereço** só é detectada quando a página que a
  referencia também muda: a imagem é um recurso separado, lido quando a página
  é relida. Trocar o arquivo sem tocar no HTML passa despercebido até a próxima
  mudança da página.
- **Desfazer não remove imagem.** O arquivo fica na biblioteca, que tem a
  própria exclusão (e recusa apagar arquivo em uso).
- **Categorias** não recebe sincronização, como não recebe importação.
- **Limite do plano** vale igual: a sincronização usa o mesmo
  `assertContentLimit` do painel.

---

## 8. Testes

| Arquivo | O que prova |
|---|---|
| `tests/unit/sync-diff.test.ts` | As quatro combinações das três pontas; edição local não vira pendência; conflito detectado; remoção nunca em conflito; identidade entre verificações; frequências e o aviso do agendador |
| `tests/integration/site-sync.test.ts` | Os 14 cenários do pedido sobre PostgreSQL real |

Os cenários cobertos, na ordem do pedido: sem alterações (com e sem 304),
telefone, endereço, textos, serviço adicionado, serviço removido, imagem
trocada, banner, página removida, edição feita na CODECA, conflito entre as
duas versões, origem indisponível, falha durante a sincronização, e dois
clientes ao mesmo tempo. Mais: agendador sem sessão, job recusando quem não tem
o segredo, fonte pausada fora da fila, pausa automática após falhas seguidas,
aviso na visão geral, histórico e auditoria.

A busca das páginas é substituída nos testes de integração
(`createMemorySiteFetcher`) pelo mesmo motivo da importação: a implementação
real recusa `localhost` de propósito. O resto — API, banco, schemas, gravação,
agendador — é real.

---

## 9. Arquivos

**Compartilhado** (`packages/shared/src/sync/`): `types.ts` (estados,
frequências, decisões, limites, o aviso do agendador), `diff.ts` (comparação de
três pontas e identidade do conteúdo).

**Backend** (`apps/api/src/lib/sync/`): `store.ts` (banco e fila),
`codeca-side.ts` (o que está no painel agora), `checker.ts` (visita e
detecção), `applier.ts` (gravação, remoção e reversão), `scheduler.ts`
(passagem e isolamento por fonte), `views.ts` (conversão para a tela). Rotas em
`apps/api/src/routes/site-sync.ts`; job em `apps/api/src/routes/billing-jobs.ts`.

**Banco**: `packages/database/migrations/0025_sincronizacao_de_sites.sql`.

**Painel**: `apps/web/src/dashboard/SyncPage.tsx`, rota
`/painel/sincronizacao`. O aviso aparece também na visão geral (`syncNotice`).

Nenhuma dependência foi adicionada ao projeto.
