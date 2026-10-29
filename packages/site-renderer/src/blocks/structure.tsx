import {
  SOCIAL_NETWORK_LABELS,
  formatPublicAddress,
  resolveColor,
  type PageSection,
  type PublicNavigationItem,
} from '@codeca/shared';
import { useSite, useWhatsApp } from '../context.js';
import { SOCIAL_ICONS, UI_ICONS } from '../icons.js';
import { Container, Prose, Section } from '../primitives.js';

/** Cabecalho, menu, rodape, espacador e divisor. */

interface BlockProps {
  section: PageSection;
}

function currentPath(path: string): string {
  return path.split('?')[0] ?? '/';
}

function NavList({ items, path }: { items: readonly PublicNavigationItem[]; path: string }) {
  return (
    <ul>
      {items.map((item, index) => {
        const isCurrent = currentPath(path) === item.href || (item.href === '/' && currentPath(path) === '/');
        return (
          <li key={index}>
            <a
              href={item.href}
              {...(isCurrent ? { 'aria-current': 'page' as const } : {})}
              {...(item.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {item.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function HeaderBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as {
    source: 'menu' | 'inline';
    menuKey: string;
    links: PublicNavigationItem[];
    logo: { url: string; alt: string } | null;
    showPhone: boolean;
    showWhatsApp: boolean;
    cta: { label: string; href: string; variant: string; newTab: boolean } | null;
    variant: 'inherit' | 'light' | 'dark' | 'transparent';
    sticky: boolean;
  };

  const whatsapp = useWhatsApp({ kind: 'generic' });
  const menu = site.menus.find((item) => item.key === props.menuKey) ?? site.menus[0];
  const items = props.source === 'inline' ? props.links : (menu?.items ?? []);
  const variant = props.variant === 'inherit' ? site.theme.header.style : props.variant;
  const logoUrl =
    props.logo?.url || (variant === 'dark' ? site.theme.logoDarkUrl : null) || site.theme.logoUrl;

  // O checkbox abre o menu no celular sem precisar de JavaScript.
  const toggleId = `${section.id}-menu`;

  return (
    <Section
      section={section}
      as="header"
      className="ct-header"
      data-variant={variant}
      data-layout={site.theme.header.layout}
      data-sticky={String(props.sticky && site.theme.header.sticky)}
    >
      <Container>
        <div className="ct-header-inner">
          <a className="ct-logo" href="/" aria-label={`${site.tenant.displayName} - pagina inicial`}>
            {logoUrl ? (
              <img src={logoUrl} alt={site.tenant.displayName} width={160} height={46} />
            ) : (
              <span>{site.tenant.displayName}</span>
            )}
          </a>

          <input className="ct-burger" type="checkbox" id={toggleId} aria-hidden="true" />
          <label className="ct-burger-label" htmlFor={toggleId}>
            <span className="ct-sr">Abrir menu de navegacao</span>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </label>

          {items.length > 0 ? (
            <nav className="ct-nav" aria-label="Navegacao principal">
              <NavList items={items} path={site.context.path} />
            </nav>
          ) : null}

          <div className="ct-header-contact">
            {props.showPhone && site.tenant.phone ? (
              <a className="ct-header-phone" href={`tel:${site.tenant.phone.replace(/\D+/g, '')}`}>
                <UI_ICONS.phone size={16} aria-hidden="true" />
                {site.tenant.phone}
              </a>
            ) : null}
            {props.showWhatsApp && whatsapp ? (
              <a className="ct-btn ct-btn-primary" href={whatsapp} target="_blank" rel="noopener noreferrer">
                WhatsApp
              </a>
            ) : null}
            {props.cta?.label ? (
              <a className="ct-btn ct-btn-outline" href={props.cta.href || '/contato'}>
                {props.cta.label}
              </a>
            ) : null}
          </div>
        </div>
      </Container>
    </Section>
  );
}

export function NavigationBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as { links: PublicNavigationItem[]; align: string; compact: boolean };
  if (props.links.length === 0) return null;

  return (
    <Section section={section} as="nav" aria-label="Navegacao secundaria">
      <Container>
        <div className="ct-nav" style={{ marginLeft: 0, justifyContent: props.align }}>
          <NavList items={props.links} path={site.context.path} />
        </div>
      </Container>
    </Section>
  );
}

export function FooterBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as {
    showLogo: boolean;
    about: string;
    columns: Array<{ title: string; links: PublicNavigationItem[] }>;
    showSocial: boolean;
    showAddress: boolean;
    showWhatsApp: boolean;
    legalText: string;
    showPlatformBadge: boolean;
  };

  const whatsapp = useWhatsApp({ kind: 'generic' });
  const social = Object.entries(site.tenant.social).filter(([, url]) => Boolean(url));
  const year = new Date().getFullYear();
  const address = formatPublicAddress(site.tenant.address);

  return (
    <Section section={section} as="footer" className="ct-footer" data-variant={site.theme.footer.style}>
      <Container>
        <div className="ct-footer-inner">
          <div>
            {props.showLogo ? (
              <a className="ct-logo" href="/">
                {site.theme.logoDarkUrl || site.theme.logoUrl ? (
                  <img
                    src={site.theme.logoDarkUrl ?? site.theme.logoUrl ?? ''}
                    alt={site.tenant.displayName}
                    width={150}
                    height={44}
                  />
                ) : (
                  <span>{site.tenant.displayName}</span>
                )}
              </a>
            ) : null}
            {props.about ? <Prose text={props.about} className="ct-footer-about" /> : null}
            {props.showSocial && site.theme.footer.showSocial && social.length > 0 ? (
              <div className="ct-social">
                {social.map(([network, url]) => {
                  const Glyph = SOCIAL_ICONS[network as keyof typeof SOCIAL_ICONS];
                  const label = SOCIAL_NETWORK_LABELS[network as keyof typeof SOCIAL_NETWORK_LABELS] ?? network;
                  return (
                    <a key={network} href={url} target="_blank" rel="noopener noreferrer" aria-label={label}>
                      {Glyph ? <Glyph size={18} aria-hidden="true" /> : label.slice(0, 2)}
                    </a>
                  );
                })}
              </div>
            ) : null}
          </div>

          {props.columns.map((column, index) => (
            <div key={index}>
              <h3>{column.title}</h3>
              <ul>
                {column.links.map((link, linkIndex) => (
                  <li key={linkIndex}>
                    <a href={link.href} {...(link.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3>Contato</h3>
            <ul>
              {site.tenant.phone ? (
                <li>
                  <a href={`tel:${site.tenant.phone.replace(/\D+/g, '')}`}>{site.tenant.phone}</a>
                </li>
              ) : null}
              {props.showWhatsApp && whatsapp ? (
                <li>
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                    WhatsApp
                  </a>
                </li>
              ) : null}
              {site.tenant.email ? (
                <li>
                  <a href={`mailto:${site.tenant.email}`}>{site.tenant.email}</a>
                </li>
              ) : null}
              {props.showAddress && address ? <li>{address}</li> : null}
              {site.tenant.businessHours ? <li>{site.tenant.businessHours}</li> : null}
              {site.tenant.serviceArea ? <li>Atendemos: {site.tenant.serviceArea}</li> : null}
            </ul>
          </div>
        </div>

        <div className="ct-footer-bottom">
          <span>
            &copy; {year} {site.tenant.legalName || site.tenant.displayName}
            {site.tenant.taxId ? ` - CNPJ ${site.tenant.taxId}` : ''}
            {site.tenant.creaNumber ? ` - ${site.tenant.creaNumber}` : ''}
          </span>
          <span style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {props.legalText ? <span>{props.legalText}</span> : null}
            {site.sections.privacyPolicyUrl ? (
              <a href={site.sections.privacyPolicyUrl}>Politica de privacidade</a>
            ) : site.sections.privacyPolicyText ? (
              <a href="/privacidade">Politica de privacidade</a>
            ) : null}
            {props.showPlatformBadge && site.showPlatformBadge ? (
              <span className="ct-platform-badge">
                Site criado com{' '}
                <a href={site.platformUrl} target="_blank" rel="noopener noreferrer">
                  {site.platformName}
                </a>
              </span>
            ) : null}
          </span>
        </div>
      </Container>
    </Section>
  );
}

export function SpacerBlock({ section }: BlockProps) {
  const props = section.props as { heightPx: number };
  return <div id={section.id} aria-hidden="true" style={{ height: `${props.heightPx}px` }} />;
}

export function DividerBlock({ section }: BlockProps) {
  const props = section.props as {
    thicknessPx: number;
    color: string | null;
    widthPercent: number;
    style: 'solid' | 'dashed' | 'dotted';
  };

  return (
    <Section section={section} as="div">
      <Container>
        <hr
          className="ct-divider"
          style={{
            borderTopWidth: `${props.thicknessPx}px`,
            borderTopStyle: props.style,
            borderTopColor: resolveColor(props.color, 'var(--ct-border)'),
            width: `${props.widthPercent}%`,
          }}
        />
      </Container>
    </Section>
  );
}
