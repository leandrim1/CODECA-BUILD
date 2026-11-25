# Geolocalização

Endereço, CEP, mapa e coordenadas. O princípio desta parte da plataforma é um
só: **nenhuma tela conhece o provedor**.

O painel e o site dos clientes falam com interfaces (`GeocodingProvider`,
`PostalCodeProvider`, `MapTileProvider`), e quem responde é decidido por
configuração. O que fica gravado é o endereço **normalizado** da plataforma —
nunca um id, uma URL ou um JSON de fornecedor. Por isso trocar de provedor não
invalida nada do que já está no banco.

Nada aqui exige chave de API ou cartão. O padrão é OpenStreetMap.

## As peças

| Onde | O que é |
| :--- | :--- |
| `packages/shared/src/geo/` | Tipos, interfaces, normalização, presets de mapa e `map_settings`. Sem rede. |
| `apps/api/src/lib/geo/` | Adaptadores (Nominatim, ViaCEP+BrasilAPI), registry, cache e fila. |
| `apps/api/src/routes/geo.ts` | `/api/geo/search`, `/api/geo/reverse`, `/api/geo/cep/:cep`. |
| `apps/web/src/components/endereco/` | `AddressPicker` e o mapa do painel. |
| `packages/sdk/src/map.ts` | `<codeca-map>`, o mapa do site do cliente. |

## Por que o navegador não fala direto com os provedores

Três razões, e nenhuma é intercambiável:

1. A CSP do painel é `connect-src 'self'`. Abri-la para domínios de terceiros
   vale para a página inteira, inclusive para um script que entre ali por
   outro caminho.
2. O Nominatim exige `User-Agent` identificando a aplicação — cabeçalho que
   navegador nenhum deixa o JavaScript definir.
3. Cache e cota só existem se houver um lugar por onde todo mundo passa.

## Adicionar um provedor novo, em 3 passos

Exemplo: trocar a geocodificação por um serviço pago qualquer.

**1. Escreva o adaptador** em `apps/api/src/lib/geo/`, devolvendo a interface
e sempre `NormalizedAddress`:

```ts
export function criarMeuProvedor(opcoes: { chave: string }): GeocodingProvider {
  return {
    id: 'meu-provedor',
    async search(consulta, opts) { /* ... */ },
    async reverse(lat, lng) { /* ... */ },
  };
}
```

**2. Acrescente uma linha no registry** (`lib/geo/registry.ts`):

```ts
case 'meu-provedor':
  return criarMeuProvedor({ chave: env.MEU_PROVEDOR_KEY! });
```

**3. Aponte a variável de ambiente:** `GEO_PROVIDER=meu-provedor`.

Pronto. Nenhum componente de tela muda, nenhuma rota muda, e os endereços já
gravados continuam válidos — porque o formato salvo é o da plataforma, não o
do provedor. O teste `tests/integration/geo.test.ts` prova isso com um
provedor falso que não toca em rede.

Camada de mapa (ladrilhos) é ainda mais simples: um objeto novo em
`packages/shared/src/geo/tiles.ts`, com URL, atribuição e zoom máximo. Ele
aparece sozinho na tela de configuração do site.

## Variáveis de ambiente

Nenhuma é obrigatória. Sem nenhuma delas, a plataforma usa OpenStreetMap.

| Variável | Padrão | Para quê |
| :--- | :--- | :--- |
| `GEO_PROVIDER` | `nominatim` | Qual adaptador de geocodificação usar. |
| `GEO_CEP_PROVIDER` | `viacep` | Adaptador de CEP (ViaCEP com queda para a BrasilAPI). |
| `GEO_CONTACT_EMAIL` | `SUPPORT_EMAIL` | Contato no `User-Agent`. **Vale preencher em produção**: a política do Nominatim pede identificação, e eles bloqueiam quem não identifica. |
| `GEO_NOMINATIM_URL` | oficial | Instância própria de Nominatim, se houver. |

Nome desconhecido em `GEO_PROVIDER` é erro de configuração, não motivo para
cair no padrão em silêncio: quem escreveu `GEO_PROVIDER=mapbox` esperando
Mapbox precisa saber que ninguém implementou isso.

## Limites de uso, e como são respeitados

A política do Nominatim pede no máximo 1 requisição por segundo, identificação
no `User-Agent` e nada de autocomplete a cada tecla. A plataforma cumpre as
três em camadas:

- **Debounce de 600 ms e mínimo de 3 caracteres** na busca do painel.
- **Fila em processo** (`lib/geo/fila.ts`), que espaça os pedidos em 1 s dentro
  de uma instância.
- **Cota global no banco** (`RATE_LIMITS.geoProvedor`, 60/min com assunto
  fixo). É ela que conta de verdade: em função serverless há várias instâncias,
  e a fila sozinha multiplicaria o limite.
- **Cache no Postgres** (tabela `geo_cache`), 30 dias para CEP e geocodificação
  reversa, 7 dias para busca por texto. A chave é normalizada (minúscula, sem
  acento; coordenada arredondada a ~1 m), e o valor é o endereço normalizado.

CEP inexistente também é guardado. Sem isso, o único caso que sempre iria ao
provedor seria justamente o de quem digitou errado e vai tentar de novo.

## O que fica no banco

O endereço vive no documento de contato do site (JSONB em
`content_documents.data`), no formato normalizado:

```jsonc
{
  "addressLine": "Rua Francisco Glicério",
  "addressNumber": "935",
  "addressComplement": "Sala 4",
  "neighborhood": "Centro",
  "city": "Campinas",
  "state": "SP",          // sigla
  "postalCode": "13012100", // só dígitos
  "latitude": -22.907123,
  "longitude": -47.063298,
  "mapSettings": { "estilo": "padrao", "altura": "media", "zoom": 16 },
  "geocodedAt": "2026-11-25T12:00:00.000Z", // auditoria
  "geocodeSource": "painel"                  // auditoria
}
```

`geocodedAt` e `geocodeSource` são auditoria e **não entram em decisão
nenhuma**: servem para responder "de onde veio esta coordenada?" quando ela
estiver errada.

A única tabela nova é `geo_cache` (migração `0035`), que é descartável:
apagá-la só faz a plataforma voltar a perguntar ao provedor.
