# LGPD: papéis, responsabilidades e direitos do titular

Este documento responde três perguntas que aparecem cedo em qualquer venda para
agência: **quem é controlador de quê**, **o que a CODECA IA assina com o
cliente**, e **como um titular exerce os direitos dele**.

Nada aqui substitui parecer jurídico. O que está aqui é o que o **código faz**
hoje, mais a lista do que falta decidir — separado, para ninguém confundir uma
coisa com a outra.

---

## 1. Os dois chapéus da CODECA IA

A mesma plataforma trata dados em duas posições diferentes, e a distinção não é
formalidade: ela decide quem responde a um pedido do titular.

| Dados | CODECA IA é | Quem é controlador |
|---|---|---|
| Cadastro da conta: nome, e-mail, telefone, senha da pessoa que opera o painel | **controladora** | CODECA IA |
| Registros de acesso, auditoria, limites de tentativa | **controladora** | CODECA IA |
| Cobrança: nome, e-mail, documento enviados à ValidaPay | **controladora** | CODECA IA |
| Conteúdo do site do cliente: textos, imagens, equipe, depoimentos | **operadora** | a empresa cliente |
| Interessados que preenchem o formulário do site do cliente | **operadora** | a empresa cliente |
| Estatísticas do Google Analytics da conta do cliente | **operadora** | a empresa cliente |

A consequência prática: um visitante que pede a exclusão dos dados dele fala com
a **empresa dona do site**, não com a CODECA IA. A plataforma encaminha o pedido
e dá as ferramentas, mas não decide por ela. É o que a política de privacidade
já diz na seção de direitos.

## 2. Quando entra a agência: três partes, não duas

Vendendo para agência, a cadeia ganha um elo:

```
titular (visitante)
   └── empresa cliente .......... CONTROLADORA dos dados do site
         └── agência ............ OPERADORA da empresa cliente
               └── CODECA IA .... SUBOPERADORA
                     └── Vercel, Neon, Resend, ValidaPay, Google ... suboperadores
```

| Responsabilidade | Empresa cliente | Agência | CODECA IA |
|---|---|---|---|
| Definir o que é coletado no site e para quê | **sim** | apoia | não |
| Responder ao titular (acesso, correção, exclusão) | **sim** | executa no painel | fornece a ferramenta |
| Manter base legal do contato comercial | **sim** | — | registra o consentimento (`leads.consent_at`) |
| Decidir quem da equipe tem acesso | **sim** | opera os convites | aplica os papéis |
| Guardar o conteúdo e os arquivos com segurança | — | — | **sim** |
| Isolar uma empresa da outra | — | — | **sim** |
| Notificar incidente | apoia | apoia | **sim**, à ANPD e aos titulares |

**O que isso exige em contrato:** a agência precisa ter com a empresa cliente um
instrumento que a autorize a tratar os dados (um contrato de operadora), e
precisa que a CODECA IA apareça nele como suboperadora autorizada. Sem isso, a
agência está subcontratando tratamento sem previsão — e é ela quem responde.

## 3. Suboperadores em uso

Todos tratam dados por conta da CODECA IA. A lista precisa ser pública: a LGPD
dá ao titular o direito de saber com quem os dados são compartilhados.

| Serviço | Para quê | Dados que alcança | Fora do Brasil? |
|---|---|---|---|
| Vercel | hospedagem da aplicação e dos sites | tudo que trafega | sim |
| Vercel Blob | arquivos enviados ao painel | imagens e documentos do cliente | sim |
| Neon | banco de dados | todo o conteúdo e os cadastros | sim |
| Resend | e-mail transacional | nome e e-mail do destinatário | sim |
| ValidaPay | cobrança | nome, e-mail, telefone, documento do contratante | não |
| Google (OAuth e Analytics) | entrar com o Google e relatórios | e-mail e identificador; relatórios agregados | sim |

Transferência internacional existe e está declarada na política (LGPD, art. 33 e
seguintes). **O que falta:** confirmar as regiões contratadas em Vercel e Neon e
registrar aqui — hoje a política diz apenas que pode haver tratamento fora do
Brasil, o que é verdade mas é vago.

## 4. O que já existe no produto

| Direito (LGPD, art. 18) | Como se exerce hoje | Onde está no código |
|---|---|---|
| Confirmação e acesso | o painel mostra tudo o que a empresa tem | telas de conteúdo |
| Correção | edição no próprio painel | rotas de conteúdo |
| **Portabilidade (V)** | **Configurações > Empresa > Dados e privacidade > Baixar meus dados** | `GET /api/tenants/:id/dados`, `lib/privacidade.ts` |
| **Eliminação (VI)** | **a mesma tela > Excluir a empresa** | `DELETE /api/tenants/:id` |
| Informação sobre compartilhamento | seção 3 deste documento e a política | `legal/privacidade.ts` |
| Revogação de consentimento | desconectar o Google Analytics, desvincular o Google | telas de integração |

