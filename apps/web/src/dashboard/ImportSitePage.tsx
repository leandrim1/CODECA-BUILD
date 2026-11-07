import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  FileSearch,
  Globe,
  Image as ImageIcon,
  Info,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import {
  IMPORT_PROGRESS_STEPS,
  checkImportUrl,
  formatDateTime,
  importTargetLabel,
  isWorkingState,
  type ImportDetailView,
  type ImportItemView,
  type ImportRunView,
  type ImportTarget,
} from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Spinner,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useTenantId } from '../hooks/useAuth.js';
import { useMutation } from '../hooks/useResource.js';
import { siteImportApi } from '../services/endpoints.js';

/**
 * Importar site.
 *
 * ## Por que esta tela consulta o servidor em laco
 *
 * Nao e polling por preguica. A funcao da Vercel para em 60 s e nao ha fila na
 * plataforma, entao a analise avanca em fatias -- e **cada consulta de estado
 * empurra uma fatia**. O laco que desenha a barra de progresso e o mesmo que
 * faz o trabalho andar. Por isso ele para assim que `working` vira falso, e so
 * recomeca se a pessoa comecar outra analise.
 *
 * ## O que a tela promete
 *
 * Que nada entra no painel sem alguem olhar. Conflito vem desmarcado e com o
 * valor atual ao lado do encontrado; o que a plataforma nao sabe trazer aparece
 * marcado como indisponivel em vez de desaparecer; e tudo que entra pode ser
 * desfeito.
 */

/** Pausa entre consultas enquanto a analise avanca. */
const POLL_MS = 1200;

