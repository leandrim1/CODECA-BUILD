# Isenção de cobrança da CODECA IA

A plataforma não cobra de si mesma. A empresa que a CODECA IA usa para o
próprio site tem acesso completo e nunca é barrada por assinatura.

## 1. O que a isenção dá

| | Empresa isenta | Qualquer cliente |
| --- | --- | --- |
| Contratar plano | Não precisa | Como sempre |
| Mensalidade | Nenhuma | Como sempre |
| ValidaPay | Não depende | Como sempre |
| Somente leitura por pendência | **Nunca** | Como sempre |
| Painel indisponível por inadimplência | **Nunca** | Como sempre |
| Site público fora do ar por pendência | **Nunca** | Como sempre |
| Limites de usuários, conteúdos, domínios, armazenamento | Sem teto comercial | Como sempre |
| Recursos do plano (painel, domínio próprio, exportação…) | Todos | Como sempre |

**Nada muda para os clientes.** Preços, planos, limites e regras de cobrança
continuam exatamente como estavam.

## 2. Como configurar

Uma variável de ambiente, na hospedagem:

```
PLATFORM_OWNER_TENANT_IDS=<identificador-da-empresa>
```

Mais de uma empresa: separe por vírgula. Vazia (o padrão) significa que
ninguém é isento.

**Para descobrir o identificador:** entre no painel e, no mesmo navegador,
abra `<APP_URL>/api/auth/session`. O valor está em `memberships[].tenantId`.

## 3. Por que por EMPRESA, e não por pessoa

O pedido original sugeria uma lista de usuários (`PLATFORM_OWNER_USER_IDS`).
Não dá, e o motivo é concreto:

> O papel de **proprietário é concedível por convite** (`routes/members.ts`,
> `canAssignRole`). Qualquer cliente pode convidar o dono da plataforma como
> proprietário da empresa dele.

Se a isenção seguisse a pessoa, bastaria esse convite ser aceito — por engano,
uma única vez — para a empresa do cliente virar gratuita e ilimitada. Com o
identificador da empresa não há esse caminho: nenhuma ação de cliente cria,
altera ou alcança um `tenantId` que esteja na lista. Ela só muda por variável
de ambiente, o que exige acesso ao painel da hospedagem.

Há teste para isso: `ter a pessoa da CODECA IA como proprietária NÃO torna a
empresa isenta`.

## 4. Onde a regra é aplicada

Em **dois pontos de passagem obrigatória**, não espalhada por dezenas de
verificações:

| Ponto | Arquivo | O que cobre |
| --- | --- | --- |
| Plano efetivo | `lib/plan-limits.ts` → `loadEffectivePlan` | Todos os limites e recursos: usuários, conteúdos, domínios, armazenamento, painel, domínio próprio |
| Estado da assinatura | `lib/billing/suspension.ts` → `resolveSiteBilling` | Somente leitura, painel bloqueado e o 402 da API pública |

Toda regra de limite lê o plano por `loadEffectivePlan`, e toda restrição por
assinatura lê por `resolveSiteBilling`. Um ponto para cada garante que nenhuma
verificação fique de fora — hoje ou quando a próxima for escrita. Espalhar
`if (isento)` por vinte lugares teria o problema oposto: basta esquecer um
para a isenção falhar justamente onde importa.

A lista fica em `lib/platform-owner.ts`, definida uma vez por
`createContext` — mesmo padrão de `setSlowQueryThreshold`, que já existia.

## 5. O que a pessoa vê

Na empresa isenta:
- o aviso "painel em somente leitura por pendência" **não aparece**;
- o botão **Regularizar** não aparece;
- em Plano e assinatura: "Acesso liberado", com a tarja "Isenta de cobrança" e
  a explicação de que não há nada a contratar.

Para os clientes, a interface e os avisos continuam idênticos.

## 6. O que a isenção NÃO faz

- **Não apaga nem altera dado nenhum.** É uma regra de leitura: nada é gravado
  por causa dela.
- **Não cria assinatura fictícia** na ValidaPay nem registra pagamento.
- **Não muda preço, plano ou regra de cobrança** de ninguém.
- **Não dá poderes de painel mestre.** Isenção é cobrança; administração da
  plataforma continua sendo o papel `platform_admin`.
- **Não sobrevive à remoção da variável.** Tire o identificador da lista e a
  empresa volta a seguir as regras normais, sem migração nem limpeza.

## 7. Onde está no código

| Peça | Arquivo |
| --- | --- |
| Lista e limites da isenção | `apps/api/src/lib/platform-owner.ts` |
| Variável de ambiente | `apps/api/src/env.ts` |
| Aplicação na montagem | `apps/api/src/context.ts` |
| Limites | `apps/api/src/lib/plan-limits.ts` |
| Assinatura | `apps/api/src/lib/billing/suspension.ts` |
| Tela | `apps/web/src/dashboard/BillingPage.tsx` |
| Testes | `tests/integration/isencao-proprietario.test.ts` |