### O que a exclusão apaga, e o que fica

Apagar a empresa derruba, em cascata, as 47 tabelas que apontam para ela:
conteúdo, imagens, interessados, chaves de integração, domínios, vínculos de
usuário, importações, sincronização, assinatura e o espelho das cobranças. Os
arquivos saem do Vercel Blob **antes** do banco — se fosse ao contrário,
perderíamos a lista de URLs e as imagens ficariam públicas e órfãs.

Três coisas sobrevivem, de propósito:

1. **O registro da própria exclusão**, gravado na auditoria fora do escopo da
   empresa (`tenant_id` nulo) — é a prova de quem pediu, quando e o que foi
   removido.
2. **Os eventos já recebidos do provedor de pagamento** (`webhook_events`), que
   são o que a ValidaPay de fato enviou.
3. **A conta de quem pediu**, apenas quando ela ainda estiver ligada a outra
   empresa. Sem nenhuma, a conta vai junto.

Base: art. 16 da LGPD, e é o que a política de privacidade já afirmava.

## 5. Avaliação do DPA (contrato de tratamento)

Um acordo de tratamento entre a CODECA IA e a empresa cliente precisa cobrir os
itens abaixo. A coluna da direita diz o que **já existe** e onde.

| Cláusula exigida | Situação |
|---|---|
| Objeto, natureza e finalidade do tratamento | Coberto pelos Termos de Uso e pela política |
| Categorias de dados e de titulares | Coberto pela política (seções de dados tratados) |
| Duração | Enquanto a conta existir; retenção na seção 9 da política |
| Instruções do controlador | **Falta**: hoje não há cláusula dizendo que a CODECA IA trata o conteúdo apenas conforme instrução do cliente |
| Confidencialidade de quem acessa | Parcial: o acesso de suporte é temporário, somente leitura e auditado (`support_access_grants`), mas não há cláusula contratual |
| Medidas de segurança | Parcial: existem e estão descritas em `docs/seguranca.md`; não estão no contrato |
| Suboperadores e autorização para contratá-los | **Falta**: a lista existe (seção 3); a autorização contratual, não |
| Apoio ao controlador nos pedidos de titular | Parcial: as ferramentas existem (seção 4); o compromisso de prazo, não |
| Notificação de incidente, com prazo | **Falta** o prazo contratual; a política promete comunicar ANPD e titulares |
| Devolução ou eliminação ao fim do contrato | Coberto pela exclusão no painel + exportação |
| Auditoria e comprovação | **Falta** |
| Transferência internacional | Declarada na política; **falta** a cláusula com as garantias do art. 33 |

**Veredito:** a plataforma tem hoje os *mecanismos* de um bom DPA e não tem o
*documento*. Para vender a agências isso vira obstáculo na primeira
contratação com jurídico — um anexo de tratamento de dados é item de checklist
de compras. A redação é trabalho de advogado; o que está acima é o escopo que
ele precisa receber.

## 6. O que ainda falta (não foi inventado)

| Item | Situação |
|---|---|
| Documento de DPA assinável | Não existe. Escopo na seção 5 |
| Encarregado (DPO) nomeado e publicado | Não há. A LGPD exige indicar (art. 41); hoje a política dá um e-mail de contato |
| Regiões contratadas em Vercel e Neon | Desconhecidas; a política fala genericamente em tratamento fora do Brasil |
| Prazo automático de retenção para interessados e auditoria | Não existe: nada é apagado por idade. **É decisão do controlador**, e por isso não foi escolhido no código |
| Novo aceite quando os textos mudam | Não existe. O aceite é registrado uma vez (`terms_accepted_at`, `terms_version`) |
| Exclusão da conta pessoal sem excluir a empresa | Não existe; hoje a conta sai junto quando fica sem empresa. Quem tem outra empresa não consegue remover só a si |

## 7. Testes

`tests/integration/lgpd.test.ts` cobre, em ordem de gravidade:

1. apagar uma empresa **não** encosta na outra — conteúdo, interessados e
   arquivos da vizinha continuam lá;
2. os arquivos saem do armazenamento, e o resumo conta quantos;
3. o registro da exclusão sobrevive à exclusão, com quem pediu e o que sumiu;
4. nome exato da empresa e senha são exigidos, e sem eles nada é removido;
5. a exportação não leva hash de senha nem segredo de chave de integração;
6. quem não é proprietário não exporta nem exclui;
7. a conta de quem ficou sem empresa é removida; quem tem outra, não.
