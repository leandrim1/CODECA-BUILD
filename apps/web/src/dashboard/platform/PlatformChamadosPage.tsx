import { useState } from 'react';
import { Send } from 'lucide-react';
import {
  TICKET_CATEGORIA_LABELS,
  TICKET_CORPO_MAX,
  TICKET_PRIORIDADES,
  TICKET_PRIORIDADE_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_AUTOR_LABELS,
  formatBytes,
  formatDateTime,
  numeroDoTicket,
  type TicketStatus,
} from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Select,
  TextArea,
  cx,
  useToast,
} from '@codeca/ui';
import { useMutation, useResource } from '../../hooks/useResource.js';
import { chamadosDaPlataformaApi } from '../../services/endpoints.js';
import { ResourcePanel } from '../../components/ResourcePanel.js';

/**
 * A fila de atendimento.
 *
 * Aqui nao ha filtro por empresa -- e esse o ponto da tela. O que protege e a
 * capacidade `platform:support:tickets` no servidor e o papel de
 * administrador da plataforma, que guarda a area inteira.
 *
 * O CONTEXTO so aparece aqui: plano, uso e quem abriu. E o que evita o
 * atendimento comecar com cinco perguntas que a plataforma ja sabe responder.
 */

const TOM: Record<TicketStatus, 'neutral' | 'warning' | 'success' | 'info'> = {
  aberto: 'warning',
  em_atendimento: 'info',
  aguardando_cliente: 'neutral',
  resolvido: 'success',
  fechado: 'neutral',
};

