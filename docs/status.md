# Status das funcionalidades

O que esta implementado e funcionando contra o banco, o que depende de
configuracao externa para funcionar e o que nao foi implementado. Nada aqui esta
marcado como concluido por existir apenas na interface.

Legenda:

- **Pronto** — implementado de ponta a ponta, persistindo no Neon, com teste
  automatizado ou verificavel no fluxo completo.
- **Pronto, depende de credencial** — o codigo esta completo; sem a variavel de
  ambiente o recurso se recusa a operar e diz por que (nunca finge sucesso).
- **Nao implementado** — fora do escopo entregue; descrito aqui para nao ser
  confundido com o que existe.

## Fundacao

| Item | Status | Observacao |
| --- | --- | --- |
| Monorepo pnpm (`apps/*`, `packages/*`) | Pronto | TypeScript estrito em todos os pacotes |
| Schema no Neon com 42 tabelas | Pronto | UUIDs, timestamps, enums, FKs, indices; isolamento `(site_id, tenant_id)` conferido pelo banco |
| Migracoes versionadas | Pronto | `packages/database/migrations`, aplicadas tambem nos testes |
| Migracoes aplicadas no deploy | Pronto | o build de producao na Vercel aplica as pendentes e falha se alguma quebrar |
| Planos padrao em instalacao nova | Pronto | criados apenas com a tabela vazia; nunca sobrescrevem ajustes do painel |
| Primeiro administrador sem passo manual | Pronto | a primeira conta cadastrada assume o painel mestre, uma unica vez |
| Seed de planos / admin / demonstracao | Pronto | `pnpm db:seed` |
| Conexao com transacoes | Pronto | driver `neon-serverless`; cadastro de site, troca de modulos e emissao de chave sao atomicos |
| `.env.example` sem credenciais reais | Pronto | somente nomes e exemplos ficticios |

## Contas, acesso e isolamento

| Item | Status | Observacao |
| --- | --- | --- |
| Cadastro de empresa + proprietario | Pronto | cria empresa, site com os modulos do segmento padrao e assinatura de avaliacao |
| Login, logout, sessoes ativas, encerrar outras sessoes | Pronto | token opaco, cookie HttpOnly |
| Verificacao de e-mail | Pronto, depende de credencial | sem `RESEND_API_KEY` o link vai para o log do servidor |
| Recuperacao de senha | Pronto, depende de credencial | idem |
| Convite de colaboradores | Pronto, depende de credencial | o vinculo e criado no banco; o e-mail depende da chave |
| Papeis `owner`/`admin`/`editor`/`viewer` | Pronto | capacidades verificadas no backend |
| `platform_admin` separado dos papeis de empresa | Pronto | ser admin de empresa nao da acesso global |
| Isolamento entre empresas | Pronto | `tests/integration/isolation.test.ts` troca IDs e espera 404 |
| Acesso de suporte explicito, temporario e auditado | Pronto | `support_access_grants`, somente leitura |
| Autenticacao em dois fatores | Nao implementado | — |

## Painel do cliente

| Item | Status | Observacao |
| --- | --- | --- |
| Visao geral com indicadores | Pronto | contagens vindas do banco; os cartoes seguem os modulos do site |
| Menu que se adapta aos modulos do site | Pronto | dois filtros: papel de quem entrou e modulos do projeto |
| Institucional e contato (documento unico) | Pronto | formulario montado a partir dos campos que a API declara |
| Banners | Pronto | ordem, periodo de exibicao e ativo/inativo |
| Imoveis (CRUD, filtros, paginacao, galeria) | Pronto | status de publicacao separado do status comercial |
| Obras e projetos (CRUD, etapas, atualizacoes com fotos) | Pronto | percentual aparece somente quando informado |
| Servicos | Pronto | ordenacao e publicacao por item |
| Produtos | Pronto | preco, unidade, codigo interno, categoria, capa e galeria; esgotado sem despublicar |
| Categorias de produto | Pronto | planas; remover nao apaga produto, so o deixa sem agrupamento |
| Galerias | Pronto | conjuntos de imagens; a primeira da ordem e a capa |
| Depoimentos | Pronto | modulo proprio; publicar exige a autorizacao do autor, conferida tambem na leitura publica |
| Equipe do site | Pronto | modulo proprio, separado de "Usuarios e permissoes", que e quem acessa o painel |
| Perguntas frequentes | Pronto | modulo proprio, com agrupamento livre |
| Biblioteca de imagens | Pronto, depende de credencial | sem `BLOB_READ_WRITE_TOKEN` o envio e recusado com aviso |
| Interessados (filtros, status, observacoes internas) | Pronto | — |
| Exportacao de interessados em CSV | Pronto | recurso de plano (`lead_export`) |
| Dominio proprio | Pronto, **mas em revisao** | o codigo registra o dominio no projeto Vercel **da plataforma** (`lib/vercel-domains.ts`), que era o que servia o renderizador removido na etapa 0. Hoje o site do cliente e um projeto Vercel dele, e o dominio deveria ser apontado la. Ver a nota no fim desta secao |
| Campo travado pela CODECA IA aparece como leitura | Pronto | com explicacao de por que esta travado |
| Campos personalizados do projeto no formulario | Pronto | definidos pela CODECA IA por site e modulo; entram na mesma lista dos campos tipados |
| Equipe e usuarios | Pronto | convite, troca de papel, remocao, hierarquia respeitada |
| Plano e assinatura (uso vs. limites) | Pronto | — |
| Configuracoes da empresa | Pronto | dados, contato, WhatsApp, redes sociais |
| Somente leitura na suspensao | Pronto | aviso no topo de toda tela, dizendo que nada foi apagado |
| Painel indisponivel no plano sem `cms_panel` | Pronto | aviso de upgrade, nunca de inadimplencia; cobranca e cadastro seguem acessiveis |

