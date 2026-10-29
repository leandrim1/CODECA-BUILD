import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@codeca/ui';
import { AuthProvider } from './hooks/useAuth.js';
import { LoadingScreen, RequireAuth, RequirePlatformAdmin, RequireTenant } from './components/Guards.js';
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
const EditorPage = lazy(() =>
  import('./editor/EditorPage.js').then((module) => ({ default: module.EditorPage })),
);
const PagesPage = lazy(() => import('./dashboard/PagesPage.js').then((m) => ({ default: m.PagesPage })));
const CustomizationPage = lazy(() => import('./dashboard/CustomizationPage.js').then((m) => ({ default: m.CustomizationPage })));
const MediaPage = lazy(() => import('./dashboard/MediaPage.js').then((m) => ({ default: m.MediaPage })));
const PropertiesPage = lazy(() => import('./dashboard/PropertiesPage.js').then((m) => ({ default: m.PropertiesPage })));
const ProjectsPage = lazy(() => import('./dashboard/ProjectsPage.js').then((m) => ({ default: m.ProjectsPage })));
const ServicesPage = lazy(() => import('./dashboard/ServicesPage.js').then((m) => ({ default: m.ServicesPage })));
const GalleryPage = lazy(() => import('./dashboard/GalleryPage.js').then((m) => ({ default: m.GalleryPage })));
const LeadsPage = lazy(() => import('./dashboard/LeadsPage.js').then((m) => ({ default: m.LeadsPage })));
const DomainsPage = lazy(() => import('./dashboard/DomainsPage.js').then((m) => ({ default: m.DomainsPage })));
const SeoPage = lazy(() => import('./dashboard/SeoPage.js').then((m) => ({ default: m.SeoPage })));
const TeamPage = lazy(() => import('./dashboard/TeamPage.js').then((m) => ({ default: m.TeamPage })));
const PlanPage = lazy(() => import('./dashboard/PlanPage.js').then((m) => ({ default: m.PlanPage })));
const CompanyPage = lazy(() => import('./dashboard/CompanyPage.js').then((m) => ({ default: m.CompanyPage })));
const PlatformOverviewPage = lazy(() => import('./dashboard/platform/PlatformOverviewPage.js').then((m) => ({ default: m.PlatformOverviewPage })));
const PlatformTenantsPage = lazy(() => import('./dashboard/platform/PlatformTenantsPage.js').then((m) => ({ default: m.PlatformTenantsPage })));
const PlatformPlansPage = lazy(() => import('./dashboard/platform/PlatformPlansPage.js').then((m) => ({ default: m.PlatformPlansPage })));
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
                  <DashboardLayout />
                </RequireTenant>
              </RequireAuth>
            }
          >
            <Route index element={<OverviewPage />} />
            <Route path="paginas" element={<PagesPage />} />
            <Route path="personalizacao" element={<CustomizationPage />} />
            <Route path="midia" element={<MediaPage />} />
            <Route path="imoveis" element={<PropertiesPage />} />
            <Route path="obras" element={<ProjectsPage />} />
            <Route path="servicos" element={<ServicesPage />} />
            <Route path="galeria" element={<GalleryPage />} />
            <Route path="interessados" element={<LeadsPage />} />
            <Route path="dominio" element={<DomainsPage />} />
            <Route path="seo" element={<SeoPage />} />
            <Route path="equipe" element={<TeamPage />} />
            <Route path="plano" element={<PlanPage />} />
            <Route path="empresa" element={<CompanyPage />} />
          </Route>

          {/* Editor em tela cheia */}
          <Route
            path="/painel/editor"
            element={
              <RequireAuth>
                <RequireTenant>
                  <Suspense fallback={<LoadingScreen label="Abrindo o editor" />}>
                    <EditorPage />
                  </Suspense>
                </RequireTenant>
              </RequireAuth>
            }
          />

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
            <Route path="planos" element={<PlatformPlansPage />} />
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
