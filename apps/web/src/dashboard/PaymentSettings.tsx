import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { PAYMENT_METHOD_OPTIONS, formatDateTime } from '@codeca/shared';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Modal,
  Select,
  useToast,
} from '@codeca/ui';
import { billingApi } from '../services/endpoints.js';
import { ApiError } from '../services/api.js';
import type { BillingSubscriptionView } from '../types/index.js';

/**
 * Forma de pagamento e dia de vencimento da assinatura.
 *
 * ## O que esta tela nao faz, de proposito
 *
 * Nao troca PARA cartao de credito nem para Pix Automatico. Cartao exigiria
 * coletar os dados do cartao aqui, e hoje eles so passam pela pagina hospedada
 * da ValidaPay -- nada de cartao toca esta aplicacao. O Pix Automatico depende
 * de uma autorizacao do pagador no proprio banco. Ambos seguem pela equipe.
 *
 * ## Dinheiro nunca muda sem simulacao
 *
 * Mudar o vencimento pode cobrar ou descontar a diferenca de dias. Por isso o
 * botao abre a **simulacao** (que nao altera nada) e so depois de a empresa ver
 * as datas e o valor existe o botao que confirma.
 */

const DIAS = Array.from({ length: 28 }, (_, i) => i + 1);

const centsLabel = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

type Simulacao = Awaited<ReturnType<typeof billingApi.changeDueDay>>;

