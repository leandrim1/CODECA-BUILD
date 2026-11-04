# Termos de uso e política de privacidade

Onde estão, como mantê-los fiéis ao código e o que ainda depende da empresa.

> **Rascunho técnico.** Os textos foram escritos a partir do que o código faz e
> **precisam de revisão por assessoria jurídica** antes de serem tratados como
> definitivos. A classificação LGPD (controladora × operadora) e as bases legais
> são entendimentos a confirmar.

## 1. Arquivos

| Arquivo | O que é |
| --- | --- |
| `apps/web/src/legal/privacidade.ts` | texto da Política de privacidade |
| `apps/web/src/legal/termos.ts` | texto dos Termos de uso |
| `apps/web/src/legal/empresa.ts` | identificação da CODECA IA (CNPJ, endereço, e-mail de privacidade) |
| `apps/web/src/legal/types.ts` | estrutura dos documentos |
| `apps/web/src/pages/LegalPage.tsx` | desenha os dois (rotas `/termos` e `/privacidade`) |
| `packages/shared/src/legal.ts` | `LEGAL_VERSION`, a versão dos textos |
| `tests/unit/legal.test.ts` | amarra o texto ao código (constantes, escopo do Analytics, prazos) |

## 2. Versão e registro do aceite

`LEGAL_VERSION` é a data (AAAA-MM-DD) da última alteração relevante dos textos.
Aparece no topo das páginas e é gravada, junto com o momento, no aceite:

- cadastro por e-mail e senha (`POST /api/auth/register`);
- criação da primeira empresa de quem entrou pelo Google (`POST /api/auth/company`).

Colunas `users.terms_accepted_at` e `users.terms_version` (migração
`0023_aceite_dos_termos.sql`). Contas anteriores ao registro e usuários criados
por convite ficam com `NULL` — não há aceite falso.

**Ao alterar os textos de forma relevante, atualize `LEGAL_VERSION`.** Hoje não há
fluxo que peça novo aceite a quem já aceitou uma versão anterior.

## 3. O que o texto afirma e onde o código garante

| Afirmação | Onde está no código |
| --- | --- |
| Só hash de senha (scrypt), de IP, de token e de código | `packages/shared/src/server/crypto.ts`, `lib/session.ts`, `lib/login-code.ts` |
| Cookies `codeca_session` / `codeca_csrf` / `codeca_oauth_state` / `codeca_ga_state` | `lib/cookies.ts`, `lib/oauth-state.ts`, `lib/analytics/oauth-state.ts` |
| Login Google: `openid email profile`, sem token guardado | `lib/google-oauth.ts` |
| Analytics: `analytics.readonly`, token cifrado AES-256-GCM, opcional | `lib/analytics/*`, [google-analytics.md](google-analytics.md) |
| Dados enviados à ValidaPay (nome, e-mail, telefone, documento) | `lib/billing/checkout.ts` |
| Dados do visitante (formulário) | `routes/public-api.ts`, tabela `leads` |
| Avaliação de 14 dias, tolerância de 5 | `TRIAL_PERIOD_DAYS`, `DEFAULT_GRACE_PERIOD_DAYS` |
| Limpeza: sessões 30 d, códigos 1 d, tokens 30 d | `lib/housekeeping.ts` |
| Acesso de suporte temporário, somente leitura | `lib/authz.ts` |
| Isolamento (404, FK composta) | `lib/authz.ts`, `docs/seguranca.md` |

O teste `legal.test.ts` falha se o texto citar prazos, escopo ou constantes que
divergirem do código, ou se aparecer CNPJ, e-mail, telefone ou pendência escritos
no texto.

## 4. O que ainda falta (não foi inventado)

| Item | Situação |
| --- | --- |
| **E-mail ou canal de privacidade** (`EMPRESA.emailPrivacidade`) | **Falta.** Sem ele, as páginas dizem que o canal "será divulgado nesta página". É o dado mais importante: os direitos dos titulares dependem dele. Preencha o campo e a página passa a exibi-lo (e o `mailto`) |
| CNPJ (`EMPRESA.cnpj`) | A empresa ainda não tem. Campo vazio é omitido |
| Endereço (`EMPRESA.endereco`) | Opcional; omitido enquanto vazio |
| Foro e eleição de lei | Os Termos citam só a legislação brasileira; **foro não foi definido** |
| Política de reembolso | Não há fonte confirmada; os Termos remetem ao período pago e às regras do provedor de pagamentos |
| Valores dos planos | Não estão nos Termos (mudam no painel mestre); valem os da página de planos |
| Regiões dos provedores (Vercel, Neon) | Desconhecidas; o texto diz apenas que podem tratar dados fora do Brasil (LGPD, art. 33) |
| Resend e ValidaPay em produção | O texto trata o e-mail como "quando habilitado"; confirme o que está ativo |

## 5. O que a plataforma ainda não faz (e o texto não promete)

- **Sem exclusão de conta/empresa nem exportação de dados pelo painel.** Os direitos
  do titular são atendidos pelo canal de contato. Existe a capacidade
  `tenant:delete`, mas nenhuma rota a usa. Interessados e arquivos podem ser
  excluídos no painel.
- **Sem prazo automático de retenção** para interessados e auditoria.
- **Sem novo aceite** quando os textos mudam.

## 6. Google (verificação do app)

A seção 5 da política traz a declaração de **Uso Limitado** da Política de Dados do
Usuário dos Serviços de API do Google, exigida na verificação do escopo sensível
`analytics.readonly`. A tela de consentimento do Google Cloud deve apontar para
`/privacidade` e `/termos` do domínio de produção.
