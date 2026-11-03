# Navegacao fluida do painel

Como o painel carrega telas e dados sem "piscar", e o que fazer ao criar uma tela
nova para nao desfazer isso.

## 1. O que piscava, e por que

Nao era CSS. Eram quatro decisoes de estrutura, que se somavam em todo clique:

| Causa | Efeito visivel |
| --- | --- |
| `<main key={rota}>` envolvendo o `Suspense` | O `Suspense` era recriado a cada clique. Isso **desliga** o comportamento de transicao do React Router (que mantem a tela anterior ate a nova ficar pronta) e mostra o indicador de espera sempre, ate para telas ja carregadas. |
| `useResource` guardava a resposta no `useState` da propria tela | Sair da tela jogava o dado fora. Voltar a ela recomecava do zero: esqueleto, requisicao, conteudo. |
| Espinner de codigo, depois espinner de modulos, depois esqueleto de dados | Tres estados de espera diferentes em sequencia, cada um com altura propria. |
| Cartoes da visao geral e itens do menu dependiam dos modulos do site e entravam **depois** do resto | O conteudo era empurrado para baixo quando a configuracao chegava (deslocamento de layout). |

O modo estrito do React **nao** era a causa e permanece ligado. Ele so dobra as
consultas em desenvolvimento; o cache agora absorve isso (ver 3.3).

## 2. O que mudou na estrutura

```
App
 └ AuthProvider                  sessao verificada uma vez, num lugar so
    └ DashboardLayout            menu e cabecalho: NUNCA desmontam ao navegar
       └ PageArea
          ├ RouteErrorBoundary   erro de uma tela nao derruba o menu
          └ Suspense (persistente)
             └ PageOutlet        recriado por endereco (e por empresa)
```

- A **moldura** (menu, cabecalho) nao depende do endereco. Ela so re-renderiza
  quando muda o que a decide: papel, modulos, plano.
- O `Suspense` e a barreira de erro ficam **fora** do que e recriado por
  endereco. E isso que mantem a tela anterior visivel enquanto a proxima chega.
- A chave por endereco continua existindo (`PageOutlet`), porque duas rotas que
  usam o mesmo componente (institucional e contato) reaproveitariam o
  formulario da anterior. Ela entra **dentro** do `Suspense`, nunca nele.
- Trocar de empresa recria a tela (a chave inclui o `tenantId`).
- Uma linha fina no topo (`NavigationProgress`) so aparece se a navegacao demorar
  mais de 180 ms. Navegacao rapida nao mostra nada.
- O codigo das telas do menu e baixado em horas vagas (`preloadWhenIdle`), e na
  hora em que o cursor ou o foco chega a um item. Fica de fora quando o
  navegador pede economia de dados.
- O HTML inicial tem o mesmo fundo e o mesmo espinner da tela de espera do
  React: a passagem de um para o outro nao se ve.
- Enquanto a configuracao do site chega, o menu mostra marcadores (mesma altura
  de um item) e a visao geral reserva o espaco com um esqueleto do desenho final.

## 3. Cache de consultas

`apps/web/src/services/queryCache.ts`. Contrato "mostra o que tem, confere por
tras" (stale-while-revalidate).

### 3.1 O que ele garante

| Situacao | Comportamento |
| --- | --- |
| Dado em cache e dentro do frescor | Mostra na hora. Nenhuma requisicao. |
| Dado em cache, passado o frescor | Mostra na hora e confere por tras. Troca so se a resposta for diferente. |
| Sem dado | Esqueleto, uma unica vez. |
| Duas telas pedem a mesma chave | **Uma** requisicao, dividida. |
| Ninguem mais espera a resposta | A requisicao e cancelada (no ciclo seguinte, para nao dobrar no modo estrito). |
| Uma escrita termina com sucesso | Tudo que esta guardado fica marcado como velho: a proxima visita confere, mesmo dentro do frescor. O dado **continua na tela**. |
| Uma consulta que ja estava em voo quando a escrita aconteceu | A resposta nasce marcada como velha. |
| Recarga manual (`reload()`) | Troca a consulta em voo por uma nova; a resposta antiga nao sobrescreve a nova. |
| Conferencia por tras falha | **O dado antigo fica e o erro aparece** (aviso "Nao foi possivel atualizar" com "Tentar novamente"). Erro nao e escondido, e dado velho nao e mostrado como se fosse atual. |
| Resposta igual a que ja estava guardada | Mesma referencia de objeto: nada e refeito. |

### 3.2 Seguranca

- O cache vive **so em memoria**. Nao ha `localStorage`, `sessionStorage` nem
  IndexedDB: a resposta de um painel multiempresa tem dado de cliente, e o disco
  sobreviveria ao logout e a troca de usuario no mesmo navegador.
- `queryCache.clear()` roda no logout, na sessao expirada e quando a conta
  conectada muda. Uma resposta que chegar depois disso e descartada.
- As chaves incluem o `tenantId`. Nada de uma empresa aparece sob outra.
- A autorizacao continua sendo do servidor em toda requisicao; o cache nao
  decide permissao.

### 3.3 Sessao

- `GET /api/auth/session` e feito uma vez na abertura (e uma so consulta mesmo no
  modo estrito, porque a em voo e compartilhada). Navegar entre telas **nao** o
  repete.
- Um `401 unauthenticated` em qualquer rota de dados limpa o cache, encerra a
  sessao no contexto e leva ao login, com aviso "Sua sessao expirou". Depois de
  entrar de novo, a pessoa volta para a tela em que estava.
