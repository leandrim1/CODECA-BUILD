/**
 * O tour de boas-vindas, como dado.
 *
 * Cinco passos, no maximo: o sexto nao e lido. Cada um aponta para um
 * elemento que JA EXISTE na tela, por um atributo `data-tour` -- e nao por
 * classe ou posicao, que mudam a cada ajuste de layout e quebrariam o tour em
 * silencio.
 *
 * Os textos falam do que a pessoa ganha, nao do que a tela e. "Aqui voce
 * cadastra o que sua empresa vende" diz mais do que "menu de conteudo".
 */
export interface PassoDoTour {
  id: string;
  titulo: string;
  texto: string;
  /**
   * Elemento destacado, pelo atributo `data-tour`.
   *
   * Sem alvo, o passo e um cartao centralizado -- e o caso das boas-vindas,
   * que nao fala de nenhum canto da tela em particular.
   */
  alvo?: string;
  /** Lado preferido do balao. Ele vira sozinho quando nao couber. */
  lado?: 'direita' | 'baixo' | 'esquerda' | 'cima';
}

export const PASSOS_DO_TOUR: PassoDoTour[] = [
  {
    id: 'boas-vindas',
    titulo: 'Bem-vindo ao seu painel',
    texto:
      'Daqui você cuida do conteúdo do seu site: textos, fotos, serviços e os contatos de quem procura a sua empresa. São dois minutos para conhecer o caminho.',
  },
  {
    id: 'menu-site',
    titulo: 'Tudo do seu site fica aqui',
    texto:
      'Neste grupo você cadastra o que a sua empresa mostra: a apresentação, as fotos, os serviços e os produtos. Clique em "Site" para abrir e fechar a lista.',
    alvo: 'grupo-site',
    lado: 'direita',
  },
  {
    id: 'primeiros-passos',
    titulo: 'Comece por aqui',
    texto:
      'Esta lista mostra o que falta para o seu site ficar completo. Ela se marca sozinha conforme você cadastra — não precisa dar baixa em nada.',
    alvo: 'primeiros-passos',
    lado: 'baixo',
  },
  {
    id: 'interessados',
    titulo: 'Quem procurou a sua empresa',
    texto:
      'Todo formulário preenchido no seu site chega aqui, com nome e telefone. É onde você acompanha os contatos que o site trouxe.',
    alvo: 'grupo-relacionamento',
    lado: 'direita',
  },
  {
    id: 'ajuda',
    titulo: 'A ajuda fica sempre à mão',
    texto:
      'Neste menu você refaz este tour quando quiser, revê os primeiros passos e fala com o suporte. Nada se perde se você fechar agora.',
    alvo: 'menu-da-conta',
    lado: 'baixo',
  },
];
