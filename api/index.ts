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

export default handler;
