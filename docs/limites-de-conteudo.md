# Limite geral de conteúdos cadastrados

A plataforma atende qualquer segmento, então o plano não limita "imóveis" nem
"obras". Existe **um** limite, `maxContentRecords`, que conta os conteúdos
cadastrados nos módulos do site -- seja produto, serviço, imóvel, obra,
profissional, cardápio, portfólio ou registro de um módulo personalizado.

## 1. A regra comercial (preços inalterados)

| Plano | Preço | Conteúdos | Usuários | Armazenamento | Domínios |
| --- | --- | --- | --- | --- | --- |
| Avaliação | grátis | 5 | 2 | 200 MB | 0 |
| Essencial | R$ 15,90 | 20 | 2 | 500 MB | 1 |
| Profissional | R$ 59,90 | 100 | 5 | 2 GB | 1 |
| Empresas | R$ 119,90 | 400 | 15 | 10 GB | 3 |

O limite da **Avaliação** (5) não estava no pedido; segui o mesmo critério dos
outros três (o número que o plano tinha em "imóveis publicados"). Se quiser
outro, é um campo do painel mestre.

Os números acima são os de fábrica. **A fonte é o banco** (`plans.limits`),
editável no painel mestre; a página inicial, a tela de plano do cliente e o
painel mestre leem dele.

## 2. O que conta

Um registro de **qualquer módulo de coleção habilitado no site**: banners,
imóveis, obras, serviços, depoimentos, equipe, perguntas frequentes, produtos,
categorias, galerias e cada registro dos módulos personalizados de coleção. O
limite é da empresa, somando todos.

| Situação | Conta? | Por quê |
| --- | --- | --- |
| Rascunho | **sim** | continua cadastrado; senão o limite se contornaria cadastrando tudo como rascunho |
| Publicado | **sim** | |
| Arquivado | **sim** | continua cadastrado; senão arquivar viraria forma de passar do plano, e restaurar precisaria de checagem própria em cada módulo |
| Excluído | não | a exclusão é definitiva; a vaga volta na hora |
| Módulo **desabilitado** no site | não | o cliente não enxerga nem usa esses registros; se o módulo voltar, voltam a contar |
| Documento (institucional, contato, módulo personalizado de documento) | não | é uma página, não uma lista |
| Filho de um registro (etapa de obra, foto de galeria, anexo) | não | |
| Arquivos da biblioteca | não | têm o limite de armazenamento |
| Interessados (contatos do site) | não | entram por fora e não são conteúdo cadastrado |

Só a **criação** consome vaga. Publicar, arquivar e restaurar não mudam a
contagem e nunca são barrados pelo limite.

Isto mudou em relação ao modelo antigo, em que o limite de imóveis contava só os
**publicados** (rascunho não contava) e o de obras contava todas.

### Onde está no código

- `apps/api/src/lib/content-usage.ts` -- a definição, a consulta (uma só,
  `UNION ALL`) e `assertContentCapacity`. Toda a regra acima está comentada ali.
- `packages/shared/src/modules/registry.ts` -- `CONTENT_LIMIT_MODULE_KEYS`: os
  módulos de coleção, derivados do registro.
- Um módulo novo de coleção entra no limite **sozinho** na lista, mas precisa de
  uma linha em `TABELA_DO_MODULO` (não compila sem ela) e de uma criação em
  `content-limits.test.ts` (o teste de cobertura falha sem ela).

## 3. Onde é verificado

No **servidor**, antes de gravar, em toda criação: banners, imóveis, obras,
serviços, depoimentos, equipe, perguntas, produtos, categorias, galerias e
registros de módulos personalizados. Resposta `402 plan_limit_reached`, com
`details: { limit: 'maxContentRecords', max, current }`. A API pública dos sites
só grava contatos (leads), que não contam.

A interface mostra o uso (visão geral, tela de plano, aviso nas listas ao passar
de 80%), mas quem recusa é o servidor.

## 4. Quem passa do limite

Reduzir o limite de um plano, trocar a empresa para um plano menor ou migrar do
modelo antigo **nunca apaga nem esconde nada**. A empresa continua vendo,
editando e excluindo tudo e só deixa de **cadastrar** novos conteúdos até voltar
a ficar abaixo do limite. A tela de troca de plano mostra isso, com os números,
antes da confirmação.

## 5. Migração 0018

`packages/database/migrations/0018_limite_geral_de_conteudos.sql`.

- **Planos:** `maxContentRecords` = o valor que o plano já tinha em
  `maxPublishedProperties` (nos de fábrica, 5/20/100/400; num plano editado ou
  criado pelo painel mestre, preserva a decisão de quem editou).
- **Ajustes por empresa** (`tenants.limit_overrides`): quem tinha ajuste de
  imóveis ou de obras ganha o ajuste equivalente no limite geral, pelo **maior**
  dos dois valores -- um acordo comercial já feito não encolhe.
- **Descrições comerciais:** trocadas pelas novas (sem citar imóveis nem obras)
  **somente onde ninguém as tinha editado**.
- **Aditiva:** `maxPublishedProperties` e `maxProjects` **permanecem no JSON**.
  A Vercel migra durante o build, com a versão anterior do código ainda no ar, e
  ela exige as duas chaves em toda requisição. Removê-las derrubaria o painel de
  todo cliente até a nova versão entrar. Depois do deploy, uma migração futura as
  retira; o código novo já as ignora.
- Nenhum dado de cliente é tocado.

### Atenção de quem opera

A soma antiga era maior que o número novo (Essencial: 20 imóveis + 10 obras = 30
virou 20; Profissional: 150 virou 100; Empresas: 600 virou 400). Empresa que já
cadastrou mais que o novo limite não perde nada, mas **não consegue cadastrar
novos** até excluir ou subir de plano. Antes do deploy, vale consultar quem está
acima:

```sql
-- Empresas acima do limite novo (aproximacao: conta tudo, sem o filtro de modulo
-- desabilitado; o numero exato de cada empresa vem de GET /content-usage).
with registros as (
  select tenant_id from banners      union all select tenant_id from properties
  union all select tenant_id from projects     union all select tenant_id from services
  union all select tenant_id from testimonials union all select tenant_id from team_members
  union all select tenant_id from faqs         union all select tenant_id from products
  union all select tenant_id from categories   union all select tenant_id from galleries
  union all select c.tenant_id from custom_records c
    join site_custom_modules m on m.site_id = c.site_id and m.key = c.module_key and m.kind = 'collection'
)
select t.display_name, p.code,
       count(r.tenant_id) as usados,
       coalesce((t.limit_overrides->>'maxContentRecords')::int, (p.limits->>'maxContentRecords')::int) as limite
from tenants t
join plans p on p.id = t.plan_id
left join registros r on r.tenant_id = t.id
group by t.id, t.display_name, p.code, p.limits, t.limit_overrides
having count(r.tenant_id) > coalesce((t.limit_overrides->>'maxContentRecords')::int, (p.limits->>'maxContentRecords')::int)
order by usados desc;
```


## 6. Configuração

Painel mestre → Planos: campo **Conteúdos cadastrados** (limite do plano). Para
uma empresa só: `limitOverrides.maxContentRecords` em `PATCH
/api/platform/tenants/:id`. A descrição e os benefícios exibidos vêm de
`planBenefits` (`@codeca/shared`), a mesma função da página inicial, da tela de
plano e do painel mestre.
