# Menu do painel mestre

A navegação de `/plataforma`: por que virou barra lateral, como ela se
comporta em cada largura e o que não é óbvio no código.

## 1. O que mudou

Era uma faixa horizontal no topo, com os nove destinos em linha. Com nove
itens ela rolava de lado no celular, quebrava em duas linhas no tablet e, por
estar no fluxo do documento, empurrava o conteúdo para baixo em **toda** tela
do painel.

Agora é uma barra lateral presa à janela, do mesmo tipo da do painel do
cliente. Nenhuma rota mudou, nenhuma tela foi tocada e a área restrita
continua atrás de `RequirePlatformAdmin`.

| Arquivo | Papel |
| --- | --- |
| `apps/web/src/lib/menuDaPlataforma.ts` | Os nove destinos, como dado |
| `apps/web/src/components/SidebarPlataforma.tsx` | A barra: gaveta, trilho e barra inteira |
| `apps/web/src/layouts/PlatformLayout.tsx` | A moldura: barra, véu, cabeçalho do celular e conteúdo |
| `apps/web/src/hooks/useMenuRecolhido.ts` | Lembra se a barra ficou recolhida |
| `apps/web/src/hooks/useConsultaDeMidia.ts` | Media query em JavaScript, compartilhado |

## 2. Três formas, um componente

| Largura | Forma |
| --- | --- |
| Até 767px | Gaveta. Hambúrguer no cabeçalho, véu escuro, fecha ao escolher |
| 768px a 1023px | Trilho de 72px, só ícones. Nasce assim |
| 1024px ou mais | Barra de 288px, com rótulos. Nasce assim |

São estados do mesmo elemento, e não duas marcações. Duas significariam dois
lugares para esquecer de acrescentar um item de menu.

A medida da barra e a do conteúdo têm de andar juntas: a barra é `fixed` e não
ocupa espaço no fluxo, então quem reserva a faixa dela é o padding da coluna de
conteúdo — `w-72`/`md:pl-72`, `w-[4.5rem]`/`md:pl-[4.5rem]`. Mexer em uma sem
mexer na outra põe o conteúdo embaixo da barra.

### Por que o padrão depende da tela

Sem preferência guardada, a barra nasce recolhida abaixo de 1024px e aberta
acima. Uma barra de 288px sobre 1024px come quase um terço da largura útil;
forçar o mesmo no computador seria esconder rótulos de quem tem espaço de
sobra. Feita a escolha, ela vale em qualquer largura: quem recolheu no
computador quer recolhido.

### Por que `soIcones` não é uma media query

Porque não é só aparência. Recolhida, o rótulo passa a `sr-only` e a logo troca
de arquivo (a completa não cabe em 72px). São decisões de **árvore**, e o CSS
não as toma. Daí o `useConsultaDeMidia`.

O rótulo nunca sai da árvore: recolhido, ele continua sendo o nome acessível do
link. Trocar o `sr-only` por `hidden` transformaria o menu em nove ícones sem
nome — é o que o teste de componente protege.

## 3. Teclado

A barra vem **antes** do conteúdo no documento. Sem cuidado, o Tab seguinte ao
hambúrguer pularia a gaveta inteira e cairia no conteúdo atrás do véu: um menu
que o mouse abre e o teclado não alcança.

Três peças resolvem isso, sem biblioteca de armadilha de foco:

- Abrir leva o foco ao botão de fechar; fechar o devolve ao hambúrguer.
- Com a gaveta aberta, a coluna de conteúdo recebe `inert`.
- Com a gaveta fora da tela, a barra inteira recebe `inert` — do contrário os
  nove links continuariam focáveis e anunciados.

O véu é `aria-hidden` e fora da ordem do Tab. Ele fecha no clique, mas Esc e o
X já cobrem o teclado, e um botão do tamanho da janela no meio da ordem do Tab
seria só ruído — além de um segundo controle com o mesmo nome do X.

## 4. O que ficou de fora, e por quê

O selo **Área restrita da plataforma** é rótulo, não botão: ele informa onde a
pessoa está e não leva a lugar nenhum. Um galão com seta sugeriria um destino
que não existe.

O **Voltar ao painel**, que vivia no cabeçalho antigo, desceu para o rodapé da
barra. Sumir com ele seria tirar o caminho de volta ao painel da empresa.

## 5. Armadilhas

**O centro do véu está coberto pela própria gaveta.** No celular a gaveta tem
288px de 390, então o centro da janela cai dentro dela. Um teste que "clica no
véu" pelo seletor bate no ponto central e falha com `subtree intercepts pointer
events`. O toque tem de cair na faixa visível, à direita — que é onde a pessoa
toca de verdade.

**O `Button` compartilhado não aceitava `ref`.** No React 19 o `ref` é
propriedade comum de componente de função, mas precisa estar no **tipo**:
`ComponentPropsWithRef<'button'>` no lugar de `ButtonHTMLAttributes`. O
`{...rest}` já o repassava.

**Teste de componente não mora em `tests/`.** O `react` é dependência de
`apps/web`; a partir da raiz, `react/jsx-dev-runtime` não resolve. Os testes de
componente ficam ao lado do componente, e o `vitest.config.ts` inclui
`apps/**/*.test.tsx`.

**Barra de rolagem clara sobre fundo escuro.** `.rolagem-fina` usa
`slate-300`, que some num fundo `slate-900`. `.rolagem-escura` ajusta só a cor
do polegar e precisa vir **depois** no arquivo: mesma especificidade, vence a
última regra.