## Conteudo e publicacao

| Item | Status | Observacao |
| --- | --- | --- |
| Modulos por site, habilitados individualmente | Pronto | o painel do cliente desenha so o que o projeto tem |
| Politica de campo por site | Pronto | apenas as excecoes sao gravadas; conferida tambem na escrita |
| Documentos de instancia unica (institucional, contato) | Pronto | nascem preenchidos com o que a empresa informou no cadastro |
| Colecoes (imoveis, obras, servicos, banners) | Pronto | tabelas proprias, com filtro, ordenacao e indices |
| Rascunho e publicado por registro | Pronto | `publication_status`; a API publica entrega so o publicado |
| Aviso de publicacao ao site do cliente | Pronto | webhook `content.published` assinado, com fila persistida e retentativa |
| Biblioteca de midia no Vercel Blob | Pronto | prefixo por empresa, tipo e tamanho validados no servidor |

## API publica e SDK

| Item | Status | Observacao |
| --- | --- | --- |
| `/api/v1` versionada | Pronto | contrato fechado desde o primeiro dia |
| Chave publicavel e chave secreta por site | Pronto | guardadas em hash; a secreta aparece uma unica vez |
| Escopo por chave, verificado a cada requisicao | Pronto | nunca o `siteId` enviado pelo cliente sozinho |
| Origens autorizadas por site | Pronto | sem sufixo: `termina com` autorizaria dominio de terceiro |
| Limite de requisicoes por chave | Pronto | — |
| Dados de interessados fora da chave publicavel | Pronto | nome, telefone e e-mail ficam atras do painel autenticado |
| `@codeca/sdk` com tipos e verificacao de webhook | Pronto | Web Crypto, para rodar tambem na borda |
| Pacote do SDK pronto para publicar | Pronto | metadado, changelog, regra de compatibilidade escrita, conferencia de publicacao e workflow por tag |
| Publicacao do SDK efetivada | **Depende de voce** | exige `NPM_TOKEN` no repositorio e a decisao entre npm publico e registro privado; `pnpm sdk:pack` simula |
| Documentacao OpenAPI | Pronto | `GET /api/v1/openapi.json`, gerado dos schemas Zod; cobertura comparada com a tabela de rotas do servidor |
| `customFields` nas respostas de conteudo | Pronto | objeto vazio quando o site nao tem campo definido; `Record<string, unknown>` no SDK, porque o conjunto e dado |

**Decisao em aberto -- dominios.** A etapa 0 removeu o renderizador, mas o
cadastro de dominio continua chamando a API da Vercel para apontar o hostname
ao projeto **da plataforma**. Com o site do cliente num projeto Vercel proprio,
isso aponta o dominio para um renderizador que nao existe mais. Sao dois
caminhos possiveis, e a escolha e comercial, nao tecnica:

1. **A plataforma so registra** qual dominio pertence a qual site, e quem
   configura DNS e dominio e o projeto Vercel do cliente. `VERCEL_API_TOKEN`,
   `VERCEL_PROJECT_ID` e `lib/vercel-domains.ts` saem, e [dominios.md](dominios.md)
   encolhe para o registro e a explicacao do que o cliente faz no painel dele.
2. **A plataforma hospeda** -- o que o plano Empresas vende como "hospedagem
   incluida". Entao o projeto Vercel de destino e por site, nao um fixo no
   ambiente, e a tabela precisa saber em qual projeto cada dominio entrou.

