import type { PageExtract } from './extract.js';

/**
 * Qual e o ramo da empresa, a partir do que o site diz.
 *
 * ## Para que serve, e para que NAO serve
 *
 * O segmento decide quais modulos o painel abre. Acertar poupa o cliente de
 * procurar onde cadastrar imovel, cardapio ou turma; errar faz o contrario --
 * abre modulos que ele nao usa e esconde o que ele precisa.
 *
 * Por isso aqui so se **sugere**. A troca de segmento mexe na configuracao do
 * site inteiro, e uma analise automatica nao tem autoridade para isso: o
 * palpite vai para a tela com o nivel de confianca e com os sinais que o
 * sustentam, e quem decide e quem conhece o negocio.
 *
 * ## Como o palpite se forma
 *
 * Tres fontes, com pesos muito diferentes:
 *
 * 1. **Dados estruturados** (`@type` do JSON-LD). E o proprio site declarando
 *    o que e, em vocabulario padronizado. Vale muito mais que qualquer
 *    palavra solta, e por isso pesa dez vezes mais.
 * 2. **Palavras do ramo** no titulo, descricao e cabecalhos -- onde uma
 *    empresa diz o que faz. Pesa mais que no corpo do texto.
 * 3. **Palavras no corpo**, com peso pequeno: "obra" aparece no site de uma
 *    construtora e tambem no de uma loja de tintas.
 *
 * A confianca sai da **distancia para o segundo colocado**, nao do total de
 * pontos. Um site com muitos pontos em dois ramos e um site ambiguo, e dizer
 * "alta confianca" ali seria mentir -- e a mentira custaria a configuracao
 * errada do painel.
 */

export type SegmentConfidence = 'alta' | 'media' | 'baixa';

export interface SegmentGuess {
  /** Codigo do segmento, como em `DEFAULT_SEGMENTS`. */
  code: string;
  /** 0 a 1. Sai da distancia para o segundo colocado. */
  confidence: number;
  level: SegmentConfidence;
  /** O que sustentou o palpite, em portugues, para a tela mostrar. */
  signals: string[];
  /** Segundo colocado, quando houve disputa. */
  runnerUp: string | null;
}

/**
 * Tipos de JSON-LD que identificam o ramo sem ambiguidade.
 *
 * Vem do vocabulario do schema.org, que e o que buscadores leem. Quando o
 * site declara um destes, ele esta dizendo o proprio ramo -- nao ha o que
 * interpretar.
 */
const TIPOS_ESTRUTURADOS: Record<string, string> = {
  dentist: 'clinica',
  medicalclinic: 'clinica',
  medicalbusiness: 'clinica',
  physician: 'clinica',
  hospital: 'clinica',
  veterinarycare: 'clinica',
  restaurant: 'restaurante',
  cafeorcoffeeshop: 'restaurante',
  bakery: 'restaurante',
  barorpub: 'restaurante',
  foodestablishment: 'restaurante',
  realestateagent: 'imobiliaria',
  school: 'escola',
  educationalorganization: 'escola',
  collegeoruniversity: 'escola',
  preschool: 'escola',
  store: 'varejo',
  clothingstore: 'varejo',
  furniturestore: 'varejo',
  hardwarestore: 'varejo',
  onlinestore: 'varejo',
  homeandconstructionbusiness: 'construtora',
  generalcontractor: 'construtora',
  professionalservice: 'prestador',
  legalservice: 'prestador',
  accountingservice: 'prestador',
  automotivebusiness: 'prestador',
  healthandbeautybusiness: 'prestador',
};

/**
 * Palavras que apontam cada ramo.
 *
 * Escolhidas pelo que **distingue**, nao pelo que e comum: "atendimento"
 * aparece em todo site e nao entra; "dentista" so aparece em um ramo e vale
 * muito. Termos que servem a dois ramos ficam de fora ou aparecem nos dois.
 *
 * Alguns foram removidos depois de errarem em site real: "lancamento" puxava
 * para construtora o site de uma agencia que anunciava lancamento de
 * campanha, e "marca" puxava para varejo qualquer empresa que falasse da
 * propria marca. Palavra ambigua nao ajuda -- atrapalha com aparencia de
 * precisao.
 */
