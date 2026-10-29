import { handle } from 'hono/vercel';
import { createApp, createContext } from '@codeca/api';

/**
 * Funcao que atende `/api/*` no ambiente da Vercel.
 *
 * O contexto (banco, armazenamento, provedor de dominios e e-mail) e montado
 * uma vez por container e reaproveitado entre invocacoes.
 */
const context = createContext();

export default handle(createApp({ context }));
