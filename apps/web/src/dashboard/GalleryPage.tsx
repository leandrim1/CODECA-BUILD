import { useState } from 'react';
import { CircleHelp, MessageSquareQuote, Pencil, Plus, Trash2, Users } from 'lucide-react';
import {
  PUBLICATION_STATUSES,
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_LABELS,
  type PublicationStatus,
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
  Modal,
  PageHeader,
  Select,
  Tabs,
  TextArea,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { contentApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { ImageField } from '../components/MediaPicker.js';
import { labels, publicationTone, toOptions } from '../utils/labels.js';
import { useForm } from '../utils/forms.js';
import type { FaqRecord, MediaRef, TeamMemberRecord, TestimonialRecord } from '../types/index.js';

/**
 * Depoimentos, equipe e perguntas frequentes.
 *
 * Depoimento so pode ser publicado com a declaracao de que o autor autorizou.
 * A regra e verificada no servidor tambem: sem a autorizacao, a publicacao e
 * recusada.
 */
export function GalleryPage() {
  const [tab, setTab] = useState('depoimentos');

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Galeria e prova social"
        description="Depoimentos autorizados, equipe tecnica e perguntas frequentes exibidas no site."
      />

      <Tabs
        items={[
          { id: 'depoimentos', label: 'Depoimentos' },
          { id: 'equipe', label: 'Equipe' },
          { id: 'perguntas', label: 'Perguntas frequentes' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'depoimentos' ? <TestimonialsSection /> : null}
      {tab === 'equipe' ? <TeamSection /> : null}
      {tab === 'perguntas' ? <FaqSection /> : null}
    </div>
  );
}

function TestimonialsSection() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();
  const [editing, setEditing] = useState<TestimonialRecord | 'new' | null>(null);
  const [removing, setRemoving] = useState<TestimonialRecord | null>(null);

  const list = useResource(() => contentApi.testimonials(tenantId, { pageSize: 50 }), [tenantId]);
  const remove = useMutation((id: string) => contentApi.removeTestimonial(tenantId, id), {
    onSuccess: () => {
      toast.success('Depoimento removido');
      setRemoving(null);
      list.reload();
    },
  });

  return (
    <div className="grid gap-4">
      <Alert tone="info" title="Autorizacao do autor">
        Um depoimento so vai ao ar quando a empresa confirma que tem a autorizacao da pessoa que o escreveu.
        Sem essa confirmacao, ele fica guardado como rascunho.
      </Alert>

      <Card>
        <CardHeader
          title="Depoimentos"
          actions={
            can('content:write') ? (
              <Button size="sm" icon={<Plus aria-hidden="true" className="size-3.5" />} onClick={() => setEditing('new')}>
                Novo depoimento
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          <ResourcePanel resource={list}>
            {(data) =>
              data.items.length === 0 ? (
                <EmptyState
                  icon={<MessageSquareQuote aria-hidden="true" className="size-8" />}
                  title="Nenhum depoimento cadastrado"
                  description="Registre depoimentos de clientes com a autorizacao deles."
                />
              ) : (
                <ul className="grid gap-3">
                  {data.items.map((testimonial) => (
                    <li key={testimonial.id} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">{testimonial.authorName}</p>
                          {testimonial.authorRole ? (
                            <p className="text-xs text-slate-500">{testimonial.authorRole}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={publicationTone(testimonial.publicationStatus)}>
                            {labels.publication[testimonial.publicationStatus]}
                          </Badge>
                          <Badge tone={testimonial.authorizationConfirmed ? 'success' : 'warning'}>
                            {testimonial.authorizationConfirmed ? 'Autorizado' : 'Sem autorizacao'}
                          </Badge>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{testimonial.content}</p>
                      {can('content:write') ? (
                        <div className="mt-3 flex gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => setEditing(testimonial)}>
                            Editar
                          </Button>
                          {can('content:delete') ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Remover depoimento de ${testimonial.authorName}`}
                              onClick={() => setRemoving(testimonial)}
                            >
                              <Trash2 aria-hidden="true" className="size-3.5 text-rose-600" />
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )
            }
          </ResourcePanel>
        </CardBody>
      </Card>

      {editing ? (
        <TestimonialModal
          testimonial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title="Remover depoimento"
        message={<>O depoimento de <strong>{removing?.authorName}</strong> sera removido.</>}
        confirmLabel="Remover"
        loading={remove.loading}
        onConfirm={() => removing && void remove.run(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function TestimonialModal({
  testimonial,
  onClose,
  onSaved,
}: {
  testimonial: TestimonialRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const form = useForm({
    authorName: testimonial?.authorName ?? '',
    authorRole: testimonial?.authorRole ?? '',
    content: testimonial?.content ?? '',
    rating: testimonial?.rating === null || testimonial?.rating === undefined ? '' : String(testimonial.rating),
    authorizationConfirmed: testimonial?.authorizationConfirmed ?? false,
    authorizationNote: testimonial?.authorizationNote ?? '',
    publicationStatus: testimonial?.publicationStatus ?? 'draft',
    photoId: testimonial?.photoId ?? null,
  });
  const [photo, setPhoto] = useState<MediaRef | null>(testimonial?.photo ?? null);

  const save = useMutation(
    () => {
      const body = {
        authorName: form.values.authorName,
        authorRole: form.values.authorRole,
        content: form.values.content,
        rating: form.values.rating === '' ? null : Number(form.values.rating),
        authorizationConfirmed: form.values.authorizationConfirmed,
        authorizationNote: form.values.authorizationNote,
        publicationStatus: form.values.publicationStatus,
        photoId: form.values.photoId,
        relatedProjectId: testimonial?.relatedProjectId ?? null,
      };
      return testimonial
        ? contentApi.updateTestimonial(tenantId, testimonial.id, body)
        : contentApi.createTestimonial(tenantId, body);
    },
    {
      onSuccess: () => {
        toast.success('Depoimento salvo');
        onSaved();
      },
      onError: (error) => {
        form.applyApiError(error);
        if (Object.keys(error.fieldErrors).length === 0) toast.error('Nao foi possivel salvar', error.message);
      },
    },
  );

  const { values, errors, setField } = form;

  return (
    <Modal
      open
      onClose={onClose}
      title={testimonial ? 'Editar depoimento' : 'Novo depoimento'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.loading} onClick={() => void save.run(undefined)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextInput
          label="Nome do autor"
          required
          value={values.authorName}
          error={errors.authorName}
          onChange={(event) => setField('authorName', event.target.value)}
        />
        <TextInput
          label="Cargo ou empreendimento"
          value={values.authorRole}
          placeholder="Proprietaria - Casa Vila Verde"
          onChange={(event) => setField('authorRole', event.target.value)}
        />
        <TextArea
          label="Depoimento"
          required
          rows={4}
          value={values.content}
          error={errors.content}
          onChange={(event) => setField('content', event.target.value)}
        />
        <Select
          label="Avaliacao"
          value={values.rating}
          placeholder="Sem avaliacao"
          options={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} estrela(s)` }))}
          hint="Opcional. Deixe vazio para nao exibir estrelas."
          onChange={(event) => setField('rating', event.target.value)}
        />
        <ImageField
          label="Foto do autor"
          tag="depoimentos"
          value={values.photoId}
          preview={photo}
          onChange={(mediaId, asset) => {
            setField('photoId', mediaId);
            setPhoto(
              asset ? { id: asset.id, url: asset.blobUrl, alt: asset.alt, width: asset.width, height: asset.height } : null,
            );
          }}
        />

        <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <Checkbox
            label="Confirmo que o autor autorizou a publicacao deste depoimento"
            hint="Exigido para publicar. A plataforma registra esta declaracao."
            checked={values.authorizationConfirmed}
            onChange={(checked) => setField('authorizationConfirmed', checked)}
          />
          {errors.authorizationConfirmed ? (
            <p className="text-xs font-medium text-rose-600">{errors.authorizationConfirmed}</p>
          ) : null}
          <TextInput
            label="Como a autorizacao foi obtida"
            value={values.authorizationNote}
            placeholder="Autorizacao por escrito em 12/03/2025"
            onChange={(event) => setField('authorizationNote', event.target.value)}
          />
        </div>

        <Select
          label="Situacao no site"
          value={values.publicationStatus}
          options={toOptions(labels.publication, PUBLICATION_STATUSES)}
          onChange={(event) => setField('publicationStatus', event.target.value as PublicationStatus)}
        />
      </div>
    </Modal>
  );
}

function TeamSection() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();
  const [editing, setEditing] = useState<TeamMemberRecord | 'new' | null>(null);
  const [removing, setRemoving] = useState<TeamMemberRecord | null>(null);

  const list = useResource(() => contentApi.team(tenantId), [tenantId]);
  const remove = useMutation((id: string) => contentApi.removeTeamMember(tenantId, id), {
    onSuccess: () => {
      toast.success('Integrante removido');
      setRemoving(null);
      list.reload();
    },
  });

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="Equipe exibida no site"
          description="Diferente de Equipe e usuarios, que trata de quem acessa o painel."
          actions={
            can('content:write') ? (
              <Button size="sm" icon={<Plus aria-hidden="true" className="size-3.5" />} onClick={() => setEditing('new')}>
                Novo integrante
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          <ResourcePanel resource={list}>
            {(data) =>
              data.members.length === 0 ? (
                <EmptyState
                  icon={<Users aria-hidden="true" className="size-8" />}
                  title="Nenhum integrante cadastrado"
                  description="Apresente a equipe tecnica responsavel pelas obras."
                />
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.members.map((member) => (
                    <li key={member.id} className="grid gap-2 rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start gap-3">
                        <div className="size-14 flex-none overflow-hidden rounded-full bg-slate-100">
                          {member.photo?.url ? (
                            <img src={member.photo.url} alt="" className="size-full object-cover" loading="lazy" />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{member.name}</p>
                          <p className="truncate text-xs text-slate-500">{member.role}</p>
                          <Badge tone={publicationTone(member.publicationStatus)}>
                            {labels.publication[member.publicationStatus]}
                          </Badge>
                        </div>
                      </div>
                      {can('content:write') ? (
                        <div className="flex gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => setEditing(member)}>
                            Editar
                          </Button>
                          {can('content:delete') ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Remover ${member.name}`}
                              onClick={() => setRemoving(member)}
                            >
                              <Trash2 aria-hidden="true" className="size-3.5 text-rose-600" />
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )
            }
          </ResourcePanel>
        </CardBody>
      </Card>

      {editing ? (
        <TeamMemberModal
          member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title="Remover integrante"
        message={<><strong>{removing?.name}</strong> deixara de aparecer no site.</>}
        confirmLabel="Remover"
        loading={remove.loading}
        onConfirm={() => removing && void remove.run(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function TeamMemberModal({
  member,
  onClose,
  onSaved,
}: {
  member: TeamMemberRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const form = useForm({
    name: member?.name ?? '',
    role: member?.role ?? '',
    bio: member?.bio ?? '',
    email: member?.email ?? '',
    publicationStatus: member?.publicationStatus ?? 'published',
    photoId: member?.photoId ?? null,
    social: (member?.social ?? {}) as Record<string, string>,
  });
  const [photo, setPhoto] = useState<MediaRef | null>(member?.photo ?? null);

  const save = useMutation(
    () => {
      const body = {
        name: form.values.name,
        role: form.values.role,
        bio: form.values.bio,
        email: form.values.email,
        publicationStatus: form.values.publicationStatus,
        photoId: form.values.photoId,
        social: Object.fromEntries(Object.entries(form.values.social).filter(([, url]) => url)),
      };
      return member
        ? contentApi.updateTeamMember(tenantId, member.id, body)
        : contentApi.createTeamMember(tenantId, body);
    },
    {
      onSuccess: () => {
        toast.success('Integrante salvo');
        onSaved();
      },
      onError: (error) => {
        form.applyApiError(error);
        if (Object.keys(error.fieldErrors).length === 0) toast.error('Nao foi possivel salvar', error.message);
      },
    },
  );

  const { values, errors, setField } = form;

  return (
    <Modal
      open
      onClose={onClose}
      title={member ? 'Editar integrante' : 'Novo integrante'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.loading} onClick={() => void save.run(undefined)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextInput
          label="Nome"
          required
          value={values.name}
          error={errors.name}
          onChange={(event) => setField('name', event.target.value)}
        />
        <TextInput
          label="Cargo e registro profissional"
          value={values.role}
          placeholder="Engenheira civil responsavel - CREA-SP 1234567"
          onChange={(event) => setField('role', event.target.value)}
        />
        <TextArea
          label="Mini biografia"
          rows={3}
          value={values.bio}
          onChange={(event) => setField('bio', event.target.value)}
        />
        <ImageField
          label="Foto"
          tag="equipe"
          value={values.photoId}
          preview={photo}
          onChange={(mediaId, asset) => {
            setField('photoId', mediaId);
            setPhoto(
              asset ? { id: asset.id, url: asset.blobUrl, alt: asset.alt, width: asset.width, height: asset.height } : null,
            );
          }}
        />
        <fieldset className="grid gap-3">
          <legend className="text-sm font-medium text-slate-700">Redes sociais</legend>
          {SOCIAL_NETWORKS.map((network) => (
            <TextInput
              key={network}
              label={SOCIAL_NETWORK_LABELS[network]}
              value={values.social[network] ?? ''}
              placeholder="https://"
              onChange={(event) =>
                setField('social', { ...values.social, [network]: event.target.value })
              }
            />
          ))}
        </fieldset>
        <Select
          label="Situacao no site"
          value={values.publicationStatus}
          options={toOptions(labels.publication, PUBLICATION_STATUSES)}
          onChange={(event) => setField('publicationStatus', event.target.value as PublicationStatus)}
        />
      </div>
    </Modal>
  );
}

function FaqSection() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();
  const [editing, setEditing] = useState<FaqRecord | 'new' | null>(null);
  const [removing, setRemoving] = useState<FaqRecord | null>(null);

  const list = useResource(() => contentApi.faqs(tenantId), [tenantId]);
  const remove = useMutation((id: string) => contentApi.removeFaq(tenantId, id), {
    onSuccess: () => {
      toast.success('Pergunta removida');
      setRemoving(null);
      list.reload();
    },
  });

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="Perguntas frequentes"
          description="Alimentam o bloco de perguntas e os dados estruturados do site."
          actions={
            can('content:write') ? (
              <Button size="sm" icon={<Plus aria-hidden="true" className="size-3.5" />} onClick={() => setEditing('new')}>
                Nova pergunta
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          <ResourcePanel resource={list}>
            {(data) =>
              data.faqs.length === 0 ? (
                <EmptyState
                  icon={<CircleHelp aria-hidden="true" className="size-8" />}
                  title="Nenhuma pergunta cadastrada"
                  description="Responda as duvidas que mais aparecem nos contatos."
                />
              ) : (
                <ul className="grid gap-2">
                  {data.faqs.map((faq) => (
                    <li key={faq.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 font-medium text-slate-900">{faq.question}</p>
                        <Badge tone={publicationTone(faq.publicationStatus)}>
                          {labels.publication[faq.publicationStatus]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{faq.answer}</p>
                      {can('content:write') ? (
                        <div className="mt-2 flex gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            icon={<Pencil aria-hidden="true" className="size-3.5" />}
                            onClick={() => setEditing(faq)}
                          >
                            Editar
                          </Button>
                          {can('content:delete') ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="Remover pergunta"
                              onClick={() => setRemoving(faq)}
                            >
                              <Trash2 aria-hidden="true" className="size-3.5 text-rose-600" />
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )
            }
          </ResourcePanel>
        </CardBody>
      </Card>

      {editing ? (
        <FaqModal
          faq={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title="Remover pergunta"
        message="A pergunta sera removida do site."
        confirmLabel="Remover"
        loading={remove.loading}
        onConfirm={() => removing && void remove.run(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function FaqModal({
  faq,
  onClose,
  onSaved,
}: {
  faq: FaqRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const form = useForm({
    question: faq?.question ?? '',
    answer: faq?.answer ?? '',
    category: faq?.category ?? '',
    publicationStatus: faq?.publicationStatus ?? 'published',
  });

  const save = useMutation(
    () => (faq ? contentApi.updateFaq(tenantId, faq.id, form.values) : contentApi.createFaq(tenantId, form.values)),
    {
      onSuccess: () => {
        toast.success('Pergunta salva');
        onSaved();
      },
      onError: (error) => {
        form.applyApiError(error);
        if (Object.keys(error.fieldErrors).length === 0) toast.error('Nao foi possivel salvar', error.message);
      },
    },
  );

  const { values, errors, setField } = form;

  return (
    <Modal
      open
      onClose={onClose}
      title={faq ? 'Editar pergunta' : 'Nova pergunta'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.loading} onClick={() => void save.run(undefined)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextInput
          label="Pergunta"
          required
          value={values.question}
          error={errors.question}
          onChange={(event) => setField('question', event.target.value)}
        />
        <TextArea
          label="Resposta"
          required
          rows={4}
          value={values.answer}
          error={errors.answer}
          onChange={(event) => setField('answer', event.target.value)}
        />
        <TextInput
          label="Categoria"
          value={values.category}
          hint="Opcional, para organizar internamente."
          onChange={(event) => setField('category', event.target.value)}
        />
        <Select
          label="Situacao no site"
          value={values.publicationStatus}
          options={toOptions(labels.publication, PUBLICATION_STATUSES)}
          onChange={(event) => setField('publicationStatus', event.target.value as PublicationStatus)}
        />
      </div>
    </Modal>
  );
}
