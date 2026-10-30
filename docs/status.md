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
| Schema no Neon com 29 tabelas | Pronto | UUIDs, timestamps, enums, FKs, indices |
| Migracoes versionadas | Pronto | `packages/database/migrations`, aplicadas tambem nos testes |
| Migracoes aplicadas no deploy | Pronto | o build de producao na Vercel aplica as pendentes e falha se alguma quebrar |
| Planos padrao em instalacao nova | Pronto | criados apenas com a tabela vazia; nunca sobrescrevem ajustes do painel |
| Primeiro administrador sem passo manual | Pronto | a primeira conta cadastrada assume o painel mestre, uma unica vez |
| Seed de planos / admin / demonstracao | Pronto | `pnpm db:seed` |
| Conexao com transacoes | Pronto | driver `neon-serverless`; publicacao e atomica |
| `.env.example` sem credenciais reais | Pronto | somente nomes e exemplos ficticios |

## Contas, acesso e isolamento

| Item | Status | Observacao |
| --- | --- | --- |
| Cadastro de construtora + proprietario | Pronto | cria empresa, site, paginas iniciais e assinatura de avaliacao |
| Login, logout, sessoes ativas, encerrar outras sessoes | Pronto | token opaco, cookie HttpOnly |
| Verificacao de e-mail | Pronto, depende de credencial | sem `RESEND_API_KEY` o link vai para o log do servidor |
| Recuperacao de senha | Pronto, depende de credencial | idem |
| Convite de colaboradores | Pronto, depende de credencial | o vinculo e criado no banco; o e-mail depende da chave |
| Papeis `owner`/`admin`/`editor`/`viewer` | Pronto | capacidades verificadas no backend |
| `platform_admin` separado dos papeis de empresa | Pronto | ser admin de empresa nao da acesso global |
| Isolamento entre empresas | Pronto | `tests/integration/isolation.test.ts` troca IDs e espera 404 |
| Acesso de suporte explicito, temporario e auditado | Pronto | `support_access_grants`, somente leitura |
| Autenticacao em dois fatores | Nao implementado | — |

## Painel da construtora

| Item | Status | Observacao |
| --- | --- | --- |
| Visao geral com indicadores | Pronto | contagens e ultimas atividades vindas do banco; nenhuma metrica inventada |
| Editor visual (tres paineis) | Pronto | lista de secoes, previa por dispositivo, propriedades |
| 22 blocos com schema validado | Pronto | catalogo em `packages/shared/src/blocks/catalog.ts` |
| Adicionar, remover, duplicar, reordenar, ocultar secao | Pronto | arrastar e soltar com `@dnd-kit` |
| Ajustes responsivos por secao | Pronto | previa com largura real e media queries de verdade |
| Paginas: criar, slug, pagina inicial, excluir | Pronto | slug unico por site; slugs reservados recusados |
| Menus de navegacao e redirecionamentos | Pronto | — |
| Personalizacao (logo, cores, fontes, bordas, cards) | Pronto | variaveis CSS por empresa, previa antes de publicar |
| Biblioteca de imagens | Pronto, depende de credencial | sem `BLOB_READ_WRITE_TOKEN` o envio e recusado com aviso |
| Imoveis (CRUD, filtros, paginacao, galeria) | Pronto | status de publicacao separado do status comercial |
| Obras e projetos (CRUD, etapas, atualizacoes com fotos) | Pronto | percentual aparece somente quando informado |
| Servicos, sobre, diferenciais, equipe, depoimentos, FAQ | Pronto | ordenacao e publicacao por item |
| Interessados (filtros, status, observacoes internas) | Pronto | — |
| Exportacao de interessados em CSV | Pronto | recurso de plano (`lead_export`) |
| Dominio proprio | Pronto, depende de credencial | sem `VERCEL_API_TOKEN`/`VERCEL_PROJECT_ID` fica em "Aguardando DNS" |
| SEO (titulo, descricao, favicon, imagem, canonical, sitemap, robots) | Pronto | — |
| Equipe e usuarios | Pronto | convite, troca de papel, remocao, hierarquia respeitada |
| Plano e assinatura (uso vs. limites) | Pronto | sem cobranca automatica (abaixo) |
| Configuracoes da empresa | Pronto | dados, contato, WhatsApp, redes sociais |

## Rascunho, versoes e publicacao

| Item | Status | Observacao |
| --- | --- | --- |
| Rascunho salvo separado da versao publicada | Pronto | validacao bloco a bloco ja no rascunho |
| Concorrencia otimista no salvamento | Pronto | `baseRevision`; duas abas nao se sobrescrevem (409) |
| Publicar em transacao | Pronto | trava a pagina, revalida layout, confere midia, grava versao |
| Historico de versoes com autor e data | Pronto | recurso de plano (`version_history`) |
| Restaurar versao anterior | Pronto | gera nova versao; nada e perdido |
| Invalidacao de cache ao publicar | Pronto | `published_version` muda o ETag das paginas da empresa |
| Site publico serve somente conteudo publicado | Pronto | coberto por teste |

## Sites publicos