Nada foi mexido ate a decisao, porque as duas saidas apagam trabalho da outra.
O recurso `included_hosting` segue listado como **nao aplicado** por essa mesma
razao.

**Nota de historico:** este arquivo descrevia, ate a etapa A, um renderizador
publico com SSR, paginas por blocos, historico de versoes e `sitemap.xml`. Esse
caminho foi removido na etapa 0 -- o site de cada cliente e um projeto Vercel
da CODECA IA, e a plataforma entrega conteudo por API. As duas secoes acima
substituem as que descreviam o modelo antigo.

## Painel mestre da plataforma

| Item | Status | Observacao |
| --- | --- | --- |
| Visao geral (empresas por estado, usuarios, dominios, armazenamento, interessados em 30 dias, empresas por plano) | Pronto | todos os numeros vem de consultas ao banco |
| Erros operacionais | Pronto, parcial | erros de dominio aparecem na tela de dominios (`lastError`); nao ha uma tela unica agregando falhas de integracao |
| Lista e cadastro de empresas | Pronto | — |
| Ativar, suspender e cancelar empresa | Pronto | reflete no site publico na hora |
| Planos: criar, editar limites e recursos | Pronto | limites verificados no backend |
| Segmentos: criar, editar, desativar e remover | Pronto | qualquer ramo, sem migracao; codigo e texto desde a etapa 7 |
| Segmento padrao de empresas novas | Pronto | exatamente um, garantido por indice unico parcial |
| Aplicar o segmento a um site existente | Pronto | ato separado e auditado; habilita o que falta e nao desliga nada |
| Editar um segmento nao reconfigura sites | Pronto | coberto por teste; a auditoria grava `appliedToExistingSites: false` |
| Limites de armazenamento por plano | Pronto | conferidos antes de cada upload |
| Dominios de todas as empresas | Pronto | estado, ultima verificacao, ultimo erro |
| Uso por empresa | Pronto | usuarios, imoveis, obras, dominios, armazenamento |
| Log de auditoria | Pronto | filtros por empresa, acao e periodo; chave emitida, rotacionada e revogada sao acoes distintas |
| Permissao global separada | Pronto | concedida explicitamente, registrada em auditoria |
| Acesso de suporte a dados de empresa | Pronto | exige concessao com motivo e validade, somente leitura |
| Campos personalizados por site e modulo | Pronto | aba "Campos do projeto"; remover a definicao nao apaga valor, e a auditoria grava `valuesDeleted: false` |

## Planos, cobranca e assinaturas (ValidaPay)

