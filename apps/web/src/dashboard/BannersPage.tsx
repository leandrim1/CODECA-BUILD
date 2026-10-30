import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  Switch,
  TextArea,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useTenantId } from '../hooks/useAuth.js';
import { useModulePolicy } from '../hooks/useSiteModules.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { bannerApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { ImageField } from '../components/MediaPicker.js';
import { Can } from '../components/Guards.js';
import { useForm } from '../utils/forms.js';
import type { BannerRecord } from '../types/index.js';

/**
 * Banners da abertura do site.
 *
 * Um banner pode ter janela de exibicao: `startsAt` e `endsAt` deixam o
 * cliente programar a troca sem precisar entrar no painel no dia. Fora da
 * janela, a API publica simplesmente nao o devolve -- o site do cliente nao
 * precisa saber a regra.
 */

export function BannersPage() {
  const tenantId = useTenantId();
  const [editando, setEditando] = useState<BannerRecord | 'novo' | null>(null);
  const [removendo, setRemovendo] = useState<BannerRecord | null>(null);
  const toast = useToast();
  const banners = useResource(() => bannerApi.list(tenantId), [tenantId]);

  const remover = useMutation((id: string) => bannerApi.remove(tenantId, id), {
    onSuccess: () => {
      toast.success('Banner removido');
      setRemovendo(null);
      banners.reload();
    },
    onError: (error) => toast.error('Nao foi possivel remover', error.message),
  });

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Banners"
        description="Destaques que abrem o seu site. A ordem define a sequencia de exibicao."
        actions={
          <Can capability="content:write">
            <Button
              icon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setEditando('novo')}
            >
              Novo banner
            </Button>
          </Can>
        }
      />

      <ResourcePanel resource={banners}>
        {(data) =>
          data.banners.length === 0 ? (
            <EmptyState
              title="Nenhum banner cadastrado"
              description="Um banner tem imagem, titulo e, se quiser, um botao que leva para outra pagina do site."
              action={
                <Can capability="content:write">
                  <Button onClick={() => setEditando('novo')}>Criar o primeiro</Button>
                </Can>
              }
            />
          ) : (
            <div className="grid gap-3">
              {data.banners.map((banner) => (
                <Card key={banner.id}>
                  <CardBody className="flex flex-wrap items-start gap-4">
                    {banner.image?.url ? (
                      <img
                        src={banner.image.url}
                        alt={banner.image.alt || banner.title}
                        className="h-20 w-32 flex-none rounded-lg object-cover"
                      />
                    ) : (
                      <div className="grid h-20 w-32 flex-none place-items-center rounded-lg bg-slate-100 text-xs text-slate-500">
                        sem imagem
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-slate-900">{banner.title}</p>
                        <Badge tone={banner.isActive ? 'success' : 'neutral'}>
                          {banner.isActive ? 'ativo' : 'inativo'}
                        </Badge>
                        <Badge tone="neutral">ordem {banner.sortOrder}</Badge>
                      </div>
                      {banner.subtitle ? (
                        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{banner.subtitle}</p>
                      ) : null}
                      {banner.buttonLabel ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Botao: {banner.buttonLabel} - {banner.buttonUrl}
                        </p>
                      ) : null}
                      <Janela banner={banner} />
                    </div>

                    <Can capability="content:write">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditando(banner)}>
                          <Pencil aria-hidden="true" className="size-4" />
                          <span className="sr-only">Editar</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemovendo(banner)}>
                          <Trash2 aria-hidden="true" className="size-4" />
                          <span className="sr-only">Remover</span>
                        </Button>
                      </div>
                    </Can>
                  </CardBody>
                </Card>
              ))}
            </div>
          )
        }
      </ResourcePanel>

      {editando ? (
        <FormularioBanner
          banner={editando === 'novo' ? null : editando}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null);
            banners.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removendo !== null}
        title="Remover este banner?"
        message="Ele sai do seu site assim que a pagina for recarregada. A imagem continua na Biblioteca de imagens."
        confirmLabel="Remover"
        tone="danger"
        loading={remover.loading}
        onCancel={() => setRemovendo(null)}
        onConfirm={() => {
          if (removendo) void remover.run(removendo.id);
        }}
      />
    </div>
  );
}

/** Janela de exibicao, em linguagem de quem opera o site. */
function Janela({ banner }: { banner: BannerRecord }) {
  if (!banner.startsAt && !banner.endsAt) return null;

  const formatar = (valor: string) => new Date(valor).toLocaleDateString('pt-BR');
  const texto = banner.startsAt
    ? banner.endsAt
      ? `Aparece de ${formatar(banner.startsAt)} a ${formatar(banner.endsAt)}`
      : `Aparece a partir de ${formatar(banner.startsAt)}`
    : `Aparece ate ${formatar(banner.endsAt!)}`;

  return <p className="mt-1 text-xs text-slate-500">{texto}</p>;
}

