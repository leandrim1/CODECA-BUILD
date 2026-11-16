# Modelo de agência — análise de viabilidade

Uma agência que desenvolve e mantém sites para os próprios clientes poderia
usar a CODECA Build para gerenciar todos eles. Este documento responde se isso
é viável, o que custa, e qual modelo comercial se sustenta.

> **Nada aqui foi implementado como produto.** Não existe plano de agência,
> preço de agência nem cobrança consolidada. O que existe é a **base
> estrutural** (seção 6), feita porque custa pouco e não fecha nenhuma porta.

## 1. O que a plataforma já faz hoje

Mais do que parece. Medido no código, não suposto:

| Necessidade de uma agência | Situação hoje |
| --- | --- |
| Vários projetos na mesma conta | **Já existe.** Uma empresa pode ter vários sites (`sites.tenant_id`) |
| Equipe com papéis diferentes | **Já existe.** Proprietário, administrador, editor e somente-leitura |
| Convidar gente por e-mail | **Já existe.** O convite cria o vínculo como `invited` e só vale quando aceito |
| Isolamento entre empresas | **Já existe e é testado.** Toda consulta é escopada pela empresa da sessão, e o banco confere o par (site, empresa) |
| Separar os projetos por cliente | **Criado nesta fase** (seção 6) |
| Cliente final com acesso próprio | **Não existe** |
| Cobrança consolidada | **Não existe** |

## 2. Os dois obstáculos reais

Não são técnicos no sentido de "difícil". São decisões de produto que ninguém
tomou ainda, e construir em cima de decisão não tomada é caro.

### 2.1 A assinatura é por SITE, não por empresa

`subscriptions_site_key` é um índice único sobre `site_id`. Uma agência com 10
clientes teria **10 assinaturas**, 10 cobranças e 10 datas de vencimento.

Consolidar exigiria mexer na integração com a ValidaPay — que as regras desta
fase proíbem alterar sem autorização, e com razão: é o caminho do dinheiro.

### 2.2 Só a CODECA IA cria sites

Não há rota para a empresa criar um projeto. Sites nascem no painel mestre,
como parte de conectar o site real.

Para uma agência isso é o oposto de autoatendimento: cada venda dela passaria
por vocês. Ou a agência ganha o direito de abrir projetos sozinha — e aí o
limite de projetos vira a régua de cobrança — ou o modelo não é de agência, é
de revenda assistida.

## 3. Os quatro modelos comerciais

| | Como cobra | A favor | Contra |
| --- | --- | --- | --- |
| **A. Plano próprio de agência** | Mensalidade fixa | Simples de anunciar | Não acompanha o custo: 3 ou 30 projetos pagam igual |
| **B. Profissional + extras** | O plano atual mais um adicional | Não cria plano novo | O Profissional foi desenhado para uma empresa, um site |
| **C. Por projeto ou cliente** | Preço por projeto ativo | **Acompanha o custo real**: cada projeto é um site, com banco, arquivos e tráfego próprios | Exige o limite de projetos, que hoje não existe |
| **D. Limites expansíveis** | Base mais pacotes | Flexível | O mais complexo de explicar e de cobrar |

**Recomendação: C, cobrança por projeto, com faixas.** É o único cujo preço
sobe junto com o que a plataforma gasta. A Fase 5 mostrou que o custo variável
é por projeto: cada site tem consultas, armazenamento e tráfego próprios.

Uma estrutura possível — **números ilustrativos, não uma proposta de preço**:
uma mensalidade base da agência, uma quantidade de projetos incluída, e um
valor por projeto adicional. Os valores só saem de dois números que ninguém
tem ainda: **o custo por projeto** (`custos-operacionais.md`, ainda sem os
dados dos painéis) e **quanto uma agência paga**, que depende de conversar com
agências.

## 4. O que faltaria construir

Em ordem de esforço, se o modelo C for escolhido:

| Peça | Esforço | Observação |
| --- | --- | --- |
| Limite de projetos no plano | Baixo | Campo novo em `plan_limits`; o padrão de validação já existe |
| A empresa criar projetos sozinha | Médio | Rota nova, com o limite acima; hoje é só do painel mestre |
| Papel "cliente final" | Médio | Papel novo com acesso a UM projeto, não à empresa inteira |
| Cobrança consolidada | **Alto** | Mexe na ValidaPay. Avaliar se uma assinatura com quantidade (`quantity`) resolve: a API aceita |
| Tela da agência | Médio | Lista por cliente, já apoiada na base da seção 6 |

A linha de **cobrança consolidada** tem um caminho promissor que vale
investigar antes de qualquer coisa: a ValidaPay aceita `quantity` num item de
assinatura. Uma agência poderia ter **uma** assinatura com quantidade igual ao
número de projetos. Isso é observação da documentação da API, **não uma
solução verificada**.

## 5. Riscos

1. **Isolamento entre clientes da mesma agência.** Hoje quem entra na conta da
   agência vê todos os projetos dela. Se o cliente final ganhar acesso, cada
   permissão precisa ser conferida por projeto, não por empresa — é a mudança
   de maior risco de vazamento de toda a proposta.
2. **Uma agência que sai leva vários clientes.** Concentração de receita.
3. **Suporte em cascata.** O cliente final reclama com a agência, que reclama
   com vocês. Sem acordo de nível de serviço, isso vira custo não previsto.
4. **O plano Essencial não cabe aqui.** Nele a CODECA IA mantém o conteúdo;
   numa agência, quem mantém é a agência. Misturar os dois confunde a venda.

## 6. A base criada nesta fase

Sem plano novo, sem preço, sem tocar em cobrança:

- **`tenant_clients`**: a empresa cadastra seus clientes (nome e contato).
  É um cadastro, **não** uma conta: sem login, sem assinatura, sem acesso.
- **`sites.client_id`**: cada projeto pode apontar para um cliente. Nulo é o
  caso normal — a empresa que usa a plataforma para o próprio site.
- **Rotas** em `/api/tenants/:id/clients` e
  `/api/tenants/:id/sites/:siteId/client`, com as capacidades `clients:read` e
  `clients:manage` (administrador e proprietário).

**A garantia de isolamento é do banco, não da rota.** A chave estrangeira é
composta — `sites(client_id, tenant_id)` → `tenant_clients(id, tenant_id)` —
então um identificador de cliente de outra agência é recusado pelo Postgres
mesmo que passasse por todas as validações da aplicação. Há teste para isso.

## 7. Recomendação final

1. **Não criar plano de agência agora.** Nenhuma agência é cliente ainda, e o
   preço depende de dois números que não existem.
2. **Conversar com três a cinco agências** antes de construir: quantos
   projetos têm, quanto pagam hoje, e se aceitariam uma fatura por projeto.
3. **Levantar o custo por projeto** (`custos-operacionais.md`).
4. **Investigar `quantity`** na assinatura da ValidaPay — pode resolver a
   cobrança consolidada sem obra nova.
5. Só então decidir entre os modelos da seção 3.
