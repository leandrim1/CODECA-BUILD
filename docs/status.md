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

## Planos e cobranca

| Item | Status | Observacao |
| --- | --- | --- |
| Planos no banco, com limites e recursos | Pronto | Avaliacao, Essencial, Profissional |
| Verificacao de limites no backend | Pronto | usuarios, imoveis publicados, obras, paginas, dominios, armazenamento |
| Recursos por plano | Pronto | dominio proprio, historico, exportacao, blocos avancados, SEO avancado, selo |
| Assinatura por empresa (`subscriptions`) | Pronto | estado, plano, periodo |
| Cobranca automatica (gateway de pagamento) | Nao implementado | previsto na especificacao; o banco e o app estao preparados para receber |

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

`GET /api/health` responde com `features.blobStorage`, `features.vercelDomains`
e `features.transactionalEmail`, o que permite conferir o que esta ativo em um
deploy sem abrir o painel.

## Testes

202 testes no Vitest; os de integracao rodam contra Postgres real em processo
(PGlite) com as mesmas migracoes enviadas ao Neon.

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
| Responsividade | `web/editor-fields.test.ts` (CSS e media queries geradas) |

Limites conhecidos da suite, para nao haver ilusao de cobertura:

- **Responsividade** e verificada pelo CSS gerado, nao por renderizacao em
  navegador real. Nao ha teste visual nem de regressao de imagem.
- **Blob, API de dominios da Vercel e Resend** sao substituidos por duplos nos
  testes; o caminho real depende de credencial e foi exercitado manualmente.
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
| Versionamento dos arquivos no Blob | Nao implementado | arquivo removido precisa ser reenviado |
| Painel de metricas de visitas do site | Nao implementado | nao ha coleta de analytics; use uma ferramenta externa |
