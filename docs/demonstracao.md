# Site de demonstração da avaliação

Quem se cadastra sozinho recebe, junto com o painel, um site de demonstração
já conectado: edita no painel e vê o resultado num endereço de verdade.

## 1. O problema que isto resolve

Antes, o cadastro criava a empresa, um site em rascunho e a avaliação de 14
dias — e nenhum lugar onde ver o conteúdo. Ligar um site (emitir a chave de
integração) era ato exclusivo da CODECA IA. A pessoa cadastrava conteúdo que
não aparecia em lugar nenhum enquanto o prazo corria.

## 2. Como funciona

```
cadastro ──► empresa + site + avaliação de 14 dias   (como sempre foi)
                │
                └─► o site nasce como DEMONSTRAÇÃO:
                      • marcado (sites.is_demo)
                      • com uma chave publicável própria
                      • com exemplos, dentro do limite do plano
                      • registro do que é exemplo (sites.demo_seed)

painel ──► edita ──► banco
                       │
visitante ──► /demonstracao/<id do site>
                 └─► /api/demo/<id>/…  ──encaminha──►  /api/v1/…  (API pública)
```

**Nada é simulado.** A página de demonstração lê pela API pública, com a chave
do próprio site. O conteúdo passa pela mesma autenticação, pela mesma
conferência de assinatura e pelo mesmo cache de um site real.

### Criação automática

Acontece dentro da transação do cadastro (`lib/company.ts` → `lib/demo.ts`),
nos dois caminhos: e-mail e senha, e Google. Empresa, site, avaliação e
demonstração são criados juntos ou não são criados.

| O quê | Detalhe |
| --- | --- |
| Marca | `sites.is_demo = true`. Nunca vem do navegador |
| Chave | Publicável (só leitura), uma por site, autorizada só para o endereço da plataforma |
| Módulos | Institucional, Contato, Banners e Serviços garantidos, além dos do segmento padrão |
| Exemplos | 1 banner e 2 serviços, e um texto de apresentação se a empresa não tiver um |
| Limite | Os exemplos nunca passam de "limite do plano − 2": sobram vagas para o cliente criar os dele. Na avaliação (5 conteúdos), são 3 exemplos e 2 vagas |
| Nome | O da própria empresa, como informado no cadastro |

**Sem depoimentos de exemplo, de propósito:** um depoimento fictício é uma
avaliação inventada, mesmo num ambiente de teste.

**A demonstração nunca impede um cadastro.** Se o endereço da plataforma
(`APP_URL`) não for aceito como origem, o cadastro segue sem demonstração, com
aviso no log.

**Empresa criada pela CODECA IA no painel mestre não recebe demonstração:** é
um projeto real.

### O que o cliente vê

- **Visão geral:** o cartão "Seu ambiente de demonstração está pronto!", com os
  três passos (editar, ver, fazer do seu jeito), o botão "Ver meu site de
  demonstração", os dias restantes da avaliação e o próximo passo para ter o
  site de verdade.
- **Site de demonstração:** página pública com faixa fixa no topo dizendo que é
  uma demonstração, o botão "Atualizar" e o link de volta ao painel. Mostra
  banner, serviços, apresentação, depoimentos, equipe, perguntas e contato —
  cada seção só aparece se houver conteúdo.

### Quanto tempo leva para a alteração aparecer

A API pública guarda respostas por poucos segundos. A página relê sozinha
quando a pessoa volta para a aba, e tem o botão "Atualizar". Rascunho não
aparece: vale a regra de publicação de qualquer site.

## 3. Regras da avaliação: nada muda

- A demonstração **usa a assinatura de avaliação que o cadastro já criava**.
  Não cria prazo, não renova, não reinicia.
- Ver o site não altera a assinatura.
- No 15º dia a API pública responde 402 e a página mostra "o período de
  avaliação terminou", com o caminho para contratar. O conteúdo continua salvo.
- Quem paga volta a ver o site. Pagar **não** transforma a demonstração em site
  real: isso é a transição (seção 5).
- O painel experimentado é o dos planos Profissional e Empresas. O Essencial
  não tem painel, e isso é dito no cartão de boas-vindas, na página inicial e
  — agora — na hora de contratar.

## 4. Segurança e isolamento

| Regra | Como é garantida |
| --- | --- |
| Uma empresa não vê a demonstração de outra pelo painel | As rotas do painel resolvem o site a partir do vínculo da sessão com a empresa; trocar o identificador dá 404 |
| O site de uma não mostra conteúdo de outra | Quem decide o que a API pública devolve é a **chave**, que pertence a um site e a uma empresa. O identificador no endereço só serve para achar a chave |
| Chaves não são compartilhadas | Uma chave por site, emitida no cadastro |
| A chave não chega ao navegador | O encaminhamento é feito no servidor; a resposta leva só o corpo e o status |
| A chave não serve no site de um terceiro | É publicável e só vale para a origem da plataforma |
| Só leitura, e só do que a página mostra | Lista fechada de leituras; qualquer outro caminho ou método responde 404. Interessados (leads) nunca |
| A demonstração não dá privilégio | Nenhuma rota dela passa por sessão; nada administrativo é alcançável |
| Não revela quais sites existem | Identificador inválido, inexistente, de site real ou de demonstração encerrada: a mesma resposta 404 |
| Excluir a empresa limpa tudo | Site, chave, origem e exemplos saem em cascata, pelo fluxo de exclusão existente (que cancela a cobrança antes) |

