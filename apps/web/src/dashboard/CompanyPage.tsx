import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import {
  BRAZIL_STATES,
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_LABELS,
  formatWhatsAppNumber,
  isValidWhatsAppNumber,
  updateSiteSectionsSchema,
  whatsAppLink,
} from '@codeca/shared';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Select,
  Switch,
  Tabs,
  TextArea,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { authApi, tenantApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { useForm } from '../utils/forms.js';

/** Dados da empresa, contato, WhatsApp, secoes do site e conta do usuario. */
export function CompanyPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can, user, refresh } = useAuth();
  const readOnly = !can('tenant:update');
  const [tab, setTab] = useState('empresa');

  const tenant = useResource(() => tenantApi.detail(tenantId), [tenantId]);

  const profile = useForm({ legalName: '', displayName: '', taxId: '', description: '', foundedYear: '', creaNumber: '' });
  const contact = useForm({
    email: '',
    phone: '',
    whatsapp: '',
    whatsappDefaultMessage: '',
    street: '',
    number: '',
    complement: '',
    neighborhood: '',
    city: '',
    state: '',
    postalCode: '',
    showFullAddress: true,
    serviceArea: '',
    businessHours: '',
    social: {} as Record<string, string>,
  });

  useEffect(() => {
    const data = tenant.data;
    if (!data) return;
    profile.reset({
      legalName: data.tenant.legalName,
      displayName: data.tenant.displayName,
      taxId: data.tenant.taxId,
      description: data.tenant.description,
      foundedYear: data.tenant.foundedYear === null ? '' : String(data.tenant.foundedYear),
      creaNumber: data.tenant.creaNumber,
    });
    contact.reset({
      email: data.tenant.contactEmail,
      phone: data.tenant.contactPhone,
      whatsapp: data.tenant.whatsapp,
      whatsappDefaultMessage: data.tenant.whatsappDefaultMessage,
      street: data.tenant.address.street,
      number: data.tenant.address.number,
      complement: data.tenant.address.complement,
      neighborhood: data.tenant.address.neighborhood,
      city: data.tenant.address.city,
      state: data.tenant.address.state,
      postalCode: data.tenant.address.postalCode,
      showFullAddress: data.tenant.address.showFullAddress,
      serviceArea: data.tenant.serviceArea,
      businessHours: data.tenant.businessHours,
      social: (data.tenant.social ?? {}) as Record<string, string>,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.data]);

  const saveProfile = useMutation(
    () =>
      tenantApi.update(tenantId, {
        legalName: profile.values.legalName,
        displayName: profile.values.displayName,
        taxId: profile.values.taxId,
        description: profile.values.description,
        foundedYear: profile.values.foundedYear === '' ? null : Number(profile.values.foundedYear),
        creaNumber: profile.values.creaNumber,
      }),
    {
      onSuccess: () => {
        toast.success('Dados da empresa salvos');
        tenant.reload();
      },
      onError: (error) => {
        profile.applyApiError(error);
        if (Object.keys(error.fieldErrors).length === 0) toast.error('Nao foi possivel salvar', error.message);
      },
    },
  );

  const saveContact = useMutation(
    () =>
      tenantApi.updateContact(tenantId, {
        email: contact.values.email,
        phone: contact.values.phone,
        whatsapp: contact.values.whatsapp,
        whatsappDefaultMessage: contact.values.whatsappDefaultMessage,
        address: {
          street: contact.values.street,
          number: contact.values.number,
          complement: contact.values.complement,
          neighborhood: contact.values.neighborhood,
          city: contact.values.city,
          state: contact.values.state,
          postalCode: contact.values.postalCode,
          showFullAddress: contact.values.showFullAddress,
        },
        serviceArea: contact.values.serviceArea,
        businessHours: contact.values.businessHours,
        social: Object.fromEntries(Object.entries(contact.values.social).filter(([, url]) => url)),
      }),
    {
      onSuccess: () => {
        toast.success('Contato salvo');
        tenant.reload();
      },
      onError: (error) => {
        contact.applyApiError(error);
        if (Object.keys(error.fieldErrors).length === 0) toast.error('Nao foi possivel salvar', error.message);
      },
    },
  );

  const whatsappPreview = whatsAppLink(
    contact.values.whatsapp,
    { kind: 'generic' },
    profile.values.displayName || 'Construtora',
    contact.values.whatsappDefaultMessage || null,
  );

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Configuracoes da empresa"
        description="Dados cadastrais, contato, WhatsApp e quais secoes do site ficam ativas."
      />

      {readOnly ? <Alert tone="info" title="Somente leitura">Seu papel nao permite alterar estes dados.</Alert> : null}

      <Tabs
        items={[
          { id: 'empresa', label: 'Empresa' },
          { id: 'contato', label: 'Contato e WhatsApp' },
          { id: 'conta', label: 'Minha conta' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <ResourcePanel resource={tenant}>
        {(data) => (
          <>
            {tab === 'empresa' ? (
              <Card>
                <CardHeader
                  title="Dados cadastrais"
                  description={`Identificador interno: ${data.tenant.slug}`}
                  actions={
                    <Button
                      icon={<Save aria-hidden="true" className="size-4" />}
                      loading={saveProfile.loading}
                      disabled={readOnly}
                      onClick={() => void saveProfile.run(undefined)}
                    >
                      Salvar
                    </Button>
                  }
                />
                <CardBody className="grid gap-4 lg:max-w-2xl">
                  <TextInput
                    label="Nome de exibicao"
                    required
                    value={profile.values.displayName}
                    error={profile.errors.displayName}
                    disabled={readOnly}
                    hint="Aparece no site, no cabecalho e nos e-mails."
                    onChange={(event) => profile.setField('displayName', event.target.value)}
                  />
                  <TextInput
                    label="Razao social"
                    required
                    value={profile.values.legalName}
                    error={profile.errors.legalName}
                    disabled={readOnly}
                    onChange={(event) => profile.setField('legalName', event.target.value)}
                  />
                  <div className="grid gap-4 sm:grid-cols-3">
                    <TextInput
                      label="CNPJ"
                      value={profile.values.taxId}
                      error={profile.errors.taxId}
                      disabled={readOnly}
                      onChange={(event) => profile.setField('taxId', event.target.value)}
                    />
                    <TextInput
                      label="Ano de fundacao"
                      inputMode="numeric"
                      value={profile.values.foundedYear}
                      error={profile.errors.foundedYear}
                      disabled={readOnly}
                      onChange={(event) => profile.setField('foundedYear', event.target.value)}
                    />
                    <TextInput
                      label="Registro no CREA"
                      value={profile.values.creaNumber}
                      disabled={readOnly}
                      onChange={(event) => profile.setField('creaNumber', event.target.value)}
                    />
                  </div>
                  <TextArea
                    label="Descricao da empresa"
                    rows={5}
                    value={profile.values.description}
                    disabled={readOnly}
                    hint="Usada no bloco 'Sobre a empresa' quando ele nao tem texto proprio."
                    onChange={(event) => profile.setField('description', event.target.value)}
                  />
                </CardBody>
              </Card>
            ) : null}

            {tab === 'contato' ? (
              <Card>
                <CardHeader
                  title="Contato e endereco"
                  actions={
                    <Button
                      icon={<Save aria-hidden="true" className="size-4" />}
                      loading={saveContact.loading}
                      disabled={readOnly}
                      onClick={() => void saveContact.run(undefined)}
                    >
                      Salvar
                    </Button>
                  }
                />
                <CardBody className="grid gap-5 lg:max-w-2xl">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextInput
                      label="E-mail de contato"
                      type="email"
                      value={contact.values.email}
                      error={contact.errors.email}
                      disabled={readOnly}
                      hint="Aparece no site e recebe os avisos de novos interessados."
                      onChange={(event) => contact.setField('email', event.target.value)}
                    />
                    <TextInput
                      label="Telefone"
                      value={contact.values.phone}
                      error={contact.errors.phone}
                      disabled={readOnly}
                      onChange={(event) => contact.setField('phone', event.target.value)}
                    />
                  </div>

                  <div className="grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                    <TextInput
                      label="WhatsApp da construtora"
                      value={contact.values.whatsapp}
                      error={contact.errors.whatsapp}
                      disabled={readOnly}
                      placeholder="(19) 99999-0000"
                      hint="Numero proprio desta empresa. Os botoes do site abrem conversa com este numero."
                      onChange={(event) => contact.setField('whatsapp', event.target.value)}
                    />
                    <TextArea
                      label="Mensagem padrao"
                      rows={2}
                      value={contact.values.whatsappDefaultMessage}
                      disabled={readOnly}
                      hint="Opcional. Vazio, a plataforma monta a mensagem conforme o imovel, a obra ou o servico."
                      onChange={(event) => contact.setField('whatsappDefaultMessage', event.target.value)}
                    />
                    {contact.values.whatsapp ? (
                      isValidWhatsAppNumber(contact.values.whatsapp) ? (
                        <p className="text-xs text-emerald-800">
                          Numero reconhecido: {formatWhatsAppNumber(contact.values.whatsapp)}.{' '}
                          {whatsappPreview ? (
                            <a className="link" href={whatsappPreview} target="_blank" rel="noopener noreferrer">
                              Testar conversa
                            </a>
                          ) : null}
                        </p>
                      ) : (
                        <p className="text-xs font-medium text-rose-600">
                          Numero nao reconhecido. Informe com DDD, por exemplo (19) 99999-0000.
                        </p>
                      )
                    ) : null}
                  </div>

                  <div className="grid gap-4">
                    <Switch
                      label="Exibir endereco completo no site"
                      hint="Desligado, o site mostra apenas bairro e cidade."
                      checked={contact.values.showFullAddress}
                      disabled={readOnly}
                      onChange={(checked) => contact.setField('showFullAddress', checked)}
                    />
                    <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
                      <TextInput
                        label="Rua"
                        value={contact.values.street}
                        disabled={readOnly}
                        onChange={(event) => contact.setField('street', event.target.value)}
                      />
                      <TextInput
                        label="Numero"
                        value={contact.values.number}
                        disabled={readOnly}
                        onChange={(event) => contact.setField('number', event.target.value)}
                      />
                      <TextInput
                        label="Complemento"
                        value={contact.values.complement}
                        disabled={readOnly}
                        onChange={(event) => contact.setField('complement', event.target.value)}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-4">
                      <TextInput
                        label="Bairro"
                        value={contact.values.neighborhood}
                        disabled={readOnly}
                        onChange={(event) => contact.setField('neighborhood', event.target.value)}
                      />
                      <TextInput
                        label="Cidade"
                        value={contact.values.city}
                        disabled={readOnly}
                        onChange={(event) => contact.setField('city', event.target.value)}
                      />
                      <Select
                        label="UF"
                        value={contact.values.state}
                        placeholder="-"
                        disabled={readOnly}
                        options={BRAZIL_STATES.map((state) => ({ value: state, label: state }))}
                        onChange={(event) => contact.setField('state', event.target.value)}
                      />
                      <TextInput
                        label="CEP"
                        value={contact.values.postalCode}
                        disabled={readOnly}
                        onChange={(event) => contact.setField('postalCode', event.target.value)}
                      />
                    </div>
                    <TextInput
                      label="Regiao atendida"
                      value={contact.values.serviceArea}
                      disabled={readOnly}
                      placeholder="Campinas, Valinhos, Vinhedo e Paulinia"
                      onChange={(event) => contact.setField('serviceArea', event.target.value)}
                    />
                    <TextInput
                      label="Horario de atendimento"
                      value={contact.values.businessHours}
                      disabled={readOnly}
                      placeholder="Segunda a sexta, das 8h as 18h"
                      onChange={(event) => contact.setField('businessHours', event.target.value)}
                    />
                  </div>

                  <fieldset className="grid gap-3">
                    <legend className="text-sm font-medium text-slate-700">Redes sociais</legend>
                    {SOCIAL_NETWORKS.map((network) => (
                      <TextInput
                        key={network}
                        label={SOCIAL_NETWORK_LABELS[network]}
                        value={contact.values.social[network] ?? ''}
                        disabled={readOnly}
                        placeholder="https://"
                        onChange={(event) =>
                          contact.setField('social', { ...contact.values.social, [network]: event.target.value })
                        }
                      />
                    ))}
                  </fieldset>
                </CardBody>
              </Card>
            ) : null}

            {tab === 'conta' ? <AccountSection onSaved={() => void refresh()} email={user?.email ?? ''} /> : null}
          </>
        )}
      </ResourcePanel>
    </div>
  );
}

/** Dados do usuario autenticado e troca de senha. */
function AccountSection({ email, onSaved }: { email: string; onSaved: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const profile = useForm({ name: user?.name ?? '', phone: user?.phone ?? '' });
  const password = useForm({ currentPassword: '', newPassword: '' });
  const sessions = useResource(() => authApi.sessions(), []);

  const saveProfile = useMutation(() => authApi.updateProfile(profile.values), {
    onSuccess: () => {
      toast.success('Perfil atualizado');
      onSaved();
    },
    onError: (error) => profile.applyApiError(error),
  });

  const changePassword = useMutation(() => authApi.changePassword(password.values), {
    onSuccess: () => {
      toast.success('Senha alterada', 'As outras sessoes foram encerradas.');
      password.reset();
      sessions.reload();
    },
    onError: (error) => {
      password.applyApiError(error);
      if (Object.keys(error.fieldErrors).length === 0) toast.error('Nao foi possivel alterar', error.message);
    },
  });

  const revokeOthers = useMutation(() => authApi.revokeOtherSessions(), {
    onSuccess: () => {
      toast.success('Outras sessoes encerradas');
      sessions.reload();
    },
  });

  return (
    <div className="grid gap-6 lg:max-w-2xl">
      <Card>
        <CardHeader
          title="Meus dados"
          description={email}
          actions={
            <Button loading={saveProfile.loading} onClick={() => void saveProfile.run(undefined)}>
              Salvar
            </Button>
          }
        />
        <CardBody className="grid gap-4">
          <TextInput
            label="Nome"
            value={profile.values.name}
            error={profile.errors.name}
            onChange={(event) => profile.setField('name', event.target.value)}
          />
          <TextInput
            label="Telefone"
            value={profile.values.phone}
            error={profile.errors.phone}
            onChange={(event) => profile.setField('phone', event.target.value)}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Trocar senha" description="As outras sessoes sao encerradas ao trocar a senha." />
        <CardBody className="grid gap-4">
          <TextInput
            label="Senha atual"
            type="password"
            autoComplete="current-password"
            value={password.values.currentPassword}
            error={password.errors.currentPassword}
            onChange={(event) => password.setField('currentPassword', event.target.value)}
          />
          <TextInput
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            value={password.values.newPassword}
            error={password.errors.newPassword}
            hint="Ao menos 10 caracteres, com letras e numeros."
            onChange={(event) => password.setField('newPassword', event.target.value)}
          />
          <Button loading={changePassword.loading} onClick={() => void changePassword.run(undefined)}>
            Alterar senha
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Sessoes ativas"
          actions={
            <Button variant="outline" size="sm" loading={revokeOthers.loading} onClick={() => void revokeOthers.run(undefined)}>
              Encerrar outras sessoes
            </Button>
          }
        />
        <CardBody>
          <ResourcePanel resource={sessions}>
            {(data) => (
              <ul className="grid gap-2">
                {data.sessions.map((session) => (
                  <li key={session.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-800">
                      {session.current ? 'Esta sessao' : 'Outro dispositivo'}
                    </p>
                    <p className="truncate text-xs text-slate-500">{session.userAgent || 'Dispositivo nao identificado'}</p>
                  </li>
                ))}
              </ul>
            )}
          </ResourcePanel>
        </CardBody>
      </Card>
    </div>
  );
}
