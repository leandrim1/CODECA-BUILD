-- Planos comerciais reais e o recurso que diz se o painel esta incluido.
--
-- Tres mudancas, e a primeira e a que **nao pode** faltar.
--
-- 1. LIMPEZA OBRIGATORIA DOS RECURSOS DE PLANO
--
-- `visual_editor_advanced_blocks`, `version_history`, `multi_page`,
-- `seo_advanced` e `remove_platform_badge` descreviam o editor visual removido
-- na etapa 0. Nenhum era verificado em lugar nenhum: os planos anunciavam o
-- que a plataforma nao faz mais.
--
-- So que `plans.limits` passa por `planLimitsSchema.parse()` em
-- `loadEffectivePlan`, e `features` e um `z.array(z.enum(PLAN_FEATURES))`.
-- Tirar os cinco do enum **sem** limpar o que esta gravado faria o parse
-- lancar -- e `loadEffectivePlan` roda em praticamente toda requisicao do
-- painel. Seria a plataforma inteira fora do ar para todo cliente, com erro
-- de validacao de um campo decorativo. `tenants.limit_overrides` recebe o
-- mesmo tratamento: ele e mesclado antes do parse.

UPDATE "plans" SET "limits" = jsonb_set(
  "limits",
  '{features}',
  COALESCE((
    SELECT jsonb_agg(f)
    FROM jsonb_array_elements_text("limits" -> 'features') AS f
    WHERE f IN ('cms_panel', 'custom_domain', 'lead_export', 'included_hosting')
  ), '[]'::jsonb)
)
WHERE "limits" ? 'features';--> statement-breakpoint

UPDATE "tenants" SET "limit_overrides" = jsonb_set(
  "limit_overrides",
  '{features}',
  COALESCE((
    SELECT jsonb_agg(f)
    FROM jsonb_array_elements_text("limit_overrides" -> 'features') AS f
    WHERE f IN ('cms_panel', 'custom_domain', 'lead_export', 'included_hosting')
  ), '[]'::jsonb)
)
WHERE "limit_overrides" IS NOT NULL AND "limit_overrides" ? 'features';--> statement-breakpoint

-- 2. O PAINEL PASSA A SER UM RECURSO DE PLANO
--
-- Quem ja tinha painel continua tendo. O Essencial fica de fora, porque o
-- plano novo vende site e dominio com o conteudo mantido pela CODECA IA -- e
-- e justamente o recurso que separa Essencial de Profissional.
UPDATE "plans" SET "limits" = jsonb_set(
  "limits",
  '{features}',
  ("limits" -> 'features') || '"cms_panel"'::jsonb
)
WHERE "code" <> 'essencial'
  AND NOT ("limits" -> 'features' @> '"cms_panel"'::jsonb);--> statement-breakpoint

-- 3. PRECOS E O PLANO EMPRESAS
--
-- Os precos sao corrigidos **somente onde ninguem mexeu**: a condicao compara
-- com o valor antigo do seed. Preco ajustado no painel mestre e decisao
-- comercial de quem opera, e uma migracao nao deve desfazer isso -- a mesma
-- regra que `ensureBaselinePlans` segue ao nunca sobrescrever.
--
-- Atencao de quem opera: isto muda o preco **na plataforma**, nao na
-- ValidaPay. Assinatura ja criada mantem o valor contratado la; sincronizar o
-- plano e republicar o preco e acao do painel mestre.
UPDATE "plans" SET "price_cents" = 1590
WHERE "code" = 'essencial' AND "price_cents" = 19900;--> statement-breakpoint

UPDATE "plans" SET "price_cents" = 5990
WHERE "code" = 'profissional' AND "price_cents" = 39900;--> statement-breakpoint

-- O Empresas nao existia. Entra somente em instalacao que **ja tem** planos.
--
-- A condicao `EXISTS` nao e zelo: sem ela, um banco novo sairia desta migracao
-- com um unico plano, e `ensureBaselinePlans` -- que so preenche com a tabela
-- vazia -- pularia. A instalacao ficaria sem o plano de avaliacao, e o
-- cadastro de empresa falha sem ele. Banco vazio e assunto do baseline, que
-- cria os quatro a partir de `DEFAULT_PLANS`.
INSERT INTO "plans" ("code", "name", "description", "price_cents", "limits", "billing", "is_public", "is_active")
SELECT
  'empresas',
  'Empresas',
  'Tudo do Profissional, com a hospedagem do site por conta da CODECA IA.',
  11990,
  '{"maxUsers":15,"maxPublishedProperties":400,"maxProjects":200,"maxDomains":3,"storageBytes":10737418240,"features":["cms_panel","custom_domain","lead_export","included_hosting"]}'::jsonb,
  '{"recurrenceType":"MONTHLY","recurrenceInterval":1,"trialDays":null,"paymentMethods":["creditcard","pix_automatico","pix","boleto"]}'::jsonb,
  true,
  true
WHERE EXISTS (SELECT 1 FROM "plans")
  AND NOT EXISTS (SELECT 1 FROM "plans" WHERE "code" = 'empresas');