| Item | Status | Observacao |
| --- | --- | --- |
| Planos no banco, com limites e recursos | Pronto | Avaliacao (R$ 0), Essencial (R$ 15,90), Profissional (R$ 59,90), Empresas (R$ 119,90) |
| Verificacao de limites no backend | Pronto | usuarios, imoveis publicados, obras, dominios, armazenamento |
| Recursos por plano | Pronto | painel de conteudo, dominio proprio, exportacao de interessados, hospedagem incluida |
| Plano sem painel de conteudo (Essencial) | Pronto | bloqueio proprio, com mensagem de upgrade -- nunca de inadimplencia |
| Hospedagem incluida | Registrado, nao aplicado | a plataforma nao hospeda site; o campo diz o que foi vendido |
| Periodicidade e formas de pagamento por plano | Pronto | editaveis no painel mestre (`plans.billing`) |
| Sincronizacao do plano como produto + preco recorrente | Pronto, depende de credencial | `POST /v1/products`; plano gratuito nao e sincronizavel (a API exige valor > 0) |
| Contratacao por sessao de checkout hospedada | Pronto, depende de credencial | `POST /v1/checkout-sessions`; o cartao e tokenizado na pagina da ValidaPay |
| Preco sempre do banco | Pronto | a entrada aceita apenas plano e forma de pagamento |
| Idempotencia da contratacao | Pronto | requisicao repetida reaproveita a sessao em aberto (30 min) |
| Cartao de credito com renovacao automatica | Pronto, depende de credencial | regua de retentativas do provedor |
| Pix Automatico | Pronto, depende de credencial **e de conta PJ** | exige conta ValidaPay com CNPJ e minimo de R$ 4,99 por cobranca |
| Pix comum e boleto por ciclo | Pronto, depende de credencial | **pagamento manual**, sem debito automatico; a interface informa isso |
| Webhook com verificacao HMAC | Pronto, depende de credencial | `t=<ms>,v1=<hmac>` sobre `<t>.<corpo bruto>`, com janela de tolerancia |
| Processamento idempotente dos eventos | Pronto | id do evento unico, id da cobranca unico, estados monotonicos |
| Eventos fora de ordem | Pronto | um evento anterior nao desfaz um estado mais novo |
| Registro durável antes de responder 2xx | Pronto | falha no processamento deixa o evento para retomada |
| Historico de cobrancas no painel da empresa | Pronto | valor, situacao, forma, datas, motivo da falha |
| Consulta individual de cobranca | Pronto, depende de credencial | `GET /v1/charges/{id}/status`, sempre no escopo da empresa |
| Troca de plano com simulacao de pro-rata | Pronto, depende de credencial | `POST /prorata` simula; `PUT /items/{itemId}` aplica |
| Cancelamento (agendado ou imediato) | Pronto, depende de credencial | quem decide o efeito e a ValidaPay, conforme o periodo pago |
| Desfazer cancelamento agendado | Pronto, depende de credencial | — |
| Estorno, contestacao e chargeback | Pronto | estorno total suspende o site para revisao; parcial fica registrado |
| Controle de publicacao por estado da assinatura | Pronto | funcao pura usada pelo webhook, pelo job e pelo painel |
| Periodo de tolerancia configuravel | Pronto | padrao 5 dias, ajustavel por empresa no painel mestre |
| Reconciliacao periodica | Pronto, depende de segredo | Vercel Cron diario (limite do plano Hobby; Pro aceita de 2 em 2 horas). O webhook e o caminho principal e a sincronizacao sob demanda cobre o resto |
| Painel mestre de cobranca | Pronto | assinaturas, cobrancas, eventos com falha, reprocessar, reconciliar, suspender |
| Auditoria das decisoes de cobranca | Pronto | `billing_audit_logs` com estado anterior, novo, origem e autor |
| Emissao de nota fiscal pela ValidaPay | Nao implementado | a API oferece (`emitirNf`, `nfConfigId`); exige configuracao fiscal da conta |
| Cupons e descontos | Nao implementado | a API oferece (`POST /subscriptions/{id}/coupons`) |
| Itens adicionais (add-ons) na assinatura | Nao implementado | a API oferece (`POST /subscriptions/{id}/items`); os eventos ja sao tratados |
| Troca da forma de pagamento de uma assinatura em vigor | Nao implementado | a API oferece (`PUT /subscriptions/{id}/payment-method`) |
| Troca do dia de vencimento | Nao implementado | a API oferece (`PUT /subscriptions/{id}/due-date`) |
| Split de pagamento e subcontas | Nao implementado | fora do escopo desta plataforma |

## Integracoes externas: o que configurar

| Integracao | Variaveis | Sem configurar |
| --- | --- | --- |
| Neon PostgreSQL | `DATABASE_URL` | a aplicacao nao sobe (obrigatoria) |
| Segredo de sessao | `AUTH_SECRET` | a aplicacao nao sobe (obrigatoria) |
| Host do painel | `APP_URL`, `PLATFORM_HOSTS` + reescrita no `vercel.json` | o painel responde 404 ou e tratado como site de cliente |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN` | biblioteca de imagens recusa envios com aviso |
| Dominios na Vercel | `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | dominios ficam em "Aguardando DNS" e nunca viram ativos |
| Alvos de DNS | `DOMAIN_A_RECORD_IP`, `DOMAIN_CNAME_TARGET` | instrucoes mostram os valores padrao da Vercel, que podem estar desatualizados |
| E-mail transacional | `RESEND_API_KEY`, `MAIL_FROM` | confirmacao, redefinicao e convites vao para o log do servidor |
| Pagamentos ValidaPay | `VALIDAPAY_CLIENT_ID`, `VALIDAPAY_CLIENT_SECRET`, `VALIDAPAY_BASE_URL` | a contratacao de planos e recusada com mensagem explicita |
| Webhooks de pagamento | `VALIDAPAY_WEBHOOK_SECRET` | os eventos sao **recusados** (401) e a ativacao dependeria so da reconciliacao |
| Reconciliacao automatica | `BILLING_RECONCILIATION_SECRET` (+ `CRON_SECRET` na Vercel) | o job responde 501 e nada roda periodicamente |

`GET /api/health` responde com `features.blobStorage`, `features.vercelDomains`,
`features.transactionalEmail`, `features.billing`, `features.billingWebhooks` e
`features.billingReconciliation`, o que permite conferir o que esta ativo em um
deploy sem abrir o painel.

## Testes

328 testes no Vitest; os de integracao rodam contra Postgres real em processo
(PGlite) com as mesmas migracoes enviadas ao Neon. Nenhuma cobranca real
acontece nos testes: a ValidaPay e substituida por um provedor em memoria que
reproduz o fluxo documentado (incluindo o fato de a assinatura nascer apenas do
pagamento).

