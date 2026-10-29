import type { PageSection } from '@codeca/shared';
import { useSite } from '../context.js';
import { TeamCard, TestimonialCard } from '../cards.js';
import { Container, EmptyState, Section, SectionHeading } from '../primitives.js';

/** Equipe e depoimentos autorizados. */

interface BlockProps {
  section: PageSection;
}

export function TeamBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as {
    title: string;
    subtitle: string;
    limit: number;
    columns: number;
    showRole: boolean;
    showBio: boolean;
    showSocial: boolean;
    emptyMessage: string;
  };

  const items = site.team.slice(0, props.limit);

  return (
    <Section section={section}>
      <Container>
        <SectionHeading title={props.title} subtitle={props.subtitle} />
        {items.length === 0 ? (
          <EmptyState message={props.emptyMessage} />
        ) : (
          <div className="ct-grid">
            {items.map((member) => (
              <TeamCard
                key={member.id}
                member={member}
                showRole={props.showRole}
                showBio={props.showBio}
                showSocial={props.showSocial}
              />
            ))}
          </div>
        )}
      </Container>
    </Section>
  );
}

export function TestimonialsBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as {
    title: string;
    subtitle: string;
    limit: number;
    columns: number;
    showPhoto: boolean;
    showRole: boolean;
    layout: 'cards' | 'quotes';
    emptyMessage: string;
  };

  // A API ja entrega apenas depoimentos publicados com autorizacao declarada.
  const items = site.testimonials.slice(0, props.limit);

  return (
    <Section section={section}>
      <Container>
        <SectionHeading title={props.title} subtitle={props.subtitle} />
        {items.length === 0 ? (
          <EmptyState message={props.emptyMessage} />
        ) : (
          <div className="ct-grid">
            {items.map((testimonial) => (
              <TestimonialCard
                key={testimonial.id}
                testimonial={testimonial}
                showPhoto={props.showPhoto}
                showRole={props.showRole}
              />
            ))}
          </div>
        )}
      </Container>
    </Section>
  );
}
