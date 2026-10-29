import {
  PROJECT_CATEGORY_LABELS,
  PROJECT_STAGE_LABELS,
  PROJECT_STATUS_LABELS,
  formatIsoDate,
  type PublicProject,
} from '@codeca/shared';
import { useSite, useWhatsApp } from '../context.js';
import { Container, Picture, ProgressBar, Prose } from '../primitives.js';
import { UI_ICONS } from '../icons.js';

/** Pagina de detalhe da obra, com a evolucao publicada pela construtora. */
export function ProjectDetail({ project }: { project: PublicProject }) {
  const site = useSite();
  const whatsapp = useWhatsApp({
    kind: 'project',
    title: project.title,
    stage: PROJECT_STAGE_LABELS[project.stage],
  });

  return (
    <article className="ct-section" style={{ paddingBlock: '2.5rem 4rem' }}>
      <Container>
        <nav className="ct-breadcrumb" aria-label="Trilha de navegacao">
          <a href="/">Inicio</a>
          <span aria-hidden="true">/</span>
          <a href="/obras">Obras</a>
          <span aria-hidden="true">/</span>
          <span>{project.title}</span>
        </nav>

        <header className="ct-detail-head">
          <div className="ct-chips">
            <span className="ct-chip">{PROJECT_CATEGORY_LABELS[project.category]}</span>
            <span className="ct-badge">{PROJECT_STATUS_LABELS[project.status]}</span>
            <span className="ct-chip">Etapa: {PROJECT_STAGE_LABELS[project.stage]}</span>
          </div>
          <h1>{project.title}</h1>
          {project.locationLabel ? <p className="ct-lead">{project.locationLabel}</p> : null}
          {/* Barra de progresso somente quando a construtora informou o numero. */}
          <ProgressBar percent={project.progressPercent} label="Evolucao da obra" />
        </header>

        <div className="ct-detail-grid">
          <div>
            <Picture
              image={project.coverImage}
              aspect="16/9"
              alt={project.coverImage?.alt || project.title}
              loading="eager"
            />

            {project.gallery.length > 0 ? (
              <div className="ct-gallery" style={{ ['--ct-cols' as string]: '3', marginTop: '1rem' }}>
                {project.gallery.map((image, index) => (
                  <Picture key={index} image={image} aspect="4/3" />
                ))}
              </div>
            ) : null}

            <section style={{ marginTop: '2.5rem' }}>
              <h2>Sobre a obra</h2>
              <Prose text={project.description || project.shortDescription} />
            </section>

            {project.updates.length > 0 ? (
              <section style={{ marginTop: '2.5rem' }}>
                <h2>Evolucao da obra</h2>
                <ol className="ct-timeline">
                  {project.updates.map((update) => (
                    <li key={update.id}>
                      {update.recordedAt ? (
                        <span className="ct-timeline-date">{formatIsoDate(update.recordedAt, 'long')}</span>
                      ) : null}
                      <h3 className="ct-card-title">{update.title}</h3>
                      {update.stage ? (
                        <span className="ct-chip" style={{ alignSelf: 'start' }}>
                          {PROJECT_STAGE_LABELS[update.stage]}
                        </span>
                      ) : null}
                      {update.note ? <Prose text={update.note} /> : null}
                      <ProgressBar percent={update.progressPercent} label="No registro" />
                      {update.images.length > 0 ? (
                        <div className="ct-gallery" style={{ ['--ct-cols' as string]: '3', marginTop: '.5rem' }}>
                          {update.images.map((image, index) => (
                            <Picture key={index} image={image} aspect="4/3" />
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </div>

          <aside className="ct-aside">
            <ul className="ct-facts" style={{ flexDirection: 'column', gap: '.6rem' }}>
              {project.startDate ? (
                <li>
                  <UI_ICONS.calendar aria-hidden="true" /> Inicio: {formatIsoDate(project.startDate, 'month')}
                </li>
              ) : null}
              {project.expectedCompletionDate ? (
                <li>
                  <UI_ICONS.clock aria-hidden="true" /> Previsao: {formatIsoDate(project.expectedCompletionDate, 'month')}
                </li>
              ) : null}
              {project.completedDate ? (
                <li>
                  <UI_ICONS.stage aria-hidden="true" /> Entregue em {formatIsoDate(project.completedDate, 'month')}
                </li>
              ) : null}
            </ul>

            <div className="ct-actions" style={{ marginTop: 0, flexDirection: 'column' }}>
              {whatsapp ? (
                <a className="ct-btn ct-btn-primary" href={whatsapp} target="_blank" rel="noopener noreferrer">
                  Tirar duvidas no WhatsApp
                </a>
              ) : null}
              <a className="ct-btn ct-btn-outline" href="/contato">
                Falar com a {site.tenant.displayName}
              </a>
            </div>
          </aside>
        </div>
      </Container>
    </article>
  );
}
