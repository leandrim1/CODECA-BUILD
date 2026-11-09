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

## 3. A frequência: o que o plano atual entrega

A instalação roda no **plano gratuito da Vercel**, que permite 2 agendamentos
e dispara cada um **uma vez por dia**. Os dois estão em uso:

```json
{
  "crons": [
    { "path": "/api/billing/reconcile", "schedule": "23 5 * * *" },
    { "path": "/api/sync/run",          "schedule": "47 17 * * *" }
  ]
}
```

A reconciliação das 05:23 também executa uma passagem da sincronização, então
na prática as fontes são olhadas **duas vezes ao dia** — de manhã cedo e no
fim da tarde. O que está *garantido* pelo plano é uma vez; é esse o número que
a plataforma promete ao cliente.

O minuto 47 evita a hora cheia, onde se concentra o tráfego agendado.

> As opções "a cada 6 horas" e "a cada 12 horas" **não executam nessa cadência
> neste plano**. A fonte realmente vence no prazo escolhido e entra na fila,
> mas só é atendida na passagem seguinte do agendador.

Isso não fica escondido: a tela mostra o aviso ao lado da frequência escolhida
(`schedulerNote`), e `frequencyExceedsScheduler` decide quando exibi-lo. Quem
escolhe 6 horas sabe o que vai receber.

Rodar pelos dois gatilhos não duplica trabalho: a reserva da fila é atômica, e
uma fonte que ainda não venceu simplesmente não é selecionada.

### Autenticação

Nenhuma configuração nova. O cron usa o mesmo segredo do job de reconciliação:
a Vercel envia `Authorization: Bearer <CRON_SECRET>`, e a instalação já define
`CRON_SECRET` com o mesmo valor de `BILLING_RECONCILIATION_SECRET` (ver
`.env.example`). Qualquer agendador externo serve igualmente — é um `POST`
para `/api/sync/run` com esse cabeçalho.

### Para obter a cadência real de 6 horas

São **duas linhas**, e nenhuma delas é de lógica:

1. em `vercel.json`, o `schedule` do cron `/api/sync/run` passa a
   `47 */6 * * *`;
2. em `packages/shared/src/sync/types.ts`,
   `SCHEDULER_INTERVAL_MINUTES` passa a `6 * 60`.

A segunda não é opcional: é ela que a tela usa para decidir se avisa o cliente
de que a cadência real é menor que a escolhida. Deixá-la em 1440 com o cron de
6 horas ativo faria a tela avisar sem motivo; o inverso faria a tela prometer
o que não entrega. Um teste unitário guarda as duas pontas e falha se só uma
mudar.

Isso exige um plano da Vercel que aceite agendamento infra-diário. Como
alternativa sem trocar de plano, qualquer agendador externo (um cron numa
máquina sua, um serviço de ping) pode chamar `/api/sync/run` de 6 em 6 horas
com o mesmo cabeçalho — aí só o passo 2 é necessário.

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

Imagens só são **armazenadas** quando a alteração é aprovada. A prévia na tela
de revisão aponta para o site de origem (com `referrerPolicy="no-referrer"`),
para não gastar o armazenamento do plano com algo que o cliente pode descartar.

Durante a verificação os arquivos das páginas que mudaram são lidos para
calcular o resumo — é a única forma de ver uma troca de foto no mesmo
endereço — mas nada é gravado no Blob antes da aprovação.

O texto alternativo fica **fora** da comparação de imagem: do lado da CODECA
ele é editável pelo cliente, e incluí-lo faria os dois lados nunca baterem,
com toda imagem aparecendo como alterada em toda verificação.

---

## 5. As regras que não se dobram

### Conectar não propõe nada

A primeira verificação depois de conectar **estabelece o ponto de partida** em
silêncio. Sem baseline não há como distinguir "a origem mudou" de "sempre foi
assim", e toda diferença entre a origem e o painel apareceria como conteúdo
novo — inclusive as que o cliente já resolveu na importação, quando escolheu
manter o que estava no painel. Da verificação seguinte em diante, o que
aparece é mudança de verdade.

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

- **Cadência infra-diária exige outro plano (ou agendador externo).** O
  gratuito da Vercel dispara cada cron uma vez por dia. Ver a seção 3.
- **Site renderizado no navegador.** A análise não executa JavaScript —
  mesma limitação da importação, documentada em `docs/importacao-de-sites.md`.
- **Renomear conteúdo na origem aparece como removido + novo.** A identidade de
  um registro de coleção é o título normalizado. Casar por semelhança de texto
  resolveria alguns casos e erraria outros em silêncio — e aqui errar significa
  sobrescrever o serviço errado.
- **Imagem trocada no mesmo endereço** é detectada pelo conteúdo do arquivo
  (SHA-256), mas só para imagens de páginas que mudaram naquela verificação.
  Imagem de página que respondeu 304 não é relida — trocar o arquivo sem tocar
  em nada no HTML passa despercebido até a página mudar. A releitura usa
  requisição condicional, então um arquivo intacto responde 304 sem corpo.
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
| `tests/integration/site-sync.test.ts` | Os 14 cenários do pedido sobre PostgreSQL real (34 testes) |

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
