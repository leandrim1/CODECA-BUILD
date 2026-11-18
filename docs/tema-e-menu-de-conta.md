# Tema e menu de conta

Como funcionam o menu de conta do painel e o tema claro/escuro, e as decisões
que não são óbvias no código.

## 1. O menu de conta

Fica em `apps/web/src/components/AccountMenu.tsx`, ancorado no seletor de
empresa que já existia no topo da barra lateral. Não foi acrescentado um
segundo controle: o seletor já era o lugar onde a pessoa procura "quem sou eu,
onde estou", e dois controles na mesma região seriam dois cliques para a mesma
pergunta.

Estrutura, de cima para baixo:

| Seção | O quê |
| --- | --- |
| Empresas | A lista que já existia, com o selo de situação |
| Pessoa | Nome, e-mail e engrenagem para **Segurança da conta** |
| Tema | Sistema, Claro, Escuro, em três ícones |
| Página inicial | Abre o site da plataforma em outra aba |
| Sair | Encerra a sessão |
| Plano | "Fazer upgrade", ou "Gerenciar plano" para quem já está no Empresas |
| Situação | Lida de `/api/health`, não fixa no código |

### O que ficou de fora, e por quê

O menu da Vercel tem **Feedback**, **Changelog** e **Ajuda**. A CODECA Build
não tem nenhuma das três: não há rota, página nem endereço externo para elas.
Um item de menu que não leva a lugar nenhum é pior que item nenhum, então os
três ficaram de fora até existir destino. **Documentação** caiu pelo mesmo
motivo: `/api/openapi.json` responde 404 em produção.

O botão de plano só aparece para quem tem `billing:read`. O menu respeita as
mesmas capacidades do resto do painel.

## 2. O tema

`apps/web/src/hooks/useTheme.tsx`. Três preferências — `sistema`, `claro`,
`escuro` — guardadas em `localStorage` sob `codeca:tema`. Em `sistema`, segue
`prefers-color-scheme` e acompanha mudanças com a aba aberta.

**Não é `next-themes`.** Este projeto é Vite + React Router, não Next.js: não
há servidor renderizando HTML, logo também não há `suppressHydrationWarning` a
fazer. O equivalente é o roteiro inline no `<head>` do `index.html`, que
escreve a classe antes da primeira pintura — antes de o React existir.

**Vale só em `/painel`.** A página pública foi desenhada em claro e o painel
mestre já é escuro; aplicar a classe fora do painel quebraria os dois. A classe
entra e sai conforme a rota, e o roteiro inline testa o mesmo prefixo.

## 3. Como o modo escuro alcança todas as telas

**Não há uma classe `dark:` sequer nas telas.** Isso é intencional.

No Tailwind v4 toda utilidade de cor compila para `var(--color-*)`:

```css
.bg-white { background-color: var(--color-white) }
.text-slate-900 { color: var(--color-slate-900) }
```

Então redefinir as variáveis sob `.dark` vira as **1157 ocorrências de cor dos
74 arquivos** do painel de uma vez. O caminho alternativo — anotar `dark:` em
cada uma — seriam milhares de linhas, cada uma uma chance de erro, e nenhuma
garantia de cobertura.

O bloco `.dark` fica **fora de `@layer`** por necessidade: o `@theme` do
Tailwind emite as variáveis em `@layer theme`, e estilo sem camada vence
estilo em camada, qualquer que seja a ordem no arquivo.

### O que foi invertido, e o que não

| Famílias | Decisão |
| --- | --- |
| `slate` e `white` | Invertidas. São a estrutura e não carregam significado — 858 das 1157 ocorrências |
| As tintas `-50` (`brand`, `emerald`, `rose`, `amber`, `sky`) | Escurecidas. Conferidas uma a uma: só aparecem como **fundo** |
| O resto de `brand`, `rose`, `amber` | **Intocado** |

