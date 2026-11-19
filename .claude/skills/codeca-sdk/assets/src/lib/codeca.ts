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

/**
 * Etiqueta de cache do conteudo da plataforma.
 *
 * Declarada antes do cliente porque e ele quem a aplica: cada busca do SDK
 * sai marcada com ela, e o aviso de publicacao a invalida.
 */
export const ETIQUETA_CONTEUDO = 'codeca:conteudo';

export const codeca = createServerClient({
  baseUrl: exigir('CODECA_BASE_URL'),
  secretKey: exigir('CODECA_SECRET_KEY'),
  /*
    O `fetch` do Next, com a etiqueta.

    Sem isto o `revalidateTag` do webhook nao tem efeito nenhum: ele invalida
    uma etiqueta que busca nenhuma carrega, e o cliente edita no painel sem
    ver mudanca -- o defeito exato que o webhook existe para evitar.

    `revalidate` de segmento NAO serve para isto: ele e tempo, nao etiqueta.
    Quem anexa etiqueta e a opcao `next` de cada `fetch`, e por isso ela entra
    aqui, uma vez, em vez de em cada chamada.

    O `as RequestInit` e necessario porque `next` e extensao do Next sobre o
    `RequestInit` padrao, e o tipo do `fetch` global nao a conhece.
  */
  fetch: (entrada, init) =>
    globalThis.fetch(entrada, {
      ...init,
      next: { tags: [ETIQUETA_CONTEUDO] },
    } as RequestInit),
});
