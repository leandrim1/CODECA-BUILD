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

/**
 * O runtime Node da Vercel trata o **export default** como um handler
 * `(req, res) => void` e **descarta o valor devolvido**. Como `handle()` do
 * Hono devolve uma `Response`, nada era escrito na resposta: a requisicao
 * ficava aberta ate o runtime mata-la aos 60 s. Toda rota desta funcao
 * respondia 504, e o log trazia o aviso
 * "default export returned a `Response`".
 *
 * Exportar um handler por metodo HTTP ativa o modo Web-standard, em que a
 * `Response` devolvida e de fato enviada. E o formato que o proprio aviso do
 * runtime indica. Nao ha export default aqui de proposito: ele reativaria a
 * interpretacao `(req, res)`.
 */
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
