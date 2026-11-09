import { useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Globe, Lock, RefreshCw, Star, Trash2 } from 'lucide-react';
import { DOMAIN_STATUS_LABELS, formatDateTime } from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { domainApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { domainTone } from '../utils/labels.js';
import type { DomainRecord } from '../types/index.js';

/**
 * Dominios proprios.
 *
 * Um dominio nunca aparece como ativo por estar cadastrado: o estado vem da
 * verificacao junto ao provedor, com propriedade comprovada e DNS apontado.
 */
export function DomainsPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can, user } = useAuth();
  const [hostname, setHostname] = useState('');
  const [removing, setRemoving] = useState<DomainRecord | null>(null);

  const list = useResource('domainApi.list', () => domainApi.list(tenantId), [tenantId]);

  const add = useMutation((value: string) => domainApi.add(tenantId, value), {
    onSuccess: (result) => {
      toast.success('Domínio cadastrado', result.message);
      setHostname('');
      list.reload();
    },
    onError: (error) => toast.error('Não foi possível cadastrar', error.message),
  });

  const verify = useMutation((domainId: string) => domainApi.verify(tenantId, domainId), {
    onSuccess: (result) => {
      if (result.domain?.status === 'active') toast.success('Domínio ativo', result.message);
      else toast.push({ tone: 'warning', title: 'Verificação pendente', description: result.message });
      list.reload();
    },
    onError: (error) => toast.error('Falha na verificação', error.message),
  });

  const setPrimary = useMutation((domainId: string) => domainApi.setPrimary(tenantId, domainId), {
    onSuccess: () => {
      toast.success('Domínio principal atualizado');
      list.reload();
    },
    onError: (error) => toast.error('Não foi possível definir', error.message),
  });

  const remove = useMutation((domainId: string) => domainApi.remove(tenantId, domainId), {
    onSuccess: () => {
      toast.success('Domínio desvinculado');
      setRemoving(null);
      list.reload();
    },
    onError: (error) => toast.error('Não foi possível desvincular', error.message),
  });

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copiado');
    } catch {
      toast.error('Não foi possível copiar', 'Selecione o texto e copie manualmente.');
    }
  }

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Domínio próprio"
        description="O endereço da empresa, por exemplo www.suaempresa.com.br, vinculado a este site."
      />

      <ResourcePanel resource={list}>
        {(data) => (
          <div className="grid gap-6">
            {!data.customDomainAvailable ? (
              <Alert tone="warning" title="Recurso não incluído no plano">
                O plano {data.limits.planName} não inclui domínio próprio. Atualize o plano para conectar o
                endereço da empresa.
              </Alert>
            ) : null}

            {/*
              Dois avisos, e so um aparece. Quando a plataforma nao hospeda o
              site, falar de credenciais da Vercel seria ruido: nada ali depende
              delas. Quando hospeda, a falta delas e o que impede a ativacao.
            */}
            {!data.hosting.managed && data.customDomainAvailable ? (
              <Alert tone="info" title="O site deste projeto não é hospedado pela plataforma">
                Os endereços ficam <strong>registrados</strong> nesta conta, mas a CODECA Build não
                verifica nem configura o DNS deles: o apontamento é feito no provedor onde o site está
                hospedado. Em caso de dúvida, fale com a CODECA IA.
              </Alert>
            ) : null}

            {data.hosting.managed && !data.providerConfigured ? (
              <Alert tone="warning" title="Verificação automática indisponível">
                A plataforma não está com as credenciais da Vercel configuradas (
                <code>VERCEL_API_TOKEN</code>). Os domínios ficam aguardando configuração externa e não
                são ativados automaticamente.
              </Alert>
            ) : null}

            {user && !user.emailVerified ? (
              <Alert tone="warning" title="Confirme seu e-mail">
                A conexão de domínio exige e-mail confirmado.
              </Alert>
            ) : null}

            {can('domains:manage') ? (
              <Card>
                <CardHeader
                  title="Adicionar domínio"
                  description={`Seu plano permite ${data.limits.maxDomains} dominio(s).`}
                />
                <CardBody>
                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void add.run(hostname);
                    }}
                  >
                    <div className="w-full min-w-0 flex-1 sm:min-w-64">
                      <TextInput
                        label="Domínio"
                        placeholder="www.suaempresa.com.br"
                        value={hostname}
                        error={add.error?.fieldErrors.domain}
                        hint="Informe com ou sem www. Endereços administrativos (app, painel, api) são reservados."
                        onChange={(event) => setHostname(event.target.value)}
                      />
                    </div>
                    <Button
                      type="submit"
                      loading={add.loading}
                      disabled={!data.customDomainAvailable || data.domains.length >= data.limits.maxDomains}
                    >
                      Adicionar
                    </Button>
                  </form>
                </CardBody>
              </Card>
            ) : null}

            {data.domains.length === 0 ? (
              <Card>
                <CardBody>
                  <EmptyState
                    icon={<Globe aria-hidden="true" className="size-8" />}
                    title="Nenhum domínio conectado"
                    description="Enquanto não houver domínio ativo, o site pode ser visto apenas pela prévia do painel."
                  />
                </CardBody>
              </Card>
            ) : (
              <div className="grid gap-4">
                {data.domains.map((domain) => (
                  <Card key={domain.id}>
                    <CardHeader
                      title={
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          {/* Mesmo motivo da visao geral: dominio longo nao
                              tem onde quebrar sozinho. */}
                          <span className="min-w-0 [overflow-wrap:anywhere]">{domain.hostname}</span>
                          {domain.isPrimary ? <Badge tone="brand">Principal</Badge> : null}
                          <Badge tone={domainTone(domain.status)}>
                            {domain.statusLabel ?? DOMAIN_STATUS_LABELS[domain.status]}
                          </Badge>
                          {/* "HTTPS pendente" num dominio so registrado diria que a
                              plataforma vai emitir um certificado. Nao vai. */}
                          {domain.status === 'registered' ? null : domain.sslStatus === 'active' ? (
                            <Badge tone="success">
                              <Lock aria-hidden="true" className="size-3" /> HTTPS
                            </Badge>
                          ) : (
                            <Badge tone="warning">HTTPS pendente</Badge>
                          )}
                        </span>
                      }
                      description={
                        domain.status === 'registered'
                          ? 'Registrado nesta conta'
                          : domain.lastCheckedAt
                            ? `Última verificação em ${formatDateTime(domain.lastCheckedAt)}`
                            : 'Ainda não verificado'
                      }
                      actions={
                        can('domains:manage') ? (
                          <div className="flex flex-wrap gap-1.5">
                            {/* Sem hospedagem da plataforma nao ha o que verificar: o
                                botao prometeria uma mudanca que nao vem. */}
                            {data.hosting.managed ? (
                              <Button
                                variant="outline"
                                size="sm"
                                loading={verify.loading}
                                icon={<RefreshCw aria-hidden="true" className="size-3.5" />}
                                onClick={() => void verify.run(domain.id)}
                              >
                                Verificar novamente
                              </Button>
                            ) : null}
                            {domain.status === 'active' && !domain.isPrimary ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                icon={<Star aria-hidden="true" className="size-3.5" />}
                                onClick={() => void setPrimary.run(domain.id)}
                              >
                                Tornar principal
                              </Button>
                            ) : null}
                            {domain.status === 'active' ? (
                              <a href={`https://${domain.hostname}`} target="_blank" rel="noopener noreferrer">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  icon={<ExternalLink aria-hidden="true" className="size-3.5" />}
                                >
                                  Abrir site
                                </Button>
                              </a>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Desvincular ${domain.hostname}`}
                              onClick={() => setRemoving(domain)}
                            >
                              <Trash2 aria-hidden="true" className="size-3.5 text-rose-600" />
                            </Button>
                          </div>
                        ) : undefined
                      }
                    />
                    {domain.lastError || domain.dns ? (
                      <CardBody className="grid gap-4">
                        {domain.lastError ? <Alert tone="danger">{domain.lastError}</Alert> : null}

                        {domain.dns ? (
                          <>
                            <div className="grid gap-2">
                              <h3 className="text-sm font-semibold text-slate-800">Registros de DNS</h3>
                              <p className="text-xs text-slate-500">
                                Configure estes registros no painel do seu provedor de domínio. A propagação pode
                                levar algumas horas; use "Verificar novamente" depois.
                              </p>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                                      <th scope="col" className="py-2 pr-3">Tipo</th>
                                      <th scope="col" className="py-2 pr-3">Nome</th>
                                      <th scope="col" className="py-2 pr-3">Valor</th>
                                      <th scope="col" className="py-2"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {domain.dns.records.map((record, index) => (
                                      <tr key={index} className="border-b border-slate-100 last:border-0">
                                        <td className="py-2 pr-3 font-mono text-xs">{record.type}</td>
                                        <td className="py-2 pr-3 font-mono text-xs">{record.name}</td>
                                        <td className="py-2 pr-3 break-all font-mono text-xs">{record.value}</td>
                                        <td className="py-2">
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={`Copiar valor do registro ${record.type}`}
                                            onClick={() => void copy(record.value)}
                                          >
                                            <Copy aria-hidden="true" className="size-3.5" />
                                          </Button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            <ul className="grid gap-1.5 text-xs">
                              <li className="flex items-center gap-1.5">
                                <CheckCircle2
                                  aria-hidden="true"
                                  className={domain.ownershipVerified ? 'size-3.5 text-emerald-600' : 'size-3.5 text-slate-300'}
                                />
                                Propriedade do domínio comprovada
                              </li>
                              <li className="flex items-center gap-1.5">
                                <CheckCircle2
                                  aria-hidden="true"
                                  className={domain.dnsConfigured ? 'size-3.5 text-emerald-600' : 'size-3.5 text-slate-300'}
                                />
                                DNS apontando para a plataforma
                              </li>
                              <li className="flex items-center gap-1.5">
                                <CheckCircle2
                                  aria-hidden="true"
                                  className={
                                    domain.sslStatus === 'active' ? 'size-3.5 text-emerald-600' : 'size-3.5 text-slate-300'
                                  }
                                />
                                Certificado HTTPS emitido
                              </li>
                            </ul>
                          </>
                        ) : null}
                      </CardBody>
                    ) : null}
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </ResourcePanel>

      <ConfirmDialog
        open={removing !== null}
        title="Desvincular domínio"
        message={
          <>
            O domínio <strong>{removing?.hostname}</strong> deixará de responder pelo site. Os registros de
            DNS no seu provedor continuam como estão e podem ser removidos por lá.
          </>
        }
        confirmLabel="Desvincular"
        loading={remove.loading}
        onConfirm={() => removing && void remove.run(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
