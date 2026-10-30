import { handle } from 'hono/vercel';
import { createContext, createSiteApp, createSiteConfigErrorApp } from '@codeca/api';

/**
 * Funcao que renderiza os sites publicos das construtoras na Vercel.
 *
 * Com a configuracao incompleta, o visitante recebe uma pagina de manutencao
 * em vez da pagina de erro da plataforma. O detalhe do que falta vai para o log
 * do servidor: quem visita o site de um cliente nao precisa -- nem deve -- ver
 * nomes de variaveis de ambiente.
 */
const handler = (() => {
  try {
    return handle(createSiteApp({ context: createContext() }));
  } catch (error) {
    return handle(createSiteConfigErrorApp(error));
  }
})();

export default handler;
