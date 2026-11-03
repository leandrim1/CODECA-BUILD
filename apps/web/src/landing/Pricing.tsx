import { Check } from 'lucide-react';
import { cx } from '@codeca/ui';
import { useResource } from '../hooks/useResource.js';
import { publicApi, type PublicPlan } from '../services/endpoints.js';
import { useDestino } from './Header.js';
import { apresentacao, beneficios, nomeDoPlano, preco } from './plans.js';
import { Reveal } from './Reveal.js';
import { Container, Eyebrow, LinkButton, SectionTitle } from './ui.js';

/** Plano que recebe o destaque: onde esta a autonomia que a pagina vende. */
const DESTAQUE = 'profissional';

/**
 * Planos e precos, lidos do backend.
 *
 * Nada aqui e escrito a mao: preco, limite e beneficio vem de
 * `/api/public/plans`, a mesma fonte da cobranca. Se a consulta falha, a
 * secao diz isso -- exibir valores de semente poderia anunciar um preco que
 * ja nao e cobrado.
 */
export function usePlanosPublicos() {
  return useResource('publicApi.plans', () => publicApi.plans(), [], { staleTime: 5 * 60_000 });
}

export function Pricing() {
  const planos = usePlanosPublicos();
  const destino = useDestino();

  return (
    <section id="planos" className="scroll-mt-20 border-t border-slate-200/70 bg-slate-50 py-20 sm:py-28" aria-labelledby="titulo-planos">
      <Container>
        <Reveal className="max-w-3xl">
          <Eyebrow>Planos e contratação</Eyebrow>
          <SectionTitle id="titulo-planos" className="mt-5">
            Uma solução adequada ao estágio da sua empresa.
          </SectionTitle>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
            Escolha a estrutura que acompanha suas necessidades e evolua conforme sua operação cresce.
          </p>
        </Reveal>

        <div className="mt-12 sm:mt-14">
          {planos.initialLoading ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="Carregando os planos">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[34rem] animate-pulse rounded-3xl bg-slate-200/70" />
              ))}
            </div>
          ) : planos.data === null || planos.data.plans.length === 0 ? (
            <div role="alert" className="rounded-3xl border border-slate-200 bg-white p-8 text-center">
              <p className="font-medium text-slate-900">Não foi possível carregar os planos agora.</p>
              <p className="mt-1.5 text-sm text-slate-600">
                Os valores exibidos aqui são sempre os vigentes, por isso não mostramos números sem a consulta.
              </p>
              <button
                type="button"
                onClick={planos.reload}
                className="mt-5 inline-flex h-11 items-center rounded-xl border border-slate-300 px-5 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <>
              <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:items-stretch">
                {planos.data.plans.map((plano, indice) => (
                  <Reveal as="li" key={plano.code} delay={indice * 80} className="flex">
                    <CartaoDePlano
                      plano={plano}
                      destaque={plano.code === DESTAQUE}
                      alvo={destino.planos}
                      logado={destino.logado}
                    />
                  </Reveal>
                ))}
              </ul>
              <p className="mt-8 max-w-3xl text-sm leading-relaxed text-slate-500">
                Valores mensais, em reais.
                {planos.data.plans.find((p) => p.trialDays) ? ' A avaliação é gratuita e não exige pagamento. ' : ' '}
                A contratação de um plano pago é feita no painel, em Plano e assinatura, depois de criar a conta.
                Os limites valem por empresa e são conferidos no servidor.
              </p>
            </>
          )}
        </div>
      </Container>
    </section>
  );
}

function CartaoDePlano({
  plano,
  destaque,
  alvo,
  logado,
}: {
  plano: PublicPlan;
  destaque: boolean;
  alvo: string;
  logado: boolean;
}) {
  const { valor, periodo } = preco(plano);
  const gratuito = plano.priceCents === 0;
  const rotulo = logado
    ? 'Ver no painel'
    : gratuito
      ? 'Começar avaliação'
      : `Contratar ${nomeDoPlano(plano)}`;

  return (
    <article
      className={cx(
        'relative flex w-full flex-col rounded-3xl border bg-white p-7 transition-shadow duration-300',
        destaque
          ? 'border-brand-300 shadow-raised ring-1 ring-brand-200 xl:-my-3 xl:py-10'
          : 'border-slate-200/80 shadow-card hover:shadow-raised',
      )}
    >
      {destaque ? (
        <span className="absolute -top-3 left-7 rounded-full bg-brand-600 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-wider text-white shadow-brand">
          Recomendado
        </span>
      ) : null}

      <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700">{nomeDoPlano(plano)}</h3>
      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="text-4xl font-semibold tracking-[-0.03em] text-slate-900">{valor}</span>
        {periodo ? <span className="text-sm text-slate-500">{periodo}</span> : null}
      </p>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-slate-600 xl:min-h-[8rem]">{apresentacao(plano)}</p>

      <ul className="mt-6 grid flex-1 content-start gap-3 border-t border-slate-200/80 pt-6 text-[0.95rem] text-slate-700">
        {beneficios(plano).map((item) => (
          <li key={item} className="flex gap-2.5">
            <Check aria-hidden="true" className="mt-0.5 size-4 flex-none text-brand-600" strokeWidth={2.5} />
            {item}
          </li>
        ))}
      </ul>

      <LinkButton to={alvo} variant={destaque ? 'solid' : 'outline'} className="mt-8 w-full">
        {rotulo}
      </LinkButton>
    </article>
  );
}
