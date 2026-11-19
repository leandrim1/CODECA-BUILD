# Guia de primeiro acesso

O que a CODECA Build mostra a quem abre o painel pela primeira vez: a lista de
primeiros passos, o tour de boas-vindas e as telas vazias que explicam para que
serve cada seção.

## 1. As peças

| Arquivo | Papel |
| --- | --- |
| `apps/web/src/lib/primeirosPassos.ts` | Os cinco passos e a função pura que calcula o progresso |
| `apps/web/src/lib/tourDoPainel.ts` | Os cinco passos do tour, com o alvo de cada um |
| `apps/web/src/components/OnboardingChecklist.tsx` | O cartão no topo da visão geral |
| `apps/web/src/components/OnboardingTour.tsx` | O recorte, o balão e o teclado |
| `apps/web/src/hooks/useGuiaDePrimeiroAcesso.ts` | Os dois marcos e como desfazê-los |
| `packages/shared/src/onboarding.ts` | O que conta como "preenchido" |
| `packages/database/migrations/0032_onboarding_do_cliente.sql` | As duas datas em `users` |

## 2. O progresso não é guardado

Cada passo pergunta aos **dados reais do site** se já foi feito. Um progresso
gravado descola do mundo no primeiro conteúdo apagado, e passa a dizer "feito"
sobre um site vazio.

O que se guarda em `users` é só o que a pessoa **dispensou** — e como data, não
como booleano: a data responde se aconteceu e quando, enquanto o par
booleano+data pode divergir, e divergindo não há como saber qual dos dois está
certo. Fica na pessoa, não na empresa: quem já fez o tour não o refaz ao entrar
na segunda empresa.

### "Preenchido" não é "existe"

Duas regras que uma contagem não dá, e por isso vivem em `@codeca/shared`:

**Institucional.** O `companyName` já vem preenchido quando o site é criado.
Contá-lo marcaria o primeiro passo como concluído antes de a pessoa escrever a
primeira linha — o guia abriria com um passo pronto que ela não fez. Conta
qualquer campo além dele.

**Contato.** Só telefone, e-mail ou WhatsApp. Endereço e horário sozinhos não
atendem quem quer pedir um orçamento, e o passo se chama "diga como falar com
você".

**Domínio.** Só o que está `active`. Um cadastro pendente de DNS não põe o site
no ar, e marcar o passo ali faria a pessoa parar justamente quando falta a
parte dela.

### Passo fora do alcance sai do total

Um editor sem acesso a domínios veria "4 de 5" para sempre. O passo que a
capacidade não alcança não aparece **nem conta**.

## 3. O tour, e por que é feito à mão

A conta contra `driver.js` e `react-joyride`: a biblioteca resolveria o
**posicionamento**, e só. O balão teria de ser repintado com os tokens do tema
de qualquer forma — sobrescrevendo as classes de um terceiro, que é a pior
espécie de acoplamento — e nenhuma das duas entrega a folha inferior que o
celular pede. Sobrariam as ~90 linhas de geometria, agora com uma dependência a
mais no pacote.

O destaque é um **recorte por quatro retângulos** (acima, abaixo, esquerda e
direita do alvo), e não uma máscara SVG: quatro divs com `--color-scrim`
funcionam em qualquer navegador e já são escuros nos dois temas.

Os alvos saem de `data-tour`, e o da barra lateral é derivado do id do grupo
(`grupo-site`, `grupo-relacionamento`): um grupo novo não precisa ser declarado
em dois lugares, e renomear o título não quebra o tour.

**Alvo que não está na tela vira cartão central.** No celular a barra é uma
gaveta fechada: o elemento existe mas está fora da janela. Destacar o que a
pessoa não vê apontaria para o nada; o texto continua ensinando onde a coisa
fica.

O tour abre **só na visão geral**: dois dos cinco passos apontam para
elementos que só existem ali, e quem entrou por um link direto para uma tela de
trabalho não deve ser interrompido.

## 4. Armadilhas que custaram tempo

**A sombra local que nunca saía.** O hook é usado em dois lugares — a visão
geral e o menu de ajuda — e cada um tem a sua cópia de estado. A visão geral
guardava "dispensei" na sombra dela; o menu gravava o desfazer no servidor e
limpava só a própria. A visão geral continuava preferindo a sombra velha, e
"Ver primeiros passos" não trazia o cartão de volta. A sombra agora é
descartada quando a sessão traz valor novo.

**`data-tour` num componente que não repassa props.** `<Card data-tour="...">`
compila: o TypeScript **não confere atributos JSX com hífen**. Mas `Card` não
espalha props soltas, o atributo some na renderização e o tour aponta para um
alvo inexistente — sem erro em lugar nenhum. O atributo fica num elemento de
verdade.

**`pnpm -s` esconde os erros do `tsc`.** O `-s` silencia a saída do script, e
`tsc` escreve em stdout. Somado a `| tail; echo ok`, que lê o código de saída do
`tail` e não o do `pnpm`, isso produz "ok" com erro de tipo no código. Rode
`pnpm typecheck` sem `-s` e leia `$?`. **Este projeto não tem script `lint`** —
um `pnpm lint` falha com "command not found", e com `-s` isso passa despercebido.

**O harness local e a verificação de origem.** O servidor de teste fixa
`APP_URL` como `http://localhost:4010`; acessar por `http://127.0.0.1:4010` é
outra origem, e **toda** escrita autenticada responde 403 — inclusive rotas
antigas, como `PATCH /api/auth/profile`. Use o mesmo nome de host.

**Contextos de teste compartilham o usuário.** Com as escritas funcionando, o
primeiro contexto concluía o tour e o segundo já o encontrava concluído. O
percurso desfaz os dois marcos antes de cada contexto — e o reset é, de quebra,
uma conferência da rota que o menu de ajuda usa.

## 5. O que foi medido

Percurso em navegador real, nos quatro contextos (computador e celular ×
claro e escuro): **76 conferências, zero falhas**. Cobre o tour abrindo no
primeiro acesso, os cinco passos pelo teclado, o foco entrando no balão,
concluir sem o tour voltar, o checklist acima dos indicadores, dispensar,
reabrir pelo menu de ajuda, contraste em cada tela e ausência de erro no
console.
