# Suporte: chamados

Como o suporte da plataforma funciona hoje, o que cada parte garante e o que
ainda não existe.

## O que mudou

Até aqui, "Falar com o suporte" era um `mailto:` no menu da conta. Um endereço
de e-mail não tem situação, não tem histórico e não deixa quem pediu ajuda
saber se alguém leu — e, deste lado, não havia fila para priorizar nem nada
para consultar depois.

Agora o pedido de ajuda é um **chamado**: tem número, situação, conversa e
dono. O cliente abre e acompanha em `/painel/suporte`; a equipe atende em
`/plataforma/chamados`.

## O chamado não depende do assistente de IA

Isto é uma decisão de arquitetura, não um detalhe de implementação. O
assistente da etapa seguinte pode estar desligado, sem chave configurada ou
fora do ar, e **abrir chamado continua funcionando**: nenhuma rota, nenhuma
tabela e nenhuma tela desta etapa chama provedor de IA nenhum.

O gancho para a etapa seguinte já existe no banco — `tickets.conversa_id`,
`tickets.resumo` e o autor `ia` em `ticket_messages` — porque o esquema precisa
aceitar esses valores antes, não depois. Nenhum deles é preenchido hoje.

## As garantias

### A empresa vem da sessão, nunca do corpo

Nenhum campo do pedido escolhe de quem é o chamado. `:tenantId` passa pelo
middleware que confere a participação de quem está logado, e toda consulta
filtra por empresa.

### O contexto é montado no servidor

Um chamado carrega um retrato da empresa — plano, uso de conteúdo e
armazenamento, quantos usuários, qual site, quem abriu e de qual tela. Tudo
sai do banco a partir do `tenantId` da sessão (`lib/suporte/contexto.ts`).

Se o navegador pudesse mandar esse retrato, um chamado descreveria a empresa de
outra pessoa e o atendimento acreditaria. Há teste provando que um contexto
forjado no corpo é ignorado (`tests/integration/suporte.test.ts`).

O contexto **não volta para o cliente**: ele já sabe quem é. Aparece só no
painel mestre, para quem atende.

### O que o contexto não leva

Nada de outra empresa, nada de segredo (chave de integração, token, senha) e
nada de dado pessoal dos clientes finais — interessados, por exemplo, são dados
de terceiros e não ajudam a responder "como mudo meu horário".

### Numeração por empresa

O número é sequencial **dentro da empresa**: o cliente cita "chamado 12", não um
uuid. Não é global de propósito — um contador global contaria à concorrência
quantos chamados a plataforma recebe.

Duas aberturas simultâneas disputam o mesmo número. Quem resolve é o índice
único `tickets_numero_key`: a segunda inserção falha e a rota tenta de novo.

## Quem pode o quê

| Capacidade | Quem tem | Para quê |
|---|---|---|
| `support:read` | todos os papéis, `viewer` incluído | Ver os chamados da própria empresa |
| `support:write` | `editor`, `admin`, `owner` | Abrir chamado e responder |
| `platform:support:tickets` | administrador da plataforma | Ver a fila inteira, responder e triar |

Um `viewer` **lê** o histórico de atendimento da empresa, mas não abre chamado.
Abrir grava um registro da empresa e manda o contexto dela — plano, uso, quem
abriu — para a operadora da plataforma; não é leitura. Quem só observa pede ao
administrador que o convidou, que é com quem ele já fala.

O item "Suporte" do menu é `semPainel`: aparece mesmo com o painel bloqueado
por plano vencido ou assinatura suspensa. Quem não consegue usar o produto é
exatamente quem mais precisa falar com alguém.

## Situações

| Situação | O que significa |
|---|---|
| `aberto` | Ninguém respondeu ainda |
| `em_atendimento` | A equipe está olhando |
| `aguardando_cliente` | A equipe respondeu e espera o cliente |
| `resolvido` | A equipe deu por resolvido |
| `fechado` | Encerrado (o cliente pode encerrar o próprio chamado) |

Responder devolve a vez: quando o cliente responde um chamado que estava
`aguardando_cliente`, ele volta para `em_atendimento`. Sem isso a pessoa veria,
na própria tela, que a bola continua com ela depois de ter respondido.

`primeira_resposta_em` é escrito **uma vez só**: é a medida de quanto alguém
esperou pela primeira resposta, não pela última.

## Limites

| Ação | Cota | Janela |
|---|---|---|
| Abrir chamado | 10 por empresa | 1 hora |
| Responder | 60 por empresa | 1 hora |

Por **empresa**, e não por IP ou por pessoa: quem abre chamado em excesso não é
um invasor, é um cliente aflito, e quase sempre a mesma empresa. Por IP puniria
o escritório inteiro atrás de uma saída só; por pessoa, não seguraria nada.

## Como testar

```bash
pnpm exec vitest run tests/integration/suporte.test.ts
```

São 19 casos: abertura, numeração por empresa, validação, as quatro provas de
isolamento entre empresas, a conversa dos dois lados, a triagem no painel
mestre e a cota de abertura.

No navegador, com o painel rodando:

1. Entre no painel e abra **Suporte** no menu (ou "Falar com o suporte" no menu
   da conta — os dois levam à mesma tela).
2. Abra um chamado a partir de qualquer tela: a origem é gravada sozinha.
3. Como administrador da plataforma, abra `/plataforma/chamados`, responda e
   mude a situação. O cliente vê a resposta e a mudança na própria conversa.

## O que ainda não existe

- **Aviso por e-mail ao suporte.** A fila de e-mails da plataforma
  (`email_outbox`) existe, mas os modelos foram aprovados pelo proprietário do
  produto um a um, e `BILLING_EMAILS_ENABLED` está desligado por padrão. Um
  aviso de chamado novo é um modelo a mais — texto a aprovar, não código a
  escrever.
- **Anexos.** Quem precisa mandar uma captura de tela hoje descreve o que viu.
- **O assistente de IA**, que é a etapa seguinte. Ver `.env.example`, seção
  "Assistente de suporte com IA".
