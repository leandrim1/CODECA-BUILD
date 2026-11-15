# Continuidade operacional

O que fazer quando algo para: como perceber, como agir, como recuperar e a quem
avisar. Escrito para ser seguido por uma pessoa sob pressão, não para ser lido
com calma.

> **Estado deste documento.** Os procedimentos descrevem o comportamento real do
> código. O que depende de um painel externo (Vercel, Neon, ValidaPay, Resend)
> está marcado como **a conferir** enquanto ninguém tiver confirmado no painel.
> Nenhum ensaio de restauração foi executado ainda (seção 8).

## Checklist de emergência

Em qualquer incidente, nesta ordem:

1. **Anote a hora** em que você percebeu. Abra um registro (seção 12).
2. **Abra `https://codecabuild.vercel.app/api/health?db=1&ops=1`.**
   - Não responde → a função ou a Vercel (seção 2).
   - Responde com `database` diferente de `ok` → o banco (seção 3).
   - Responde com `ops.reconcileOverdue: true` → a conciliação parou (seção 6).
3. **Confira as páginas de status** dos provedores (seção 1).
4. **Não publique nada às pressas.** Um envio para o ramo de produção publica
   na hora e pode piorar. Se o problema começou logo depois de uma publicação,
   reverta-a pelo painel da Vercel (seção 2).
5. **Não rode migração, não restaure banco, não reprocesse eventos em massa**
   sem a autorização da seção 13.
6. **Avise os clientes** se o site deles ou o painel estiverem afetados há mais
   de 30 minutos (seção 11).
7. Depois de resolvido: confira a cobrança (seção 10) e feche o registro.

## 1. Como perceber uma indisponibilidade

| Sinal | Onde aparece | O que quer dizer |
| --- | --- | --- |
| Alerta no canal configurado | Slack/Discord/e-mail de `OPS_ALERT_*` | Falha crítica registrada pela própria aplicação (ver [monitoramento.md](monitoramento.md)) |
| `/api/health` não responde | navegador, monitor externo | Função fora do ar ou implantação quebrada |
| `/api/health?db=1` → 503 | idem | Banco não responde |
| `/api/health?ops=1` → 503 | idem | Conciliação diária não roda há mais de 26 h |
| Painel da plataforma → Cobrança → eventos com falha | painel | Webhooks recebidos e não aplicados |
| Cliente reclama | suporte | O monitoramento falhou em avisar antes — registre isso |

Páginas de status (guarde nos favoritos):

- Vercel: `vercel-status.com`
- Neon: `neonstatus.com`
- Resend: `resend-status.com`
- ValidaPay: **a conferir** — peça ao suporte deles o endereço da página de
  status e o canal de incidentes.

**O que a aplicação não percebe sozinha:** se a função inteira estiver fora do
ar, ela não consegue alertar. Por isso é preciso um **monitor externo** de
disponibilidade chamando `/api/health?db=1&ops=1` a cada poucos minutos — ver
[monitoramento.md](monitoramento.md). Enquanto ele não existir, uma queda
total só é percebida por uma pessoa.

## 2. Vercel indisponível, ou publicação quebrada

**Efeito:** painel, API e página inicial fora do ar. Os sites dos clientes que
buscam conteúdo pela API deixam de receber atualizações (o que cada site mostra
nesse intervalo depende de como ele foi construído).

**Não se perde:** dados (estão no Neon), arquivos (Vercel Blob), eventos de
cobrança (a ValidaPay reenvia entregas que falharam — **a conferir** por quanto
tempo; o código assume até 72 h).

**O que fazer**

1. Confirme na página de status se é incidente da Vercel. Se for, não há ação
   técnica: avise os clientes e aguarde.
2. Se **não** for incidente deles e começou depois de uma publicação: no painel
   da Vercel, Deployments → escolha a última publicação que funcionava →
   **Promote to Production** (ou "Instant Rollback"). É reversível e não mexe
   no banco.
   - **Atenção a migrações:** se a publicação quebrada aplicou uma migração, o
     código antigo pode não funcionar com o esquema novo. Confira no log do
     build ("migrações aplicadas") antes de reverter. Nesse caso, a correção é
     publicar um conserto, não reverter.
3. Quando voltar: siga a seção 10.

## 3. Neon indisponível

**Efeito:** a API responde 503 com `Retry-After` em tudo que usa banco (login,
painel, conteúdo dos sites). `/api/health` sem `?db=1` continua respondendo —
é assim que se distingue banco de função.

