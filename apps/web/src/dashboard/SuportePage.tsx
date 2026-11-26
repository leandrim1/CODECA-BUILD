import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LifeBuoy, MessageSquarePlus, Send } from 'lucide-react';
import {
  TICKET_ASSUNTO_MAX,
  TICKET_AUTOR_LABELS,
  TICKET_CATEGORIAS,
  TICKET_CATEGORIA_LABELS,
  TICKET_CORPO_MAX,
  TICKET_STATUS_LABELS,
  formatDateTime,
  numeroDoTicket,
  ticketEstaAberto,
  type TicketCategoria,
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
  FORM_GRID_CLASSES,
  FORM_SPAN_FULL,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  cx,
  useToast,
} from '@codeca/ui';
import { useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { suporteApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import type { ChamadoResumo } from '../types/index.js';

/**
 * Suporte: abrir e acompanhar chamados.
 *
 * Substitui o `mailto:` que havia no menu da conta. Um endereco de e-mail nao
 * tem situacao e nao deixa quem pediu ajuda saber se alguem leu -- aqui o
 * chamado tem numero, situacao e a conversa inteira na tela.
 *
 * NAO depende do assistente de IA. Quando ele existir, entra como um atalho
 * ANTES desta tela; se estiver fora do ar, esta tela continua sendo o caminho
 * inteiro.
 */

const TOM_DA_SITUACAO: Record<TicketStatus, 'neutral' | 'warning' | 'success' | 'info'> = {
  aberto: 'warning',
  em_atendimento: 'info',
  aguardando_cliente: 'warning',
  resolvido: 'success',
  fechado: 'neutral',
};

export function SuportePage() {
  const tenantId = useTenantId();
  const [situacao, setSituacao] = useState<'abertos' | 'todos'>('abertos');
  const [abrindo, setAbrindo] = useState(false);
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const lista = useResource(
    `suporteApi.listar:${situacao}`,
    () => suporteApi.listar(tenantId, { situacao }),
    [tenantId, situacao],
  );

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Suporte"
        description="Abra um chamado e acompanhe a resposta aqui mesmo, sem sair do painel."
      />

      {selecionado ? (
        <Chamado
          ticketId={selecionado}
          aoVoltar={() => {
            setSelecionado(null);
            lista.reload();
          }}
        />
      ) : (
        <>
          {abrindo ? (
            <NovoChamado
              aoFechar={() => setAbrindo(false)}
              aoCriar={(id) => {
                setAbrindo(false);
                setSelecionado(id);
                lista.reload();
              }}
            />
          ) : null}

          <Card>
            <CardHeader
              title="Seus chamados"
              description={
                situacao === 'abertos'
                  ? 'Os que ainda esperam alguma coisa.'
                  : 'Todos os chamados desta empresa.'
              }
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSituacao((atual) => (atual === 'abertos' ? 'todos' : 'abertos'))}
                  >
                    {situacao === 'abertos' ? 'Ver todos' : 'Ver só os abertos'}
                  </Button>
                  {abrindo ? null : (
                    <Button
                      onClick={() => setAbrindo(true)}
                      icon={<MessageSquarePlus aria-hidden="true" className="size-4" />}
                    >
                      Abrir chamado
                    </Button>
                  )}
                </div>
              }
            />
            <CardBody>
              <ResourcePanel resource={lista}>
                {(dados) =>
                  dados.items.length === 0 ? (
                    <EmptyState
                      icon={<LifeBuoy aria-hidden="true" className="size-6" />}
                      title={situacao === 'abertos' ? 'Nenhum chamado aberto' : 'Nenhum chamado por aqui'}
                      description="Quando precisar de ajuda, abra um chamado: a equipe responde por aqui e você acompanha tudo nesta tela."
                    />
                  ) : (
                    <ul className="grid gap-2">
                      {dados.items.map((chamado) => (
                        <li key={chamado.id}>
                          <LinhaDoChamado chamado={chamado} aoAbrir={() => setSelecionado(chamado.id)} />
                        </li>
                      ))}
                    </ul>
                  )
                }
              </ResourcePanel>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function LinhaDoChamado({ chamado, aoAbrir }: { chamado: ChamadoResumo; aoAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={aoAbrir}
      className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3.5 text-left transition-colors duration-200 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-900">
          <span className="font-mono text-xs text-slate-500">{numeroDoTicket(chamado.numero)}</span>{' '}
          {chamado.assunto}
        </span>
        <span className="mt-0.5 block text-xs text-slate-500">
          {TICKET_CATEGORIA_LABELS[chamado.categoria]} · aberto em {formatDateTime(chamado.createdAt)}
        </span>
      </span>
      <Badge tone={TOM_DA_SITUACAO[chamado.status]}>{TICKET_STATUS_LABELS[chamado.status]}</Badge>
    </button>
  );
}

function NovoChamado({ aoFechar, aoCriar }: { aoFechar: () => void; aoCriar: (id: string) => void }) {
  const tenantId = useTenantId();
  const toast = useToast();
  const localizacao = useLocation();

  /*
    De qual tela a pessoa veio -- nao em qual ela esta.

    O formulario mora em `/painel/suporte`, entao o caminho atual seria
    sempre ele mesmo: um campo que promete dizer de onde o chamado partiu e
    nao diz nada. Quem sabe a resposta e quem navegou ate aqui, e por isso o
    menu da conta manda a tela de origem junto (`state.de`).

    Chegou pelo menu lateral, sem origem? Fica VAZIO. Inventar `/painel/suporte`
    seria pior do que nao saber: o atendimento leria como informacao.
  */
  const de = (localizacao.state as { de?: unknown } | null)?.de;
  const origemUrl =
    typeof de === 'string' && de.startsWith('/painel') && de !== '/painel/suporte' ? de : '';

  const [assunto, setAssunto] = useState('');
  const [categoria, setCategoria] = useState<TicketCategoria>('outro');
  const [corpo, setCorpo] = useState('');

  const abrir = useMutation(
    () =>
      suporteApi.abrir(tenantId, {
        assunto,
        categoria,
        corpo,
        // Caminho do painel, nunca endereco completo: o painel mestre mostra
        // isso ao atendimento, e um endereco de fora viraria link clicavel
        // apontando para onde o remetente quisesse.
        origemUrl,
      }),
    {
      onSuccess: (dados) => {
        toast.success(`Chamado ${numeroDoTicket(dados.numero)} aberto`, 'A equipe responde por aqui.');
        aoCriar(dados.id);
      },
      onError: (erro) => toast.error('Não foi possível abrir o chamado', erro.message),
    },
  );

  const faltaAssunto = assunto.trim().length < 5;
  const faltaCorpo = corpo.trim().length < 15;

  return (
    <Card>
      <CardHeader title="Abrir chamado" description="Conte o que está acontecendo. Quanto mais detalhe, mais rápido resolvemos." />
      <CardBody className={FORM_GRID_CLASSES}>
        <TextInput
          label="Assunto"
          className={FORM_SPAN_FULL}
          required
          maxLength={TICKET_ASSUNTO_MAX}
          placeholder="Resuma o problema em uma frase"
          value={assunto}
          onChange={(evento) => setAssunto(evento.target.value)}
        />
        <Select
          label="Sobre o que é"
          className={FORM_SPAN_FULL}
          value={categoria}
          onChange={(evento) => setCategoria(evento.target.value as TicketCategoria)}
          options={TICKET_CATEGORIAS.map((chave) => ({
            value: chave,
            label: TICKET_CATEGORIA_LABELS[chave],
          }))}
        />
        <TextArea
          label="O que está acontecendo"
          className={FORM_SPAN_FULL}
          rows={6}
          required
          maxLength={TICKET_CORPO_MAX}
          hint="Se puder, diga o que você fez, o que esperava e o que aconteceu."
          value={corpo}
          onChange={(evento) => setCorpo(evento.target.value)}
        />

        {/*
          O aviso e curto de proposito: a pessoa que abre um chamado esta com
          um problema, e um texto longo aqui e mais uma barreira.
        */}
        <div className={FORM_SPAN_FULL}>
          <Alert tone="info">
            A equipe vê o seu plano, o uso do site e a tela de onde você chamou — não precisa digitar isso.
            Nunca envie senhas nesta conversa.
          </Alert>
        </div>

        <div className={cx(FORM_SPAN_FULL, 'flex flex-wrap justify-end gap-2')}>
          <Button variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            onClick={() => void abrir.run(undefined)}
            loading={abrir.loading}
            disabled={faltaAssunto || faltaCorpo}
            icon={<Send aria-hidden="true" className="size-4" />}
          >
            Enviar chamado
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function Chamado({ ticketId, aoVoltar }: { ticketId: string; aoVoltar: () => void }) {
  const tenantId = useTenantId();
  const toast = useToast();
  const [resposta, setResposta] = useState('');

  const chamado = useResource(
    `suporteApi.detalhe:${ticketId}`,
    () => suporteApi.detalhe(tenantId, ticketId),
    [tenantId, ticketId],
  );

  const responder = useMutation(() => suporteApi.responder(tenantId, ticketId, resposta), {
    onSuccess: () => {
      setResposta('');
      chamado.reload();
    },
    onError: (erro) => toast.error('Não foi possível enviar', erro.message),
  });

  const encerrar = useMutation(() => suporteApi.encerrar(tenantId, ticketId), {
    onSuccess: () => {
      toast.success('Chamado encerrado');
      chamado.reload();
    },
    onError: (erro) => toast.error('Não foi possível encerrar', erro.message),
  });

  return (
    <ResourcePanel resource={chamado}>
      {(dados) => (
        <Card>
          <CardHeader
            title={`${numeroDoTicket(dados.numero)} · ${dados.assunto}`}
            description={`${TICKET_CATEGORIA_LABELS[dados.categoria]} · aberto em ${formatDateTime(dados.createdAt)}`}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TOM_DA_SITUACAO[dados.status]}>{TICKET_STATUS_LABELS[dados.status]}</Badge>
                <Button variant="outline" size="sm" onClick={aoVoltar}>
                  Voltar
                </Button>
              </div>
            }
          />
          <CardBody className="grid gap-4">
            <ol className="grid gap-3">
              {dados.mensagens.map((mensagem) => (
                <li
                  key={mensagem.id}
                  className={cx(
                    'grid gap-1 rounded-xl border p-3.5',
                    mensagem.author === 'cliente'
                      ? 'border-brand-200 bg-brand-50/60'
                      : mensagem.author === 'sistema'
                        ? 'border-slate-200 bg-slate-50'
                        : 'border-slate-200 bg-white',
                  )}
                >
                  <p className="flex flex-wrap items-baseline gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{TICKET_AUTOR_LABELS[mensagem.author]}</span>
                    {formatDateTime(mensagem.createdAt)}
                  </p>
                  {/* `whitespace-pre-wrap`: o cliente escreve em paragrafos, e
                      colapsar as quebras transformaria o relato num bloco. */}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{mensagem.body}</p>
                </li>
              ))}
            </ol>

            {ticketEstaAberto(dados.status) ? (
              <div className="grid gap-3">
                <TextArea
                  label="Responder"
                  rows={4}
                  maxLength={TICKET_CORPO_MAX}
                  value={resposta}
                  onChange={(evento) => setResposta(evento.target.value)}
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    loading={encerrar.loading}
                    onClick={() => void encerrar.run(undefined)}
                  >
                    Já resolvi, pode encerrar
                  </Button>
                  <Button
                    loading={responder.loading}
                    disabled={resposta.trim().length < 15}
                    onClick={() => void responder.run(undefined)}
                    icon={<Send aria-hidden="true" className="size-4" />}
                  >
                    Enviar resposta
                  </Button>
                </div>
              </div>
            ) : (
              <Alert tone="info">
                Este chamado está encerrado. Se o problema voltar, abra um novo chamado — assim a equipe vê
                o histórico separado.
              </Alert>
            )}
          </CardBody>
        </Card>
      )}
    </ResourcePanel>
  );
}
