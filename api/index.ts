import { handle } from 'hono/vercel';
import { createApp, createConfigErrorApp, createContext } from '@codeca/api';

/**
 * Funcao que atende `/api/*` no ambiente da Vercel.
 *
 * O contexto (banco, armazenamento, dominios, e-mail e pagamentos) e montado
 * uma vez por container e reaproveitado entre invocacoes.
 *
 * Se a configuracao estiver incompleta, montar o contexto falha. Em vez de
 * deixar a funcao morrer na carga do modulo -- o que devolve a pagina de erro
 * da Vercel, sem corpo JSON, e esconde a causa --, a API de contingencia assume
 * e responde dizendo quais variaveis faltam.
 */
const handler = (() => {
  try {
    return handle(createApp({ context: createContext() }));
  } catch (error) {
    return handle(createConfigErrorApp(error));
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