function FormularioBanner({
  banner,
  onClose,
  onSaved,
}: {
  banner: BannerRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const politica = useModulePolicy('banners');
  const { values, errors, setField, applyApiError } = useForm({
    title: banner?.title ?? '',
    subtitle: banner?.subtitle ?? '',
    imageId: banner?.imageId ?? null,
    buttonLabel: banner?.buttonLabel ?? '',
    buttonUrl: banner?.buttonUrl ?? '',
    sortOrder: String(banner?.sortOrder ?? 0),
    isActive: banner?.isActive ?? true,
    // A API devolve data e hora; o controle de data usa so a data.
    startsAt: banner?.startsAt ? banner.startsAt.slice(0, 10) : '',
    endsAt: banner?.endsAt ? banner.endsAt.slice(0, 10) : '',
  });

  const salvar = useMutation(
    () => {
      const corpo = {
        title: values.title,
        subtitle: values.subtitle,
        imageId: values.imageId,
        buttonLabel: values.buttonLabel,
        buttonUrl: values.buttonUrl,
        sortOrder: Number(values.sortOrder) || 0,
        isActive: values.isActive,
        startsAt: values.startsAt === '' ? null : values.startsAt,
        endsAt: values.endsAt === '' ? null : values.endsAt,
      };
      return banner
        ? bannerApi.update(tenantId, banner.id, corpo)
        : bannerApi.create(tenantId, corpo);
    },
    {
      onSuccess: () => {
        toast.success(banner ? 'Banner atualizado' : 'Banner criado');
        onSaved();
      },
      onError: (error) => {
        applyApiError(error);
        toast.error('Nao foi possivel salvar', error.message);
      },
    },
  );

  /** Campo travado pela CODECA IA aparece, sem permitir alteracao. */
  const travado = (fieldKey: string) => !politica.editavel(fieldKey);
  const dica = (fieldKey: string) => politica.travaExplicada(fieldKey) ?? undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title={banner ? 'Editar banner' : 'Novo banner'}
      description="O titulo aparece sobre a imagem. O botao e opcional."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar.run(undefined)} disabled={salvar.loading}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextInput
          label="Titulo"
          required
          value={values.title}
          error={errors.title}
          readOnly={travado('title')}
          {...(dica('title') ? { hint: dica('title') } : {})}
          onChange={(event) => setField('title', event.target.value)}
        />

        <TextArea
          label="Subtitulo"
          rows={2}
          value={values.subtitle}
          error={errors.subtitle}
          readOnly={travado('subtitle')}
          {...(dica('subtitle') ? { hint: dica('subtitle') } : {})}
          onChange={(event) => setField('subtitle', event.target.value)}
        />

        <ImageField
          label="Imagem"
          value={values.imageId}
          preview={banner?.image ?? null}
          onChange={(mediaId) => setField('imageId', mediaId)}
          tag="banner"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="Texto do botao"
            value={values.buttonLabel}
            error={errors.buttonLabel}
            hint="Deixe vazio para um banner sem botao."
            onChange={(event) => setField('buttonLabel', event.target.value)}
          />
          <TextInput
            label="Link do botao"
            value={values.buttonUrl}
            error={errors.buttonUrl}
            placeholder="/imoveis"
            onChange={(event) => setField('buttonUrl', event.target.value)}
          />
        </div>

        {values.buttonLabel.trim() !== '' && values.buttonUrl.trim() === '' ? (
          <Alert tone="warning" title="O botao precisa de um link">
            Um botao sem destino nao e exibido no site.
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="Publicar a partir de"
            type="date"
            value={values.startsAt}
            error={errors.startsAt}
            hint="Vazio: aparece desde ja."
            onChange={(event) => setField('startsAt', event.target.value)}
          />
          <TextInput
            label="Despublicar em"
            type="date"
            value={values.endsAt}
            error={errors.endsAt}
            hint="Vazio: fica no ar sem prazo."
            onChange={(event) => setField('endsAt', event.target.value)}
          />
        </div>

        <TextInput
          label="Ordem"
          type="number"
          value={values.sortOrder}
          error={errors.sortOrder}
          hint="Menor numero aparece primeiro."
          onChange={(event) => setField('sortOrder', event.target.value)}
        />

        <Switch
          label="Ativo"
          hint="Desligado, o banner fica guardado sem aparecer no site."
          checked={values.isActive}
          onChange={(marcado) => setField('isActive', marcado)}
        />
      </div>
    </Modal>
  );
}
