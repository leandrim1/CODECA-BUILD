# Mudança de plano e autoatendimento

Como o cliente muda de plano, e o que ele passa a resolver sozinho.

## 1. O defeito que isto corrigiu

Até a Fase 6, `/billing/change-plan` conferia **apenas a cobrança**: nada
olhava se a conta cabia no plano de destino. Uma empresa com 40 conteúdos podia
pedir o Essencial (limite 5), o pedido seguia para o provedor, e o sistema só
descobria o problema na próxima tentativa de cadastrar algo — com o cliente já
no plano menor, sem aviso nenhum.

Agora a conta é conferida **antes de falar com o provedor**.

## 2. A regra

> **Reduzir plano nunca apaga nada.** O que existe continua existindo e
> continua aparecendo no site. O limite menor impede **criar mais**.

Quem aplica isso são as validações que já existiam (`assertWithinLimit`,
`assertContentCapacity`, `assertStorageAvailable`). A novidade é avisar antes.

## 3. O que é conferido

| Limite | Se estourar |
| --- | --- |
| Pessoas com acesso | **Bloqueia** a redução |
| Conteúdos cadastrados | **Bloqueia** |
| Domínios | **Bloqueia** |
| Armazenamento | **Bloqueia** |
| Recursos do plano (painel, domínio próprio, exportação…) | **Avisa**, não bloqueia |

A diferença é deliberada: um limite estourado é algo que a pessoa consegue
ajustar (apagar, remover, liberar espaço), e seguir sem ajustar deixaria a
conta num estado em que nada mais entra. Perder um recurso é uma **escolha
legítima** — quem decide descer para um plano sem painel sabe o que está
fazendo, e impedir isso seria prender o cliente no plano caro.

Não há limite de projetos nos planos, então projetos não entram na conferência.
Inventar um aqui seria criar uma regra comercial que ninguém definiu.

## 4. Como funciona na prática

```
cliente escolhe o plano
        │
        ├─ prévia (preview: true) ──► o que muda, sem alterar nada
        │                              • limites estourados, com quanto
        │                              • recursos que somem
        │                              • o que fazer para caber
        │                              • valores da pró-rata (do provedor)
        │
        └─ confirma
              │
              ├─ não cabe  ──► RECUSA (409). O provedor nem é chamado
              │
              └─ cabe ──► o provedor registra a troca
                            │
                            ├─ plano mais caro: pró-rata agora
                            └─ plano mais barato: SCHEDULED_DOWNGRADE,
                               vale a partir do próximo ciclo
                            │
                            └─► a tela mostra "plano atual → plano novo,
                                a partir de <data>"
                                  │
                                  └─ webhook confirma ──► plano promovido
```

**Quem agenda a redução é o provedor, não a plataforma.** A ValidaPay responde
`mode: SCHEDULED_DOWNGRADE` e `effectiveAt`; a plataforma guarda os dois em
`subscriptions.pending_plan_mode` e `pending_plan_effective_at` e mostra. Nenhum
cálculo financeiro é feito aqui — nem pró-rata, nem crédito, nem data.

### Cancelar uma redução já pedida

**Não implementado**, e por decisão. A API da ValidaPay não tem uma rota de
"cancelar troca agendada": o caminho seria pedir a troca de volta para o plano
atual, o que o provedor trataria como um **upgrade** e poderia gerar cobrança
de pró-rata. Criar um botão "cancelar" que às vezes cobra o cliente seria
inventar uma regra financeira.

Enquanto isso, quem pedir para desfazer fala com a CODECA IA, que avalia com a
prévia (`dryRun`) antes de qualquer coisa.

## 5. Autoatendimento de chaves

| O cliente pode | Observação |
| --- | --- |
| Ver as chaves, a situação, a data de criação e o último uso | O segredo **nunca** volta: o banco guarda só o hash |
| Revogar | Efeito imediato. O site para de receber conteúdo até publicarem a chave nova — a tela diz isso antes |
| Trocar por uma nova (rotação) | A antiga continua valendo por um tempo (padrão 60 min), para o site não cair. O segredo novo aparece **uma vez** |
| **Emitir a primeira chave** | **Não.** Continua com a CODECA IA, que é quem conecta o site |

Ver as chaves e revogá-las funciona **em qualquer plano**, inclusive no
Essencial: revogar uma chave vazada é segurança, e não pode depender de o plano
incluir o painel de conteúdo.

## 6. Autoatendimento de módulos

Ligar e desligar os módulos que o plano já inclui. **Não existe módulo pago** —
isso seria produto novo, não autoatendimento.

> **Desligar esconde, não apaga.** O conteúdo continua no banco e volta a
> aparecer assim que o módulo for ligado de novo.

Antes de confirmar, a tela mostra o que muda:

- quantos conteúdos deixam de aparecer no site;
- se outro módulo ligado depende deste;
- se este módulo depende de outro que está desligado.

As dependências vêm de **chaves estrangeiras reais** no banco, não de um
catálogo inventado. Hoje há uma: `produtos` usa `categorias`
(`products.category_id`).

Sem o recurso `cms_panel` no plano, a rota recusa com a razão escrita — não há
botão que o servidor rejeitaria.

## 7. Segurança

| Risco | Como é fechado |
| --- | --- |
| Alcançar a chave de outra empresa | A consulta filtra pelo site da sessão. Trocar o identificador dá 404 |
| Alcançar o módulo de outra empresa | Mesma coisa, pela empresa resolvida da sessão |
| Editor revogando chave sem querer | `integration:manage` é de administrador e proprietário. Editor não tem |
| Liberar recurso pago pelo navegador | Toda regra é conferida no servidor; a tela é conveniência |
| Rastrear quem fez o quê | Revogação, rotação e troca de módulo vão para a auditoria, com `via: autoatendimento` |

## 8. Onde está no código

| Peça | Arquivo |
| --- | --- |
| Impacto da mudança de plano | `apps/api/src/lib/billing/mudanca-de-plano.ts` |
| Regras de chaves e módulos | `apps/api/src/lib/autoatendimento.ts` |
| Rotas | `apps/api/src/routes/autoatendimento.ts` |
| Verificação na troca de plano | `apps/api/src/routes/billing.ts` |
| Tela | `apps/web/src/dashboard/IntegrationPage.tsx` |
| Testes | `tests/integration/fase6-autoatendimento.test.ts` |
