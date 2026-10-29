# Vercel Blob e biblioteca de imagens

Logos, favicons, fotos de imoveis, imagens de obras e PDFs ficam no Vercel Blob.
O banco guarda o registro de cada arquivo (`media_assets`), com a empresa dona,
tamanho, tipo, texto alternativo e caminho no Blob.

## 1. Criar o store

1. Na Vercel, abra **Storage > Create > Blob**.
2. Conecte o store ao projeto.
3. Copie o `BLOB_READ_WRITE_TOKEN` (fica em *.env.local* na tela do store) para
   as variaveis de ambiente do projeto e para o seu `.env`.

Sem o token, o painel continua funcionando: a biblioteca informa que o envio
esta indisponivel, em vez de aceitar o arquivo e perde-lo. `GET /api/health`
mostra `features.blobStorage`.

## 2. Como o upload acontece

```
navegador -> POST /api/tenants/:tenantId/media  (multipart)
             |
             +-- sessao valida?            (cookie HttpOnly + CSRF)
             +-- membro desta empresa?     (memberships)
             +-- tem a permissao media:upload?
             +-- mime permitido? tamanho <= 4 MB?
             +-- cabe no limite de armazenamento do plano?
             |
             v
         Vercel Blob  (tenants/<tenantId>/<arquivo>)
             |
             v
         media_assets (tenant_id, url, pathname, tamanho, tipo, alt)
```

O token de escrita **nunca** vai ao navegador: nao ha upload direto do cliente
para o Blob. O arquivo passa pela nossa funcao, que valida tudo antes de
gravar. Ver `apps/api/src/lib/blob.ts` e `apps/api/src/routes/media.ts`.

O caminho e sempre prefixado por `tenants/<tenantId>/`. `blobPathBelongsToTenant`
confere esse prefixo antes de qualquer remocao, de modo que uma empresa nao
consegue apagar o arquivo de outra nem informando a URL completa. `media_assets`
tambem e consultada com `tenant_id` fixado pela sessao.

## 3. Tipos e tamanhos

| Aceito | |
| --- | --- |
| Imagens | `image/jpeg`, `image/png`, `image/webp`, `image/avif`, `image/gif`, `image/svg+xml` |
| Documentos | `application/pdf` |

- **4 MB por arquivo** (`MAX_UPLOAD_BYTES`), abaixo do limite de corpo de
  requisicao da Vercel (4,5 MB).
- **Total por empresa** definido pelo plano: 200 MB na Avaliacao, 2 GB no
  Essencial, 10 GB no Profissional. A verificacao acontece no servidor, somando
  `media_assets.size_bytes` da empresa antes de aceitar o envio.
- O tipo e validado pelo mime declarado **e** pela extensao derivada dele; o
  nome original nao define o caminho gravado.

Sobre SVG: e aceito porque logos costumam vir nesse formato, mas um SVG pode
conter script. Os arquivos sao servidos pelo dominio do Blob, fora do dominio do
painel e dos sites, e as imagens sao sempre renderizadas em `<img>` — nunca
embutidas no HTML. Se preferir nao aceitar SVG, remova-o de
`ALLOWED_IMAGE_MIME_TYPES` em `packages/shared/src/validators/media.ts`.

## 4. Biblioteca de imagens no painel

Em **Biblioteca de imagens** o cliente ve os arquivos da propria empresa, com
busca por nome e por marcador, tamanho, tipo, data e o uso de armazenamento em
relacao ao plano.

- **Texto alternativo e titulo** sao editaveis e usados pelo site publico, o que
  atende acessibilidade e SEO.
- **Onde esta sendo usado**: `GET /api/tenants/:id/media/:mediaId/usage` procura
  o identificador do arquivo nos layouts das paginas, nos imoveis, nas obras e
  nas configuracoes de identidade visual.
- **Remocao**: um arquivo em uso **nao** e excluido. A API responde 409 dizendo
  onde ele aparece ("em 2 imoveis, 1 pagina"), e o cliente precisa remover as
  referencias antes. Um arquivo sem uso e removido primeiro de `media_assets` e
  depois do Blob — nessa ordem, para que uma falha na remocao do objeto deixe no
  maximo um arquivo orfao inacessivel, nunca uma referencia quebrada no site.
- **Arquivos sem referencia** aparecem pelo filtro "apenas nao utilizados", para
  que a limpeza seja uma decisao do cliente e nao um efeito colateral.
- **Antes de excluir a empresa dona**: `media_assets` cai por cascata; os
  objetos no Blob ficam sob `tenants/<tenantId>/` e podem ser recolhidos por esse
  prefixo.

A publicacao e o ultimo guardiao: `publishPage` reune todos os identificadores
de midia do layout e confirma que cada um pertence a empresa. Um layout que
cite um arquivo removido ou de outra empresa nao e publicado.

## 5. Custos e desempenho

O Blob cobra por armazenamento e por trafego. O que o projeto faz para conter
ambos:

- cabecalho `cache-control: public, max-age=31536000, immutable` nos assets
  estaticos do painel;
- `addRandomSuffix` nos nomes gravados, de modo que cada versao de um arquivo
  tem URL propria e pode ser cacheada para sempre;
- `loading="lazy"` e `decoding="async"` nas imagens do site publico, exceto a
  primeira imagem do topo;
- limites de armazenamento por plano verificados no backend.

## 6. Problemas comuns

| Sintoma | Causa |
| --- | --- |
| "Envio de arquivos indisponivel" | `BLOB_READ_WRITE_TOKEN` ausente no ambiente |
| 413 no upload | Arquivo acima de 4 MB; oriente a reduzir antes de enviar |
| "Tipo de arquivo nao permitido" | Mime fora da lista aceita |
| "Seu plano permite ate ..." | Limite de armazenamento do plano atingido |
| Imagem sumiu do site | Arquivo removido no Blob por fora da plataforma; reenvie e aponte de novo |
