# Mudancas do `@codeca/sdk`

As versoes seguem [SemVer](https://semver.org/lang/pt-BR/), com a regra de
compatibilidade escrita em [README.md](./README.md#compatibilidade).

O resumo que importa: **nada que um site ja use quebra num `minor`.**

## 0.1.0

Primeira versao preparada para publicacao. O pacote existia no monorepo desde
a etapa 6; esta e a primeira com metadado, licenca, conferencia de publicacao e
regra de compatibilidade escrita.

Recursos:

- `site.get()` — identidade do site, modulos habilitados, escopos da chave e
  aviso de pendencia.
- `institutional.get()`, `contact.get()` — documentos de instancia unica.
- `banners.list()`.
- `properties.list()`, `properties.get(slug)` — com filtros de busca.
- `projects.list()`, `projects.get(slug)`.
- `services.list()`.
- `products.list()`, `products.get(slug)`, `categories.list()`.
- `galleries.list()`, `galleries.get(slug)`.
- `testimonials.list()`, `team.list()`, `faqs.list()`.
- `customFields` em imovel, obra, servico, produto, depoimento e membro da
  equipe — os campos que a CODECA IA definiu para aquele projeto. Objeto vazio
  quando nao ha nenhum; `Record<string, unknown>`, porque o conjunto de campos
  e configuracao e nao contrato (ver Compatibilidade no README).
- `custom(chave)` — `list()` e `get(slug)` dos modulos criados para aquele
  projeto. `data` e `Record<string, unknown>`, e os modulos disponiveis vem em
  `getSite().customModules`. Sao configuracao do projeto, nao contrato da API
  (ver Compatibilidade no README).
- `leads.create()` — unica escrita, aceita com chave publicavel.
- `verifyWebhook()` em `@codeca/sdk/server` — confere a assinatura do aviso
  `content.published` usando Web Crypto, para rodar tambem na borda.

Cuidados embutidos:

- `createClient` recusa chave secreta: no navegador ela deixaria de ser
  segredo. A secreta vai em `createServerClient`, de um ponto de entrada
  separado, para o erro aparecer na revisao e no bundle.
- Nenhuma rota le dado de interessado.
- Zero dependencia em tempo de execucao.
