import { useEffect, useState } from 'react';
import { Building2, ExternalLink, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import {
  CURRENCIES,
  PROPERTY_COMMERCIAL_STATUSES,
  PROPERTY_PURPOSES,
  PROPERTY_TYPES,
  PUBLICATION_STATUSES,
  formatPrice,
  slugify,
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
  DataTable,
  EmptyState,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Switch,
  TextArea,
  TextInput,
  useToast,
  type Column,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useDebounced, useMutation, useResource } from '../hooks/useResource.js';
import { useModulePolicy } from '../hooks/useSiteModules.js';
import { propertyApi } from '../services/endpoints.js';
import {
  CamposPersonalizados,
  useCamposPersonalizados,
} from '../components/CustomFields.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { GalleryField, ImageField } from '../components/MediaPicker.js';
import { commercialTone, labels, publicationTone, toOptions } from '../utils/labels.js';
import { formatList, numberOrNull, parseList, useForm } from '../utils/forms.js';
import type { MediaRef, PropertyRecord } from '../types/index.js';

/**
 * Imoveis.
 *
 * A tela separa o estado editorial (rascunho, publicado, arquivado) do estado
 * comercial (disponivel, reservado, vendido), porque um imovel vendido pode
 * continuar publicado como portfolio.
 */
export function PropertiesPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const debounced = useDebounced(search);

  const [editing, setEditing] = useState<PropertyRecord | 'new' | null>(null);
  const [removing, setRemoving] = useState<PropertyRecord | null>(null);

  const list = useResource(
    () =>
      propertyApi.list(tenantId, {
        page,
        pageSize: 20,
        ...(debounced ? { search: debounced } : {}),
        ...(status ? { publicationStatus: status } : {}),
        ...(type ? { type } : {}),
      }),
    [tenantId, page, debounced, status, type],
  );

  const facets = useResource(() => propertyApi.facets(tenantId), [tenantId]);

  const remove = useMutation((id: string) => propertyApi.remove(tenantId, id), {
    onSuccess: () => {
      toast.success('Imovel excluido');
      setRemoving(null);
      list.reload();
    },
    onError: (error) => toast.error('Nao foi possivel excluir', error.message),
  });

  const columns: Array<Column<PropertyRecord>> = [
    {
      key: 'title',
      header: 'Imovel',
      render: (property) => (
        <div className="flex items-center gap-3">
          <div className="size-12 flex-none overflow-hidden rounded-lg bg-slate-100">
            {property.coverImage?.url ? (
              <img
                src={property.coverImage.url}
                alt=""
                className="size-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="grid size-full place-items-center text-slate-300">
                <Building2 aria-hidden="true" className="size-5" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium text-slate-900">
              {property.title}
              {property.featured ? (
                <Star aria-label="Em destaque" className="size-3.5 fill-amber-400 text-amber-500" />
              ) : null}
            </p>
            <p className="truncate text-xs text-slate-500">
              {labels.propertyType[property.type]} - {labels.propertyPurpose[property.purpose]}
              {property.reference ? ` - ref. ${property.reference}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Valor',
      hideOnMobile: true,
      render: (property) => (
        <span className="tabular-nums">
          {formatPrice(property.price, property.currency, property.priceOnRequest)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Situacao',
      render: (property) => (
        <div className="grid gap-1">
          <Badge tone={publicationTone(property.publicationStatus)}>
            {labels.publication[property.publicationStatus]}
          </Badge>
          <Badge tone={commercialTone(property.commercialStatus)}>
            {labels.propertyCommercial[property.commercialStatus]}
          </Badge>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Localizacao',
      hideOnMobile: true,
      render: (property) => (
        <span className="text-xs text-slate-600">
          {[property.address.neighborhood, property.address.city].filter(Boolean).join(', ') || '-'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (property) => (
        <div className="flex justify-end gap-1">
          {property.publicationStatus === 'published' ? (
            <a
              href={`/imoveis/${property.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-grid size-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label={`Abrir ${property.title} no site`}
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          ) : null}
          {can('content:write') ? (
            <Button variant="ghost" size="icon" aria-label={`Editar ${property.title}`} onClick={() => setEditing(property)}>
              <Pencil aria-hidden="true" className="size-3.5" />
            </Button>
          ) : null}
          {can('content:delete') ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Excluir ${property.title}`}
              onClick={() => setRemoving(property)}
            >
              <Trash2 aria-hidden="true" className="size-3.5 text-rose-600" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Imoveis"
        description="Cadastro dos imoveis a venda, em locacao e lancamentos. Cada imovel publicado ganha uma pagina propria no site."
        actions={
          can('content:write') ? (
            <Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setEditing('new')}>
              Novo imovel
            </Button>
          ) : undefined
        }
      />

      {facets.data ? (
        <Alert tone="info">
          O plano atual permite ate <strong>{facets.data.maxPublishedProperties}</strong> imoveis publicados ao
          mesmo tempo. Imoveis em rascunho nao contam para o limite.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Carteira de imoveis"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-48">
                <TextInput
                  label="Buscar"
                  className="[&>label]:sr-only"
                  placeholder="Titulo ou referencia"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="w-40">
                <Select
                  label="Situacao"
                  className="[&>label]:sr-only"
                  placeholder="Todas as situacoes"
                  value={status}
                  options={toOptions(labels.publication, PUBLICATION_STATUSES)}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="w-40">
                <Select
                  label="Tipo"
                  className="[&>label]:sr-only"
                  placeholder="Todos os tipos"
                  value={type}
                  options={toOptions(labels.propertyType, PROPERTY_TYPES)}
                  onChange={(event) => {
                    setType(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
          }
        />
        <ResourcePanel resource={list}>
          {(data) => (
            <>
              <DataTable
                columns={columns}
                rows={data.items}
                rowKey={(property) => property.id}
                caption="Imoveis cadastrados"
                empty={
                  <CardBody>
                    <EmptyState
                      icon={<Building2 aria-hidden="true" className="size-8" />}
                      title="Nenhum imovel cadastrado"
                      description="Cadastre o primeiro imovel para que ele apareca no site."
                      action={
                        can('content:write') ? (
                          <Button onClick={() => setEditing('new')}>Novo imovel</Button>
                        ) : undefined
                      }
                    />
                  </CardBody>
                }
              />
              <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
            </>
          )}
        </ResourcePanel>
      </Card>

      {editing ? (
        <PropertyFormModal
          propertyId={editing === 'new' ? null : editing.id}
          cities={facets.data?.cities ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
            facets.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title="Excluir imovel"
        message={
          <>
            O imovel <strong>{removing?.title}</strong> sera excluido, junto com a pagina publica dele. As
            fotos permanecem na biblioteca de imagens.
          </>
        }
        confirmLabel="Excluir imovel"
        loading={remove.loading}
        onConfirm={() => removing && void remove.run(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

const EMPTY_FORM = {
  title: '',
  slug: '',
  reference: '',
  shortDescription: '',
  description: '',
  type: 'apartamento',
  purpose: 'venda',
  price: '',
  priceOnRequest: false,
  condoFee: '',
  iptu: '',
  currency: 'BRL',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  postalCode: '',
  showFullAddress: true,
  builtAreaM2: '',
  landAreaM2: '',
  bedrooms: '',
  suites: '',
  bathrooms: '',
  parkingSpots: '',
  features: '',
  publicationStatus: 'draft',
  commercialStatus: 'disponivel',
  featured: false,
  deliveryDate: '',
  videoUrl: '',
  seoTitle: '',
  seoDescription: '',
  coverImageId: null as string | null,
  galleryImageIds: [] as string[],
};

/** Formulario completo de imovel. */
function PropertyFormModal({
  propertyId,
  cities,
  onClose,
  onSaved,
}: {
  propertyId: string | null;
  cities: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const politica = useModulePolicy('imoveis');
  const toast = useToast();
  const form = useForm({ ...EMPTY_FORM });
  const [cover, setCover] = useState<MediaRef | null>(null);
  const [gallery, setGallery] = useState<MediaRef[]>([]);

  const detail = useResource(() => propertyApi.detail(tenantId, propertyId as string), [tenantId, propertyId], {
    enabled: Boolean(propertyId),
  });

  useEffect(() => {
    const property = detail.data?.property;
    if (!property) return;
    form.setValues({
      title: property.title,
      slug: property.slug,
      reference: property.reference,
      shortDescription: property.shortDescription,
      description: property.description,
      type: property.type,
      purpose: property.purpose,
      price: property.price === null ? '' : String(property.price),
      priceOnRequest: property.priceOnRequest,
      condoFee: property.condoFee === null ? '' : String(property.condoFee),
      iptu: property.iptu === null ? '' : String(property.iptu),
      currency: property.currency,
      street: property.address.street,
      number: property.address.number,
      complement: property.address.complement,
      neighborhood: property.address.neighborhood,
      city: property.address.city,
      state: property.address.state,
      postalCode: property.address.postalCode,
      showFullAddress: property.address.showFullAddress,
      builtAreaM2: property.builtAreaM2 === null ? '' : String(property.builtAreaM2),
      landAreaM2: property.landAreaM2 === null ? '' : String(property.landAreaM2),
      bedrooms: property.bedrooms === null ? '' : String(property.bedrooms),
      suites: property.suites === null ? '' : String(property.suites),
      bathrooms: property.bathrooms === null ? '' : String(property.bathrooms),
      parkingSpots: property.parkingSpots === null ? '' : String(property.parkingSpots),
      features: formatList(property.features),
      publicationStatus: property.publicationStatus,
      commercialStatus: property.commercialStatus,
      featured: property.featured,
      deliveryDate: property.deliveryDate ?? '',
      videoUrl: property.videoUrl,
      seoTitle: property.seoTitle,
      seoDescription: property.seoDescription,
      coverImageId: property.coverImageId,
      galleryImageIds: (property.gallery ?? []).map((image) => image.id),
    });
    setCover(property.coverImage ?? null);
    setGallery(property.gallery ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data]);

  const personalizados = useCamposPersonalizados('imoveis', detail.data?.property.customFields);

  function payload() {
    const values = form.values;
    // Campo travado sai do corpo: reenvia-lo levaria 403 mesmo sem o cliente
    // ter tocado nele, e o servidor sabe o proprio valor.
    const extras = personalizados.paraApi();
    return politica.semTravados({
      ...(extras ? { customFields: extras } : {}),
      title: values.title,
      ...(values.slug ? { slug: values.slug } : {}),
      reference: values.reference,
      shortDescription: values.shortDescription,
      description: values.description,
      type: values.type,
      purpose: values.purpose,
      price: numberOrNull(values.price),
      priceOnRequest: values.priceOnRequest,
      condoFee: numberOrNull(values.condoFee),
      iptu: numberOrNull(values.iptu),
      currency: values.currency,
      address: {
        street: values.street,
        number: values.number,
        complement: values.complement,
        neighborhood: values.neighborhood,
        city: values.city,
        state: values.state,
        postalCode: values.postalCode,
        showFullAddress: values.showFullAddress,
      },
      builtAreaM2: numberOrNull(values.builtAreaM2),
      landAreaM2: numberOrNull(values.landAreaM2),
      bedrooms: numberOrNull(values.bedrooms),
      suites: numberOrNull(values.suites),
      bathrooms: numberOrNull(values.bathrooms),
      parkingSpots: numberOrNull(values.parkingSpots),
      features: parseList(values.features),
      publicationStatus: values.publicationStatus,
      commercialStatus: values.commercialStatus,
      featured: values.featured,
      deliveryDate: values.deliveryDate || null,
      videoUrl: values.videoUrl,
      seoTitle: values.seoTitle,
      seoDescription: values.seoDescription,
      coverImageId: values.coverImageId,
      galleryImageIds: values.galleryImageIds,
    });
  }

  const save = useMutation(
    () => (propertyId ? propertyApi.update(tenantId, propertyId, payload()) : propertyApi.create(tenantId, payload())),
    {
      onSuccess: () => {
        toast.success(propertyId ? 'Imovel atualizado' : 'Imovel cadastrado');
        onSaved();
      },
      onError: (error) => {
        form.applyApiError(error);
        if (error.isPlanLimit) toast.error('Limite do plano alcancado', error.message);
        else if (Object.keys(error.fieldErrors).length === 0) toast.error('Nao foi possivel salvar', error.message);
      },
    },
  );

  const { values, errors, setField } = form;

  return (
    <Modal
      open
      onClose={onClose}
      title={propertyId ? 'Editar imovel' : 'Novo imovel'}
      description="Os campos de endereco podem ficar ocultos no site publico."
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.loading} onClick={() => void save.run(undefined)}>
            {propertyId ? 'Salvar alteracoes' : 'Cadastrar imovel'}
          </Button>
        </>
      }
    >
      <div className="grid gap-6">
        <section className="grid gap-4">
          <h3 className="text-sm font-semibold text-slate-800">Identificacao</h3>
          <TextInput
            label="Titulo"
            required
            value={values.title}
            error={errors.title}
            onChange={(event) => setField('title', event.target.value)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Endereco da pagina"
              value={values.slug}
              error={errors.slug}
              placeholder={slugify(values.title)}
              readOnly={!politica.editavel('slug')}
              disabled={!politica.editavel('slug')}
              hint={
                politica.travaExplicada('slug') ??
                'Gerado a partir do titulo quando vazio.'
              }
              onChange={(event) => setField('slug', slugify(event.target.value))}
            />
            <TextInput
              label="Referencia interna"
              value={values.reference}
              error={errors.reference}
              onChange={(event) => setField('reference', event.target.value)}
            />
          </div>
          <TextInput
            label="Resumo"
            value={values.shortDescription}
            error={errors.shortDescription}
            hint="Aparece nos cartoes de listagem."
            onChange={(event) => setField('shortDescription', event.target.value)}
          />
          <TextArea
            label="Descricao completa"
            rows={5}
            value={values.description}
            error={errors.description}
            onChange={(event) => setField('description', event.target.value)}
          />
        </section>

        <section className="grid gap-4">
          <h3 className="text-sm font-semibold text-slate-800">Tipo e valores</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Tipo"
              required
              value={values.type}
              options={toOptions(labels.propertyType, PROPERTY_TYPES)}
              onChange={(event) => setField('type', event.target.value)}
            />
            <Select
              label="Finalidade"
              required
              value={values.purpose}
              options={toOptions(labels.propertyPurpose, PROPERTY_PURPOSES)}
              onChange={(event) => setField('purpose', event.target.value)}
            />
          </div>
          <Switch
            label="Valor sob consulta"
            hint="O site mostra 'Valor sob consulta' em vez do preco."
            checked={values.priceOnRequest}
            onChange={(checked) => setField('priceOnRequest', checked)}
          />
          <div className="grid gap-4 sm:grid-cols-4">
            <TextInput
              label="Valor"
              inputMode="decimal"
              value={values.price}
              error={errors.price}
              disabled={values.priceOnRequest}
              onChange={(event) => setField('price', event.target.value)}
            />
            <Select
              label="Moeda"
              value={values.currency}
              options={CURRENCIES.map((code) => ({ value: code, label: code }))}
              disabled={!politica.editavel('currency')}
              {...(politica.travaExplicada('currency')
                ? { hint: politica.travaExplicada('currency')! }
                : {})}
              onChange={(event) => setField('currency', event.target.value)}
            />
            <TextInput
              label="Condominio"
              inputMode="decimal"
              value={values.condoFee}
              onChange={(event) => setField('condoFee', event.target.value)}
            />
            <TextInput
              label="IPTU"
              inputMode="decimal"
              value={values.iptu}
              onChange={(event) => setField('iptu', event.target.value)}
            />
          </div>
        </section>

        <section className="grid gap-4">
          <h3 className="text-sm font-semibold text-slate-800">Caracteristicas</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextInput
              label="Area construida (m2)"
              inputMode="decimal"
              value={values.builtAreaM2}
              onChange={(event) => setField('builtAreaM2', event.target.value)}
            />
            <TextInput
              label="Area do terreno (m2)"
              inputMode="decimal"
              value={values.landAreaM2}
              onChange={(event) => setField('landAreaM2', event.target.value)}
            />
            <TextInput
              label="Dormitorios"
              inputMode="numeric"
              value={values.bedrooms}
              onChange={(event) => setField('bedrooms', event.target.value)}
            />
            <TextInput
              label="Suites"
              inputMode="numeric"
              value={values.suites}
              onChange={(event) => setField('suites', event.target.value)}
            />
            <TextInput
              label="Banheiros"
              inputMode="numeric"
              value={values.bathrooms}
              onChange={(event) => setField('bathrooms', event.target.value)}
            />
            <TextInput
              label="Vagas de garagem"
              inputMode="numeric"
              value={values.parkingSpots}
              onChange={(event) => setField('parkingSpots', event.target.value)}
            />
          </div>
          <TextArea
            label="Caracteristicas adicionais"
            rows={4}
            value={values.features}
            hint="Uma por linha. Exemplo: varanda gourmet, portaria 24 horas, energia solar."
            onChange={(event) => setField('features', event.target.value)}
          />
        </section>

        <section className="grid gap-4">
          <h3 className="text-sm font-semibold text-slate-800">Localizacao</h3>
          <Switch
            label="Exibir endereco completo no site"
            hint="Desligado, o site mostra apenas bairro e cidade."
            checked={values.showFullAddress}
            onChange={(checked) => setField('showFullAddress', checked)}
          />
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
            <TextInput label="Rua" value={values.street} onChange={(event) => setField('street', event.target.value)} />
            <TextInput label="Numero" value={values.number} onChange={(event) => setField('number', event.target.value)} />
            <TextInput
              label="Complemento"
              value={values.complement}
              onChange={(event) => setField('complement', event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <TextInput
              label="Bairro"
              value={values.neighborhood}
              onChange={(event) => setField('neighborhood', event.target.value)}
            />
            <TextInput
              label="Cidade"
              value={values.city}
              list="cidades-cadastradas"
              onChange={(event) => setField('city', event.target.value)}
            />
            <datalist id="cidades-cadastradas">
              {cities.map((city) => (
                <option key={city} value={city} />
              ))}
            </datalist>
            <TextInput
              label="UF"
              maxLength={2}
              value={values.state}
              error={errors['address.state']}
              onChange={(event) => setField('state', event.target.value.toUpperCase())}
            />
            <TextInput
              label="CEP"
              value={values.postalCode}
              onChange={(event) => setField('postalCode', event.target.value)}
            />
          </div>
        </section>

        <section className="grid gap-4">
          <h3 className="text-sm font-semibold text-slate-800">Imagens</h3>
          <ImageField
            label="Imagem de capa"
            tag="imoveis"
            value={values.coverImageId}
            preview={cover}
            onChange={(mediaId, asset) => {
              setField('coverImageId', mediaId);
              setCover(
                asset
                  ? { id: asset.id, url: asset.blobUrl, alt: asset.alt, width: asset.width, height: asset.height }
                  : null,
              );
            }}
          />
          <GalleryField
            label="Galeria de fotos"
            value={values.galleryImageIds}
            previews={gallery}
            onChange={(ids, assets) => {
              setField('galleryImageIds', ids);
              if (assets) {
                setGallery((current) => [
                  ...current,
                  ...assets.map((asset) => ({
                    id: asset.id,
                    url: asset.blobUrl,
                    alt: asset.alt,
                    width: asset.width,
                    height: asset.height,
                  })),
                ]);
              }
            }}
          />
          <TextInput
            label="Link de video"
            value={values.videoUrl}
            hint="Link do YouTube ou Vimeo, opcional."
            onChange={(event) => setField('videoUrl', event.target.value)}
          />
        </section>

        <section className="grid gap-4">
          <h3 className="text-sm font-semibold text-slate-800">Publicacao</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Situacao no site"
              value={values.publicationStatus}
              options={toOptions(labels.publication, PUBLICATION_STATUSES)}
              hint="Somente imoveis publicados aparecem no site."
              onChange={(event) => setField('publicationStatus', event.target.value)}
            />
            <Select
              label="Situacao comercial"
              value={values.commercialStatus}
              options={toOptions(labels.propertyCommercial, PROPERTY_COMMERCIAL_STATUSES)}
              hint="Independente da publicacao: um imovel vendido pode seguir no portfolio."
              onChange={(event) => setField('commercialStatus', event.target.value)}
            />
          </div>
          <Checkbox
            label="Marcar como destaque"
            hint="Usado pelo bloco de imovel em destaque e na ordenacao das listagens."
            checked={values.featured}
            onChange={(checked) => setField('featured', checked)}
          />
          <TextInput
            label="Entrega prevista"
            type="date"
            value={values.deliveryDate}
            onChange={(event) => setField('deliveryDate', event.target.value)}
          />
        </section>

        <section className="grid gap-4">
          <h3 className="text-sm font-semibold text-slate-800">SEO da pagina do imovel</h3>
          <TextInput
            label="Titulo para buscadores"
            value={values.seoTitle}
            hint="Vazio usa o titulo do imovel."
            onChange={(event) => setField('seoTitle', event.target.value)}
          />
          <TextArea
            label="Descricao para buscadores"
            rows={2}
            value={values.seoDescription}
            hint="Vazio usa o resumo do imovel."
            onChange={(event) => setField('seoDescription', event.target.value)}
          />
        </section>

        <CamposPersonalizados
          moduleKey="imoveis"
          values={personalizados.valores}
          onChange={personalizados.definir}
          errors={errors}
        />
      </div>
    </Modal>
  );
}
