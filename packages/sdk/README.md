# @codeca/sdk

Cliente do CODECA Build para os sites desenvolvidos pela CODECA IA.

Sem dependencia de runtime: o pacote usa apenas `fetch`.

---

## Instalacao

O pacote vive dentro do monorepo da plataforma. Em um site separado, use uma
destas vias:

```bash
pnpm add "https://gitpkg.now.sh/leandrim1/CODECA-BUILD/packages/sdk?main"
```

Ou, mais simples e sem servico de terceiro: `pnpm pack` no pacote e commitar o
tarball no site, ou copiar `packages/sdk/src` para `src/codeca/` do site. Os
arquivos nao importam nada de fora.

---

## Uso no navegador

```ts
import { createClient } from '@codeca/sdk';

export const codeca = createClient({
  baseUrl: 'https://app.codecabuild.com.br',
  publishableKey: import.meta.env.VITE_CODECA_KEY,
});
```

A chave publicavel (`cb_pub_...`) **nao e segredo**: ela so le conteudo
publicado, e so a partir de uma origem cadastrada no painel da plataforma.
Pode ficar no codigo do site.

Passar uma chave secreta aqui falha na hora, com mensagem explicando o que
fazer. E o erro mais facil de cometer e o mais caro.

### Chamadas

```ts
await codeca.site.get();
await codeca.institutional.get();
await codeca.contact.get();
await codeca.banners.list();

await codeca.properties.list({ purpose: 'venda', city: 'Campinas', page: 1 });
await codeca.properties.get('residencial-aurora');

await codeca.projects.list({ status: 'em_andamento' });
await codeca.projects.get('edificio-horizonte');

await codeca.services.list();

await codeca.leads.create({
  name: 'Marina Souza',
  phone: '(19) 98888-7777',
  interestType: 'compra_imovel',
  message: 'Gostaria de visitar o decorado.',
  consent: true,
});
```

A listagem traz a **capa** de cada item; a galeria completa vem no detalhe,
por `slug`.

`leads.create` devolve apenas a confirmacao. Quem envia nao le de volta --
use o que ja esta no formulario para montar a tela de obrigado.

---

## Uso no servidor

```ts
import { createServerClient } from '@codeca/sdk/server';

const codeca = createServerClient({
  baseUrl: process.env.CODECA_BASE_URL!,
  secretKey: process.env.CODECA_SECRET_KEY!,
});

const rascunhos = await codeca.properties.list({ preview: true });
```

A chave secreta (`cb_sec_...`) le tambem rascunho. Ela **nunca** vai para o
navegador: nem em componente de cliente, nem em `VITE_*`, nem no
repositorio.

O ponto de entrada e separado de proposito: `@codeca/sdk/server` aparecendo em
codigo que vai para o navegador e visivel na revisao e no bundle.

---

## Erros

Toda falha chega como `CodecaError`, com o codigo da plataforma e o status.

```ts
import { CodecaError } from '@codeca/sdk';

try {
  const imovel = await codeca.properties.get(slug);
} catch (erro) {
  if (erro instanceof CodecaError) {
    if (erro.isNotFound) return render404();
    if (erro.isNetworkError) return tentarDeNovo();
    if (erro.isRateLimited) return esperar();
    if (erro.isSuspended) return mostrarUltimoConteudoConhecido();
    if (erro.isAuthError) console.error('Credencial ou origem', erro.message);
  }
  throw erro;
}
```

`isNetworkError` significa que a plataforma nao chegou a responder -- vale
repetir. Um `422` repetido daria o mesmo resultado.

`isSuspended` (402 `subscription_required`) e pendencia da assinatura do site,
nao problema do codigo: a credencial esta correta e repetir nao resolve. Quem
resolve e a empresa, no painel. O conteudo continua guardado na plataforma e
volta a responder sozinho, entao o site faz melhor mostrando o que tem em
cache do que uma pagina de erro.

Aparece somente quando o plano do site escolhe `parar de responder` na
suspensao; o padrao da plataforma e continuar servindo.

### O aviso em `getSite()`

`site.get()` devolve `notice`: uma frase pronta para exibir ao visitante, ou
`null`. Vem preenchida quando o plano pede aviso durante uma pendencia. O
texto nao descreve a pendencia nem cita valores -- se o seu site exibe o
`notice`, pode exibi-lo como veio.

---

## Prazo

Dez segundos por padrao, ajustavel em `timeoutMs`. Sem prazo, uma plataforma
lenta travaria a renderizacao do site ate o navegador desistir sozinho.

---

## Tipos

Todos os tipos de conteudo sao exportados (`PublicProperty`, `PublicProject`,
`PublicService`, `PublicBanner`, `InstitutionalContent`, `ContactContent`...).

O pacote carrega a propria copia deles para nao depender de nada. Uma
verificacao de contrato no monorepo compara essa copia com o que a API entrega
**em tempo de compilacao**: se um campo mudar de um lado so, o build da
plataforma quebra antes de qualquer site receber a versao errada.
