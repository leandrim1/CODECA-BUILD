import { aviso, lista, p, sub, tabela, type Documento } from './types.js';

/**
 * Politica de Cookies do CODECA Build -- do PAINEL, nao dos sites dos clientes.
 *
 * Cada linha da tabela foi conferida no codigo: os cinco cookies estao em
 * `apps/api/src/lib/cookies.ts`, `oauth-state.ts`, `analytics/oauth-state.ts` e
 * `login-code.ts`; as quatro chaves de `localStorage`, nos hooks do painel.
 * Nao ha cookie de terceiro, nao ha pixel e nao ha medicao de audiencia no
 * painel -- e por isso ele nao pede consentimento: exigir autorizacao para o
 * que nao se pode recusar e teatro, nao consentimento.
 *
 * O site de cada cliente tem politica PROPRIA, com o controlador dele e as
 * ferramentas que ele declarou no painel mestre. Esta pagina nao fala por eles.
 *
 * Rascunho tecnico: o conteudo deve ser revisado por assessoria juridica.
 */
export const COOKIES: Documento = {
  titulo: 'Política de cookies',
  resumo:
    'Quais cookies o painel do CODECA Build usa, para que servem e por que nenhum deles pede autorização.',
  secoes: [
    {
      id: 'resumo',
      titulo: '1. Em uma frase',
      blocos: [
        p(
          'O painel do CODECA Build usa cinco cookies, todos estritamente necessários para entrar e permanecer conectado com segurança. Não há cookie de publicidade, não há cookie de terceiro e não há medição de audiência no painel.',
        ),
        aviso(
          'Por isso o painel não exibe banner de cookies. A LGPD dispensa consentimento prévio para o que é indispensável ao funcionamento do serviço — e pedir autorização para algo que não se pode recusar seria enganoso.',
        ),
      ],
    },
    {
      id: 'o-que-sao',
      titulo: '2. O que são cookies',
      blocos: [
        p(
          'Cookies são pequenos arquivos que um site guarda no seu navegador e reenvia a cada visita. Servem para o site reconhecer que é você entre duas páginas — sem eles, você sairia da sessão a cada clique.',
        ),
        p(
          'Além de cookies, o painel guarda algumas preferências de interface no armazenamento local do seu navegador (localStorage). Esse conteúdo nunca é enviado aos nossos servidores: fica só no seu aparelho.',
        ),
      ],
    },
    {
      id: 'cookies-do-painel',
      titulo: '3. Os cookies do painel',
      blocos: [
        p('Todos são de primeira parte (do próprio endereço do painel) e estritamente necessários:'),
        tabela(
          ['Cookie', 'Para que serve', 'Duração', 'Legível por script'],
          [
            'codeca_session',
            'Mantém você conectado. Guarda um valor sorteado que não diz nada sobre você; os dados da sessão ficam no nosso banco.',
            '12 horas, ou 30 dias com "continuar conectado"',
            'Não (HttpOnly)',
          ],
          [
            'codeca_csrf',
            'Protege contra requisições forjadas por outro site: o painel reenvia este valor em um cabeçalho, e o servidor confere se os dois batem.',
            'A mesma da sessão',
            'Sim, por necessidade técnica',
          ],
          [
            'codeca_login_pending',
            'Liga o código enviado ao seu e-mail ao navegador que começou o acesso. Só existe entre pedir o código e digitá-lo.',
            '15 minutos',
            'Não (HttpOnly)',
          ],
          [
            'codeca_oauth_state',
            'Protege o login com Google: garante que o retorno do Google pertence ao navegador que iniciou o acesso.',
            '10 minutos',
            'Não (HttpOnly)',
          ],
          [
            'codeca_ga_state',
            'A mesma proteção, ao conectar uma conta do Google Analytics às estatísticas do seu site.',
            '10 minutos',
            'Não (HttpOnly)',
          ],
        ),
        sub('O que estes cookies não fazem'),
        lista(
          'Não guardam senha nem token de autenticação acessível por script.',
          'Não acompanham você em outros sites: são lidos apenas pelo endereço do painel.',
          'Não alimentam publicidade, perfilamento ou venda de dados.',
        ),
      ],
    },
    {
      id: 'preferencias',
      titulo: '4. Preferências guardadas no seu navegador',
      blocos: [
        p(
          'Estes valores ficam no localStorage do seu aparelho e nunca chegam aos nossos servidores. Apagá-los só faz o painel voltar ao estado padrão:',
        ),
        tabela(
          ['Chave', 'O que guarda'],
          ['codeca:tema', 'Se você escolheu o tema claro, escuro ou o do sistema.'],
          ['codeca:tenant-selecionado', 'Qual empresa o painel abre, quando você tem acesso a mais de uma.'],
          ['codeca:menu-grupos-fechados', 'Quais grupos do menu você deixou recolhidos.'],
          ['codeca:plataforma-menu-recolhido', 'Se a barra lateral da área restrita fica recolhida.'],
        ),
      ],
    },
    {
      id: 'estatisticas',
      titulo: '5. Google Analytics: do seu site, não do painel',
      blocos: [
        p(
          'A plataforma permite conectar uma conta do Google Analytics para você ver as estatísticas do seu site dentro do painel. Isso não coloca nenhum cookie de medição no painel: a leitura é feita pelos nossos servidores, com a autorização que você concedeu ao Google, e o painel apenas mostra os números.',
        ),
        p(
          'Os cookies de medição, quando existem, são do site do visitante — e lá dependem do consentimento dele, pedido pelo banner daquele site.',
        ),
      ],
    },
    {
      id: 'sites-dos-clientes',
      titulo: '6. Os sites criados pela plataforma têm política própria',
      blocos: [
        p(
          'Cada site publicado por uma empresa cliente é um site dela, com endereço próprio e responsabilidade própria. Quem responde pelos dados de quem visita aquele site é a empresa dona dele — a CODECA IA atua como operadora, disponibilizando a plataforma.',
        ),
        p('Nos sites construídos com o nosso SDK, o visitante encontra:'),
        lista(
          'Um aviso na primeira visita, com três opções de igual peso: aceitar tudo, recusar o que é opcional ou escolher por categoria.',
          'Quatro categorias: necessários (sempre ativos, porque sem eles o site não funciona), preferências, estatísticas e marketing. As três últimas começam desligadas.',
          'A possibilidade de mudar de ideia depois, no mesmo painel de preferências, com a mesma facilidade com que aceitou.',
        ),
        p(
          'Enquanto a escolha não é feita, o que é opcional não é carregado — não se trata de deixar de enviar dados, e sim de o script não entrar na página.',
        ),
        sub('O que a plataforma recebe dessas escolhas'),
        p(
          'Quando a empresa cliente mantém o registro ativado, recebemos, em nome dela, um registro anônimo de cada decisão: um número sorteado no navegador, a data e hora, o domínio do site, as categorias aceitas e recusadas e a versão da política. Não recebemos IP, identificação do navegador nem qualquer dado que ligue duas decisões à mesma pessoa. O registro serve a um único fim: a empresa poder demonstrar o consentimento que obteve.',
        ),
        p('Guardamos esse registro por até três anos, e depois ele é apagado automaticamente.'),
      ],
    },
    {
      id: 'controlar',
      titulo: '7. Como controlar os cookies',
      blocos: [
        p(
          'Todo navegador permite apagar cookies e bloquear novos. Se você bloquear os cookies do painel, não conseguirá entrar: sem o cookie de sessão não há como o servidor reconhecer que você já se autenticou.',
        ),
        p(
          'Para encerrar a sessão de imediato, use "Sair" no menu da sua conta: o cookie é removido e a sessão é invalidada também no servidor, de modo que o valor antigo deixa de valer mesmo que alguém o tenha copiado.',
        ),
      ],
    },
    {
      id: 'mudancas',
      titulo: '8. Mudanças nesta política',
      blocos: [
        p(
          'Se a plataforma passar a usar um cookie que não está listado aqui, esta página e a data da versão mudam junto. A lista acima descreve o que existe hoje, não o que pretendemos fazer.',
        ),
        { tipo: 'contato' },
      ],
    },
  ],
};