**O que a aplicação já faz:** respostas 503 (e não 500), disjuntor nas
consultas, recusa de carga quando satura, alerta `db_unavailable`.

**O que fazer**

1. Confira a página de status do Neon.
2. No painel do Neon, veja se o projeto está ativo e se a computação não foi
   suspensa por limite do plano (**a conferir**: quais limites o seu plano tem).
3. Não troque `DATABASE_URL` nem crie outro banco para "voltar rápido": um
   banco vazio faria a plataforma parecer ter perdido todos os clientes, e a
   primeira conta cadastrada viraria administradora.
4. Se o banco voltou mas há suspeita de perda ou corrupção de dados: seção 8.

## 4. ValidaPay indisponível

**Efeito**

| Operação | Comportamento |
| --- | --- |
| Clientes já pagantes | **Nada muda.** O acesso vale até `access_until`, com tolerância |
| Nova contratação | Falha com mensagem clara; o cliente continua na avaliação, se ainda tiver |
| Cancelamento, troca de plano | Falham; nada é alterado localmente |
| Exclusão de empresa com assinatura | **Recusada**, nada é apagado (ver [lgpd.md](lgpd.md)) |
| Webhooks | Não chegam; a ValidaPay reenvia depois |
| Conciliação diária | Registra falhas e alerta `billing_provider_error` |

**O que fazer**

1. Não suspenda nem libere ninguém manualmente por causa da queda.
2. Quando voltar: rode a conciliação (seção 7) e confira os eventos pendentes.
3. Se um cliente pagou durante a queda e está bloqueado: no painel dele, o
   botão de atualizar a situação do pagamento consulta a ValidaPay na hora.

## 5. Resend indisponível, ou e-mail não entregue

**Efeito:** com o código por e-mail ativo, **ninguém consegue entrar** — o
login responde "não foi possível enviar o e-mail". Recuperação de senha,
convites e avisos de novos interessados também param.

**O que a aplicação já faz:** uma nova tentativa em falha passageira, disjuntor
depois de cinco falhas seguidas, alerta `email_failed`.

**O que fazer**

1. Painel da plataforma → Visão geral → cartão **Envio de e-mail**: o veredito
   do provedor e a situação do domínio.
2. Se o domínio perdeu a verificação: corrija o DNS ([email.md](email.md)).
3. Se for incidente do Resend e precisar que as pessoas entrem **agora**:
   remover `RESEND_API_KEY` das variáveis de produção e republicar faz o login
   por senha voltar a funcionar sem a segunda etapa (desde que
   `LOGIN_CODE_REQUIRED` não esteja `true`). **É uma redução de segurança
   temporária** — exige a autorização da seção 13, e a chave volta assim que o
   provedor normalizar.

## 6. Tarefas agendadas pararam

A conciliação diária (`/api/billing/reconcile`) é a rede de segurança dos
pagamentos: retoma eventos pendentes, confere assinaturas na ValidaPay,
reenvia avisos aos sites e limpa registros vencidos.

**Como se percebe:** alerta `job_missed` (a outra tarefa agendada confere que
esta rodou), ou `/api/health?ops=1` com `reconcileOverdue: true`.

**O que fazer**

1. Painel da Vercel → projeto → Cron Jobs: os dois agendamentos existem e estão
   ativos? O último disparo teve qual resposta?
2. Resposta 401: `CRON_SECRET` ausente ou diferente de
   `BILLING_RECONCILIATION_SECRET`.
3. Rode à mão, uma vez (seção 7).

## 7. Webhooks de cobrança: conferir falhas e recuperar eventos

**Onde olhar:** painel da plataforma → Cobrança → eventos recebidos. Cada
evento tem uma situação:

| Situação | Significado | Ação |
| --- | --- | --- |
| Processado | Aplicado | Nenhuma |
| Ignorado | Evento que a integração não trata (ex.: cobrança avulsa) | Nenhuma |
| Pendente | Gravado, ainda não aplicado | É retomado sozinho na próxima entrega ou na conciliação |
| Falhou | A aplicação deu erro; a mensagem está no evento | Até 10 tentativas automáticas; depois, reprocesso manual |
| Não resolvido | Não foi possível ligar o evento a uma empresa | Investigar: assinatura de empresa excluída? link de pagamento antigo? |

**Recuperar**

- **Automático:** eventos pendentes são retomados depois de cada novo webhook e
  na conciliação diária.