| Item | Status | Observacao |
| --- | --- | --- |
| Resolucao por dominio verificado e ativo | Pronto | empresa suspensa deixa de responder |
| Renderizacao no servidor (SSR) | Pronto | `renderToStaticMarkup`, HTML completo na primeira resposta |
| Paginas de imovel e de obra com metadados proprios | Pronto | `/imoveis/<slug>`, `/obras/<slug>` |
| Metatags, Open Graph, canonical, JSON-LD | Pronto | dados estruturados apenas de registros existentes |
| `sitemap.xml` e `robots.txt` por site | Pronto | podem ser desligados nas configuracoes |
| 404 proprio e redirecionamentos | Pronto | — |
| Cache na borda com `s-maxage` e ETag/304 | Pronto | revalidacao sem refazer o HTML |
| Site funciona sem JavaScript | Pronto | menu, FAQ e galeria em CSS; so o formulario usa ~1 KB de JS, com `<noscript>` |
| Formulario de contato com os interesses previstos | Pronto | validacao no servidor, rate limiting, honeypot, consentimento |
| Botao de WhatsApp com mensagem contextualizada | Pronto | numero da propria empresa, nunca compartilhado |
| `loading="lazy"`, `decoding="async"`, primeira imagem eager | Pronto | — |
| Geracao estatica no build (SSG/ISR por arquivo) | Nao implementado | o cache na borda cumpre o mesmo papel com invalidacao por versao |
| Redimensionamento/conversao automatica de imagens | Nao implementado | as imagens sao servidas como enviadas |

## Painel mestre da plataforma

| Item | Status | Observacao |
| --- | --- | --- |
| Visao geral (empresas por estado, usuarios, dominios, armazenamento, interessados em 30 dias, paginas publicadas, empresas por plano) | Pronto | todos os numeros vem de consultas ao banco |
| Erros operacionais | Pronto, parcial | erros de dominio aparecem na tela de dominios (`lastError`); nao ha uma tela unica agregando falhas de integracao |
| Lista e cadastro de construtoras | Pronto | — |
| Ativar, suspender e cancelar empresa | Pronto | reflete no site publico na hora |
| Planos: criar, editar limites e recursos | Pronto | limites verificados no backend |
| Limites de armazenamento por plano | Pronto | conferidos antes de cada upload |
| Dominios de todas as empresas | Pronto | estado, ultima verificacao, ultimo erro |
| Uso por empresa | Pronto | usuarios, imoveis, obras, paginas, dominios, armazenamento |
| Log de auditoria | Pronto | filtros por empresa, acao e periodo |
| Permissao global separada | Pronto | concedida explicitamente, registrada em auditoria |
| Acesso de suporte a dados de empresa | Pronto | exige concessao com motivo e validade, somente leitura |

## Planos, cobranca e assinaturas (ValidaPay)

| Item | Status | Observacao |
| --- | --- | --- |
| Planos no banco, com limites e recursos | Pronto | Avaliacao, Essencial, Profissional |
| Verificacao de limites no backend | Pronto | usuarios, imoveis publicados, obras, paginas, dominios, armazenamento |
| Recursos por plano | Pronto | dominio proprio, historico, exportacao, blocos avancados, SEO avancado, selo |
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
| Controle de publicacao por estado da assinatura | Pronto | funcao pura usada pelo webhook, pelo job, pelo painel e pelo renderizador |
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
| Resolucao de dominio | `integration/media-domains.test.ts`, `integration/public-site.test.ts` |
| Formularios publicos | `integration/public-site.test.ts` |
| Limites de plano | `integration/media-domains.test.ts`, `integration/content.test.ts` |
| Acesso ao painel mestre | `integration/rbac.test.ts` |
| Fluxos principais do editor | `web/editor-fields.test.ts`, `unit/blocks.test.ts` |
| Fluxo completo, da criacao da empresa ate o site publicado | `integration/flow.test.ts` |
| Criar assinatura mensal, plano inativo, preco manipulado, erro da API, duplicidade | `integration/billing-subscriptions.test.ts` |
| Webhook: assinatura invalida, timestamp, reentrega, fora de ordem, falha no banco, reprocesso | `integration/billing-webhooks.test.ts` |
| Cobrancas: pendente, confirmada, falha, expiracao, cancelamento, estorno | `integration/billing-webhooks.test.ts`, `integration/billing-reconcile.test.ts` |
| Isolamento da cobranca entre empresas e acesso ao painel mestre | `integration/billing-isolation.test.ts` |
| Publicacao: pendente, paga, tolerancia, suspensa, reativada, conteudo preservado | `integration/billing-isolation.test.ts` |
| Divergencia recuperada por reconciliacao | `integration/billing-reconcile.test.ts` |
| Valores, estados, decisao de publicacao e HMAC do webhook | `unit/billing.test.ts` |
| Responsividade | `web/editor-fields.test.ts` (CSS e media queries geradas) |

Limites conhecidos da suite, para nao haver ilusao de cobertura:

- **Responsividade** e verificada pelo CSS gerado, nao por renderizacao em
  navegador real. Nao ha teste visual nem de regressao de imagem.
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
