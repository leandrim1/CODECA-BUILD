import {
  ARMAZENAMENTO_DO_PAINEL,
  COOKIES_DO_PAINEL,
  FERRAMENTAS_OPCIONAIS,
  NOME_DA_CATEGORIA,
  TEXTO_DA_CATEGORIA,
  VERSAO_DA_POLITICA,
  haOpcionais,
} from '../consentimento/inventario.js';
import { aviso, lista, p, sub, tabela, type Bloco, type Documento } from './types.js';

/**
 * Politica de Cookies do CODECA Build -- do PAINEL, nao dos sites dos clientes.
 *
 * As duas tabelas NAO sao escritas aqui: elas sao geradas a partir de
 * `consentimento/inventario.ts`, o mesmo arquivo que alimenta o modal de
 * preferencias e decide se o banner aparece. Era a unica forma de garantir o
 * que esta pagina promete -- que a lista descreve o que existe hoje. Duas
 * listas mantidas a mao divergem, e uma politica de cookies que diverge do
 * software e pior do que nenhuma.
 *
 * O site de cada cliente tem politica PROPRIA, com o controlador dele e as
 * ferramentas que ele declarou no painel mestre. Esta pagina nao fala por eles.
 *
 * Rascunho tecnico: o conteudo deve ser revisado por assessoria juridica.
 */

/** Os cookies do inventario, na forma de tabela. */
const tabelaDeCookies = (): Bloco =>
  tabela(
    ['Cookie', 'Para que serve', 'Duração', 'Legível por script'],
    ...COOKIES_DO_PAINEL.map((cookie) => [
      cookie.nome,
      cookie.finalidade,
      cookie.duracao,
      cookie.httpOnly ? 'Não (HttpOnly)' : 'Sim, por necessidade técnica',
    ]),
  );

const tabelaDeArmazenamento = (): Bloco =>
  tabela(
    ['Chave', 'O que guarda'],
    ...ARMAZENAMENTO_DO_PAINEL.map((item) => [item.chave, item.guarda]),
  );

/**
 * A secao das categorias opcionais.
 *
 * Enquanto nenhuma ferramenta opcional existe, ela diz exatamente isso -- e
 * nao finge uma tabela vazia. Quando a primeira for declarada no inventario,
 * ela aparece aqui e no modal ao mesmo tempo.
 */
const blocosDasOpcionais = (): Bloco[] =>
  haOpcionais()
    ? [
        p('O painel carrega as ferramentas abaixo apenas se você autorizar a categoria delas:'),
        tabela(
          ['Ferramenta', 'Categoria', 'Para que serve', 'Cookies'],
          ...FERRAMENTAS_OPCIONAIS.map((ferramenta) => [
            ferramenta.fornecedor ? `${ferramenta.nome} (${ferramenta.fornecedor})` : ferramenta.nome,
            NOME_DA_CATEGORIA[ferramenta.categoria],
            ferramenta.finalidade,
            ferramenta.cookies.join(', ') || '—',
          ]),
        ),
      ]
    : [
        p(
          'Hoje não há nenhuma: dentro do painel não existe medição de audiência, pixel de anúncio nem cookie de terceiro. Por isso o aviso de cookies não aparece — ele volta sozinho no dia em que a primeira ferramenta opcional for declarada, e nada carrega antes da sua resposta.',
        ),
        aviso(
          'Pedir autorização para o que ninguém pode recusar treina a pessoa a clicar em "aceitar" sem ler, e gasta a única pergunta que vale a pena fazer. Por isso o aviso só aparece quando existe mesmo uma escolha.',
        ),
      ];

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
          'O painel do CODECA Build usa cinco cookies, todos estritamente necessários para entrar e permanecer conectado com segurança. Hoje não há cookie de publicidade, cookie de terceiro nem medição de audiência dentro do painel.',
        ),
        p(
          'O painel tem um controle de privacidade por categoria, que você reabre quando quiser em "Preferências de cookies" — no menu da sua conta e no rodapé do site. Nele você vê o que está ativo e decide sobre o que é opcional.',
        ),
        aviso(
          'Enquanto o painel não carregar nada opcional, o aviso de cookies não aparece: a LGPD dispensa consentimento prévio para o que é indispensável ao funcionamento, e pedir autorização para algo que não se pode recusar seria enganoso. O aviso surge sozinho no dia em que houver uma escolha real a fazer.',
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
        tabelaDeCookies(),
        sub('O que estes cookies não fazem'),
        lista(
          'Não guardam senha nem token de autenticação acessível por script.',
          'Não acompanham você em outros sites: são lidos apenas pelo endereço do painel.',
          'Não alimentam publicidade, perfilamento ou venda de dados.',
        ),
        sub('O desafio anti-robô das telas de acesso'),
        p(
          'As telas de criar conta e de recuperar a senha carregam o Cloudflare Turnstile, um desafio que distingue uma pessoa de um robô. Ele é da Cloudflare, roda só nessas duas telas — não dentro do painel — e pode deixar um cookie próprio no seu navegador enquanto verifica o acesso.',
        ),
        p(
          'Ele também é estritamente necessário, e por isso não aparece como escolha: sem o desafio, essas telas não têm como se defender de cadastros automatizados e de tentativas de descobrir senha em massa. Ele não mede audiência, não acompanha você em outros sites e não alimenta publicidade.',
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
        tabelaDeArmazenamento(),
      ],
    },
    {
      id: 'categorias',
      titulo: '5. As categorias e o seu controle',
      blocos: [
        p(
          'O painel separa o que guarda no seu navegador em três categorias. As duas últimas só entram em funcionamento se você autorizar, e a autorização é pedida antes de qualquer script opcional ser colocado na página — não depois.',
        ),
        tabela(
          ['Categoria', 'O que é', 'Pode recusar?'],
          ['Necessários', TEXTO_DA_CATEGORIA.necessarios, 'Não'],
          ['Estatísticos', TEXTO_DA_CATEGORIA.estatisticos, 'Sim'],
          ['Marketing', TEXTO_DA_CATEGORIA.marketing, 'Sim'],
        ),
        sub('O que o painel usa hoje em cada categoria opcional'),
        ...blocosDasOpcionais(),
        sub('Como mudar de ideia'),
        p(
          'Abra "Preferências de cookies" no menu da sua conta, dentro do painel, ou no rodapé deste site. A janela mostra o que está ativo e permite ligar e desligar cada categoria opcional — revogar custa exatamente os mesmos cliques que aceitar.',
        ),
        p(
          `A sua escolha fica no seu próprio navegador, com a data e a versão da política (hoje, a versão ${VERSAO_DA_POLITICA}). Ela não é enviada aos nossos servidores. Se a política mudar de versão, a escolha anterior deixa de valer e a pergunta volta — é o único jeito honesto de pedir de novo quando o que se pede mudou.`,
        ),
      ],
    },
    {
      id: 'estatisticas',
      titulo: '6. Google Analytics: do seu site, não do painel',
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
      titulo: '7. Os sites criados pela plataforma têm política própria',
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
      titulo: '8. Como controlar os cookies',
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
      titulo: '9. Mudanças nesta política',
      blocos: [
        p(
          'Se a plataforma passar a usar um cookie que não está listado aqui, esta página e a data da versão mudam junto. A lista acima descreve o que existe hoje, não o que pretendemos fazer.',
        ),
        { tipo: 'contato' },
      ],
    },
  ],
};