- **Conciliação à mão** (substitua o segredo; ele não deve ficar no histórico
  do terminal):

  ```bash
  curl -X POST https://codecabuild.vercel.app/api/billing/reconcile \
    -H "Authorization: Bearer $BILLING_RECONCILIATION_SECRET"
  ```

- **Um evento específico:** painel da plataforma → Cobrança → o evento →
  Reprocessar.

**É seguro repetir.** Cada evento é aplicado uma única vez: entregas repetidas
são reconhecidas pelo identificador, e uma trava impede que dois caminhos
apliquem o mesmo evento ao mesmo tempo.

**Webhooks recusados** (alerta `webhook_rejected`): quase sempre o segredo de
assinatura cadastrado na ValidaPay ficou diferente de
`VALIDAPAY_WEBHOOK_SECRET`. Enquanto estiver errado, **todo pagamento deixa de
entrar**; a conciliação diária compensa, com até um dia de atraso.

## 8. Restaurar o banco

> **Nenhuma restauração foi ensaiada ainda.** Antes de precisar de verdade,
> faça o ensaio abaixo e anote o tempo que levou. Um procedimento de
> restauração que nunca foi executado é uma hipótese.

**Regra que não se quebra:** restaura-se para um banco **novo e separado**.
Nunca por cima do banco de produção. A produção só passa a usar o banco
restaurado depois da validação (seção 9) e da autorização (seção 13).

### O que conferir no Neon antes (a conferir, sem evidência ainda)

| Item | Onde ver no painel |
| --- | --- |
| Plano contratado | Billing |
| Janela de recuperação (quantas horas ou dias para trás dá para voltar) | Settings → Storage / Instant restore |
| Região do projeto | Settings → General |
| Limites de computação e armazenamento | Billing → Usage |
| Se há cópia fora do Neon | Não há, até alguém criar (ver "Exportação") |

A janela de recuperação é a pergunta mais importante: um problema percebido
depois dela **não tem volta**. Em planos gratuitos ela costuma ser de horas.

### Ensaio de restauração (seguro, não toca na produção)

1. No Neon: **Branches → Create branch**, a partir do ramo principal, em um
   **instante no passado** (por exemplo, uma hora atrás). Isso cria um banco
   separado, com os dados daquele instante. O ramo principal não é alterado.
2. Copie a string de conexão **do ramo novo**. Trate-a como segredo.
3. Na sua máquina, com o repositório atualizado, rode a verificação (somente
   leitura):

   ```bash
   RESTORE_CHECK_DATABASE_URL="<conexão do ramo restaurado>" pnpm run ops:verificar-restauracao
   ```

   Ela confere se as migrações batem com as do repositório, conta as tabelas
   e as linhas das principais e procura registros órfãos.
4. Anote: instante escolhido, hora de início, hora de fim, resultado.
5. **Apague o ramo de ensaio** no Neon quando terminar — ele contém dados reais
   de clientes.

**Dados de clientes:** o ramo restaurado é uma cópia de produção. Não o
conecte a prévias, a máquinas de terceiros nem a ferramentas de análise. Se
for preciso trabalhar com uma cópia por mais tempo, ela deve ser anonimizada
antes, com autorização.

### Exportação (cópia fora do Neon)

Uma cópia que depende do mesmo provedor que o original não protege contra a
perda da conta ou um erro de cobrança do provedor. Recomendação: um `pg_dump`
periódico, cifrado, guardado fora do Neon. **Não está implementado** — exige
decidir onde guardar e quem tem a chave.

### Restauração de verdade

1. Autorização (seção 13). Registre o motivo e o instante para o qual voltar.
2. Coloque a plataforma em manutenção ou aceite que escritas feitas a partir
   de agora serão perdidas — decida e registre.
3. Crie o ramo no instante desejado (passo 1 do ensaio).
4. Valide (seção 9).
5. Só então troque `DATABASE_URL` de produção para o ramo restaurado e
   republique. Guarde a conexão antiga: é o caminho de volta.
6. Siga a seção 10 — **obrigatório**, porque o banco voltou no tempo e a
   ValidaPay não.

## 9. Validar uma recuperação

Antes de declarar resolvido:

- [ ] `/api/health?db=1&ops=1` responde 200.
- [ ] A verificação de restauração passou (quando houve restauração).
- [ ] Você consegue entrar no painel da plataforma.
- [ ] O número de empresas e de assinaturas ativas bate com o esperado.
- [ ] Uma empresa de teste abre o painel e vê o próprio conteúdo.
- [ ] O site de um cliente recebe conteúdo pela API.
- [ ] A conciliação rodou à mão e terminou sem falhas.
- [ ] Não há eventos de cobrança em "Falhou".

