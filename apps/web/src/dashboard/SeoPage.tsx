import { useEffect, useState } from 'react';
import { Save, Search } from 'lucide-react';
import { updateSeoSchema, type PublicSeo } from '@codeca/shared';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Select,
  Switch,
  TextArea,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { pageApi, tenantApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';

/** Metadados de SEO, sitemap e robots do site. */
export function SeoPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();
  const readOnly = !can('seo:write');

  const tenant = useResource(() => tenantApi.detail(tenantId), [tenantId]);
  const redirects = useResource(() => pageApi.redirects(tenantId), [tenantId]);
  const [seo, setSeo] = useState<PublicSeo | null>(null);
  const [redirect, setRedirect] = useState({ fromPath: '', toPath: '' });

  useEffect(() => {
    if (tenant.data?.settings?.seo) setSeo(updateSeoSchema.parse(tenant.data.settings.seo));
  }, [tenant.data]);

  const save = useMutation((next: PublicSeo) => tenantApi.updateSeo(tenantId, next), {
    onSuccess: () => {
      toast.success('SEO atualizado');
      tenant.reload();
    },
    onError: (error) => toast.error('Nao foi possivel salvar', error.message),
  });

  const createRedirect = useMutation(
    (input: { fromPath: string; toPath: string }) =>
      pageApi.createRedirect(tenantId, { ...input, statusCode: 301, enabled: true }),
    {
      onSuccess: () => {
        toast.success('Redirecionamento criado');
        setRedirect({ fromPath: '', toPath: '' });
        redirects.reload();
      },
      onError: (error) => toast.error('Nao foi possivel criar', error.message),
    },
  );

  const removeRedirect = useMutation((id: string) => pageApi.removeRedirect(tenantId, id), {
    onSuccess: () => {
      toast.success('Redirecionamento removido');
      redirects.reload();
    },
  });

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="SEO"
        description="Titulo, descricao e indexacao do site. Cada imovel e cada obra tambem tem campos proprios no cadastro."
        actions={
          <Button
            icon={<Save aria-hidden="true" className="size-4" />}
            loading={save.loading}
            disabled={readOnly || !seo}
            onClick={() => seo && void save.run(seo)}
          >
            Salvar
          </Button>
        }
      />

      <ResourcePanel resource={tenant}>
        {() =>
          seo ? (
            <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
              <Card>
                <CardHeader title="Metadados do site" />
                <CardBody className="grid gap-4">
                  <TextInput
                    label="Titulo padrao"
                    value={seo.defaultTitle}
                    disabled={readOnly}
                    hint="Usado na pagina inicial e quando a pagina nao define um titulo proprio."
                    onChange={(event) => setSeo({ ...seo, defaultTitle: event.target.value })}
                  />
                  <TextInput
                    label="Modelo de titulo das paginas internas"
                    value={seo.titleTemplate}
                    disabled={readOnly}
                    hint="Use %s no lugar do titulo da pagina. Exemplo: %s | Construtora Horizonte"
                    onChange={(event) => setSeo({ ...seo, titleTemplate: event.target.value })}
                  />
                  <TextArea
                    label="Descricao padrao"
                    rows={3}
                    value={seo.defaultDescription}
                    disabled={readOnly}
                    hint="Entre 120 e 160 caracteres funciona bem nos resultados de busca."
                    onChange={(event) => setSeo({ ...seo, defaultDescription: event.target.value })}
                  />
                  <TextInput
                    label="Imagem de compartilhamento"
                    value={seo.shareImageUrl}
                    disabled={readOnly}
                    placeholder="https://"
                    hint="Exibida quando o site e compartilhado em redes sociais e aplicativos."
                    onChange={(event) => setSeo({ ...seo, shareImageUrl: event.target.value })}
                  />
                  <TextInput
                    label="URL canonica base"
                    value={seo.canonicalBaseUrl}
                    disabled={readOnly}
                    placeholder="https://www.suaconstrutora.com.br"
                    hint="Deixe vazio para usar o dominio da requisicao."
                    onChange={(event) => setSeo({ ...seo, canonicalBaseUrl: event.target.value })}
                  />
                  <TextInput
                    label="Verificacao do Google Search Console"
                    value={seo.googleSiteVerification}
                    disabled={readOnly}
                    hint="Cole apenas o conteudo da meta tag de verificacao."
                    onChange={(event) => setSeo({ ...seo, googleSiteVerification: event.target.value })}
                  />
                </CardBody>
              </Card>

              <div className="grid gap-6">
                <Card>
                  <CardHeader title="Indexacao" />
                  <CardBody className="grid gap-4">
                    <Select
                      label="Permitir indexacao pelos buscadores"
                      value={seo.robots}
                      disabled={readOnly}
                      options={[
                        { value: 'index', label: 'Sim, indexar o site' },
                        { value: 'noindex', label: 'Nao indexar (site em construcao)' },
                      ]}
                      onChange={(event) => setSeo({ ...seo, robots: event.target.value as 'index' | 'noindex' })}
                    />
                    {seo.robots === 'noindex' ? (
                      <Alert tone="warning">
                        Com esta opcao, o <code>robots.txt</code> bloqueia todos os buscadores e as paginas
                        recebem <code>noindex</code>. Lembre-se de reverter quando o site estiver pronto.
                      </Alert>
                    ) : null}
                    <Switch
                      label="Gerar sitemap.xml"
                      hint="Lista as paginas, os imoveis e as obras publicados."
                      checked={seo.sitemapEnabled}
                      disabled={readOnly}
                      onChange={(checked) => setSeo({ ...seo, sitemapEnabled: checked })}
                    />
                    <ul className="grid gap-1 text-xs text-slate-500">
                      <li>
                        <Search aria-hidden="true" className="mr-1 inline size-3" />
                        O sitemap fica em <code>/sitemap.xml</code> no dominio do site.
                      </li>
                      <li>As paginas de imoveis e obras sao montadas no servidor, com titulo e descricao proprios.</li>
                    </ul>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader
                    title="Redirecionamentos"
                    description="Use quando um endereco antigo precisar levar para um novo."
                  />
                  <CardBody className="grid gap-4">
                    {can('site:edit') ? (
                      <form
                        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void createRedirect.run(redirect);
                        }}
                      >
                        <TextInput
                          label="De"
                          placeholder="/pagina-antiga"
                          value={redirect.fromPath}
                          onChange={(event) => setRedirect({ ...redirect, fromPath: event.target.value })}
                        />
                        <TextInput
                          label="Para"
                          placeholder="/sobre"
                          value={redirect.toPath}
                          onChange={(event) => setRedirect({ ...redirect, toPath: event.target.value })}
                        />
                        <Button type="submit" loading={createRedirect.loading}>
                          Criar
                        </Button>
                      </form>
                    ) : null}

                    <ResourcePanel resource={redirects}>
                      {(data) =>
                        data.redirects.length === 0 ? (
                          <p className="text-sm text-slate-500">Nenhum redirecionamento configurado.</p>
                        ) : (
                          <ul className="grid gap-1.5">
                            {data.redirects.map((item) => (
                              <li
                                key={item.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-sm"
                              >
                                <span className="font-mono text-xs">
                                  {item.fromPath} &rarr; {item.toPath} ({item.statusCode})
                                </span>
                                {can('site:edit') ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void removeRedirect.run(item.id)}
                                  >
                                    Remover
                                  </Button>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )
                      }
                    </ResourcePanel>
                  </CardBody>
                </Card>
              </div>
            </div>
          ) : null
        }
      </ResourcePanel>
    </div>
  );
}
