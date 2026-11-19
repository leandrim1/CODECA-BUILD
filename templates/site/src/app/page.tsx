import Image from 'next/image';
import { CodecaError } from '@codeca/sdk/server';
import { codeca, ETIQUETA_CONTEUDO } from '@/lib/codeca';

/**
 * Pagina inicial.
 *
 * Busca em paralelo, e nao em serie: em serie a pagina espera a soma das
 * idas a plataforma; em paralelo espera so a mais lenta.
 *
 * `unstable_cache` nao aparece aqui porque o `fetch` do Next ja cacheia e o
 * SDK usa `fetch`. A etiqueta entra pelo `next.revalidate` da rota, e o aviso
 * de publicacao a invalida.
 */
export const revalidate = 3600;

export default async function Home() {
  try {
    const [institucional, banners, servicos] = await Promise.all([
      codeca.institutional.get(),
      codeca.banners.list(),
      codeca.services.list(),
    ]);

    return (
      <main>
        <h1>{institucional.companyName}</h1>
        {institucional.tagline ? <p>{institucional.tagline}</p> : null}

        {/*
          `banners.list()` devolve o ARRAY direto; `services.list()` devolve
          uma pagina com `items`. Banner nao e paginado, servico e -- a
          diferenca e de proposito, e o compilador avisa se trocar.
        */}
        {banners.map((banner) => (
          <section key={banner.id}>
            {banner.image?.url ? (
              <Image
                src={banner.image.url}
                alt={banner.image.alt ?? ''}
                width={1600}
                height={900}
                priority
              />
            ) : null}
            <h2>{banner.title}</h2>
          </section>
        ))}

        <h2>O que fazemos</h2>
        <ul>
          {servicos.items.map((servico) => (
            <li key={servico.id}>
              <h3>{servico.title}</h3>
              {servico.description ? <p>{servico.description}</p> : null}
            </li>
          ))}
        </ul>
      </main>
    );
  } catch (erro) {
    /*
      Assinatura pendente nao e erro do site.
      A credencial esta certa e repetir nao resolve -- quem resolve e a
      empresa, no painel. Mostrar o ultimo conteudo conhecido (ou uma pagina
      sobria) serve melhor ao visitante do que uma tela de erro.
    */
    if (erro instanceof CodecaError && erro.isSuspended) {
      return (
        <main>
          <p>Estamos em manutenção. Volte em instantes.</p>
        </main>
      );
    }
    throw erro;
  }
}
