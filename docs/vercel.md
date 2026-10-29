# Vercel

Um unico projeto hospeda o painel da plataforma, a API e todos os sites dos
clientes. O que diferencia um do outro e o host da requisicao.

## 1. Importar o repositorio

Em <https://vercel.com/new>, importe o repositorio. O `vercel.json` na raiz ja
traz tudo:

| Chave | Valor | Por que |
| --- | --- | --- |
| `buildCommand` | `pnpm run build` | Compila os pacotes internos e depois o painel |
| `installCommand` | `pnpm install --frozen-lockfile` | Falha se o lockfile estiver desatualizado |
| `outputDirectory` | `apps/web/dist` | Saida estatica do Vite |
| `functions` | `api/*.ts` em `@vercel/node@5.1.11` | 1024 MB, 30 s |
| `framework` | `null` | O roteamento e nosso, nao de um preset |

Nao defina um *Root Directory* no painel da Vercel: o build sai da raiz do
monorepo, porque as funcoes em `api/` importam `@codeca/api` pelo workspace.

As duas funcoes:

- `api/index.ts` — a API (`createApp`), servida em `/api/*`
- `api/site.ts` — os sites publicos (`createSiteApp`), renderizados no servidor

## 2. Ajustar a reescrita por host — passo obrigatorio

Em `vercel.json`:

```json
{
  "source": "/(.*)",
  "destination": "/api/site",
  "missing": [
    {
      "type": "host",
      "value": "(?:app\\.codecabuild\\.com|[^.]+\\.vercel\\.app|localhost(?::\\d+)?|127\\.0\\.0\\.1(?::\\d+)?)"
    }
  ]
}
```

Leia como: *"todo caminho vai para o renderizador dos sites, exceto quando o
host for um host da plataforma"*. Troque `app\.codecabuild\.com` pelo dominio do
seu painel, escapando os pontos. Para mais de um host da plataforma, separe com
`|`:

```
(?:app\.seudominio\.com|admin\.seudominio\.com|[^.]+\.vercel\.app|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)
```

Se esquecer esse ajuste, o dominio do painel passa a ser tratado como site de
cliente e responde 404 — e o sintoma mais comum de uma primeira implantacao.

Mantenha a entrada `*.vercel.app`: e o que faz os deploys de previa abrirem o
painel.

A ordem das reescritas importa: `/api/*` primeiro, os sites publicos depois e,
por fim, `/index.html` para o painel (SPA).

A mesma lista tambem precisa estar em `PLATFORM_HOSTS`, que e o que a API usa
para nao resolver um host da plataforma como site de cliente. O host de
`APP_URL` e os `*.vercel.app` entram automaticamente (ver
`platformHosts()` em `apps/api/src/env.ts`).

## 3. Variaveis de ambiente

Em **Project Settings > Environment Variables**, cadastre as variaveis de
`.env.example` para *Production* e *Preview*. Todas sao lidas somente no
servidor; nenhuma e exposta ao navegador (nao existe nenhuma variavel
`VITE_*` com segredo no projeto).

Obrigatorias:

| Variavel | Observacao |
| --- | --- |
| `DATABASE_URL` | Conexao *pooled* do Neon |
| `AUTH_SECRET` | 32+ caracteres; trocar invalida todas as sessoes e links de e-mail |
| `APP_URL` | `https://app.seudominio.com` — usado nos links de e-mail e no CORS |
| `PLATFORM_HOSTS` | Os mesmos hosts da reescrita, separados por virgula |

Opcionais; cada uma desliga um recurso de forma explicita quando ausente:

| Variavel | Sem ela |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | A biblioteca de imagens informa que o envio esta indisponivel |
| `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID` (+ `VERCEL_TEAM_ID`) | Dominios ficam aguardando configuracao externa e nunca sao marcados como ativos |
| `RESEND_API_KEY` + `MAIL_FROM` | Confirmacao, redefinicao de senha e convites vao para o log do servidor |

`GET /api/health` devolve esses tres indicadores em `features`, o que permite
conferir o que esta ativo em um deploy sem abrir o painel.

Em producao, `NODE_ENV` ja vem como `production`, o que liga `Secure` nos
cookies. `COOKIE_SECURE=false` serve apenas para desenvolvimento local em HTTP.

## 4. Dominio do painel

Em **Project Settings > Domains**, adicione `app.seudominio.com` e siga as
instrucoes de DNS da Vercel. Depois:

1. Ajuste `APP_URL` e `PLATFORM_HOSTS`.
2. Confirme que o host aparece na reescrita do `vercel.json`.
3. Faca um novo deploy — `vercel.json` so vale a partir do deploy que o contem.

Os dominios dos clientes **nao** sao adicionados a mao nesse painel: quem os
registra e a API, pelo backend, quando o cliente cadastra o dominio no painel
da empresa. Ver [dominios.md](dominios.md).

## 5. Migracoes no deploy

O build **nao** aplica migracoes: um deploy nao deve alterar o schema sem
alguem olhando. Rode a partir da sua maquina, com o `DATABASE_URL` de producao:

```bash
DATABASE_URL="postgresql://..." pnpm db:migrate
```

Aplique a migracao antes do deploy quando ela so adiciona (coluna nova,
tabela nova, indice novo) e depois do deploy quando ela remove algo que o
codigo antigo ainda usa.

## 6. Cache e invalidacao

As paginas publicas sao renderizadas no servidor e respondem com:

- `cache-control: public, max-age=0, s-maxage=..., stale-while-revalidate=...` —
  a borda da Vercel serve a copia pronta e revalida em segundo plano, enquanto o
  navegador sempre confere;
- `etag` derivado da versao publicada do site e do caminho, o que permite 304
  sem refazer o HTML.

Publicar incrementa `published_version` em `site_settings`, o que muda o ETag de
todas as paginas daquela empresa e invalida o cache sem tocar em nenhuma outra.
O painel (`/api/*` e a previa) responde `no-store`.

## 7. Limites a observar

| Limite | Valor configurado | Comentario |
| --- | --- | --- |
| Duracao da funcao | 30 s | Publicacao e verificacao de dominio ficam muito abaixo disso |
| Memoria | 1024 MB | Suficiente para o SSR do site inteiro |
| Corpo da requisicao | 4,5 MB (limite da plataforma) | O upload limita o arquivo a 4 MB |

## 8. Problemas comuns

| Sintoma | Causa |
| --- | --- |
| Painel responde 404 | O dominio do painel nao esta na reescrita por host |
| Site do cliente mostra o painel | O host do cliente casa com a regex da plataforma (ou falta `\.` escapado) |
| `Configuracao de ambiente invalida` nos logs | Variavel obrigatoria ausente; a mensagem nomeia quais |
| 401 em toda chamada apos o login | `APP_URL` diferente do dominio acessado: o CORS e o cookie nao batem |
| `ERR_PNPM_OUTDATED_LOCKFILE` | `pnpm-lock.yaml` nao versionado junto com a mudanca de dependencia |