const PALAVRAS: Record<string, readonly string[]> = {
  clinica: [
    'clínica', 'clinica', 'consultório', 'consultorio', 'dentista', 'odontolog',
    'médico', 'medico', 'paciente', 'consulta', 'tratamento', 'exame', 'crm ',
    'cro ', 'fisioterap', 'psicolog', 'nutricion', 'estética', 'estetica',
    'agendar consulta', 'especialidade', 'saúde', 'saude', 'veterinár', 'veterinar',
  ],
  restaurante: [
    'cardápio', 'cardapio', 'menu do dia', 'restaurante', 'lanchonete', 'pizzaria',
    'hamburguer', 'hambúrguer', 'delivery', 'prato', 'bebida', 'sobremesa',
    'reserva de mesa', 'chef', 'culinária', 'culinaria', 'petisco', 'bar ',
    'almoço', 'almoco', 'jantar', 'ifood',
  ],
  imobiliaria: [
    'imobiliária', 'imobiliaria', 'imóveis', 'imoveis', 'creci', 'aluguel',
    'locação', 'locacao', 'apartamento', 'casa à venda', 'casa a venda',
    'terreno', 'financiamento imobiliário', 'corretagem', 'dormitório', 'dormitorio',
    'suíte', 'suite', 'condomínio', 'condominio', 'metragem',
  ],
  corretor: [
    'corretor de imóveis', 'corretor de imoveis', 'corretora de imóveis', 'creci',
  ],
  construtora: [
    'construtora', 'incorporadora', 'obra', 'empreendimento', 'reforma',
    'engenharia', 'engenheiro', 'arquitet', 'alvenaria', 'canteiro',
    'planta baixa', 'crea', 'metros quadrados de área construída',
  ],
  escola: [
    'escola', 'colégio', 'colegio', 'curso', 'matrícula', 'matricula', 'aluno',
    'professor', 'turma', 'aula', 'ensino', 'educação', 'educacao', 'bolsa de estudo',
    'vestibular', 'graduação', 'graduacao', 'pós-graduação', 'certificado',
    'grade curricular', 'semestre',
  ],
  varejo: [
    'loja', 'produto', 'comprar', 'carrinho', 'frete', 'estoque', 'catálogo',
    'catalogo', 'coleção', 'colecao', 'promoção', 'promocao', 'parcelas',
    'à vista', 'a vista', 'atacado', 'varejo',
  ],
  prestador: [
    'orçamento', 'orcamento', 'prestador', 'serviço especializado',
    'servico especializado', 'assistência técnica', 'assistencia tecnica',
    'manutenção', 'manutencao', 'instalação', 'instalacao', 'conserto',
    'atendemos', 'consultoria', 'assessoria', 'advoga', 'contabil', 'contábil',
    // Agencia de web e marketing e prestador de servico, e estes termos a
    // distinguem sem pegar o site de quem apenas *tem* um site.
    'criação de sites', 'criacao de sites', 'landing page', 'marketing digital',
    'agência', 'agencia', 'tráfego pago', 'trafego pago', 'identidade visual',
  ],
};

/** Papeis de pagina que, sozinhos, ja apontam um ramo. */
const PAPEIS: Record<string, string> = {
  imoveis: 'imobiliaria',
  produtos: 'varejo',
  obras: 'construtora',
};

const PESO_ESTRUTURADO = 30;
const PESO_DESTAQUE = 3;
const PESO_CORPO = 1;
const PESO_PAPEL = 6;

/**
 * Sugere o ramo da empresa.
 *
 * Devolve `null` quando nao ha sinal nenhum -- preferivel a chutar
 * "institucional" e dar ao palpite uma aparencia de conclusao.
 */
export function guessSegment(pages: readonly PageExtract[]): SegmentGuess | null {
  if (pages.length === 0) return null;

  const pontos = new Map<string, number>();
  const sinais = new Map<string, Set<string>>();

  const somar = (codigo: string, peso: number, sinal: string): void => {
    pontos.set(codigo, (pontos.get(codigo) ?? 0) + peso);
    const lista = sinais.get(codigo) ?? new Set<string>();
    if (lista.size < 6) lista.add(sinal);
    sinais.set(codigo, lista);
  };

  for (const page of pages) {
    // 1. O que o site declara de si, em vocabulario padronizado.
    for (const node of page.jsonLd) {
      for (const tipo of tiposDe(node)) {
        const codigo = TIPOS_ESTRUTURADOS[tipo.toLowerCase()];
        if (codigo !== undefined) {
          somar(codigo, PESO_ESTRUTURADO, `o site se declara "${tipo}" nos dados estruturados`);
        }
      }
    }

    // 2. Papel da pagina: uma pagina de imoveis nao aparece por acaso.
    const porPapel = PAPEIS[page.role];
    if (porPapel !== undefined) {
      somar(porPapel, PESO_PAPEL, `tem página de ${page.role}`);
    }

    // 3. Palavras, com peso maior onde a empresa diz o que faz.
    const destaque = [page.title, page.metaDescription, page.og.description, ...page.headings.map((h) => h.text)]
      .join(' ')
      .toLowerCase();
    const corpo = page.paragraphs.join(' ').toLowerCase().slice(0, 20_000);

    for (const [codigo, termos] of Object.entries(PALAVRAS)) {
      for (const termo of termos) {
        if (destaque.includes(termo)) somar(codigo, PESO_DESTAQUE, `"${termo.trim()}" no título ou nos destaques`);
        else if (corpo.includes(termo)) somar(codigo, PESO_CORPO, `"${termo.trim()}" no texto do site`);
      }
    }
  }

  if (pontos.size === 0) return null;

  const ordenado = [...pontos.entries()].sort((a, b) => b[1] - a[1]);
  const primeiro = ordenado[0];
  if (!primeiro) return null;

  const [codigo, melhor] = primeiro;
  const segundo = ordenado[1];
  const segundoValor = segundo?.[1] ?? 0;

  /**
   * Confianca pela distancia, nao pelo total.
   *
   * Um site com 40 pontos em "clinica" e 38 em "varejo" nao e um site de
   * clinica com alta confianca: e um site ambiguo. A razao entre a diferenca
   * e o total captura isso; o total sozinho nao.
   */
  const confianca = melhor <= 0 ? 0 : (melhor - segundoValor) / melhor;

  const level: SegmentConfidence =
    melhor >= PESO_ESTRUTURADO || (confianca >= 0.6 && melhor >= 9)
      ? 'alta'
      : confianca >= 0.3 && melhor >= 5
        ? 'media'
        : 'baixa';

  return {
    code: codigo,
    confidence: Math.round(confianca * 100) / 100,
    level,
    signals: [...(sinais.get(codigo) ?? [])],
    runnerUp: segundo?.[0] ?? null,
  };
}

/** `@type` de um no JSON-LD, que pode ser string ou lista. */
function tiposDe(node: Record<string, unknown>): string[] {
  const bruto = node['@type'];
  if (typeof bruto === 'string') return [bruto];
  if (Array.isArray(bruto)) return bruto.filter((item): item is string => typeof item === 'string');
  return [];
}