- Ao voltar para a aba depois de mais de um minuto, a sessao e conferida em
  silencio. Sem isso, um painel esquecido aberto so descobriria a expiracao no
  proximo clique que precisasse de rede.

## 4. Como usar `useResource` numa tela nova

```ts
const lista = useResource(
  'bannerApi.list',                       // escopo: identifica a consulta
  () => bannerApi.list(tenantId),         // o que busca
  [tenantId],                             // parametros: tudo que a consulta usa
  { staleTime: 0 },                       // opcoes (todas opcionais)
);
```

**O escopo mais os parametros e a chave do cache.** Duas regras:

1. **Todo valor usado dentro da funcao entra nos parametros.** Faltou um, e duas
   consultas diferentes dividem a mesma resposta.
2. **Consultas diferentes precisam de escopos diferentes**, mesmo chamando a
   mesma funcao com argumentos diferentes e fixos (`'mediaApi.list'` na pagina de
   midia, `'mediaApi.list#seletor'` no seletor, que pede 60 por pagina).

| Opcao | Quando usar |
| --- | --- |
| `staleTime` (ms) | Padrao 15 s. Use `0` para o que muda por fora (contatos que chegam pelo site, contagens da visao geral): mostra o guardado e **sempre** confere. |
| `keepPrevious` (padrao `true`) | Filtro e paginacao: a lista nao some a cada tecla. Passe `false` quando a chave troca de registro. |
| `fresh: true` | O dado alimenta um **formulario de edicao aberto sobre um registro** (modal, painel). Nunca mostra o que estava guardado: comeca no esqueleto, como antes do cache. |
| `enabled: false` | Nao busca (modulo desligado, modal fechado). |

### 4.1 Formularios: o que nunca pode acontecer

Uma conferencia por tras que chega com valores novos **nao pode apagar o que a
pessoa esta digitando**. Duas formas de garantir, e uma tela de formulario usa
uma delas:

- **Modal ou painel sobre um registro** -> `fresh: true` e `keepPrevious: false`.
- **Tela inteira que e um formulario** (institucional, contato, empresa,
  documento proprio) -> o formulario guarda se foi alterado e so aplica valores
  do servidor enquanto estiver intocado. `useForm` ja faz isso:
  `syncFromServer(valores)` no efeito, `markPristine()` depois de salvar.
  Depois de salvar, os valores novos entram.

### 4.2 Estados de uma tela

`ResourcePanel` cuida dos quatro, e e o que as telas devem usar:

| Estado | Resultado |
| --- | --- |
| `initialLoading` | esqueleto |
| erro sem dado | `ErrorState` com "Tentar novamente" |
| dado | o conteudo |
| dado + erro | aviso acima do conteudo, conteudo mantido |

`refreshing` indica conferencia em curso com dado na tela; por padrao nada e
desenhado para ela.

## 5. Mobile-first

- **Grades nao se expandem pelo conteudo.** `.grid` tem uma coluna
  `minmax(0, 1fr)` por padrao (camada base); qualquer `grid-cols-*` do Tailwind
  continua mandando. Antes, uma coluna `auto` crescia ate caber a tabela mais
  larga e empurrava a pagina inteira para alem da tela.
- **Tabelas viram cartoes abaixo de `sm`.** A primeira coluna e o titulo, as
  demais aparecem com o nome da coluna ao lado, e a acao da linha (editar,
  remover) deixa de ficar fora da tela. O cabecalho continua no DOM para leitor
  de tela. Colunas com `hideOnMobile` seguem escondidas.
- O `caption` de uma tabela e `sr-only` (posicao absoluta): o contêiner que rola
  precisa ser `relative`, ou o texto invisivel ancora fora dele e alarga a
  pagina.
- Filtros ocupam a linha inteira no celular (`w-full sm:w-48`).
- Modais: `m-auto` (o reset do Tailwind zera a margem e o `<dialog>` ia para o
  canto), altura limitada a tela com cabecalho e rodape presos, margem de 16px.
- Abas e o controle segmentado rolam na horizontal em vez de quebrar linha. O
  menu do painel mestre vira uma faixa que rola.
- Gaveta do menu: o fundo nao rola por baixo e Esc fecha.
- Espacamento interno menor no celular (`p-4`), o de antes de `sm` em diante.

## 6. Limites conhecidos

- **Abrir o painel (ou F5) e uma cascata de rede**: sessao -> modulos do site ->
  dados da tela. Cada etapa depende da anterior, entao o tempo ate o conteudo e
  o de tres idas e voltas. O codigo da tela pedida ja desce em paralelo com a
  sessao, e o esqueleto ocupa o lugar do conteudo, mas o numero de idas e voltas
  e o mesmo. Reduzi-lo exigiria buscar o dado da tela antes de saber se o modulo
  esta ligado (um 403 a mais quando nao estiver) ou uma rota unica que devolva
  sessao e modulos juntos.
- O cache nao sobrevive a recarregar a pagina (de proposito, ver 3.2).
- Uma escrita feita **por outra pessoa** so aparece no proximo ciclo de
  conferencia (ao voltar a tela depois de 15 s, ou sempre, nas telas com
  `staleTime: 0`). Nao ha atualizacao em tempo real.
- O cache envelhece **tudo** a cada escrita, sem distinguir o que ela afeta. E
  conservador de proposito: custa uma conferencia por tras a mais, nunca um
  numero errado.
