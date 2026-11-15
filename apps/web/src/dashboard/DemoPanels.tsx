import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, useToast } from '@codeca/ui';
import { useResource, useMutation } from '../hooks/useResource.js';
import { demoApi } from '../services/endpoints.js';

/**
 * Boas-vindas do ambiente de demonstracao, na visao geral do cliente.
 *
 * Responde, sem ninguem precisar perguntar: o que e isto, onde eu edito, onde
 * eu vejo, quanto tempo tenho e o que faco quando quiser o meu site de verdade.
 * Some sozinho quando a demonstracao e encerrada (o site real foi conectado).
 */
export function DemoWelcome({ tenantId, canBilling }: { tenantId: string; canBilling: boolean }) {
  const info = useResource('demoApi.info', () => demoApi.info(tenantId), [tenantId]);
  const demo = info.data?.demo;
  if (!demo?.active || !demo.path) return null;

  const diasRestantes = demo.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(demo.trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <Card className="border-brand-200">
      <CardHeader
        title="Seu ambiente de demonstração está pronto!"
        description="Agora você pode experimentar o painel da CODECA Build, editar conteúdos e visualizar suas alterações em um site conectado."
      />
      <CardBody className="grid gap-4">
        <ol className="grid gap-2 text-sm text-slate-700">
          <li>
            <strong>1. Edite um conteúdo.</strong> Já deixamos alguns exemplos em{' '}
            <Link to="/painel/servicos" className="font-medium text-brand-700 underline">
              Serviços
            </Link>{' '}
            e em{' '}
            <Link to="/painel/banners" className="font-medium text-brand-700 underline">
              Banners
            </Link>
            . Troque um título e salve.
          </li>
          <li>
            <strong>2. Veja no site.</strong> Abra o site de demonstração: a alteração aparece em
            poucos segundos.
          </li>
          <li>
            <strong>3. Faça do seu jeito.</strong> Edite, cadastre e exclua à vontade. É um ambiente
            de teste, com conteúdo de exemplo.
          </li>
        </ol>

        <div className="flex flex-wrap items-center gap-3">
          <a href={demo.path} target="_blank" rel="noreferrer">
            <Button>
              Ver meu site de demonstração
              <ExternalLink aria-hidden="true" className="size-4" />
            </Button>
          </a>
          {diasRestantes !== null ? (
            <span className="text-sm text-slate-600">
              {diasRestantes === 0
                ? 'Sua avaliação termina hoje.'
                : `Sua avaliação gratuita vai até daqui a ${diasRestantes} dia${diasRestantes === 1 ? '' : 's'}.`}
            </span>
          ) : null}
        </div>

        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          <strong>Quando quiser o seu site de verdade:</strong> contrate um plano
          {canBilling ? (
            <>
              {' '}
              em{' '}
              <Link to="/painel/plano" className="font-medium text-brand-700 underline">
                Plano e assinatura
              </Link>
            </>
          ) : null}
          . A equipe da CODECA IA desenvolve e conecta o site da sua empresa, e o conteúdo que você
          criou aqui continua seu. O painel que você está experimentando faz parte dos planos
          Profissional e Empresas; no plano Essencial, quem mantém o conteúdo é a equipe da CODECA IA.
        </p>
      </CardBody>
    </Card>
  );
}

/**
 * Transicao da demonstracao para o site real, no painel mestre.
 *
 * Mostra antes o que vai acontecer, e so apaga exemplo que o cliente nao
 * tocou -- e so quando a pessoa marca que quer.
 */
export function DemoTransition({ siteId, onDone }: { siteId: string; onDone?: () => void }) {
  const toast = useToast();
  const previa = useResource('demoApi.transition', () => demoApi.transition(siteId), [siteId]);
  const [remover, setRemover] = useState(true);
  const [confirmando, setConfirmando] = useState(false);

  const encerrar = useMutation(() => demoApi.end(siteId, remover), {
    onSuccess: ({ result }) => {
      const removidos = result.removed.banners + result.removed.services;
      toast.success(
        'Demonstração encerrada',
        removidos > 0
          ? `${removidos} exemplo(s) removido(s). O conteúdo do cliente foi mantido.`
          : 'Nenhum conteúdo foi removido.',
      );
      setConfirmando(false);
      void previa.reload();
      onDone?.();
    },
    onError: (error) => toast.error('Não foi possível encerrar', error.message),
  });

  const t = previa.data?.transition;
  if (!t?.isDemo) return null;

  const intocados = t.untouchedExamples.banners + t.untouchedExamples.services;
  const editados = t.editedExamples.banners + t.editedExamples.services;

  return (
    <Alert tone="warning" title="Este site é uma demonstração da avaliação">
      <div className="grid gap-3">
        <p>
          Ele foi criado no cadastro do cliente, com conteúdo de exemplo. Ao conectar o site real,
          encerre a demonstração: a chave de demonstração deixa de valer e o endereço de
          demonstração para de responder.
        </p>
        <ul className="grid gap-1">
          <li>
            <strong>{intocados}</strong> exemplo(s) que o cliente não alterou.
          </li>
          <li>
            <strong>{editados}</strong> exemplo(s) que o cliente editou: passaram a ser dele e{' '}
            <strong>serão mantidos</strong>.
          </li>
          <li>Tudo o que o cliente cadastrou por conta própria é mantido.</li>
        </ul>

        {!t.realKeyIssued ? (
          <p>
            <strong>Antes de encerrar:</strong> emita a chave de integração do site real, na aba
            “Chaves”. Sem ela o cliente ficaria sem site nenhum.
          </p>
        ) : !confirmando ? (
          <div>
            <Button variant="outline" size="sm" onClick={() => setConfirmando(true)}>
              Encerrar a demonstração
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={remover}
                onChange={(event) => setRemover(event.target.checked)}
              />
              <span>
                Remover os {intocados} exemplo(s) que o cliente não alterou. Nada além deles é
                apagado.
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmando(false)}>
                Cancelar
              </Button>
              <Button size="sm" loading={encerrar.loading} onClick={() => void encerrar.run(undefined)}>
                Confirmar e encerrar
              </Button>
            </div>
          </div>
        )}
      </div>
    </Alert>
  );
}
