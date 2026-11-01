import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ToastProvider } from '@codeca/ui';
import { AuthProvider } from './hooks/useAuth.js';
import {
  LoadingScreen,
  RequireAuth,
  RequireCustomModule,
  RequireModule,
  RequirePlatformAdmin,
  RequireTenant,
} from './components/Guards.js';
import { SiteModulesProvider, useSiteModules } from './hooks/useSiteModules.js';
import { AuthLayout } from './layouts/AuthLayout.js';
import { DashboardLayout } from './layouts/DashboardLayout.js';
import { PlatformLayout } from './layouts/PlatformLayout.js';
import { LandingPage } from './pages/LandingPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { RegisterPage } from './pages/RegisterPage.js';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.js';
import { ResetPasswordPage } from './pages/ResetPasswordPage.js';
import { VerifyEmailPage } from './pages/VerifyEmailPage.js';
import { AcceptInvitePage } from './pages/AcceptInvitePage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { OverviewPage } from './dashboard/OverviewPage.js';

/**
 * Rotas da aplicacao.
 *
 * Somente a visao geral entra no carregamento inicial. As demais telas vem por
 * carregamento tardio, de modo que o editor, o renderizador de previa e o
 * painel mestre nao pesem no primeiro acesso ao painel.
 */
const DocumentModulePage = lazy(() => import('./dashboard/DocumentModulePage.js').then((m) => ({ default: m.DocumentModulePage })));
const CustomModulePage = lazy(() => import('./dashboard/CustomModulePage.js').then((m) => ({ default: m.CustomModulePage })));
const CustomDocumentPage = lazy(() => import('./dashboard/CustomModulePage.js').then((m) => ({ default: m.CustomDocumentPage })));
const BannersPage = lazy(() => import('./dashboard/BannersPage.js').then((m) => ({ default: m.BannersPage })));
const MediaPage = lazy(() => import('./dashboard/MediaPage.js').then((m) => ({ default: m.MediaPage })));
const PropertiesPage = lazy(() => import('./dashboard/PropertiesPage.js').then((m) => ({ default: m.PropertiesPage })));
const ProjectsPage = lazy(() => import('./dashboard/ProjectsPage.js').then((m) => ({ default: m.ProjectsPage })));
const ServicesPage = lazy(() => import('./dashboard/ServicesPage.js').then((m) => ({ default: m.ServicesPage })));
const ProductsPage = lazy(() => import('./dashboard/ProductsPage.js').then((m) => ({ default: m.ProductsPage })));
const CategoriesPage = lazy(() => import('./dashboard/CategoriesPage.js').then((m) => ({ default: m.CategoriesPage })));
const GalleriesPage = lazy(() => import('./dashboard/GalleriesPage.js').then((m) => ({ default: m.GalleriesPage })));
const TestimonialsPage = lazy(() => import('./dashboard/SiteContentPages.js').then((m) => ({ default: m.TestimonialsPage })));
const SiteTeamPage = lazy(() => import('./dashboard/SiteContentPages.js').then((m) => ({ default: m.SiteTeamPage })));
const FaqPage = lazy(() => import('./dashboard/SiteContentPages.js').then((m) => ({ default: m.FaqPage })));
const LeadsPage = lazy(() => import('./dashboard/LeadsPage.js').then((m) => ({ default: m.LeadsPage })));
const DomainsPage = lazy(() => import('./dashboard/DomainsPage.js').then((m) => ({ default: m.DomainsPage })));
const UsersPage = lazy(() => import('./dashboard/UsersPage.js').then((m) => ({ default: m.UsersPage })));
const BillingPage = lazy(() => import('./dashboard/BillingPage.js').then((m) => ({ default: m.BillingPage })));
const CompanyPage = lazy(() => import('./dashboard/CompanyPage.js').then((m) => ({ default: m.CompanyPage })));
const PlatformOverviewPage = lazy(() => import('./dashboard/platform/PlatformOverviewPage.js').then((m) => ({ default: m.PlatformOverviewPage })));
const PlatformTenantsPage = lazy(() => import('./dashboard/platform/PlatformTenantsPage.js').then((m) => ({ default: m.PlatformTenantsPage })));
const PlatformSitesPage = lazy(() => import('./dashboard/platform/PlatformSitesPage.js').then((m) => ({ default: m.PlatformSitesPage })));
const PlatformSegmentsPage = lazy(() => import('./dashboard/platform/PlatformSegmentsPage.js').then((m) => ({ default: m.PlatformSegmentsPage })));
const PlatformPlansPage = lazy(() => import('./dashboard/platform/PlatformPlansPage.js').then((m) => ({ default: m.PlatformPlansPage })));
const PlatformBillingPage = lazy(() => import('./dashboard/platform/PlatformBillingPage.js').then((m) => ({ default: m.PlatformBillingPage })));
const PlatformDomainsPage = lazy(() => import('./dashboard/platform/PlatformDomainsPage.js').then((m) => ({ default: m.PlatformDomainsPage })));
const PlatformSupportPage = lazy(() => import('./dashboard/platform/PlatformSupportPage.js').then((m) => ({ default: m.PlatformSupportPage })));
const PlatformAuditPage = lazy(() => import('./dashboard/platform/PlatformAuditPage.js').then((m) => ({ default: m.PlatformAuditPage })));

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          {/* Site institucional da plataforma */}
          <Route path="/" element={<LandingPage />} />

          {/* Acesso */}
          <Route element={<AuthLayout />}>
            <Route path="/entrar" element={<LoginPage />} />
            <Route path="/criar-conta" element={<RegisterPage />} />
            <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
            <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
            <Route path="/confirmar-email" element={<VerifyEmailPage />} />
            <Route path="/aceitar-convite" element={<AcceptInvitePage />} />
          </Route>

          {/* Painel da construtora */}
          <Route
            path="/painel"
            element={
              <RequireAuth>
                <RequireTenant>
                  {/* Os modulos do site chegam antes do menu: e o que decide
                      quais telas existem para esta empresa. */}
                  <SiteModulesProvider>
                    <DashboardLayout />
                  </SiteModulesProvider>
                </RequireTenant>
              </RequireAuth>
            }
          >
            <Route index element={<OverviewPage />} />
            <Route path="midia" element={<MediaPage />} />
            {/*
              Uma rota para todos os modulos criados para o site.
              `/painel/p/:moduleKey` -- o prefixo `p/` separa o que e deste
              projeto do que e da plataforma, pela mesma razao do `/custom/`
              na API publica: uma chave que entre no registro amanha nao pode
              mudar o significado de um endereco que ja existe.
            */}
            <Route path="p/:moduleKey" element={<RotaDeModuloProprio />} />
            <Route
              path="institucional"
              element={
                <RequireModule moduleKey="institucional">
                  <DocumentModulePage moduleKey="institucional" />
                </RequireModule>
              }
            />
            <Route
              path="contato"
              element={
                <RequireModule moduleKey="contato">
                  <DocumentModulePage moduleKey="contato" />
                </RequireModule>
              }
            />
            <Route
              path="banners"
              element={
                <RequireModule moduleKey="banners">
                  <BannersPage />
                </RequireModule>
              }
            />
            <Route
              path="imoveis"
              element={
                <RequireModule moduleKey="imoveis">
                  <PropertiesPage />
                </RequireModule>
              }
            />
            <Route
              path="obras"
              element={
                <RequireModule moduleKey="obras">
                  <ProjectsPage />
                </RequireModule>
              }
            />
            <Route
              path="servicos"
              element={
                <RequireModule moduleKey="servicos">
                  <ServicesPage />
                </RequireModule>
              }
            />
            <Route
              path="produtos"
              element={
                <RequireModule moduleKey="produtos">
                  <ProductsPage />
                </RequireModule>
              }
            />
            <Route
              path="categorias"
              element={
                <RequireModule moduleKey="categorias">
                  <CategoriesPage />
                </RequireModule>
              }
            />
            <Route
              path="galerias"
              element={
                <RequireModule moduleKey="galerias">
                  <GalleriesPage />
                </RequireModule>
              }
            />
            <Route
              path="depoimentos"
              element={
                <RequireModule moduleKey="depoimentos">
                  <TestimonialsPage />
                </RequireModule>
              }
            />
            <Route
              path="equipe"
              element={
                <RequireModule moduleKey="equipe">
                  <SiteTeamPage />
                </RequireModule>
              }
            />
            <Route
              path="perguntas"
              element={
                <RequireModule moduleKey="faq">
                  <FaqPage />
                </RequireModule>
              }
            />
            <Route path="interessados" element={<LeadsPage />} />
            <Route path="dominio" element={<DomainsPage />} />
            {/* Gestao de acessos ao painel, nao a equipe exibida no site. */}
            <Route path="usuarios" element={<UsersPage />} />
            <Route path="plano" element={<BillingPage />} />
            <Route path="empresa" element={<CompanyPage />} />
          </Route>

          {/* Painel mestre da plataforma */}
          <Route
            path="/plataforma"
            element={
              <RequireAuth>
                <RequirePlatformAdmin>
                  <PlatformLayout />
                </RequirePlatformAdmin>
              </RequireAuth>
            }
          >
            <Route index element={<PlatformOverviewPage />} />
            <Route path="empresas" element={<PlatformTenantsPage />} />
            <Route path="sites" element={<PlatformSitesPage />} />
            <Route path="segmentos" element={<PlatformSegmentsPage />} />
            <Route path="planos" element={<PlatformPlansPage />} />
            <Route path="cobranca" element={<PlatformBillingPage />} />
            <Route path="dominios" element={<PlatformDomainsPage />} />
            <Route path="suporte" element={<PlatformSupportPage />} />
            <Route path="auditoria" element={<PlatformAuditPage />} />
          </Route>

          <Route path="/dashboard" element={<Navigate to="/painel" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}

/**
 * Despacha a rota de um modulo criado para o site.
 *
 * O tipo do modulo -- lista ou documento -- e dado, entao a escolha da tela
 * acontece aqui, em tempo de execucao, e nao na tabela de rotas. Duas rotas
 * declaradas (`/p/lista/:key` e `/p/documento/:key`) poriam o tipo no endereco:
 * o dia em que ele mudasse, todo link salvo pelo cliente apontaria para a tela
 * errada.
 */
function RotaDeModuloProprio() {
  const { moduleKey } = useParams<{ moduleKey: string }>();
  const { customModule } = useSiteModules();
  const chave = moduleKey ?? '';
  const modulo = customModule(chave);

  return (
    <RequireCustomModule moduleKey={chave}>
      {modulo?.kind === 'document' ? (
        <CustomDocumentPage moduleKey={chave} />
      ) : (
        <CustomModulePage moduleKey={chave} />
      )}
    </RequireCustomModule>
  );
}