export function PaymentSettings({
  tenantId,
  subscription,
  onChanged,
}: {
  tenantId: string;
  subscription: BillingSubscriptionView;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [working, setWorking] = useState(false);

  // ---- forma de pagamento
  const atual = subscription.paymentMethod;
  const opcoes = (['pix', 'boleto'] as const).filter((code) => code !== atual);
  const [novaForma, setNovaForma] = useState<'pix' | 'boleto' | ''>('');
  const [confirmaForma, setConfirmaForma] = useState(false);

  // ---- vencimento
  const diaAtual = subscription.nextChargeAt ? new Date(subscription.nextChargeAt).getUTCDate() : null;
  const [dia, setDia] = useState<number | ''>('');
  const [prorata, setProrata] = useState(true);
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);
  const [erroSimulacao, setErroSimulacao] = useState<string | null>(null);

  const trocarForma = async () => {
    if (!novaForma) return;
    setWorking(true);
    try {
      const result = await billingApi.changePaymentMethod(tenantId, { paymentMethod: novaForma });
      toast.success('Forma de pagamento trocada', result.message);
      setConfirmaForma(false);
      setNovaForma('');
      onChanged();
    } catch (error) {
      toast.error('Não foi possível trocar', error instanceof ApiError ? error.message : undefined);
    } finally {
      setWorking(false);
    }
  };

  const simular = async () => {
    if (dia === '') return;
    setWorking(true);
    setErroSimulacao(null);
    try {
      setSimulacao(await billingApi.changeDueDay(tenantId, { billingDay: dia, prorata, preview: true }));
    } catch (error) {
      toast.error('Não foi possível simular', error instanceof ApiError ? error.message : undefined);
    } finally {
      setWorking(false);
    }
  };

  const confirmarVencimento = async () => {
    if (dia === '') return;
    setWorking(true);
    try {
      const result = await billingApi.changeDueDay(tenantId, { billingDay: dia, prorata, preview: false });
      toast.success('Vencimento alterado', result.message);
      setSimulacao(null);
      setDia('');
      onChanged();
    } catch (error) {
      setErroSimulacao(error instanceof ApiError ? error.message : 'Não foi possível alterar agora.');
    } finally {
      setWorking(false);
    }
  };

  const manual = novaForma ? !PAYMENT_METHOD_OPTIONS[novaForma].automatic : false;

  return (
    <Card>
      <CardHeader
        title="Pagamento e vencimento"
        description="Como e quando a assinatura é cobrada."
      />
      <CardBody className="grid gap-6 text-sm text-slate-600">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Forma de pagamento</dt>
            <dd className="mt-1 font-medium text-slate-900">
              {subscription.paymentMethodLabel ?? 'Não informada'}
            </dd>
            <dd className="text-xs text-slate-500">
              {subscription.automaticRenewal
                ? 'Renovação automática.'
                : 'Renovação manual: a cada ciclo você recebe a cobrança e precisa pagá-la.'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Próxima cobrança</dt>
            <dd className="mt-1 font-medium text-slate-900">
              {subscription.nextChargeAt ? formatDateTime(subscription.nextChargeAt) : 'Sem data prevista'}
            </dd>
          </div>
        </dl>

        <section className="grid gap-3" aria-labelledby="troca-forma">
          <h3 id="troca-forma" className="text-sm font-semibold text-slate-900">
            Trocar a forma de pagamento
          </h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Select
              label="Nova forma"
              value={novaForma}
              onChange={(event) => setNovaForma(event.target.value as 'pix' | 'boleto' | '')}
              placeholder="Escolha"
              options={opcoes.map((code) => ({ value: code, label: PAYMENT_METHOD_OPTIONS[code].label }))}
            />
            <Button variant="outline" disabled={!novaForma || working} onClick={() => setConfirmaForma(true)}>
              Trocar
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            A troca vale a partir da próxima cobrança; a que está em aberto não muda. Para usar cartão
            de crédito ou Pix Automático, fale com a CODECA IA: esses dois dependem de uma autorização
            que não é feita por aqui.
          </p>
        </section>

        <section className="grid gap-3" aria-labelledby="troca-dia">
          <h3 id="troca-dia" className="text-sm font-semibold text-slate-900">
            Mudar o dia de vencimento
          </h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Select
              label="Novo dia do mês"
              value={dia === '' ? '' : String(dia)}
              onChange={(event) => setDia(event.target.value ? Number(event.target.value) : '')}
              placeholder={diaAtual ? `Hoje: dia ${diaAtual}` : 'Escolha'}
              options={DIAS.map((d) => ({ value: String(d), label: `Dia ${d}` }))}
            />
            <Button variant="outline" disabled={dia === '' || working} onClick={() => void simular()}>
              Ver simulação
            </Button>
          </div>
          <Checkbox
            label="Ajustar o valor pelos dias de diferença"
            hint="Ao adiar, os dias a mais entram na próxima cobrança; ao antecipar, os dias a menos viram desconto."
            checked={prorata}
            onChange={setProrata}
          />
          <p className="text-xs text-slate-500">
            Você vê as datas e o valor antes de confirmar. Só os dias 1 a 28 são oferecidos, para o
            dia escolhido ser sempre o dia cobrado.
          </p>
        </section>
      </CardBody>

      <Modal
        open={confirmaForma}
        onClose={() => setConfirmaForma(false)}
        title="Trocar a forma de pagamento"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmaForma(false)} disabled={working}>
              Cancelar
            </Button>
            <Button onClick={() => void trocarForma()} loading={working}>
              Confirmar troca
            </Button>
          </>
        }
      >
        <div className="grid gap-3 text-sm text-slate-600">
          <p>
            De <strong>{subscription.paymentMethodLabel ?? 'forma atual'}</strong> para{' '}
            <strong>{novaForma ? PAYMENT_METHOD_OPTIONS[novaForma].label : ''}</strong>, a partir da
            próxima cobrança.
          </p>
          {manual && subscription.automaticRenewal ? (
            <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle aria-hidden="true" className="size-4 flex-none" />
              Você deixa de ter débito automático. A cada ciclo será emitida uma cobrança, e se ela
              não for paga a assinatura entra em atraso e o site pode ser suspenso.
            </p>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={simulacao !== null}
        onClose={() => setSimulacao(null)}
        title={simulacao ? `Vencimento no dia ${simulacao.newBillingDay}` : 'Vencimento'}
        footer={
          <>
            <Button variant="outline" onClick={() => setSimulacao(null)} disabled={working}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmarVencimento()} loading={working}>
              Confirmar mudança
            </Button>
          </>
        }
      >
        {simulacao ? (
          <div className="grid gap-3 text-sm text-slate-600">
            <p>
              A próxima cobrança passa de{' '}
              <strong>{simulacao.currentNextDueDate ? formatDay(simulacao.currentNextDueDate) : 'sem data'}</strong>{' '}
              para <strong>{simulacao.newNextDueDate ? formatDay(simulacao.newNextDueDate) : 'sem data'}</strong>
              {simulacao.deltaDays !== 0
                ? ` (${Math.abs(simulacao.deltaDays)} ${Math.abs(simulacao.deltaDays) === 1 ? 'dia' : 'dias'} ${simulacao.deltaDays > 0 ? 'a mais' : 'a menos'})`
                : ''}
              . A cobrança que já está em aberto não muda.
            </p>
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
              {!simulacao.prorataApplied || simulacao.prorataAmountCents === 0
                ? 'Nenhum valor é cobrado ou descontado por causa da mudança.'
                : simulacao.prorataAmountCents > 0
                  ? `Entra ${centsLabel(simulacao.prorataAmountCents)} a mais na próxima cobrança, pelos dias adicionais.`
                  : `A próxima cobrança vem ${centsLabel(Math.abs(simulacao.prorataAmountCents))} mais barata, pelos dias a menos.`}
            </p>
            {simulacao.issuesImmediately ? (
              <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle aria-hidden="true" className="size-4 flex-none" />
                Com a data nova, a próxima cobrança já é emitida agora.
              </p>
            ) : null}
            {simulacao.warnings.map((aviso) => (
              <p key={aviso} className="text-xs text-amber-800">
                {aviso}
              </p>
            ))}
            {erroSimulacao ? <Alert tone="danger" title="Não foi possível alterar">{erroSimulacao}</Alert> : null}
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}

/** `2026-10-20` -> `20/10/2026`, sem passar por fuso horario. */
function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}
