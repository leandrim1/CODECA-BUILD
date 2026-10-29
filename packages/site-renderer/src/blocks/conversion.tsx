import { LEAD_INTEREST_LABELS, formatPublicAddress, type LeadInterestType, type PageSection } from '@codeca/shared';
import { useSite, useWhatsApp } from '../context.js';
import { UI_ICONS } from '../icons.js';
import { ButtonRow, Container, Section, SectionHeading } from '../primitives.js';

/** Botao de WhatsApp, formulario de contato e chamada para acao. */

interface BlockProps {
  section: PageSection;
}

type Button = { label: string; href: string; variant: 'primary' | 'secondary' | 'accent' | 'outline' | 'ghost'; newTab: boolean };

export function WhatsAppButtonBlock({ section }: BlockProps) {
  const props = section.props as {
    label: string;
    context: 'generic' | 'quote';
    customMessage: string;
    placement: 'inline' | 'floating';
    size: 'md' | 'lg';
    showIcon: boolean;
  };

  const href = useWhatsApp(
    props.context === 'quote' ? { kind: 'quote', subject: null } : { kind: 'generic' },
    props.customMessage || null,
  );

  // Sem numero cadastrado, o bloco simplesmente nao aparece.
  if (!href) return null;

  if (props.placement === 'floating') {
    return (
      <a className="ct-wa-float" href={href} target="_blank" rel="noopener noreferrer">
        {props.showIcon ? <UI_ICONS.whatsapp size={22} aria-hidden="true" /> : null}
        <span>{props.label}</span>
        <span className="ct-sr">{props.label}</span>
      </a>
    );
  }

  return (
    <Section section={section}>
      <Container>
        <a
          className={`ct-btn ct-btn-primary${props.size === 'lg' ? '' : ''}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={props.size === 'lg' ? { padding: '1rem 2rem', fontSize: '1.05rem' } : undefined}
        >
          {props.showIcon ? <UI_ICONS.whatsapp size={20} aria-hidden="true" /> : null}
          {props.label}
        </a>
      </Container>
    </Section>
  );
}

export function ContactFormBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as {
    title: string;
    subtitle: string;
    interestOptions: LeadInterestType[];
    requireEmail: boolean;
    showMessage: boolean;
    submitLabel: string;
    consentText: string;
    successMessage: string;
    showContactInfo: boolean;
    layout: 'stacked' | 'split';
  };

  const whatsapp = useWhatsApp({ kind: 'generic' });
  const address = formatPublicAddress(site.tenant.address);
  const relatedId =
    site.property?.id ?? site.project?.id ?? null;
  const relatedField = site.property ? 'propertyId' : site.project ? 'projectId' : null;

  const form = (
    <form
      className="ct-form"
      data-ct-lead-form
      data-success={props.successMessage}
      method="post"
      action="/api/public/leads"
      noValidate
    >
      <p className="ct-form-status" data-ct-status role="status" aria-live="polite" />

      <div className="ct-row">
        <div className="ct-field">
          <label htmlFor={`${section.id}-nome`}>
            Nome <span className="ct-req">*</span>
          </label>
          <input className="ct-input" id={`${section.id}-nome`} name="name" required minLength={2} maxLength={120} autoComplete="name" />
        </div>
        <div className="ct-field">
          <label htmlFor={`${section.id}-telefone`}>
            Telefone <span className="ct-req">*</span>
          </label>
          <input
            className="ct-input"
            id={`${section.id}-telefone`}
            name="phone"
            required
            inputMode="tel"
            maxLength={32}
            autoComplete="tel"
            placeholder="(00) 00000-0000"
          />
        </div>
      </div>

      <div className="ct-row">
        <div className="ct-field">
          <label htmlFor={`${section.id}-email`}>
            E-mail {props.requireEmail ? <span className="ct-req">*</span> : <span className="ct-card-text">(opcional)</span>}
          </label>
          <input
            className="ct-input"
            id={`${section.id}-email`}
            name="email"
            type="email"
            maxLength={254}
            autoComplete="email"
            {...(props.requireEmail ? { required: true } : {})}
          />
        </div>
        <div className="ct-field">
          <label htmlFor={`${section.id}-interesse`}>
            Assunto <span className="ct-req">*</span>
          </label>
          <select className="ct-select" id={`${section.id}-interesse`} name="interestType" required defaultValue={props.interestOptions[0] ?? 'outro'}>
            {props.interestOptions.map((option) => (
              <option key={option} value={option}>
                {LEAD_INTEREST_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {props.showMessage ? (
        <div className="ct-field">
          <label htmlFor={`${section.id}-mensagem`}>Mensagem</label>
          <textarea className="ct-textarea" id={`${section.id}-mensagem`} name="message" maxLength={4000} />
        </div>
      ) : null}

      <label className="ct-consent">
        <input type="checkbox" name="consent" required value="true" />
        <span>{props.consentText}</span>
      </label>

      {/* Campo oculto para identificar envio automatizado. */}
      <div className="ct-honeypot" aria-hidden="true">
        <label htmlFor={`${section.id}-site`}>Nao preencha</label>
        <input id={`${section.id}-site`} name="honeypot" tabIndex={-1} autoComplete="off" />
      </div>

      <input type="hidden" name="sourcePath" value={site.context.path} />
      {relatedField && relatedId ? <input type="hidden" name={relatedField} value={relatedId} /> : null}

      <div>
        <button className="ct-btn ct-btn-primary" type="submit">
          {props.submitLabel}
        </button>
      </div>

      <noscript>
        <p className="ct-card-text">
          Para enviar o formulario e necessario JavaScript. Fale com a gente pelo telefone
          {site.tenant.phone ? ` ${site.tenant.phone}` : ''}
          {site.tenant.email ? ` ou pelo e-mail ${site.tenant.email}` : ''}.
        </p>
      </noscript>
    </form>
  );

  const info = props.showContactInfo ? (
    <div className="ct-contact-info">
      {site.tenant.phone ? (
        <div className="ct-contact-line">
          <UI_ICONS.phone aria-hidden="true" />
          <span>
            <strong>Telefone</strong>
            <a href={`tel:${site.tenant.phone.replace(/\D+/g, '')}`}>{site.tenant.phone}</a>
          </span>
        </div>
      ) : null}
      {whatsapp ? (
        <div className="ct-contact-line">
          <UI_ICONS.whatsapp aria-hidden="true" />
          <span>
            <strong>WhatsApp</strong>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              Conversar agora
            </a>
          </span>
        </div>
      ) : null}
      {site.tenant.email ? (
        <div className="ct-contact-line">
          <UI_ICONS.mail aria-hidden="true" />
          <span>
            <strong>E-mail</strong>
            <a href={`mailto:${site.tenant.email}`}>{site.tenant.email}</a>
          </span>
        </div>
      ) : null}
      {address ? (
        <div className="ct-contact-line">
          <UI_ICONS.location aria-hidden="true" />
          <span>
            <strong>Endereco</strong>
            {address}
          </span>
        </div>
      ) : null}
      {site.tenant.businessHours ? (
        <div className="ct-contact-line">
          <UI_ICONS.clock aria-hidden="true" />
          <span>
            <strong>Atendimento</strong>
            {site.tenant.businessHours}
          </span>
        </div>
      ) : null}
      {site.tenant.serviceArea ? (
        <div className="ct-contact-line">
          <UI_ICONS.stage aria-hidden="true" />
          <span>
            <strong>Regiao atendida</strong>
            {site.tenant.serviceArea}
          </span>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <Section section={section}>
      <Container>
        <SectionHeading title={props.title} subtitle={props.subtitle} />
        {props.layout === 'split' && info ? (
          <div className="ct-split" style={{ ['--ct-split' as string]: '1.3fr 1fr', alignItems: 'start' }}>
            {form}
            {info}
          </div>
        ) : (
          <>
            {form}
            {info ? <div style={{ marginTop: '2rem' }}>{info}</div> : null}
          </>
        )}
      </Container>
    </Section>
  );
}

export function CtaBlock({ section }: BlockProps) {
  const props = section.props as {
    title: string;
    subtitle: string;
    buttons: Button[];
    layout: 'center' | 'split';
  };

  if (props.layout === 'split') {
    return (
      <Section section={section}>
        <Container>
          <div className="ct-split" style={{ ['--ct-split' as string]: '1.4fr 1fr' }}>
            <div>
              {props.title ? <h2>{props.title}</h2> : null}
              {props.subtitle ? <p className="ct-lead" style={{ color: 'inherit' }}>{props.subtitle}</p> : null}
            </div>
            <ButtonRow buttons={props.buttons} />
          </div>
        </Container>
      </Section>
    );
  }

  return (
    <Section section={section} className="ct-center">
      <Container narrow>
        {props.title ? <h2>{props.title}</h2> : null}
        {props.subtitle ? <p className="ct-lead" style={{ color: 'inherit', marginInline: 'auto' }}>{props.subtitle}</p> : null}
        <ButtonRow buttons={props.buttons} />
      </Container>
    </Section>
  );
}