export function PlatformChamadosPage() {
  const [situacao, setSituacao] = useState<'abertos' | 'todos'>('abertos');
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const fila = useResource(
    `chamados.listar:${situacao}`,
    () => chamadosDaPlataformaApi.listar({ situacao, pageSize: 50 }),
    [situacao],
  );

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader title="Chamados" description="Pedidos de ajuda abertos pelas empresas." />

      {selecionado ? (
        <Atendimento
          ticketId={selecionado}
          aoVoltar={() => {
            setSelecionado(null);
            fila.reload();
          }}
        />
      ) : (
        <Card>
          <CardHeader
            title={situacao === 'abertos' ? 'Esperando atendimento' : 'Todos os chamados'}
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSituacao((atual) => (atual === 'abertos' ? 'todos' : 'abertos'))}
              >
                {situacao === 'abertos' ? 'Ver todos' : 'Ver só os abertos'}
              </Button>
            }
          />
          <CardBody>
            <ResourcePanel resource={fila}>
              {(dados) =>
                dados.items.length === 0 ? (
                  <EmptyState title="Nada na fila" description="Nenhum chamado esperando resposta." />
                ) : (
                  <ul className="grid gap-2">
                    {dados.items.map((chamado) => (
                      <li key={chamado.id}>
                        <button
                          type="button"
                          onClick={() => setSelecionado(chamado.id)}
                          className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3.5 text-left transition-colors duration-200 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-900">
                              <span className="font-mono text-xs text-slate-500">
                                {numeroDoTicket(chamado.numero)}
                              </span>{' '}
                              {chamado.assunto}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-slate-500">
                              {chamado.empresa} · {TICKET_CATEGORIA_LABELS[chamado.categoria]} ·{' '}
                              {formatDateTime(chamado.createdAt)}
                            </span>
                          </span>
                          <span className="flex flex-none items-center gap-2">
                            {chamado.prioridade === 'alta' ? <Badge tone="danger">Alta</Badge> : null}
                            <Badge tone={TOM[chamado.status]}>{TICKET_STATUS_LABELS[chamado.status]}</Badge>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              }
            </ResourcePanel>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Atendimento({ ticketId, aoVoltar }: { ticketId: string; aoVoltar: () => void }) {
  const toast = useToast();
  const [resposta, setResposta] = useState('');

  const chamado = useResource(
    `chamados.detalhe:${ticketId}`,
    () => chamadosDaPlataformaApi.detalhe(ticketId),
    [ticketId],
  );

  const responder = useMutation(() => chamadosDaPlataformaApi.responder(ticketId, resposta), {
    onSuccess: () => {
      setResposta('');
      chamado.reload();
    },
    onError: (erro) => toast.error('Não foi possível enviar', erro.message),
  });

  const atualizar = useMutation(
    (corpo: { status?: string; prioridade?: string }) => chamadosDaPlataformaApi.atualizar(ticketId, corpo),
    {
      onSuccess: () => chamado.reload(),
      onError: (erro) => toast.error('Não foi possível alterar', erro.message),
    },
  );

  return (
    <ResourcePanel resource={chamado}>
      {(dados) => (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
          <Card>
            <CardHeader
              title={`${numeroDoTicket(dados.numero)} · ${dados.assunto}`}
              description={`${dados.empresa} · ${TICKET_CATEGORIA_LABELS[dados.categoria]}`}
              actions={
                <Button variant="outline" size="sm" onClick={aoVoltar}>
                  Voltar
                </Button>
              }
            />
            <CardBody className="grid gap-4">
              <ol className="grid gap-3">
                {dados.mensagens.map((mensagem) => (
                  <li
                    key={mensagem.id}
                    className={cx(
                      'grid gap-1 rounded-xl border p-3.5',
                      mensagem.author === 'suporte'
                        ? 'border-brand-200 bg-brand-50/60'
                        : mensagem.author === 'sistema'
                          ? 'border-slate-200 bg-slate-50'
                          : 'border-slate-200 bg-white',
                    )}
                  >
                    <p className="flex flex-wrap items-baseline gap-2 text-xs text-slate-500">
                      <span className="font-medium text-slate-700">
                        {mensagem.author === 'cliente' ? 'Cliente' : TICKET_AUTOR_LABELS[mensagem.author]}
                      </span>
                      {formatDateTime(mensagem.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{mensagem.body}</p>
                  </li>
                ))}
              </ol>

              <TextArea
                label="Responder ao cliente"
                rows={5}
                maxLength={TICKET_CORPO_MAX}
                value={resposta}
                onChange={(evento) => setResposta(evento.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  loading={responder.loading}
                  disabled={resposta.trim().length < 15}
                  onClick={() => void responder.run(undefined)}
                  icon={<Send aria-hidden="true" className="size-4" />}
                >
                  Enviar resposta
                </Button>
              </div>
            </CardBody>
          </Card>

          <div className="grid gap-5">
            <Card>
              <CardHeader title="Triagem" />
              <CardBody className="grid gap-4">
                <Select
                  label="Situação"
                  value={dados.status}
                  onChange={(evento) => void atualizar.run({ status: evento.target.value })}
                  options={TICKET_STATUSES.map((chave) => ({
                    value: chave,
                    label: TICKET_STATUS_LABELS[chave],
                  }))}
                />
                <Select
                  label="Prioridade"
                  value={dados.prioridade}
                  onChange={(evento) => void atualizar.run({ prioridade: evento.target.value })}
                  options={TICKET_PRIORIDADES.map((chave) => ({
                    value: chave,
                    label: TICKET_PRIORIDADE_LABELS[chave],
                  }))}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Contexto"
                description="Tirado do banco no momento da abertura, não digitado pelo cliente."
              />
              <CardBody>
                {dados.contexto ? (
                  <dl className="grid gap-2 text-sm">
                    <Linha rotulo="Empresa" valor={dados.contexto.empresa.nome} />
                    <Linha rotulo="Plano" valor={dados.contexto.plano.nome} />
                    <Linha
                      rotulo="Site"
                      valor={
                        dados.contexto.site
                          ? `${dados.contexto.site.dominio ?? 'sem domínio próprio'}${dados.contexto.site.publicado ? '' : ' (fora do ar)'}`
                          : 'sem site'
                      }
                    />
                    <Linha
                      rotulo="Conteúdos"
                      valor={`${dados.contexto.uso.conteudos.usados} de ${dados.contexto.uso.conteudos.limite}`}
                    />
                    <Linha
                      rotulo="Armazenamento"
                      valor={`${formatBytes(dados.contexto.uso.armazenamento.bytes)} de ${formatBytes(dados.contexto.uso.armazenamento.limiteBytes)}`}
                    />
                    <Linha
                      rotulo="Usuários"
                      valor={`${dados.contexto.uso.usuarios.usados} de ${dados.contexto.uso.usuarios.limite}`}
                    />
                    <Linha rotulo="Quem abriu" valor={`${dados.contexto.usuario.nome} (${dados.contexto.usuario.papel})`} />
                    <Linha rotulo="E-mail" valor={dados.contexto.usuario.email} />
                    <Linha rotulo="Tela de origem" valor={dados.contexto.origemUrl || '—'} />
                  </dl>
                ) : (
                  <Alert tone="info">Este chamado foi aberto antes do contexto automático existir.</Alert>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </ResourcePanel>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{rotulo}</dt>
      <dd className="min-w-0 truncate text-right text-slate-700">{valor}</dd>
    </div>
  );
}
