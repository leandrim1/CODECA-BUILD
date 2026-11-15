import { waitUntil } from '@vercel/functions';
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
    /*
     * `waitUntil` mantem a funcao viva ate a promessa terminar, depois de a
     * resposta sair. E o que permite ao webhook responder dentro do prazo da
     * ValidaPay e ainda concluir o processamento: sem isto, o trabalho em
     * segundo plano seria congelado junto com a funcao.
     */
    const context = createContext({ background: (task) => waitUntil(task) });

    // Promessa rejeitada que ninguem tratou: nao tem requisicao para onde
    // voltar, entao so aparece se for reportada aqui.
    process.on('unhandledRejection', (reason) => {
      void context.monitor.report({
        kind: 'unhandled_error',
        severity: 'critical',
        message: 'Promessa rejeitada sem tratamento na função da API.',
        error: reason,
      });
    });

    return handle(createApp({ context }));
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