export function ImportSitePage() {
  const tenantId = useTenantId();
  const toast = useToast();

  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [run, setRun] = useState<ImportDetailView | null>(null);
  const [history, setHistory] = useState<ImportRunView[]>([]);
  const [limits, setLimits] = useState<{ maxPages: number; maxImages: number } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [confirmarAberto, setConfirmarAberto] = useState(false);
  const [desfazerAberto, setDesfazerAberto] = useState(false);

  /** Evita duas consultas simultaneas: cada uma avanca a analise. */
  const consultando = useRef(false);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const carregarVisaoGeral = useCallback(async () => {
    try {
      const data = await siteImportApi.overview(tenantId);
      if (!vivo.current) return;
      setHistory(data.history);
      setLimits({ maxPages: data.limits.maxPages, maxImages: data.limits.maxImages });
      setErro('');
      if (data.latest) {
        const detalhe = await siteImportApi.state(tenantId, data.latest.id);
        if (!vivo.current) return;
        setRun(detalhe.run);
      } else {
        setRun(null);
      }
    } catch (error) {
      if (!vivo.current) return;
      setErro(error instanceof Error ? error.message : 'Não foi possível carregar as importações.');
    } finally {
      if (vivo.current) setCarregando(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void carregarVisaoGeral();
  }, [carregarVisaoGeral]);

  /**
   * O laco que faz a analise andar.
   *
   * Cada volta e uma requisicao que avanca uma fatia no servidor e devolve o
   * progresso. Para sozinho quando `working` vira falso.
   */
  useEffect(() => {
    if (run === null || !run.working) return undefined;

    let cancelado = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const avancar = async () => {
      if (cancelado || consultando.current) return;
      consultando.current = true;
      try {
        const data = await siteImportApi.state(tenantId, run.id);
        if (cancelado || !vivo.current) return;
        setRun(data.run);
        if (!data.run.working) void carregarVisaoGeral();
      } catch (error) {
        if (cancelado || !vivo.current) return;
        setErro(error instanceof Error ? error.message : 'A análise foi interrompida.');
      } finally {
        consultando.current = false;
        if (!cancelado) timer = setTimeout(() => void avancar(), POLL_MS);
      }
    };

    timer = setTimeout(() => void avancar(), POLL_MS);
    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
    };
  }, [run, tenantId, carregarVisaoGeral]);

  // ------------------------------------------------------------- acoes

  const iniciar = useMutation(
    async (endereco: string) => siteImportApi.start(tenantId, endereco),
    {
      onSuccess: async () => {
        setUrl('');
        await carregarVisaoGeral();
      },
      onError: (error) => {
        const campo = error.fieldErrors['url'];
        if (campo) setUrlError(campo);
        else toast.push({ tone: 'error', title: 'Não foi possível analisar', description: error.message });
      },
    },
  );

  const analisar = () => {
    const check = checkImportUrl(url);
    if (!check.ok) {
      setUrlError(check.message);
      return;
    }
    setUrlError('');
    void iniciar.run(check.url);
  };

  const confirmar = useMutation(
    async (targets: ImportTarget[]) => siteImportApi.confirm(tenantId, run?.id ?? '', targets),
    {
      onSuccess: async (data) => {
        setRun(data.run);
        setConfirmarAberto(false);
        toast.push({
          tone: data.result.failed > 0 ? 'warning' : 'success',
          title: 'Importação concluída',
          description: data.run.message,
        });
        await carregarVisaoGeral();
      },
      onError: (error) =>
        toast.push({ tone: 'error', title: 'Não foi possível importar', description: error.message }),
    },
  );

  const desfazer = useMutation(async () => siteImportApi.revert(tenantId, run?.id ?? ''), {
    onSuccess: async (data) => {
      setRun(data.run);
      setDesfazerAberto(false);
      toast.push({
        tone: data.failed > 0 ? 'warning' : 'success',
        title: 'Importação desfeita',
        description: data.run.message,
      });
      await carregarVisaoGeral();
    },
    onError: (error) =>
      toast.push({ tone: 'error', title: 'Não foi possível desfazer', description: error.message }),
  });

  const cancelar = useMutation(async () => siteImportApi.cancel(tenantId, run?.id ?? ''), {
    onSuccess: async () => {
      await carregarVisaoGeral();
    },
    onError: (error) =>
      toast.push({ tone: 'error', title: 'Não foi possível cancelar', description: error.message }),
  });

  /** Marca ou desmarca um candidato, e grava a decisao no servidor. */
  const decidir = useCallback(
    async (item: ImportItemView, decision: 'selecionado' | 'ignorado', resolution?: 'manter' | 'substituir') => {
      if (run === null) return;
      // Otimista: a tela responde na hora e o servidor confirma depois.
      setRun((atual) =>
        atual === null
          ? atual
          : {
              ...atual,
              items: atual.items.map((candidato) =>
                candidato.id === item.id
                  ? { ...candidato, decision, resolution: resolution ?? candidato.resolution }
                  : candidato,
              ),
            },
      );
      try {
        await siteImportApi.review(tenantId, run.id, [
          { itemId: item.id, decision, ...(resolution ? { resolution } : {}) },
        ]);
      } catch (error) {
        toast.push({
          tone: 'error',
          title: 'A seleção não foi salva',
          description: error instanceof Error ? error.message : 'Tente novamente.',
        });
        const data = await siteImportApi.state(tenantId, run.id);
        if (vivo.current) setRun(data.run);
      }
    },
    [run, tenantId, toast],
  );

  /** Marca ou desmarca um grupo inteiro. */
  const decidirGrupo = useCallback(
    async (itens: ImportItemView[], decision: 'selecionado' | 'ignorado') => {
      if (run === null || itens.length === 0) return;
      const alcancaveis = itens.filter((item) => !item.targetDisabled);
      if (alcancaveis.length === 0) return;

      setRun((atual) =>
        atual === null
          ? atual
          : {
              ...atual,
              items: atual.items.map((candidato) =>
                alcancaveis.some((item) => item.id === candidato.id)
                  ? { ...candidato, decision }
                  : candidato,
              ),
            },
      );
      try {
        await siteImportApi.review(
          tenantId,
          run.id,
          alcancaveis.map((item) => ({ itemId: item.id, decision })),
        );
      } catch (error) {
        toast.push({
          tone: 'error',
          title: 'A seleção não foi salva',
          description: error instanceof Error ? error.message : 'Tente novamente.',
        });
      }
    },
    [run, tenantId, toast],
  );

  const grupos = useMemo(() => agruparPorDestino(run?.items ?? []), [run]);
  const selecionados = (run?.items ?? []).filter((item) => item.decision === 'selecionado');
  const emRevisao = run?.state === 'analisada';
  const importada = run?.state === 'importada';

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Importar site"
        description="Informe o endereço do site que a sua empresa já tem. A plataforma analisa as páginas públicas, organiza o que encontrar nos módulos do seu painel e espera a sua confirmação antes de gravar."
      />

      {erro ? (
        <Alert tone="danger" title="Não foi possível carregar">
          {erro}
        </Alert>
      ) : null}

      <ComoFunciona limits={limits} />

      {/* ------------------------------------------------ endereço */}
      {run === null || (!run.working && run.state !== 'analisada') ? (
        <Card>
          <CardHeader title="Endereço do site" description="Aceitamos endereços públicos que começam com http:// ou https://." />
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <TextInput
                label="Endereço do site"
                value={url}
                placeholder="https://seusite.com.br"
                inputMode="url"
                autoComplete="url"
                error={urlError !== '' ? urlError : undefined}
                hint="Analisamos apenas o conteúdo público do endereço informado. Nenhuma senha é necessária."
                onChange={(event) => {
                  setUrl(event.target.value);
                  if (urlError) setUrlError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') analisar();
                }}
              />
              <Button
                onClick={analisar}
                loading={iniciar.loading}
                disabled={url.trim() === ''}
                icon={<Search size={16} />}
              >
                Analisar meu site
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ------------------------------------------------- progresso */}
      {run !== null ? (
        <Progresso
          run={run}
          onCancelar={() => void cancelar.run(undefined)}
          cancelando={cancelar.loading}
        />
      ) : null}

      {/* --------------------------------------------------- revisão */}
      {run !== null && (emRevisao || importada) ? (
        <>
          <Resumo run={run} />

          {run.likelyClientRendered ? (
            <Alert tone="warning" title="Esse site monta o conteúdo no navegador">
              O endereço informado entrega uma página praticamente vazia e preenche o conteúdo depois,
              por JavaScript. A análise lê o que vem no endereço, sem executar scripts, então
              encontramos pouco. O que aparece abaixo é o que estava mesmo no endereço; o restante
              precisa ser cadastrado pelo painel.
            </Alert>
          ) : null}

          {grupos.length === 0 ? (
            <EmptyState
              icon={<FileSearch size={28} />}
              title="Nada que corresponda aos módulos do seu painel"
              description="Lemos as páginas, mas não encontramos conteúdo que caiba nos módulos deste site. Você pode cadastrar manualmente pelo menu ao lado."
            />
          ) : (
            <div className="grid gap-4">
              {grupos.map((grupo) => (
                <GrupoDeCandidatos
                  key={grupo.target}
                  grupo={grupo}
                  somenteLeitura={!emRevisao}
                  onDecidir={decidir}
                  onDecidirGrupo={decidirGrupo}
                />
              ))}
            </div>
          )}

          {emRevisao ? (
            <Card>
              <CardBody>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <p className="text-sm text-[color:var(--muted)]">
                    {selecionados.length === 0
                      ? 'Nada selecionado. Marque o que você quer trazer para o painel.'
                      : `${selecionados.length} ${selecionados.length === 1 ? 'item selecionado' : 'itens selecionados'}. O conteúdo entra como rascunho — você confere e publica quando quiser.`}
                  </p>
                  <Button
                    onClick={() => setConfirmarAberto(true)}
                    disabled={selecionados.length === 0}
                    icon={<Download size={16} />}
                  >
                    Importar conteúdo
                  </Button>
                </div>
              </CardBody>
            </Card>
          ) : null}

          {importada ? (
            <Card>
              <CardBody>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <p className="text-sm text-[color:var(--muted)]">
                    Mudou de ideia? Você pode desfazer esta importação. Os registros criados são
                    removidos e os campos voltam ao valor que tinham antes.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setDesfazerAberto(true)}
                    icon={<RotateCcw size={16} />}
                  >
                    Desfazer importação
                  </Button>
                </div>
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : null}

      {/* -------------------------------------------------- histórico */}
      {history.length > 1 ? <Historico history={history} atual={run?.id ?? ''} /> : null}

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-[color:var(--muted)]">
          <Spinner /> Carregando…
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmarAberto}
        title="Importar o conteúdo selecionado?"
        message={`${selecionados.length} ${selecionados.length === 1 ? 'item' : 'itens'} serão gravados no seu painel como rascunho. Campos que já tinham conteúdo só são substituídos onde você autorizou. Você pode desfazer depois.`}
        confirmLabel="Importar"
        loading={confirmar.loading}
        onCancel={() => setConfirmarAberto(false)}
        onConfirm={() => void confirmar.run([])}
      />

      <ConfirmDialog
        open={desfazerAberto}
        title="Desfazer esta importação?"
        message="Os registros criados por ela serão removidos e os campos voltam ao valor que tinham no momento da importação. Atenção: alterações que você fez depois da importação nesses mesmos campos também serão desfeitas. As imagens continuam na Biblioteca de imagens."
        confirmLabel="Desfazer"
        tone="danger"
        loading={desfazer.loading}
        onCancel={() => setDesfazerAberto(false)}
        onConfirm={() => void desfazer.run(undefined)}
      />
    </div>
  );
}

// --------------------------------------------------------------- partes

function ComoFunciona({ limits }: { limits: { maxPages: number; maxImages: number } | null }) {
  return (
    <Card>
      <CardHeader title="Como funciona a importação" />
      <CardBody>
        <ol className="grid gap-2 text-sm text-[color:var(--muted)]">
          <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
            <span aria-hidden className="text-[color:var(--accent)]">1.</span>
            <span>
              Você informa o endereço. A plataforma acessa só o que está público ali — nenhuma senha
              é pedida e nada é alterado no seu site atual.
            </span>
          </li>
          <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
            <span aria-hidden className="text-[color:var(--accent)]">2.</span>
            <span>
              Lemos a página inicial e procuramos as páginas de sempre: sobre, serviços, produtos,
              contato, equipe, galeria, portfólio, depoimentos e perguntas frequentes.
              {limits
                ? ` Analisamos até ${limits.maxPages} páginas e ${limits.maxImages} imagens por análise.`
                : ''}
            </span>
          </li>
          <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
            <span aria-hidden className="text-[color:var(--accent)]">3.</span>
            <span>
              Organizamos o que encontramos nos módulos do seu painel. Cada informação mostra de qual
              página veio — e o que não dá para identificar com segurança fica de fora em vez de ser
              adivinhado.
            </span>
          </li>
          <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
            <span aria-hidden className="text-[color:var(--accent)]">4.</span>
            <span>
              Você revisa, escolhe o que quer e confirma. O conteúdo entra como <strong>rascunho</strong>:
              nada aparece no seu site antes de você publicar. Campo que já tem conteúdo nunca é
              substituído sem a sua autorização.
            </span>
          </li>
        </ol>
      </CardBody>
    </Card>
  );
}

/**
 * Barra de progresso pelos estados reais da analise.
 *
 * Os passos vem de `IMPORT_PROGRESS_STEPS`, no pacote compartilhado, para a
 * tela e o servidor nao divergirem sobre o que "aguardando confirmacao"
 * significa.
 */
function Progresso({
  run,
  onCancelar,
  cancelando,
}: {
  run: ImportRunView;
  onCancelar: () => void;
  cancelando: boolean;
}) {
  const passos = IMPORT_PROGRESS_STEPS.filter((passo) => passo.state !== null);
  const indiceAtual = passos.findIndex((passo) => passo.state === run.state);
  const falhou = run.state === 'erro';
  const lidas = run.pages.filter((page) => page.error === undefined);
  const falhas = run.pages.filter((page) => page.error !== undefined);

  return (
    <Card>
      <CardHeader
        title={falhou ? 'A análise não foi concluída' : 'Análise do site'}
        description={run.sourceUrl}
        actions={
          run.working ? (
            <Button variant="ghost" size="sm" onClick={onCancelar} loading={cancelando} icon={<X size={14} />}>
              Cancelar
            </Button>
          ) : null
        }
      />
      <CardBody>
        <div className="grid gap-4">
          {falhou ? (
            <Alert tone="danger" title="Não foi possível concluir">
              {run.message}
            </Alert>
          ) : (
            <div className="grid gap-2">
              <div className="flex items-center gap-2 text-sm">
                {run.working ? <Spinner /> : <CheckCircle2 size={16} className="text-[color:var(--success)]" />}
                <span className="[overflow-wrap:anywhere]">{run.message}</span>
              </div>
              <ol className="grid gap-1 text-xs text-[color:var(--muted)] sm:grid-cols-[minmax(0,1fr)]">
                {passos.map((passo, indice) => {
                  const concluido = indiceAtual > indice || !run.working;
                  const atual = indiceAtual === indice && run.working;
                  return (
                    <li
                      key={passo.key}
                      className="grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-2"
                      aria-current={atual ? 'step' : undefined}
                    >
                      {atual ? (
                        <Spinner />
                      ) : concluido ? (
                        <CheckCircle2 size={12} className="text-[color:var(--success)]" />
                      ) : (
                        <Clock size={12} />
                      )}
                      <span className={atual ? 'font-medium text-[color:var(--text)]' : undefined}>
                        {passo.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {run.pages.length > 0 ? (
            <details className="rounded-lg border border-[color:var(--border)] p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Páginas encontradas ({lidas.length}
                {falhas.length > 0 ? `, ${falhas.length} com problema` : ''})
              </summary>
              <ul className="mt-2 grid gap-1 text-xs">
                {run.pages.map((page) => (
                  <li
                    key={page.url}
                    className="grid grid-cols-[minmax(0,1fr)] gap-0.5 border-t border-[color:var(--border)] pt-1 first:border-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-2"
                  >
                    <span className="[overflow-wrap:anywhere]">
                      {page.title !== '' ? page.title : page.url}
                    </span>
                    <span className="flex flex-wrap items-center gap-1">
                      {page.error !== undefined ? (
                        <Badge tone="danger">{page.error}</Badge>
                      ) : (
                        <>
                          <Badge tone="neutral">{PAPEL_LABEL[page.role] ?? page.role}</Badge>
                          {page.imageCount > 0 ? (
                            <Badge tone="neutral">
                              {page.imageCount} {page.imageCount === 1 ? 'imagem' : 'imagens'}
                            </Badge>
                          ) : null}
                          {page.renderedByScript ? <Badge tone="warning">sem texto no HTML</Badge> : null}
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

const PAPEL_LABEL: Record<string, string> = {
  inicial: 'Página inicial',
  sobre: 'Sobre',
  servicos: 'Serviços',
  produtos: 'Produtos',
  contato: 'Contato',
  equipe: 'Equipe',
  galeria: 'Galeria',
  portfolio: 'Portfólio',
  depoimentos: 'Depoimentos',
  faq: 'Perguntas frequentes',
  imoveis: 'Imóveis',
  outra: 'Outra',
};

/** Resumo com os numeros reais da analise. */
function Resumo({ run }: { run: ImportDetailView }) {
  const { summary } = run;
  const blocos: { label: string; valor: number; icon: typeof Globe }[] = [
    { label: summary.pages === 1 ? 'página lida' : 'páginas lidas', valor: summary.pages, icon: Globe },
    { label: summary.images === 1 ? 'imagem' : 'imagens', valor: summary.images, icon: ImageIcon },
    {
      label: summary.documentFields === 1 ? 'informação institucional' : 'informações institucionais',
      valor: summary.documentFields,
      icon: FileSearch,
    },
  ];

  const porModulo = Object.entries(summary.collectionRecords).filter(
    ([, total]) => (total ?? 0) > 0,
  );

  return (
    <Card>
      <CardHeader title="O que encontramos" description={run.message} />
      <CardBody>
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {blocos.map((bloco) => (
              <div
                key={bloco.label}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-[color:var(--border)] p-3"
              >
                <bloco.icon size={18} className="text-[color:var(--accent)]" />
                <span className="text-sm">
                  <strong className="text-base">{bloco.valor}</strong>{' '}
                  <span className="text-[color:var(--muted)]">{bloco.label}</span>
                </span>
              </div>
            ))}
          </div>

          {porModulo.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {porModulo.map(([target, total]) => (
                <Badge key={target} tone="neutral">
                  {total} em {importTargetLabel(target as ImportTarget)}
                </Badge>
              ))}
            </div>
          ) : null}

          {(summary.conflicts > 0 || summary.skippedByModule > 0 || summary.unmapped > 0) ? (
            <ul className="grid gap-1 text-xs text-[color:var(--muted)]">
              {summary.conflicts > 0 ? (
                <li className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2">
                  <AlertTriangle size={12} className="mt-0.5 text-[color:var(--warning)]" />
                  <span>
                    {summary.conflicts}{' '}
                    {summary.conflicts === 1
                      ? 'informação colide com um campo que já tem conteúdo'
                      : 'informações colidem com campos que já têm conteúdo'}
                    . Elas vêm desmarcadas: escolha manter o atual ou substituir.
                  </span>
                </li>
              ) : null}
              {summary.skippedByModule > 0 ? (
                <li className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2">
                  <Info size={12} className="mt-0.5" />
                  <span>
                    {summary.skippedByModule}{' '}
                    {summary.skippedByModule === 1 ? 'item' : 'itens'} não podem ser importados porque o
                    módulo correspondente não está habilitado neste site. Fale com a CODECA IA se
                    quiser habilitá-lo.
                  </span>
                </li>
              ) : null}
              {summary.unmapped > 0 ? (
                <li className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2">
                  <Info size={12} className="mt-0.5" />
                  <span>
                    {summary.unmapped}{' '}
                    {summary.unmapped === 1
                      ? 'trecho de texto não foi identificado'
                      : 'trechos de texto não foram identificados'}{' '}
                    e não serão importados. Preferimos deixar de fora do que adivinhar o lugar.
                  </span>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

interface Grupo {
  target: ImportTarget;
  label: string;
  items: ImportItemView[];
}

function agruparPorDestino(items: readonly ImportItemView[]): Grupo[] {
  const mapa = new Map<ImportTarget, ImportItemView[]>();
  for (const item of items) {
    const lista = mapa.get(item.target) ?? [];
    lista.push(item);
    mapa.set(item.target, lista);
  }
  return [...mapa.entries()].map(([target, lista]) => ({
    target,
    label: importTargetLabel(target),
    items: lista,
  }));
}

function GrupoDeCandidatos({
  grupo,
  somenteLeitura,
  onDecidir,
  onDecidirGrupo,
}: {
  grupo: Grupo;
  somenteLeitura: boolean;
  onDecidir: (
    item: ImportItemView,
    decision: 'selecionado' | 'ignorado',
    resolution?: 'manter' | 'substituir',
  ) => void | Promise<void>;
  onDecidirGrupo: (items: ImportItemView[], decision: 'selecionado' | 'ignorado') => void | Promise<void>;
}) {
  const disponiveis = grupo.items.filter((item) => !item.targetDisabled);
  const marcados = disponiveis.filter((item) => item.decision === 'selecionado');
  const todosMarcados = disponiveis.length > 0 && marcados.length === disponiveis.length;
  const indisponivel = disponiveis.length === 0;

  return (
    <Card>
      <CardHeader
        title={grupo.label}
        description={`${grupo.items.length} ${grupo.items.length === 1 ? 'item encontrado' : 'itens encontrados'}`}
        actions={
          somenteLeitura || indisponivel ? null : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onDecidirGrupo(disponiveis, todosMarcados ? 'ignorado' : 'selecionado')}
            >
              {todosMarcados ? 'Desmarcar tudo' : 'Marcar tudo'}
            </Button>
          )
        }
      />
      <CardBody>
        {indisponivel ? (
          <Alert tone="info" title="Módulo não habilitado neste site">
            Encontramos este conteúdo no seu site atual, mas o módulo {grupo.label} não está habilitado
            para este projeto. Fale com a CODECA IA se quiser passar a usá-lo.
          </Alert>
        ) : null}

        <ul className="grid gap-2">
          {grupo.items.map((item) => (
            <li
              key={item.id}
              className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-[color:var(--border)] p-3"
            >
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                {somenteLeitura || item.targetDisabled ? (
                  <span className="pt-0.5">
                    {item.outcome === 'importado' ? (
                      <CheckCircle2 size={16} className="text-[color:var(--success)]" />
                    ) : item.outcome === 'falhou' ? (
                      <AlertTriangle size={16} className="text-[color:var(--danger)]" />
                    ) : (
                      <Info size={16} className="text-[color:var(--muted)]" />
                    )}
                  </span>
                ) : (
                  <Checkbox
                    label={<span className="sr-only">{`Importar ${item.label}`}</span>}
                    checked={item.decision === 'selecionado'}
                    onChange={(marcado) => void onDecidir(item, marcado ? 'selecionado' : 'ignorado')}
                  />
                )}

                <div className="grid gap-1">
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">{item.label}</p>
                  <p className="text-xs text-[color:var(--muted)] [overflow-wrap:anywhere]">
                    {item.preview}
                  </p>

                  {/* O que ja esta no painel, quando ha conflito. */}
                  {item.conflict && item.currentPreview ? (
                    <div className="mt-1 grid gap-1 rounded-md bg-[color:var(--surface-2)] p-2">
                      <p className="text-xs text-[color:var(--muted)]">
                        Este campo já tem conteúdo no painel:
                      </p>
                      <p className="text-xs [overflow-wrap:anywhere]">{item.currentPreview}</p>
                      {!somenteLeitura ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            size="sm"
                            variant={item.resolution === 'manter' || item.decision === 'ignorado' ? 'primary' : 'outline'}
                            onClick={() => void onDecidir(item, 'ignorado', 'manter')}
                          >
                            Manter o atual
                          </Button>
                          <Button
                            size="sm"
                            variant={
                              item.decision === 'selecionado' && item.resolution === 'substituir'
                                ? 'primary'
                                : 'outline'
                            }
                            onClick={() => void onDecidir(item, 'selecionado', 'substituir')}
                          >
                            Substituir pelo encontrado
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    {item.targetDisabled ? <Badge tone="neutral">módulo não habilitado</Badge> : null}
                    {item.duplicate ? <Badge tone="neutral">repetido</Badge> : null}
                    {item.conflict ? <Badge tone="warning">campo já preenchido</Badge> : null}
                    {item.outcome === 'importado' ? <Badge tone="success">importado</Badge> : null}
                    {item.outcome === 'ignorado' ? <Badge tone="neutral">não importado</Badge> : null}
                    {item.outcome === 'revertido' ? <Badge tone="neutral">desfeito</Badge> : null}
                    {item.outcome === 'falhou' ? <Badge tone="danger">falhou</Badge> : null}
                    <a
                      className="text-xs underline [overflow-wrap:anywhere]"
                      href={item.evidence.pageUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      ver no site atual
                    </a>
                  </div>

                  {item.error ? (
                    <p className="text-xs text-[color:var(--danger)] [overflow-wrap:anywhere]">
                      {item.error}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function Historico({ history, atual }: { history: ImportRunView[]; atual: string }) {
  return (
    <Card>
      <CardHeader title="Importações anteriores" />
      <CardBody>
        <ul className="grid gap-2 text-sm">
          {history
            .filter((run) => run.id !== atual)
            .map((run) => (
              <li
                key={run.id}
                className="grid grid-cols-[minmax(0,1fr)] gap-1 border-t border-[color:var(--border)] pt-2 first:border-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-2"
              >
                <span className="grid gap-0.5">
                  <span className="[overflow-wrap:anywhere]">{run.sourceUrl}</span>
                  <span className="text-xs text-[color:var(--muted)]">
                    {formatDateTime(run.startedAt)}
                    {run.createdByName !== '' ? ` · ${run.createdByName}` : ''}
                  </span>
                </span>
                <Badge tone={ESTADO_TOM[run.state] ?? 'neutral'}>
                  {ESTADO_LABEL[run.state] ?? run.state}
                </Badge>
              </li>
            ))}
        </ul>
      </CardBody>
    </Card>
  );
}

const ESTADO_LABEL: Record<string, string> = {
  validando: 'validando',
  analisando: 'analisando',
  identificando: 'identificando',
  processando_imagens: 'processando imagens',
  analisada: 'aguardando confirmação',
  importando: 'importando',
  importada: 'importada',
  revertida: 'desfeita',
  erro: 'não concluída',
};

const ESTADO_TOM: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  importada: 'success',
  analisada: 'warning',
  erro: 'danger',
  revertida: 'neutral',
};

export { isWorkingState };