| Area exigida | Onde |
| --- | --- |
| Cadastro e autenticacao | `integration/auth.test.ts` |
| Permissoes por papel | `integration/rbac.test.ts` |
| Isolamento entre empresas (trocando IDs e parametros) | `integration/isolation.test.ts` |
| CRUD de imoveis e de obras | `integration/content.test.ts` |
| Upload de imagens e limites de armazenamento | `integration/media-domains.test.ts` |
| Salvamento de rascunho, publicacao e restauracao | `integration/content.test.ts` |
| Resolucao de dominio | `integration/media-domains.test.ts` |
| Formularios publicos (interessados pela API publica) | `integration/public-content.test.ts` |
| Limites de plano | `integration/media-domains.test.ts`, `integration/content.test.ts` |
| Acesso ao painel mestre | `integration/rbac.test.ts` |
| Conteudo entregue ao site, com escopo por chave | `integration/public-content.test.ts`, `unit/sdk-contract.test.ts` |
| Fluxo completo, da criacao da empresa ate o site publicado | `integration/flow.test.ts` |
| Criar assinatura mensal, plano inativo, preco manipulado, erro da API, duplicidade | `integration/billing-subscriptions.test.ts` |
| Webhook: assinatura invalida, timestamp, reentrega, fora de ordem, falha no banco, reprocesso | `integration/billing-webhooks.test.ts` |
| Cobrancas: pendente, confirmada, falha, expiracao, cancelamento, estorno | `integration/billing-webhooks.test.ts`, `integration/billing-reconcile.test.ts` |
| Isolamento da cobranca entre empresas e acesso ao painel mestre | `integration/billing-isolation.test.ts` |
| Publicacao: pendente, paga, tolerancia, suspensa, reativada, conteudo preservado | `integration/billing-isolation.test.ts` |
| Divergencia recuperada por reconciliacao | `integration/billing-reconcile.test.ts` |
| Valores, estados, decisao de publicacao e HMAC do webhook | `unit/billing.test.ts` |
| Campos personalizados por site | `integration/custom-fields.test.ts` |

Limites conhecidos da suite, para nao haver ilusao de cobertura:

- **O painel nao tem teste de navegador.** A suite cobre a API e os contratos
  de resposta; a renderizacao do painel (`apps/web`) e verificada por
  `typecheck` e build, nao por teste visual nem de regressao de imagem. Os
  contratos entre API e painel vivem em `@codeca/shared` justamente porque
  esse furo existe: um campo que a API deixa de enviar quebra o `typecheck` do
  painel em vez de quebrar a tela do cliente.
- **Blob, API de dominios da Vercel, Resend e ValidaPay** sao substituidos por
  duplos nos testes; o caminho real depende de credencial. Para a ValidaPay, os
  corpos enviados foram validados contra o schema oficial de cada rota, e o
  checklist de sandbox em [validapay.md](validapay.md) cobre o que so da para
  verificar com credenciais de verdade.
- **Pix Automatico** nao pode ser exercitado nem em sandbox sem uma conta PJ
  habilitada; o caminho de recusa (`PJ_ONLY`, valor minimo) tem teste, a
  autorizacao bancaria em si nao.
- **Acessibilidade** segue as praticas (HTML semantico, foco visivel, rotulos,
  contraste, navegacao por teclado), mas nao ha auditoria automatizada (axe,
  Lighthouse CI) na suite.

## Operacao

| Item | Status | Observacao |
| --- | --- | --- |
| Rate limiting persistido | Pronto | funciona em ambiente serverless |
| Auditoria das acoes sensiveis | Pronto | sem dados pessoais nos metadados |
| Erros padronizados | Pronto | `integration_not_configured` quando falta configuracao externa |
| Backup / restauracao | Pronto como procedimento | historico do Neon + `pg_dump`; ver [neon.md](neon.md) |
| Reverificacao periodica de dominios | Nao implementado | a reverificacao e manual, pelo botao no painel ou pelo painel mestre |
| Reconciliacao periodica de cobranca | Pronto, depende de segredo | Vercel Cron; relatorio com divergencias e falhas |
| Alerta ativo de evento com falha | Pronto, parcial | aparece no painel mestre e no log; nao ha envio de e-mail ou push |
| Versionamento dos arquivos no Blob | Nao implementado | arquivo removido precisa ser reenviado |
| Painel de metricas de visitas do site | Nao implementado | nao ha coleta de analytics; use uma ferramenta externa |
