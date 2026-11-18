# Controles da interface

Padrão de botões, interruptores e campos da CODECA Build, e o que a auditoria
de 18/11/2026 encontrou.

Tudo nasce de `packages/ui/src`. Nenhuma tela define botão ou interruptor
próprio: corrigir o componente corrige as 33 rotas de uma vez.

## 1. Onde cada controle mora

| Controle | Arquivo |
| --- | --- |
| `Button`, `IconButton` (`size="icon"`) | `packages/ui/src/Button.tsx` |
| `Switch`, `Checkbox`, `Select`, `TextInput`, `TextArea`, `RangeInput`, `ColorInput` | `packages/ui/src/Field.tsx` |
| `Tabs`, `SegmentedControl` | `packages/ui/src/Tabs.tsx` |
| `Modal`, `ConfirmDialog` | `packages/ui/src/Modal.tsx` |
| `DataTable`, `Pagination` | `packages/ui/src/Table.tsx` |
| `Card`, `PageHeader`, `Badge`, `Alert`, `Meter` | `packages/ui/src/Surface.tsx` |
| Notificações | `packages/ui/src/Toast.tsx` |

## 2. Medidas

| Item | Valor |
| --- | --- |
| Altura do botão | `sm` 32px, `md` 40px, `lg` 48px, `icon` 36×36 |
| Raio | `rounded-xl` no botão, `rounded-2xl` no cartão |
| Espaço entre ícone e texto | `gap-1.5` / `gap-2` / `gap-2.5`, conforme o tamanho |
| Interruptor | trilha 44×24, indicador 20×20, folga de 2px em volta |
| Percurso do indicador | 20px (44 − 20 − 2 − 2) |
| Alvo mínimo de toque | 24px (WCAG 2.2 AA) |
| Curva de animação | `--ease-out-soft`, 200ms |

Outras alturas que aparecem na tela e **não** são inconsistência: 24px é a
trilha do interruptor, 28px o `SegmentedControl`, 46px as abas e 58px o
seletor de empresa.

## 3. Estados

Medidos em navegador, não presumidos:

| Estado | Botão |
| --- | --- |
| Repouso | cor da variante, ponteiro de mão |
| Hover | fundo um passo mais escuro (ou mais claro no `outline`) |
| Foco | contorno sólido de 2px em `brand-600`, com 2px de afastamento |
| Pressionado | `scale(0.99)` |
| Desabilitado | opacidade 0,55, cursor `not-allowed`, sem recuo ao clicar |
| Carregando | giro no lugar do ícone, e o botão fica desabilitado |

O ícone de um botão vai na **prop `icon`**, não como filho: é assim que o giro
substitui o ícone em vez de aparecer ao lado dele.

## 4. Os três defeitos encontrados

### 4.1 O indicador do interruptor saía da trilha

O mais grave, e o que estava visível em toda a plataforma.

O indicador era `position: absolute` **sem `left`**. Sem `left`, o navegador
usa a *posição estática* — e a trilha é um `<button>`, que o navegador alinha
ao centro. A posição estática resolvia em `left: 22px`, o meio dos 44px:

| Estado | left | translate | Indicador na trilha de 44px |
| --- | --- | --- | --- |
| Desligado | 22px | +2px | 24…44 — colado na borda direita |
| **Ligado** | 22px | +22px | **44…64 — inteiramente fora** |

Em *Plataforma › Sites › Módulos e campos*, **151 dos 160** interruptores
estavam com o círculo branco solto, 20px à direita da trilha azul.

A correção é `left-0.5` no indicador e percurso de `translate-x-5` (20px).

### 4.2 O botão de ícone deformava

`size="icon"` é `h-9 w-9`, mas sem `shrink-0` ele encolhia como qualquer item
flexível. No cabeçalho do modal, com título longo a 360px, virava 36×22,8 — uma
elipse, abaixo do alvo mínimo de toque. Resolvido no componente.

### 4.3 Nenhum botão tinha ponteiro de mão

