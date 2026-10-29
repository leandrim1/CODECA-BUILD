import { handle } from 'hono/vercel';
import { createContext, createSiteApp } from '@codeca/api';

/**
 * Funcao que serve os sites publicos das construtoras.
 *
 * Recebe todo o trafego de hosts que nao pertencem a plataforma (ver as
 * reescritas em `vercel.json`), identifica a empresa pelo dominio verificado e
 * devolve o HTML montado no servidor.
 */
const context = createContext();

export default handle(createSiteApp({ context }));