## 10. Evitar cobrança ou acesso errado depois de um incidente

O que protege contra duplicidade, por construção:

- **Evento repetido não é aplicado duas vezes** (identificador único + trava).
- **O acesso só avança com pagamento confirmado**; nunca por criação de
  assinatura, nem por estado otimista.
- **Renovação nunca encurta** um período já pago.
- **Contratação repetida** dentro de 30 minutos devolve a mesma sessão de
  pagamento, em vez de criar outra.

O que **você** precisa conferir depois de um incidente:

1. Rode a conciliação. Ela compara cada assinatura com a ValidaPay e registra
   divergências.
2. Painel da plataforma → Cobrança → divergências e eventos não resolvidos.
3. **Depois de uma restauração do banco:** tudo que aconteceu entre o instante
   restaurado e agora sumiu do nosso lado e continua valendo na ValidaPay —
   contratações, cancelamentos, trocas de plano. A conciliação recupera o
   estado das assinaturas que **já existiam** no instante restaurado. Empresas
   que **se cadastraram e pagaram** nesse intervalo não existem mais no banco:
   os eventos delas ficam como "não resolvido" e exigem contato com o cliente.
4. Nunca reenvie cobranças pelo painel da ValidaPay para "corrigir": confira
   primeiro o que ela já cobrou.

## 11. Comunicar uma indisponibilidade aos clientes

**Quando avisar:** painel ou sites afetados há mais de 30 minutos; qualquer
suspeita de perda de dados; qualquer cobrança indevida — imediatamente.

**Por onde:** hoje não há página de status nem envio em massa pela plataforma.
O aviso é manual, pelo canal de atendimento que você usa com cada cliente.
Recomendação: uma página de status simples, hospedada **fora** da Vercel (se a
Vercel cair, ela precisa continuar no ar).

**O que dizer** — fatos, sem causa presumida e sem prazo que você não controla:

> Identificamos às HH:MM uma instabilidade em [painel / atualização dos sites /
> pagamentos]. Seus dados e seu conteúdo estão preservados. Estamos atuando e
> voltamos a informar até HH:MM.

Depois de resolvido, diga o que houve, por quanto tempo, se algum dado foi
afetado e o que mudou para não se repetir.

**Incidente com dados pessoais** (acesso indevido, vazamento, perda): há
obrigação legal de comunicar a ANPD e os titulares em prazo curto. Acione o
encarregado de dados e o apoio jurídico **antes** de comunicar — ver
[lgpd.md](lgpd.md). Esse papel ainda está por definir.

## 12. Registrar o incidente

Um registro por incidente, mesmo dos pequenos. Modelo:

```
Início percebido:        AAAA-MM-DD HH:MM
Início real (se souber): AAAA-MM-DD HH:MM
Fim:                     AAAA-MM-DD HH:MM
Como foi percebido:      alerta / monitor externo / cliente / acaso
O que parou:             painel / API pública / login / pagamentos / e-mail
Quem foi afetado:        todos / empresas X, Y
Causa:                   (o que se sabe; "desconhecida" é resposta válida)
O que foi feito:         (em ordem, com hora)
Dados afetados:          nenhum / quais
Cobrança afetada:        nenhuma / quais assinaturas
Clientes avisados:       quando e por onde
O que muda:              (ação, responsável, prazo)
```

Onde guardar: fora do repositório público, em local que continue acessível se
a Vercel e o GitHub estiverem fora do ar.

## 13. Quem autoriza

| Ação | Quem autoriza |
| --- | --- |
| Reverter uma publicação | Responsável técnico de plantão |
| Rodar a conciliação à mão, reprocessar um evento | Responsável técnico de plantão |
| Suspender ou liberar o acesso de uma empresa manualmente | Proprietário |
| Restaurar o banco de produção | **Proprietário, por escrito**, com o instante de retorno |
| Desligar a segunda etapa do login (remover a chave de e-mail) | **Proprietário** |
| Trocar credenciais da ValidaPay, do Resend ou do banco | **Proprietário** |
| Comunicar incidente com dados pessoais | **Proprietário + encarregado de dados** |

Os nomes e os contatos de quem ocupa cada papel **precisam ser preenchidos** —
este documento define os papéis, não as pessoas. Guarde-os junto com o
registro de incidentes, não aqui.
