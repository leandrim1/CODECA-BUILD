import { createServerClient } from '@codeca/sdk/server';

/**
 * O cliente do CODECA Build, montado uma vez.
 *
 * Este arquivo **nao** e para componente de cliente: ele usa a chave secreta,
 * que le tambem rascunho. Se for preciso chamar a plataforma do navegador --
 * um formulario, um filtro sem recarregar --, use `clienteDoNavegador()` do
 * arquivo `codeca-navegador.ts`, que carrega a chave publicavel.
 *
 * As variaveis sao conferidas aqui, na partida, e nao no primeiro acesso: um
 * site que sobe sem credencial deve falhar no build, e nao devolver uma
 * pagina vazia ao primeiro visitante.
 */
function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(
      `Falta a variavel ${nome}. Copie o .env.example para .env.local e preencha com as credenciais do painel mestre.`,
    );
  }
  return valor;
}

export const codeca = createServerClient({
  baseUrl: exigir('CODECA_BASE_URL'),
  secretKey: exigir('CODECA_SECRET_KEY'),
});

/**
 * Etiqueta de cache do conteudo da plataforma.
 *
 * Toda busca entra nesta etiqueta, e o aviso de publicacao a invalida. Sem
 * isso o site so atualizaria no proximo build -- e o cliente editaria no
 * painel sem ver mudanca nenhuma, que e a reclamacao mais cara de atender.
 */
export const ETIQUETA_CONTEUDO = 'codeca:conteudo';
