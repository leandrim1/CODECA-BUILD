# Cores e contraste

Como a CODECA Build decide cor, o que a medição encontrou e por que algumas
correções não são onde se esperaria.

## 1. Onde a cor nasce

| Lugar | O quê |
| --- | --- |
| `apps/web/src/index.css`, bloco `@theme` | A paleta: marca, raios, sombras, `--color-scrim`, `--color-contorno` |
| `apps/web/src/index.css`, bloco `.dark` | O tema escuro, por redefinição de variável — sem uma classe `dark:` nas telas |
| `packages/ui/src/*` | Os componentes compartilhados: campo, botão, tabela, abas, selo, modal |

Nenhuma tela deve carregar cor fora disso. Quando a medição apontou um
problema, a correção foi no token ou no componente — não na página.

## 2. O que a medição mede

`MEDIR()` percorre a árvore e compara a cor **pintada** com o fundo efetivo.
Seis tipos de achado, cada um com o seu mínimo da WCAG 2.2 AA:

| Tipo | Mínimo |
| --- | --- |
| texto pequeno | 4,5:1 |
| texto grande (≥24px, ou ≥18,66px em negrito) | 3:1 |
| placeholder | 4,5:1 — é texto |
| borda de campo (1.4.11) | 3:1 |
| ícone sem rótulo ao lado | 3:1 |
| texto em controle desabilitado | 3:1 (a WCAG isenta; a legibilidade, não) |

O fundo é composto subindo a árvore, respeitando alfa e opacidade herdada: o
que vale é o que o olho recebe, não o que está escrito na classe.

## 3. Antes e depois

Percurso de 4 contextos (público, painel claro, painel escuro, plataforma) × 2
larguras, mais uma varredura que abre modais, menus e confirmações.

| | Antes | Depois |
| --- | --- | --- |
| Rotas | 764 ocorrências, 18 combinações | **0** |
| Sobreposições | 6 ocorrências | **0** |

### Os defeitos, por ordem de tamanho

**O branco que virava azul-escuro — 50 botões.** `--color-white` é a
superfície do cartão, e no escuro ela vira azul-marinho. Correto para
`bg-white`, errado para `text-white`: o "Salvar" ficava com texto escuro sobre
o azul da marca, 2,65:1. Era o defeito mais visível do painel escuro.

A regra **exige as duas classes no mesmo elemento** — fundo colorido e texto
branco. O botão secundário é `bg-slate-900 text-white`, e essa dupla se
inverte junta, de propósito: no escuro ele é claro com texto escuro. Uma regra
ampla demais quebraria justamente o que estava certo.

**As tintas de estado no escuro.** `bg-emerald-50` escureceu para virar fundo;
`text-emerald-700` ficou como estava. Verde-escuro sobre verde-escuro: 2,85:1
no selo "Ativo", 2,14:1 no aviso âmbar, 1,59:1 no bloco de publicação. Mesma
dupla função do azul da marca, mesmo remédio: nível 300 quando são **texto**,
nenhum fundo tocado.

**A borda de campo — 206 ocorrências.** `border-slate-300` sobre branco mede
1,49:1. A borda é o que diz "aqui se digita", e a 1.4.11 pede 3:1.
`slate-500` passaria com folga mas deixaria todo formulário pesado; daí
`--color-contorno`, em 3,27:1 no claro. No escuro ele clareia — o fundo do
campo é que é escuro — e ficou em 56% de luminosidade, não 52%, porque um
campo dentro de um bloco âmbar media 2,99:1.

**O placeholder — 2,63:1.** `slate-400` sobre branco. Virou `slate-500`.

**`text-slate-400` como texto — 398 ocorrências em 17 arquivos.** Mesma razão,
2,63:1. Subiu para `slate-500` em **toda superfície clara**. Onde ficou:
`SidebarPlataforma`, `AuthShowcase`, rodapé e `Differential` da landing — ali o
fundo é escuro e `slate-400` mede 6,96:1. Trocar seria piorar.

**O botão desabilitado.** `opacity-55` sobre o azul da marca deixava o rótulo
em 1,76:1 no claro e 1,35:1 no escuro. Agora é cinza chapado, 6,9:1 — diz
"inativo" com a mesma clareza sem exigir que o olho adivinhe. **Carregando não
é desabilitado**: um "Salvar" em andamento continua azul, com o indicador
girando.

**Recurso de plano não incluído.** Usava o mesmo ✓ do incluído, só mais claro.
Quem não distingue os dois cinzas lia "incluído" nos dois casos. Agora tem
símbolo próprio, cinza legível, e o estado também em palavras para o leitor de
tela.

## 4. Armadilhas da medição

Estas custaram uma rodada inteira de achados falsos, e todas valem para a
próxima auditoria.

**A paleta do Tailwind v4 é oklch.** `getComputedStyle` devolve
`oklch(0.208 0.042 265.755)` tal e qual. Um leitor de cor por expressão regular
de `rgba()` ignora toda superfície colorida, e a medição cai no fundo do
`body` — foi assim que "texto branco sobre barra azul-marinho" virou "branco
sobre slate-50" e inventou 130 reprovações. A conversão certa é pintar a cor
num canvas e ler os bytes: funciona para qualquer sintaxe.

**É isto que invalida o "zero reprovações" anterior.** A auditoria de contraste
da entrega do tema escuro rodou com esse leitor, só em `/painel`, só em nós de
texto e só a 1366px. O zero era do medidor, não do produto.

**Seção animada medida antes de aparecer.** As seções da landing entram com
opacidade; medidas em opacidade zero, a cor do texto se mistura com o fundo e
dá 1:1. O percurso rola a página inteira antes de medir, e elemento que o
navegador considera invisível é descartado.

**Texto em gradiente não se mede pelo `color`.** `bg-clip-text` pinta as letras
com o fundo e deixa `color: transparent`. Não é defeito.

**Checkbox e radio nativos desenham o próprio contorno.** `border-width` zero
neles não é campo sem contorno.

**O centro do véu está coberto pela gaveta.** Vale para a varredura de
sobreposições no celular: clicar "no véu" pelo seletor bate no ponto central,
que é a própria gaveta.
