import { useSite } from '../context.js';
import { Container } from '../primitives.js';

/** Pagina nao encontrada, servida com status 404 pelo renderizador. */
export function NotFound() {
  const site = useSite();
  return (
    <section className="ct-section ct-center" style={{ paddingBlock: '5rem', textAlign: 'center' }}>
      <Container narrow>
        <span className="ct-eyebrow">Erro 404</span>
        <h1>Pagina nao encontrada</h1>
        <p className="ct-lead" style={{ marginInline: 'auto' }}>
          O endereco acessado nao existe ou foi movido. Veja os imoveis disponiveis ou fale com a equipe da{' '}
          {site.tenant.displayName}.
        </p>
        <div className="ct-actions" style={{ justifyContent: 'center' }}>
          <a className="ct-btn ct-btn-primary" href="/">
            Ir para a pagina inicial
          </a>
          <a className="ct-btn ct-btn-outline" href="/contato">
            Falar com a equipe
          </a>
        </div>
      </Container>
    </section>
  );
}