O motivo do "intocado" é **dupla função**: o mesmo token serve de texto num
lugar e de fundo em outro. `text-brand-700` aparece 26 vezes e `bg-brand-700`
5; `bg-rose-600` é o botão de excluir e `text-rose-600` é a mensagem de erro.
Mexer na variável conserta um papel e quebra o outro.

A saída foi separar **pelo papel, não pela cor**: uma regra que atinge só as
utilidades de texto.

```css
.dark .text-brand-600,
.dark .text-brand-700,
.dark .link { color: var(--color-brand-300); }
```

Nenhum fundo é tocado, e nenhuma das 37 chamadas espalhadas pelas telas
precisou de uma classe `dark:`.

### O logotipo

A logo padrão tem o texto escuro e sumia no painel escuro. A versão de texto
branco (`/brand/logo-branca.webp`) já existia: o layout passa o `tone` conforme
o tema.

## 4. O que foi medido, e não suposto

A escolha das cores do escuro não foi feita a olho. Um roteiro percorre as 24
rotas do painel, lê a cor **pintada** de cada nó de texto e o fundo efetivo, e
calcula a razão de contraste da WCAG 2.1 (mínimo 4,5:1, ou 3:1 para texto
grande).

A primeira medição reprovou **43 textos em 24 rotas**, e o agrupamento mostrou
que eram **duas cores só** — `brand-700` a 2,16:1 e `brand-600` a 2,81:1. Daí
saiu a regra acima. Uma segunda rodada ainda pegou 13, todos vindos da classe
`.link`, que aplica a cor por `@apply` e por isso escapava do seletor por
utilidade.

Resultado final: **zero reprovações**, no claro e no escuro, incluindo os seis
tons de selo (que não aparecem nas telas vazias da base de teste e precisaram
ser medidos à parte, com as classes reais de `Surface.tsx`).

## 5. Armadilhas que custaram tempo

**O `transform` da gaveta.** No celular a folha do menu precisa vir do rodapé
da janela. A barra lateral tem `transition-transform`, e um elemento com
`transform` vira bloco de contenção para os `fixed` de dentro dele — a folha se
ancorava na barra de 288px em vez da janela (medido: 287px de largura numa tela
de 390px). A solução é um portal para o `body`. O evento de teclado continua
chegando porque o React faz eventos de portal subirem pela árvore de
**componentes**, não pela do documento.

**O manipulador de teclado no lugar errado.** Ele estava no painel do menu, que
não é ancestral do gatilho: com o foco ainda no gatilho recém-clicado, as setas
não chegavam nele. Subiu para o contêiner.

**O véu engolindo o próprio clique.** No celular o véu cobre a tela inteira,
inclusive o gatilho do menu. Fechando no `pointerdown`, ele desmontava **antes**
do `click` — e o clique caía no gatilho que estava embaixo, reabrindo o menu no
mesmo toque. A pessoa tocava a seta e nada parecia acontecer. O véu fecha no
`click` dele, e o manipulador de `pointerdown` o ignora: assim ele continua
montado até o clique, que então é dele e de mais ninguém.

A trilha de eventos que mostrou isso, com o defeito presente:

```
pointerdown -> Fechar menu da conta   (o véu)
click       -> menu                   (o gatilho, por baixo)
```

Vale para qualquer sobreposição que cubra o controle que a abriu. Reproduzir
exige contexto de **toque** (`hasTouch: true`): com ponteiro de mouse o
Playwright não expõe a mesma sequência.

**O véu branco.** Um véu não pertence à escala `slate`: ela se inverte no
escuro, e `bg-slate-900/40` virava um véu claro lavando o que estava atrás.
Existe `--color-scrim` para isso, escuro nos dois temas. A auditoria de
contraste não pega esse tipo de defeito — ela mede texto, não camadas; quem
pega é a varredura de superfícies claras e grandes num painel escuro.

**Barra sobreposta no headless.** Para medir qualquer coisa de barra de
rolagem é preciso navegador com janela (`xvfb-run` com `headless: false`): no
Chromium headless a barra é sobreposta, ocupa 0px e não aparece na captura.
