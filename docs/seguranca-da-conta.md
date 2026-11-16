# Verificação em duas etapas (TOTP)

Segundo fator por aplicativo autenticador. **Sempre opcional**: quem não ativa
entra exatamente como antes.

## 1. Como funciona

Padrão TOTP (RFC 6238), compatível com Google Authenticator, Microsoft
Authenticator, 1Password e qualquer aplicativo que siga o padrão: SHA-1, 6
dígitos, janela de 30 segundos.

```
ativar     painel → "Gerar segredo" → QR Code → digita o código → ATIVO
                                                 └→ 8 códigos de recuperação,
                                                    mostrados uma única vez

entrar     e-mail + senha → (senha correta) → código do aplicativo → sessão
                                           └→ ou um código de recuperação

desligar   senha  OU  código do aplicativo  → desligado
           (sessão aberta NÃO basta)
```

**A implementação do algoritmo é própria**, em `lib/security/totp.ts`, e não
veio de biblioteca: cabe em cinquenta linhas do `crypto` do próprio Node, e uma
dependência nova no caminho do login seria superfície de ataque permanente por
algo que não muda desde 2011. Ela é conferida contra os **seis vetores de teste
oficiais da RFC 6238** em `tests/unit/totp.test.ts`.

## 2. O que convive com o quê

| Conta | Primeira etapa | Segunda etapa |
| --- | --- | --- |
| Sem TOTP, com e-mail configurado | senha | código por e-mail (como antes) |
| Sem TOTP, sem e-mail configurado | senha | nenhuma (como antes) |
| **Com TOTP** | senha | **código do aplicativo** |
| Com TOTP, entrando pelo Google | Google | **código do aplicativo** |

Ativar o TOTP **substitui** o código por e-mail, não se soma a ele. É mais
seguro e não depende da entrega de e-mail — que, nesta data, ainda não foi
comprovada em produção.

## 3. Garantias

| Garantia | Como |
| --- | --- |
| O segredo nunca vaza | Guardado cifrado (AES-GCM, chave derivada de `AUTH_SECRET` por HKDF). Aparece em texto uma única vez, na resposta da configuração |
| O mesmo código não entra duas vezes | `last_step` grava o passo aceito; passos iguais ou anteriores são recusados |
| Códigos de recuperação são de uso único | Guardados como hash; o consumo é marcado na mesma instrução que os valida, então duas requisições simultâneas não passam as duas |
| Relógio do celular fora de hora | Tolerância de um passo para cada lado (90 s no total) |
| Força bruta | Cotas por IP (30 em 15 min) e por conta (10 em 15 min) |
| Desligar exige identidade | Senha ou código do aplicativo. **Sessão aberta não basta** |
| Nada vai para log | Nem segredo, nem código, nem código de recuperação |

**O código usado para confirmar a configuração não serve para entrar depois.**
É consequência da proteção contra reuso, e é proposital.

## 4. Para quem entrou com Google

Essas contas não têm senha. Para elas, desligar o segundo fator exige um código
do próprio aplicativo — que é um caminho forte, porque exige o aparelho. Quem
perdeu o aparelho usa um código de recuperação para entrar e, já dentro, pode
desligar com outro código de recuperação.

## 5. Onde está no código

| Peça | Arquivo |
| --- | --- |
| Algoritmo (TOTP, base32, códigos de recuperação) | `apps/api/src/lib/security/totp.ts` |
| Guarda, confirmação e validação | `apps/api/src/lib/security/totp-store.ts` |
| Rotas da conta | `apps/api/src/routes/auth.ts` (`/api/auth/totp/*`) |
| Validação no login | `apps/api/src/routes/auth-code.ts` (`/verify-totp`) |
| Tabelas | `packages/database/migrations/0031_fase6_totp_clientes_downgrade.sql` |
| Testes | `tests/integration/fase6-totp.test.ts`, `tests/unit/totp.test.ts` |

## 6. Suporte

| A pessoa diz | O que fazer |
| --- | --- |
| "Perdi o celular" | Usar um código de recuperação para entrar, e depois desligar e reconfigurar |
| "Perdi o celular e os códigos" | **Não há como recuperar sozinha.** Só a CODECA IA, pelo banco, removendo a linha em `user_totp` — e isso deve exigir confirmação de identidade fora da plataforma |
| "O código nunca funciona" | O horário do celular precisa estar automático. A tolerância é de 90 s |
| "Pedi para desligar e não deixa" | Por desenho: exige senha ou código do aplicativo |