**O que é público:** o site de demonstração pode ser aberto por qualquer pessoa
que tenha o endereço, como qualquer site. O identificador é longo e aleatório,
mas não é segredo. O cartão de boas-vindas diz que é um ambiente de teste.

## 5. Transição para o site real

Quem conecta sites reais é a CODECA IA, pelo painel mestre. A demonstração
acrescenta um passo a esse fluxo, e ele é o último.

1. O cliente contrata, e a CODECA IA desenvolve o site.
2. No painel mestre, no site do cliente: ajusta segmento e módulos, cadastra a
   origem (o endereço do site real) e **emite a chave de integração do site
   real**.
3. Com o site real funcionando, no mesmo painel aparece o aviso "Este site é
   uma demonstração da avaliação", com o que vai acontecer:
   - quantos exemplos o cliente **não alterou** (podem sair);
   - quantos ele **editou** (passaram a ser dele, e ficam);
   - tudo o que ele cadastrou por conta própria fica.
4. "Encerrar a demonstração" → confirmação, com a opção de remover os exemplos
   intocados.

### O que a transição garante

| Situação | Comportamento |
| --- | --- |
| Site real ainda sem chave | **Recusa.** Encerrar deixaria o cliente sem site nenhum |
| Sem confirmação explícita | Recusa |
| Exemplo que o cliente nunca editou | Removido **só** se a remoção for marcada |
| Exemplo que o cliente editou | Mantido, sempre |
| Conteúdo criado pelo cliente | Mantido, sempre |
| Texto de apresentação reescrito pelo cliente | Mantido |
| Falha em qualquer passo | Nada muda: tudo acontece numa transação. A demonstração continua no ar e a transição pode ser repetida |
| Encerrar duas vezes | A segunda é recusada e não apaga nada |
| Depois de encerrar | A chave da demonstração é revogada, a plataforma deixa de ser origem autorizada do site, o endereço de demonstração responde 404 e `is_demo` volta a `false`. O registro do que foi exemplo fica, com a data |

"Nunca editou" quer dizer: a data de alteração do registro é igual à de
criação.

### Decisões que continuam com você

- **Quem encerra.** Hoje, só a CODECA IA. O cliente não tem botão para isso.
- **Quando encerrar.** O sistema exige apenas que a chave do site real exista;
  conferir que o site real está de fato no ar é ato de quem encerra.
- **Contas que já existiam** antes desta mudança não ganham demonstração.

## 6. Limitações conhecidas

- Os exemplos não têm imagens: a seção de destaque usa cor, e a marca é a
  inicial da empresa. Imagens enviadas pelo cliente em banners e serviços não
  são exibidas pela página de demonstração nesta versão.
- A página mostra banner, serviços, apresentação, depoimentos, equipe,
  perguntas e contato. Imóveis, obras, produtos, galerias e módulos próprios
  são editáveis no painel, mas ainda não têm seção na demonstração.
- O site de demonstração é um modelo único, igual para todos: mostra como o
  painel funciona, não como ficará o site sob medida.
- A demonstração é pública para quem tiver o endereço.

## 7. Suporte

| O cliente diz | O que conferir |
| --- | --- |
| "Editei e não mudou" | O conteúdo está publicado (não rascunho)? Usou "Atualizar"? O banner está ativo? |
| "O site sumiu" | A avaliação venceu (a página diz isso)? A demonstração foi encerrada? |
| "Não tenho o botão do site" | A conta é anterior a esta mudança, ou foi criada pelo painel mestre |
| "Não consigo cadastrar mais" | Limite de conteúdos da avaliação: excluir um exemplo libera a vaga |
| "Quero meu site de verdade" | Contratar em Plano e assinatura; a CODECA IA inicia o projeto |

## 8. Onde está no código

| Peça | Arquivo |
| --- | --- |
| Criação, credencial e transição | `apps/api/src/lib/demo.ts` |
| Rotas (visitante, cliente, painel mestre) | `apps/api/src/routes/demo.ts` |
| Chamada no cadastro | `apps/api/src/lib/company.ts` |
| Colunas | `packages/database/migrations/0029_site_de_demonstracao.sql` |
| Página pública | `apps/web/src/pages/DemoSitePage.tsx` |
| Boas-vindas e transição | `apps/web/src/dashboard/DemoPanels.tsx` |
| Testes | `tests/integration/site-de-demonstracao.test.ts` |
