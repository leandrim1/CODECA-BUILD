# Integracao de um site com o CODECA Build

Como um site desenvolvido pela CODECA IA passa a consumir o conteudo da
plataforma. O SDK vem na etapa 6; o que esta aqui ja funciona por HTTP.

---

## 1. As duas credenciais

A pergunta que organiza a seguranca nao e "como o site se autentica", e sim
**quem** esta chamando.

| | Chave publicavel | Chave secreta |
| --- | --- | --- |
| Prefixo | `cb_pub_` | `cb_sec_` |
| Onde roda | Navegador do visitante | Servidor do site |
| E segredo? | **Nao** | Sim |
| Le rascunho? | Nao | Sim |
| Exige origem autorizada | **Sim** | Nao |
| Pode ser consultada depois | Sim | **Nao** |

A publicavel **nao e um segredo**: e um identificador com escopo. Vazada, ela
nao da acesso a nada que ja nao fosse publico -- esse e o criterio para
considera-la segura, e nao a obscuridade. Por isso ela pode ir no codigo do
site, inclusive em variavel `VITE_*`.

A secreta aparece **uma unica vez**, na resposta que a cria. O banco guarda so
o hash. Perdida, rotaciona-se. Ela nunca vai para o navegador, nunca para uma
variavel `VITE_*` e nunca para o repositorio.

### O que nenhuma das duas le

**Dados de interessados.** Nome, telefone e e-mail sao dado pessoal e ficam
atras do painel autenticado. `leads:write` permite **criar** um interessado
pelo formulario do site; nao existe escopo que permita lista-los. E a
separacao mais importante entre "dado publico do site" e "dado privado da
empresa".

---

## 2. Origens autorizadas

A chave publicavel viaja no navegador, a vista de qualquer um. O que impede um
terceiro de usa-la no proprio site e a origem: o navegador envia `Origin` e
nao deixa a pagina mentir sobre ele.

Cadastre o endereco do site no painel mestre antes de usar a chave. Sem
nenhuma origem cadastrada, a chave publicavel **nao atende** -- falhar assim e
melhor do que atender a qualquer um.

A comparacao e **exata** sobre a origem normalizada (esquema + host, porta
padrao removida). Nada de sufixo: `termina com .construtora.com.br`
autorizaria `construtora.com.br.invasor.com`.

Isto nao protege contra um servidor determinado -- `Origin` so existe no
navegador, e quem chama por fora simplesmente nao o envia. E exatamente por
isso que a chave publicavel nao le nada que ja nao seja publico.

---

## 3. Chamando a API

```ts
const resposta = await fetch('https://app.codecabuild.com.br/api/v1/site', {
  headers: { authorization: `Bearer ${import.meta.env.VITE_CODECA_KEY}` },
});
const { data } = await resposta.json();
```

O site **nao** informa qual site ele e: isso vem da credencial. Nao ha
parametro de site para forjar.

### Rotas

| Rota | O que devolve |
| --- | --- |
| `GET /api/v1/site` | Identidade do site, modulos habilitados e escopos da chave |
| `GET /api/v1/content/institucional` | Documento institucional |
| `GET /api/v1/content/contato` | Documento de contato |
| `GET /api/v1/banners` | Banners ativos, ja filtrados pela janela de exibicao |
| `GET /api/v1/properties` | Imoveis publicados, com filtros e paginacao |
| `GET /api/v1/properties/:slug` | Um imovel, com galeria |
| `GET /api/v1/projects` | Obras publicadas |
| `GET /api/v1/projects/:slug` | Uma obra, com galeria |
| `GET /api/v1/services` | Servicos publicados |
| `POST /api/v1/leads` | Recebe o formulario de contato |

Um modulo que o site nao tem responde **404**, nao 403: para quem le o site,
ele simplesmente nao existe. Dizer "proibido" revelaria que a rota existe em
outros sites.

### Filtros de imoveis

`purpose`, `type`, `city`, `neighborhood`, `minPrice`, `maxPrice`, `bedrooms`,
`featured`, `search`, `page`, `pageSize` (maximo 50).

A listagem traz apenas a **capa** de cada imovel. A galeria completa vem no
detalhe, por `slug` -- carregar dezenas de imagens que a listagem nao usa
seria desperdicio em toda abertura de pagina.

### Previa de rascunho

`?preview=true` inclui o que ainda nao foi publicado, e exige a chave
**secreta**. Pedir previa com a publicavel responde 403: seria conteudo nao
publicado chegando ao navegador de um visitante.

### Formulario de contato

`POST /api/v1/leads` e a **unica escrita** aceita com chave publicavel, porque
o formulario roda no navegador. A protecao vem da origem autorizada, do limite
por IP e de um campo-armadilha (`honeypot`): preenchido, a API responde sucesso
e nao grava nada -- responder erro ensinaria o robo a contorna-lo.

O consentimento (`consent: true`) e obrigatorio. O IP e guardado apenas como
hash. A resposta confirma o recebimento e **nao devolve o registro**: quem
envia nao consegue ler de volta.

Vinculos (`propertyId`, `projectId`, `serviceId`) sao conferidos contra o
proprio site; um id de outra empresa simplesmente nao cola.

### Preflight

O navegador envia um `OPTIONS` **sem** o cabecalho de autorizacao. A API
responde a ele de forma permissiva, e isso nao abre nada: a requisicao real
que vem depois passa pela conferencia completa, e sem ela o navegador nao
entrega resposta nenhuma a pagina.

---

## 4. Limites

600 requisicoes por minuto por chave. Um site carrega varias chamadas de uma
vez; o limite existe contra abuso, nao contra uso normal. Estourado, a API
responde `429` com `retry-after`.

---

## 5. Rotacao

Rotacionar emite uma chave nova e marca a anterior para expirar depois de uma
janela (padrao: 60 minutos).

A sobreposicao existe porque o site do cliente nao troca a credencial no mesmo
instante: revogar na hora derrubaria o site ate alguem publicar o valor novo.
Publique a chave nova no site dentro da janela.

Se uma chave vazou, nao rotacione -- **revogue**. A revogacao vale na hora,
sem janela.

---

## 6. Checklist de um site novo

1. Cadastrar o site no painel mestre (ja acontece com a empresa).
2. Configurar os modulos e a politica de campos do projeto.
3. Cadastrar as origens: producao e, se usar, a previa da Vercel.
4. Emitir a chave publicavel e copiar para o codigo do site.
5. Emitir a chave secreta **apenas se** o site tiver servidor proprio.
6. Conferir `GET /api/v1/site` a partir do site.