O preflight do Tailwind v4 deixou de dar `cursor: pointer` ao `<button>`, que o
v3 dava. O projeto foi escrito contra o v3 — o `Button` traz
`disabled:cursor-not-allowed`, que só faz sentido contrastando com um ponteiro
no estado normal, e `Switch` e `DataTable` tiveram de pedir `cursor-pointer` à
mão. Sem isso, **todo** botão exibia a seta e parecia inerte.

Resolvido com uma regra em `@layer base` no `index.css`, sem `!important`.

Também corrigido: o × das notificações tinha alvo de 20×20, abaixo dos 24px.

## 4.4 A barra de rolagem do menu lateral

O menu tem mais opções do que cabe na tela. A barra padrão do navegador mede
**16px** (medido) com trilho cinza sólido — larga ao lado de um menu de 288px.
A classe `.rolagem-fina` a deixa em **6px**, trilho transparente e polegar
arredondado em `slate-300` (`slate-400` no hover).

A armadilha, que decidiu a implementação: **o Chrome ignora
`::-webkit-scrollbar` se `scrollbar-width` OU `scrollbar-color` estiver
definida.** Não adianta declarar as duas abordagens e esperar a mais fina.
Medido no mesmo navegador:

| Abordagem | Largura |
| --- | --- |
| Padrão do navegador | 16px |
| `scrollbar-width: thin` | 11px |
| `::-webkit-scrollbar { width: 6px }` | **6px** |

Por isso um `@supports selector(::-webkit-scrollbar)` manda cada navegador por
um caminho só: Firefox fica nas propriedades padrão, Chrome e Safari voltam
`scrollbar-width`/`scrollbar-color` para `auto` e usam as regras webkit.

A barra continua **visível**, ao contrário do `[scrollbar-width:none]` das
abas: escondê-la num menu vertical tiraria a pista de que há mais opções
abaixo da dobra.

Para medir isto é preciso navegador com janela (`xvfb-run` com
`headless: false`): no Chromium headless a barra é sobreposta, ocupa 0px de
layout e não aparece na captura.

## 5. Ação duplicada

`useMutation` (`apps/web/src/hooks/useResource.ts`) tem uma trava **síncrona**
(`inFlight`), não apenas o `disabled`. Dois cliques no mesmo quadro não enviam
a operação duas vezes, mesmo que o React ainda não tenha redesenhado o botão.
Isso já existia e continua valendo.

Botões de ação única mostram o giro (`loading`). Botões que **dividem** uma
ação — dois tipos de chave, ou uma coluna de ações numa lista — ficam só
desabilitados: girar todas as linhas enquanto uma salva seria mentira.

## 6. Como reauditar

Os roteiros de auditoria não fazem parte da aplicação; ficam no diretório de
trabalho da sessão. O que eles medem, para quem quiser refazer:

1. Percorrer as rotas dos dois painéis em 360, 390, 768, 1024, 1366 e 1920px.
2. Em cada uma, conferir: controle fora da janela ou do cartão, sobreposição,
   alvo menor que 24px, desabilitado sem `not-allowed`, rolagem lateral.
3. Nos interruptores, conferir folga do indicador nos dois estados (2/22 e
   22/2), centralização vertical e tamanho 44×24.
4. Abrir os formulários de criação e as abas da configuração do site, porque
   boa parte dos controles só existe depois de um clique.

**Armadilhas que geram falso positivo** e que o roteiro precisa excluir:

- a gaveta fechada do menu no celular (fica fora da tela, à esquerda);
- rótulos `sr-only`, que têm 1px de largura;
- abas e `SegmentedControl`, que rolam na horizontal de propósito;
- o fundo de um `<dialog>` aberto, que o navegador torna inerte;
- o miolo rolante do modal passando sob o rodapé preso.

Sem essas exclusões a auditoria acusa milhares de problemas inexistentes.

## 7. O que não foi alterado

Paleta, logotipo, tipografia, raios, sombras, espaçamentos e textos. Nenhuma
regra de negócio, permissão, assinatura ou integração financeira. Nenhum
componente novo foi criado e nenhum foi removido.
