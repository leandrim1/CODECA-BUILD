import { normalizeSpace } from './html.js';
import { jsonLdIsType, jsonLdString, type ExtractedBlock, type PageExtract } from './extract.js';
import {
  IMPORT_LIMITS,
  MEDIA_TARGET,
  type ImportEvidence,
  type ImportEvidenceSource,
  type ImportTarget,
} from './types.js';

/**
 * De texto encontrado para campo de modulo.
 *
 * Esta e a camada que **decide** o destino de cada coisa, e por isso e onde a
 * regra "nao inventar informacao" e aplicada: um candidato so nasce quando ha
 * um sinal concreto no site, e carrega sempre a pagina e o sinal que o
 * produziram. Nenhum campo e preenchido por semelhanca, por media ou por
 * padrao do setor.
 *
 * O que nao se consegue atribuir com seguranca nao e chutado: vira texto nao
 * identificado, que a tela mostra separado para a pessoa decidir. Um campo
 * vazio e um custo pequeno; um campo com dado inventado sobre a empresa de
 * alguem e um problema que ninguem percebe antes de o site publicar.
 */

/** Candidato a um campo de modulo de instancia unica. */
export interface DocumentFieldCandidate {
  kind: 'documento_campo';
  target: 'institucional' | 'contato';
  fieldKey: string;
  label: string;
  value: unknown;
  evidence: ImportEvidence;
}

/** Candidato a um registro novo de modulo de colecao. */
export interface CollectionRecordCandidate {
  kind: 'colecao_registro';
  target: ImportTarget;
  label: string;
  /** Campos do registro, no formato que o schema do modulo espera. */
  value: Record<string, unknown>;
  /** Imagem do site a anexar ao registro, quando houver. */
  imageUrl?: string;
  evidence: ImportEvidence;
}

/** Candidato a arquivo na biblioteca de imagens. */
export interface ImageCandidate {
  kind: 'imagem';
  target: typeof MEDIA_TARGET;
  label: string;
  url: string;
  alt: string;
  /** Para que a imagem parece servir, pelo lugar onde apareceu. */
  tag: string;
  evidence: ImportEvidence;
}

export type ImportCandidate = DocumentFieldCandidate | CollectionRecordCandidate | ImageCandidate;

/** Texto encontrado que nao foi atribuido a campo nenhum. */
export interface UnmappedText {
  pageUrl: string;
  heading: string;
  excerpt: string;
}

export interface MappingResult {
  candidates: ImportCandidate[];
  unmapped: UnmappedText[];
}

function evidence(pageUrl: string, source: ImportEvidenceSource, excerpt: string): ImportEvidence {
  return { pageUrl, source, excerpt: normalizeSpace(excerpt).slice(0, 400) };
}

/** Primeira pagina de um papel, ou nula. */
function pageByRole(pages: readonly PageExtract[], role: PageExtract['role']): PageExtract | null {
  return pages.find((page) => page.role === role) ?? null;
}

// ------------------------------------------------------- institucional

/**
 * Nome da empresa.
 *
 * Em ordem de confianca: o que o site declarou em JSON-LD (`Organization`),
 * depois `og:site_name`, depois o titulo da inicial. O titulo vem por ultimo
 * porque vem cheio de enfeite ("Clinica X | Odontologia em Curitiba"), e o
 * corte no separador e justamente o que torna esse caso o menos confiavel.
 */
function companyNameOf(pages: readonly PageExtract[]): { value: string; evidence: ImportEvidence } | null {
  for (const page of pages) {
    for (const node of page.jsonLd) {
      if (!jsonLdIsType(node, 'Organization', 'LocalBusiness', 'Store', 'Dentist', 'MedicalClinic', 'MedicalBusiness', 'RealEstateAgent', 'HomeAndConstructionBusiness', 'ProfessionalService', 'Restaurant')) {
        continue;
      }
      const name = jsonLdString(node, 'name');
      if (name !== '' && name.length <= 160) {
        return { value: name, evidence: evidence(page.url, 'json_ld', name) };
      }
    }
  }

  const home = pageByRole(pages, 'inicial') ?? pages[0];
  if (!home) return null;

  if (home.og.siteName !== '' && home.og.siteName.length <= 160) {
    return { value: home.og.siteName, evidence: evidence(home.url, 'open_graph', home.og.siteName) };
  }

  if (home.title !== '') {
    // "Nome | Descricao" e "Nome - Descricao": o nome e a parte mais curta e
    // vem antes. Pegar o trecho inteiro gravaria a frase de SEO como razao
    // social da empresa.
    const parte = home.title.split(/\s[|•·–—]\s|\s-\s/)[0]?.trim() ?? '';
    const nome = parte !== '' && parte.length <= 160 ? parte : home.title.slice(0, 160);
    if (nome.length >= 2) return { value: nome, evidence: evidence(home.url, 'titulo', home.title) };
  }

  return null;
}

/**
 * Candidatos de institucional.
 *
 * `history`, `mission` e `vision` so saem de secao com cabecalho que diz o
 * que e. Enfiar o texto mais longo da pagina "Sobre" em `history` daria um
 * campo preenchido com o que, na pagina original, podia ser qualquer coisa.
 */
function mapInstitucional(pages: readonly PageExtract[]): ImportCandidate[] {
  const candidates: ImportCandidate[] = [];
  const home = pageByRole(pages, 'inicial') ?? pages[0] ?? null;
  const sobre = pageByRole(pages, 'sobre');

  const nome = companyNameOf(pages);
  if (nome) {
    candidates.push({
      kind: 'documento_campo',
      target: 'institucional',
      fieldKey: 'companyName',
      label: 'Nome da empresa',
      value: nome.value,
      evidence: nome.evidence,
    });
  }

  // Frase de apresentacao: o `h1` da inicial e exatamente isso na maioria dos
  // sites. Descartado quando repete o nome da empresa, que seria redundante.
  const h1 = home?.headings.find((heading) => heading.level === 1)?.text ?? '';
  if (h1 !== '' && h1.length <= 200 && h1.toLowerCase() !== (nome?.value ?? '').toLowerCase()) {
    candidates.push({
      kind: 'documento_campo',
      target: 'institucional',
      fieldKey: 'tagline',
      label: 'Frase de apresentação',
      value: h1,
      evidence: evidence(home?.url ?? '', 'cabecalho', h1),
    });
  }

  // Descricao curta: a meta description, que e o resumo que o proprio site
  // escolheu publicar nos buscadores.
  const resumo = home?.metaDescription || home?.og.description || sobre?.metaDescription || '';
  if (resumo !== '') {
    candidates.push({
      kind: 'documento_campo',
      target: 'institucional',
      fieldKey: 'shortDescription',
      label: 'Descrição curta',
      value: resumo.slice(0, 600),
      evidence: evidence(home?.url ?? sobre?.url ?? '', 'meta', resumo),
    });
  }

  const paginasDeTexto = [sobre, home].filter((page): page is PageExtract => page !== null);
  for (const page of paginasDeTexto) {
    for (const block of page.blocks) {
      const titulo = block.heading.toLowerCase();
      const texto = block.paragraphs.join('\n\n');

      /**
       * `valores` vem antes do teste de texto vazio porque e o unico campo que
       * nasce de uma **lista**, nao de paragrafo: a secao "Valores" costuma ser
       * so um `<ul>`. Testar texto vazio primeiro descartaria a secao inteira.
       */
      if (/\bvalores\b/.test(titulo) && block.items.length > 0) {
        // Valores e lista de termos curtos, nao de frases: o campo e `tags` e
        // o schema recusa item acima de 80 caracteres.
        const valores = block.items
          .map((item) => normalizeSpace(item))
          .filter((item) => item.length >= 2 && item.length <= 80)
          .slice(0, 12);
        if (valores.length > 0) {
          pushOnce(candidates, {
            kind: 'documento_campo',
            target: 'institucional',
            fieldKey: 'values',
            label: 'Valores',
            value: valores,
            evidence: evidence(page.url, 'lista', valores.join(', ')),
          });
          continue;
        }
      }

      if (texto === '') continue;

      if (/\b(hist[oó]ria|nossa\s+trajet[oó]ria|trajet[oó]ria|quem\s+somos|sobre\s+n[oó]s|a\s+empresa)\b/.test(titulo)) {
        pushOnce(candidates, {
          kind: 'documento_campo',
          target: 'institucional',
          fieldKey: 'history',
          label: 'História',
          value: texto.slice(0, 5000),
          evidence: evidence(page.url, 'texto', block.heading),
        });
        continue;
      }
      if (/\bmiss[aã]o\b/.test(titulo)) {
        pushOnce(candidates, {
          kind: 'documento_campo',
          target: 'institucional',
          fieldKey: 'mission',
          label: 'Missao',
          value: texto.slice(0, 1000),
          evidence: evidence(page.url, 'texto', block.heading),
        });
        continue;
      }
      if (/\bvis[aã]o\b/.test(titulo)) {
        pushOnce(candidates, {
          kind: 'documento_campo',
          target: 'institucional',
          fieldKey: 'vision',
          label: 'Visão',
          value: texto.slice(0, 1000),
          evidence: evidence(page.url, 'texto', block.heading),
        });
        continue;
      }
    }
  }

  // Quando nao ha secao "Historia" com cabecalho, o texto mais longo da pagina
  // Sobre e a melhor aproximacao -- mas so dela, e so se for substancial.
  if (sobre && !candidates.some((item) => item.kind === 'documento_campo' && item.fieldKey === 'history')) {
    const maior = sobre.paragraphs.reduce((a, b) => (a.length >= b.length ? a : b), '');
    if (maior.length >= 200) {
      candidates.push({
        kind: 'documento_campo',
        target: 'institucional',
        fieldKey: 'history',
        label: 'História',
        value: maior.slice(0, 5000),
        evidence: evidence(sobre.url, 'texto', maior),
      });
    }
  }

  /**
   * Logotipo.
   *
   * O valor aqui e o **endereco no site antigo**; a gravacao o troca pelo
   * identificador do arquivo na biblioteca, depois de a imagem ser baixada.
   * O campo `logoImageId` guarda identificador, nunca URL de terceiro -- e e
   * isso que faz o site novo parar de depender do antigo.
   */
  const logo = pages
    .flatMap((page) => page.images.map((image) => ({ page, image })))
    .find((entry) => entry.image.placement === 'logo');
  if (logo) {
    candidates.push({
      kind: 'documento_campo',
      target: 'institucional',
      fieldKey: 'logoImageId',
      label: 'Logotipo',
      value: logo.image.url,
      evidence: evidence(logo.page.url, 'imagem', logo.image.alt || 'Logotipo do site'),
    });
  }

  /**
   * Ano de fundacao: somente da inicial ou da pagina Sobre.
   *
   * Qualquer pagina pode conter "desde 2005" sem falar da empresa -- numa
   * pagina de equipe isso e "atende aqui desde 2005", numa de obras e a data
   * de um projeto. Fundacao e informacao institucional, e so as duas paginas
   * que falam da empresa valem como fonte dela.
   */
  const fonteDoAno = [home, sobre].filter((page): page is PageExtract => page !== null);
  const ano = fonteDoAno.map((page) => page.foundedYear).find((year) => year !== null) ?? null;
  if (ano !== null) {
    const pagina = fonteDoAno.find((page) => page.foundedYear === ano);
    candidates.push({
      kind: 'documento_campo',
      target: 'institucional',
      fieldKey: 'foundedYear',
      label: 'Ano de fundação',
      value: ano,
      evidence: evidence(pagina?.url ?? '', 'texto', `Ano de fundação: ${ano}`),
    });
  }

  return candidates;
}

/** Acrescenta so se ainda nao houver candidato para o mesmo campo. */
function pushOnce(list: ImportCandidate[], candidate: DocumentFieldCandidate): void {
  const existe = list.some(
    (item) =>
      item.kind === 'documento_campo'
      && item.target === candidate.target
      && item.fieldKey === candidate.fieldKey,
  );
  if (!existe) list.push(candidate);
}

// ------------------------------------------------------------- contato

/**
 * Candidatos de contato.
 *
 * A pagina de contato tem prioridade sobre o rodape da inicial: as duas
 * costumam trazer o mesmo telefone, mas quando divergem a pagina dedicada e a
 * que esta certa.
 */
function mapContato(pages: readonly PageExtract[]): ImportCandidate[] {
  const candidates: ImportCandidate[] = [];
  const contato = pageByRole(pages, 'contato');
  const home = pageByRole(pages, 'inicial') ?? pages[0] ?? null;
  const ordem = [contato, home, ...pages].filter((page): page is PageExtract => page !== null);

  const add = (fieldKey: string, label: string, value: unknown, page: PageExtract, source: ImportEvidenceSource, excerpt: string): void => {
    pushOnce(candidates, {
      kind: 'documento_campo',
      target: 'contato',
      fieldKey,
      label,
      value,
      evidence: evidence(page.url, source, excerpt),
    });
  };

  // JSON-LD de negocio local e a fonte mais confiavel de endereco: vem
  // separado em campos, sem precisar interpretar texto corrido.
  for (const page of ordem) {
    for (const node of page.jsonLd) {
      if (!jsonLdIsType(node, 'Organization', 'LocalBusiness', 'Store', 'Dentist', 'MedicalClinic', 'MedicalBusiness', 'RealEstateAgent', 'HomeAndConstructionBusiness', 'ProfessionalService', 'Restaurant')) {
        continue;
      }
      const email = jsonLdString(node, 'email').replace(/^mailto:/i, '');
      if (email.includes('@')) add('email', 'E-mail', email.toLowerCase(), page, 'json_ld', email);
      const phone = jsonLdString(node, 'telephone');
      if (phone !== '') add('phone', 'Telefone', phone.slice(0, 40), page, 'json_ld', phone);

      const address = node['address'];
      if (address !== null && typeof address === 'object' && !Array.isArray(address)) {
        const record = address as Record<string, unknown>;
        const street = jsonLdString(record, 'streetAddress');
        if (street !== '') add('addressLine', 'Endereço', street.slice(0, 240), page, 'json_ld', street);
        const city = jsonLdString(record, 'addressLocality');
        if (city !== '') add('city', 'Cidade', city.slice(0, 120), page, 'json_ld', city);
        const region = jsonLdString(record, 'addressRegion');
        // O campo do modulo guarda a sigla de duas letras.
        if (/^[A-Za-z]{2}$/.test(region)) add('state', 'Estado', region.toUpperCase(), page, 'json_ld', region);
        const postal = jsonLdString(record, 'postalCode');
        if (/\d{5}-?\d{3}/.test(postal)) {
          add('postalCode', 'CEP', postal.replace(/(\d{5})-?(\d{3})/, '$1-$2'), page, 'json_ld', postal);
        }
      }
    }
  }

  for (const page of ordem) {
    const contactData = page.contact;
    if (contactData.emails[0]) add('email', 'E-mail', contactData.emails[0], page, 'link', contactData.emails[0]);
    if (contactData.phones[0]) add('phone', 'Telefone', contactData.phones[0], page, 'link', contactData.phones[0]);
    if (contactData.whatsapp !== '') add('whatsapp', 'WhatsApp', contactData.whatsapp, page, 'link', contactData.whatsapp);
    if (contactData.addressLine !== '') add('addressLine', 'Endereço', contactData.addressLine, page, 'texto', contactData.addressLine);
    if (contactData.city !== '') add('city', 'Cidade', contactData.city, page, 'texto', `${contactData.city} - ${contactData.state}`);
    if (contactData.state !== '') add('state', 'Estado', contactData.state, page, 'texto', contactData.state);
    if (contactData.postalCode !== '') add('postalCode', 'CEP', contactData.postalCode, page, 'texto', contactData.postalCode);
    if (contactData.businessHours !== '') {
      add('businessHours', 'Horário de atendimento', contactData.businessHours, page, 'texto', contactData.businessHours);
    }
    if (contactData.mapUrl !== '') add('mapUrl', 'Link do mapa', contactData.mapUrl, page, 'link', contactData.mapUrl);
  }

  // Redes sociais: uniao de todas as paginas, porque o rodape de uma pagina
  // pode trazer uma rede que a outra nao tem.
  const social: Record<string, string> = {};
  let paginaSocial: PageExtract | null = null;
  for (const page of ordem) {
    for (const [network, url] of Object.entries(page.contact.social)) {
      if (url === undefined || social[network] !== undefined) continue;
      social[network] = url;
      paginaSocial ??= page;
    }
  }
  if (Object.keys(social).length > 0 && paginaSocial) {
    add('social', 'Redes sociais', social, paginaSocial, 'link', Object.keys(social).join(', '));
  }

  return candidates;
}

// ------------------------------------------------------------- colecoes

/**
 * Transforma um bloco (cabecalho + texto) num registro de colecao.
 *
 * Usado por servicos, produtos e obras, que compartilham a forma "titulo,
 * resumo, descricao". Devolve `null` quando o bloco nao tem titulo utilizavel
 * ou e grande demais para ser um item de lista.
 */
function blockToRecord(block: ExtractedBlock): { title: string; summary: string; description: string } | null {
  const title = normalizeSpace(block.heading);
  if (title === '' || title.length > 160) return null;
  // Cabecalho que e frase inteira nao e nome de servico.
  if (title.split(/\s+/).length > 12) return null;
  const paragraphs = block.paragraphs.filter((text) => text !== '');
  if (paragraphs.length === 0 && block.items.length === 0) return null;

  const description = paragraphs.join('\n\n');
  const summary = paragraphs[0] ?? block.items.slice(0, 5).join('; ');
  return {
    title,
    summary: summary.slice(0, 600),
    description: description.slice(0, 5000),
  };
}

/**
 * Cabecalhos que anunciam a lista, e nao um item dela.
 *
 * Sem este filtro, "Nossos Servicos" entraria como um servico chamado "Nossos
 * Servicos", acima dos servicos de verdade.
 */
const SECTION_HEADINGS = /^(nossos?|nossas?|as?|os?|principais?|conheca|conheça|veja)?\s*(servi[cç]os?|produtos?|especialidades?|tratamentos?|procedimentos?|solu[cç][oõ]es|obras?|projetos?|empreendimentos?|diferenciais?|depoimentos?|equipe|time|perguntas?\s+frequentes|d[uú]vidas?|galeria|portf[oó]lio|im[oó]veis)\s*$/i;

function isSectionHeading(heading: string): boolean {
  return SECTION_HEADINGS.test(normalizeSpace(heading));
}

/**
 * Servicos.
 *
 * Duas fontes: `Service`/`OfferCatalog` do Schema.org, e os blocos das paginas
 * de servico. Fora de uma pagina de servicos a inicial tambem conta, porque
 * site de uma pagina lista tudo nela -- mas ali so os blocos sob um cabecalho
 * de secao de servicos, para nao recolher a pagina inteira.
 */
function mapServicos(pages: readonly PageExtract[]): ImportCandidate[] {
  const candidates: CollectionRecordCandidate[] = [];

  for (const page of pages) {
    for (const node of page.jsonLd) {
      if (!jsonLdIsType(node, 'Service')) continue;
      const title = jsonLdString(node, 'name');
      if (title === '' || title.length > 160) continue;
      candidates.push({
        kind: 'colecao_registro',
        target: 'servicos',
        label: title,
        value: {
          title,
          summary: jsonLdString(node, 'description').slice(0, 600),
          description: jsonLdString(node, 'description').slice(0, 5000),
        },
        evidence: evidence(page.url, 'json_ld', title),
      });
    }
  }

  const paginas = pages.filter((page) => page.role === 'servicos');
  for (const page of paginas) {
    for (const block of page.blocks) {
      if (isSectionHeading(block.heading)) continue;
      const record = blockToRecord(block);
      if (!record) continue;
      candidates.push({
        kind: 'colecao_registro',
        target: 'servicos',
        label: record.title,
        value: record,
        evidence: evidence(page.url, 'cabecalho', block.heading),
      });
    }
    // Pagina de servicos que lista em `<li>` em vez de cabecalho+paragrafo.
    if (candidates.length === 0) {
      for (const block of page.blocks) {
        if (!isSectionHeading(block.heading)) continue;
        for (const item of block.items) {
          const title = normalizeSpace(item);
          if (title === '' || title.length > 160 || title.split(/\s+/).length > 12) continue;
          candidates.push({
            kind: 'colecao_registro',
            target: 'servicos',
            label: title,
            value: { title, summary: '', description: '' },
            evidence: evidence(page.url, 'lista', title),
          });
        }
      }
    }
  }

  // Sem pagina dedicada: a secao de servicos da inicial.
  if (candidates.length === 0) {
    const home = pageByRole(pages, 'inicial');
    if (home) {
      let dentroDaSecao = false;
      let nivelDaSecao = 0;
      for (const block of home.blocks) {
        if (isSectionHeading(block.heading) && /servi[cç]|especialidade|tratamento|procedimento|solu[cç]/i.test(block.heading)) {
          dentroDaSecao = true;
          nivelDaSecao = block.headingLevel;
          for (const item of block.items) {
            const title = normalizeSpace(item);
            if (title === '' || title.length > 160 || title.split(/\s+/).length > 12) continue;
            candidates.push({
              kind: 'colecao_registro',
              target: 'servicos',
              label: title,
              value: { title, summary: '', description: '' },
              evidence: evidence(home.url, 'lista', title),
            });
          }
          continue;
        }
        if (!dentroDaSecao) continue;

        /**
         * Cabecalho de nivel igual ou mais alto **encerra** a secao.
         *
         * Num site de uma pagina so, "Nossos servicos" e "Sobre nos" sao os
         * dois `h2`. Sem esta regra, tudo que vem depois da secao de servicos
         * ate o fim da pagina viraria servico -- e "Sobre nos" apareceria na
         * lista de servicos do cliente.
         */
        if (block.headingLevel <= nivelDaSecao) {
          dentroDaSecao = false;
          continue;
        }

        // Cabecalho mais fundo: e um item dentro da secao de servicos.
        const record = blockToRecord(block);
        if (record) {
          candidates.push({
            kind: 'colecao_registro',
            target: 'servicos',
            label: record.title,
            value: record,
            evidence: evidence(home.url, 'cabecalho', block.heading),
          });
        }
      }
    }
  }

  return dedupeRecords(candidates);
}

/**
 * Produtos.
 *
 * Preco so entra quando vem de `Product`/`Offer` do Schema.org, em campo
 * numerico proprio. Ler preco de texto corrido ("a partir de R$ 90") daria um
 * numero que nao e o preco de nada -- e preco errado num site e problema com
 * cliente, nao um campo a corrigir depois.
 */
function mapProdutos(pages: readonly PageExtract[]): ImportCandidate[] {
  const candidates: CollectionRecordCandidate[] = [];

  for (const page of pages) {
    for (const node of page.jsonLd) {
      if (!jsonLdIsType(node, 'Product')) continue;
      const title = jsonLdString(node, 'name');
      if (title === '' || title.length > 160) continue;

      const value: Record<string, unknown> = {
        title,
        summary: jsonLdString(node, 'description').slice(0, 600),
        description: jsonLdString(node, 'description').slice(0, 5000),
      };

      const sku = jsonLdString(node, 'sku') || jsonLdString(node, 'mpn');
      if (sku !== '') value['code'] = sku.slice(0, 80);

      const offers = node['offers'];
      const offer = Array.isArray(offers) ? offers[0] : offers;
      if (offer !== null && typeof offer === 'object') {
        const record = offer as Record<string, unknown>;
        const raw = record['price'] ?? record['lowPrice'];
        const price = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
        if (Number.isFinite(price) && price > 0) value['price'] = price;
        const currency = jsonLdString(record, 'priceCurrency').toUpperCase();
        if (currency === 'BRL' || currency === 'USD' || currency === 'EUR') value['currency'] = currency;
      }

      const image = jsonLdString(node, 'image');
      let imageUrl: string | undefined;
      if (image !== '') {
        try {
          imageUrl = new URL(image, page.url).toString();
        } catch {
          imageUrl = undefined;
        }
      }

      candidates.push({
        kind: 'colecao_registro',
        target: 'produtos',
        label: title,
        value,
        ...(imageUrl ? { imageUrl } : {}),
        evidence: evidence(page.url, 'json_ld', title),
      });
    }
  }

  for (const page of pages.filter((item) => item.role === 'produtos')) {
    for (const block of page.blocks) {
      if (isSectionHeading(block.heading)) continue;
      const record = blockToRecord(block);
      if (!record) continue;
      candidates.push({
        kind: 'colecao_registro',
        target: 'produtos',
        label: record.title,
        value: { title: record.title, summary: record.summary, description: record.description },
        evidence: evidence(page.url, 'cabecalho', block.heading),
      });
    }
  }

  return dedupeRecords(candidates);
}

/**
 * Obras e projetos: blocos das paginas de portfolio.
 *
 * So entra a obra cuja categoria o texto declara. Ver `categoriaDeObra`: o
 * campo e obrigatorio e nao tem padrao, e escolher um por nos poria toda a
 * carteira de obras na categoria errada.
 */
function mapObras(pages: readonly PageExtract[]): ImportCandidate[] {
  const candidates: CollectionRecordCandidate[] = [];
  for (const page of pages.filter((item) => item.role === 'portfolio')) {
    for (const block of page.blocks) {
      if (isSectionHeading(block.heading)) continue;
      const record = blockToRecord(block);
      if (!record) continue;

      const categoria = categoriaDeObra(`${record.title} ${record.summary} ${record.description}`);
      if (categoria === null) continue;

      candidates.push({
        kind: 'colecao_registro',
        target: 'obras',
        label: record.title,
        value: {
          title: record.title,
          shortDescription: record.summary,
          description: record.description,
          category: categoria,
        },
        evidence: evidence(page.url, 'cabecalho', block.heading),
      });
    }
  }
  return dedupeRecords(candidates);
}

/** Depoimentos: so com autor, e sempre sem autorizacao declarada. */
function mapDepoimentos(pages: readonly PageExtract[]): ImportCandidate[] {
  const candidates: CollectionRecordCandidate[] = [];
  for (const page of pages) {
    for (const quote of page.quotes) {
      candidates.push({
        kind: 'colecao_registro',
        target: 'depoimentos',
        label: quote.author,
        value: {
          authorName: quote.author,
          authorRole: quote.role,
          content: quote.text,
          /**
           * Importado **sem** autorizacao confirmada, sempre.
           *
           * O depoimento estar publicado no site antigo nao e a autorizacao
           * que o modulo exige: o campo declara que a empresa tem a permissao
           * da pessoa, e so a empresa pode declarar isso. Marcar sozinho
           * seria assinar no lugar dela -- e o servidor nem publica o
           * depoimento sem essa marca, entao o registro entra guardado.
           */
          authorizationConfirmed: false,
        },
        evidence: evidence(page.url, 'texto', quote.text),
      });
    }
  }
  return dedupeRecords(candidates);
}

/** Equipe: nome com cargo ou foto. */
function mapEquipe(pages: readonly PageExtract[]): ImportCandidate[] {
  const candidates: CollectionRecordCandidate[] = [];
  for (const page of pages) {
    for (const person of page.people) {
      candidates.push({
        kind: 'colecao_registro',
        target: 'equipe',
        label: person.name,
        value: { name: person.name, role: person.role, bio: person.bio },
        ...(person.photo !== '' ? { imageUrl: person.photo } : {}),
        evidence: evidence(page.url, person.photo !== '' ? 'imagem' : 'cabecalho', person.name),
      });
    }
  }
  return dedupeRecords(candidates);
}

/** Perguntas frequentes. */
function mapFaq(pages: readonly PageExtract[]): ImportCandidate[] {
  const candidates: CollectionRecordCandidate[] = [];
  for (const page of pages) {
    for (const faq of page.faqs) {
      candidates.push({
        kind: 'colecao_registro',
        target: 'faq',
        label: faq.question,
        value: { question: faq.question, answer: faq.answer },
        evidence: evidence(page.url, 'texto', faq.question),
      });
    }
  }
  return dedupeRecords(candidates);
}

/**
 * Banners.
 *
 * Um banner e titulo mais imagem de abertura. O titulo vem do `h1` da pagina
 * ou do Open Graph; sem imagem nao ha banner, e sem titulo o registro entra
 * com o nome da pagina, que e o que o site de fato anuncia ali.
 */
function mapBanners(pages: readonly PageExtract[]): ImportCandidate[] {
  const candidates: CollectionRecordCandidate[] = [];
  const home = pageByRole(pages, 'inicial') ?? pages[0] ?? null;
  if (!home) return candidates;

  const destaques = home.images.filter((image) => image.placement === 'banner').slice(0, 6);
  const h1 = home.headings.find((heading) => heading.level === 1)?.text ?? '';

  destaques.forEach((image, index) => {
    const title = index === 0 ? (h1 || home.og.title || home.title) : (image.alt || image.caption || home.title);
    if (title === '') return;
    candidates.push({
      kind: 'colecao_registro',
      target: 'banners',
      label: title.slice(0, 160),
      value: {
        title: title.slice(0, 160),
        subtitle: index === 0 ? (home.og.description || home.metaDescription).slice(0, 600) : image.caption.slice(0, 600),
        sortOrder: index,
      },
      imageUrl: image.url,
      evidence: evidence(home.url, 'imagem', image.alt || title),
    });
  });

  return dedupeRecords(candidates);
}

/**
 * Galerias.
 *
 * Uma galeria por pagina de galeria, com as imagens daquela pagina. As
 * imagens entram depois, no momento da gravacao, porque dependem de ter sido
 * baixadas com sucesso -- e o modulo guarda identificadores da biblioteca, nao
 * enderecos do site antigo.
 */
function mapGalerias(pages: readonly PageExtract[]): ImportCandidate[] {
  const candidates: CollectionRecordCandidate[] = [];
  for (const page of pages.filter((item) => item.role === 'galeria')) {
    const imagens = page.images.filter((image) => image.placement !== 'icone' && image.placement !== 'logo');
    if (imagens.length < 2) continue;
    const title = page.headings.find((heading) => heading.level === 1)?.text || page.title;
    if (title === '') continue;
    candidates.push({
      kind: 'colecao_registro',
      target: 'galerias',
      label: title.slice(0, 160),
      value: {
        title: title.slice(0, 160),
        description: page.metaDescription.slice(0, 600),
        /** Enderecos no site antigo; trocados por ids da biblioteca ao gravar. */
        __imageUrls: imagens.map((image) => image.url).slice(0, 24),
      },
      evidence: evidence(page.url, 'imagem', `${imagens.length} imagens`),
    });
  }
  return dedupeRecords(candidates);
}

/**
 * Imoveis: somente quando o site declara dados estruturados.
 *
 * O modulo exige `type` e `purpose` -- apartamento ou casa, venda ou locacao.
 * Nenhum dos dois se deduz de texto com confianca: "Apartamento Jardins" nao
 * diz se esta a venda, e errar isso poe o imovel na aba errada do site novo.
 * Entao, sem `RealEstateListing` ou equivalente, nao nasce candidato -- e a
 * tela avisa que os imoveis precisam ser cadastrados a mao.
 */
function mapImoveis(pages: readonly PageExtract[]): ImportCandidate[] {
  const candidates: CollectionRecordCandidate[] = [];

  for (const page of pages) {
    for (const node of page.jsonLd) {
      if (!jsonLdIsType(node, 'RealEstateListing', 'Residence', 'Apartment', 'House', 'SingleFamilyResidence')) {
        continue;
      }
      const title = jsonLdString(node, 'name');
      if (title === '' || title.length > 160) continue;

      const tipo = tipoDeImovel(node, title);
      const finalidade = finalidadeDeImovel(node, `${title} ${jsonLdString(node, 'description')}`);
      // Sem os dois obrigatorios o registro nao passaria na validacao.
      if (tipo === null || finalidade === null) continue;

      const value: Record<string, unknown> = {
        title,
        description: jsonLdString(node, 'description').slice(0, 5000),
        type: tipo,
        purpose: finalidade,
      };

      const offers = node['offers'];
      const offer = Array.isArray(offers) ? offers[0] : offers;
      if (offer !== null && typeof offer === 'object') {
        const raw = (offer as Record<string, unknown>)['price'];
        const price = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
        if (Number.isFinite(price) && price > 0) value['price'] = price;
      }

      const quartos = Number(node['numberOfBedrooms'] ?? node['numberOfRooms'] ?? NaN);
      if (Number.isFinite(quartos) && quartos > 0 && quartos < 100) value['bedrooms'] = Math.trunc(quartos);
      const banheiros = Number(node['numberOfBathroomsTotal'] ?? node['numberOfBathrooms'] ?? NaN);
      if (Number.isFinite(banheiros) && banheiros > 0 && banheiros < 100) value['bathrooms'] = Math.trunc(banheiros);

      candidates.push({
        kind: 'colecao_registro',
        target: 'imoveis',
        label: title,
        value,
        evidence: evidence(page.url, 'json_ld', title),
      });
    }
  }

  return dedupeRecords(candidates);
}

/**
 * Tipo do imovel, nos valores que o modulo aceita (`PROPERTY_TYPES`).
 *
 * O `@type` do Schema.org vem primeiro porque e declaracao do site. Faltando
 * ele, cai no nome do imovel -- que e texto escrito pela propria imobiliaria
 * para aquele anuncio, nao uma deducao nossa sobre o imovel.
 */
function tipoDeImovel(node: Record<string, unknown>, title: string): string | null {
  if (jsonLdIsType(node, 'Apartment')) return 'apartamento';
  if (jsonLdIsType(node, 'House', 'SingleFamilyResidence')) return 'casa';

  const texto = title.toLowerCase();
  if (/\bcobertura\b/.test(texto)) return 'cobertura';
  if (/\bstudio\b|\bst[uú]dio\b|\bkitnet\b/.test(texto)) return 'studio';
  if (/\bapartamento\b|\bapto\b|\bflat\b/.test(texto)) return 'apartamento';
  if (/\bcasa\s+em\s+condom[ií]nio\b|\bcasa\s+de\s+condom[ií]nio\b/.test(texto)) return 'casa_condominio';
  if (/\bcasa\b|\bsobrado\b/.test(texto)) return 'casa';
  if (/\bterreno\b|\blote\b/.test(texto)) return 'terreno';
  if (/\bgalp[aã]o\b/.test(texto)) return 'galpao';
  if (/\bloja\b/.test(texto)) return 'loja';
  if (/\bsala\s+comercial\b|\bsala\b|\bconjunto\s+comercial\b/.test(texto)) return 'sala_comercial';
  if (/\bch[aá]cara\b|\bs[ií]tio\b|\bfazenda\b|\brural\b/.test(texto)) return 'rural';
  return null;
}

/**
 * Finalidade, nos valores que o modulo aceita (`PROPERTY_PURPOSES`).
 *
 * Devolve `null` quando o texto fala de venda **e** de locacao sem distinguir:
 * existe `venda_locacao` para quando o site diz os dois de propósito, e um
 * anuncio ambiguo nao e a mesma coisa. Imovel na finalidade errada aparece na
 * aba errada do site novo, e isso e pior que nao importar.
 */
function finalidadeDeImovel(node: Record<string, unknown>, texto: string): string | null {
  const offers = node['offers'];
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (offer !== null && typeof offer === 'object') {
    const categoria = jsonLdString(offer as Record<string, unknown>, 'businessFunction').toLowerCase();
    if (categoria.includes('lease') || categoria.includes('rent')) return 'locacao';
    if (categoria.includes('sell') || categoria.includes('sale')) return 'venda';
  }
  const lower = texto.toLowerCase();
  if (/\blan[cç]amento\b/.test(lower)) return 'lancamento';
  const aluguel = /\b(aluga|alugar|alugue|loca[cç][aã]o|locar)\b/.test(lower);
  const venda = /\b(venda|vender|vende|[aà]\s+venda|comprar)\b/.test(lower);
  if (aluguel && venda) return 'venda_locacao';
  if (aluguel) return 'locacao';
  if (venda) return 'venda';
  return null;
}

/**
 * Categoria da obra, nos valores que o modulo aceita (`PROJECT_CATEGORIES`).
 *
 * Campo obrigatorio do modulo, e sem default. Nao ha como deduzir "residencial"
 * ou "industrial" de um titulo qualquer, entao sem palavra que diga a categoria
 * o candidato nem nasce -- e o resumo da analise avisa quantas obras ficaram de
 * fora por isso, em vez de importar tudo como "residencial" e deixar o cliente
 * descobrir depois.
 */
function categoriaDeObra(texto: string): string | null {
  const lower = texto.toLowerCase();

  /**
   * Os parenteses nao sao estilo: sem eles, `\ba|b|c\b` ancora a borda de
   * palavra so na primeira e na ultima alternativa, e o meio casa dentro de
   * outra palavra.
   *
   * Os termos sao deliberadamente especificos. "Escritorio" e "loja" ficaram
   * de fora de `comercial` porque aparecem em frase que nao fala do tipo da
   * obra ("em parceria com um escritorio"), e categoria errada joga a obra
   * para a aba errada do site novo. Quando nenhum termo aparece, a obra nao
   * vira candidato -- o resumo da analise informa isso, e o cliente cadastra
   * a mao.
   */
  if (/\b(reforma|reformas|retrofit|revitaliza[cç][aã]o|restaura[cç][aã]o|amplia[cç][aã]o)\b/.test(lower)) {
    return 'reforma';
  }
  if (/\b(industrial|ind[uú]stria|f[aá]brica|fabril|galp[aã]o)\b/.test(lower)) return 'industrial';
  if (/\b(infraestrutura|saneamento|pavimenta[cç][aã]o|rodovia|ponte|viaduto|drenagem)\b/.test(lower)) {
    return 'infraestrutura';
  }
  if (/\b(institucional|escola|hospital|creche|universidade|posto de sa[uú]de)\b/.test(lower)) {
    return 'institucional';
  }
  if (/\b(comercial|shopping|corporativo|corporativa)\b/.test(lower)) return 'comercial';
  if (/\b(residencial|condom[ií]nio|edif[ií]cio|apartamentos?|moradia|habitacional)\b/.test(lower)) {
    return 'residencial';
  }
  return null;
}

/**
 * Imagens para a biblioteca.
 *
 * Icone e descartado: nao e conteudo da empresa, e encheria a biblioteca de
 * setas e marcadores. O logotipo entra, porque e dado da empresa e o campo
 * `logoImageId` do institucional precisa dele.
 */
function mapImagens(pages: readonly PageExtract[]): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  const vistas = new Set<string>();

  for (const page of pages) {
    for (const image of page.images) {
      if (candidates.length >= IMPORT_LIMITS.maxImages) break;
      if (image.placement === 'icone') continue;
      if (vistas.has(image.url)) continue;
      vistas.add(image.url);

      let nome = '';
      try {
        nome = decodeURIComponent(new URL(image.url).pathname.split('/').pop() ?? '');
      } catch {
        nome = '';
      }

      candidates.push({
        kind: 'imagem',
        target: MEDIA_TARGET,
        label: image.alt || image.caption || nome || 'Imagem do site',
        url: image.url,
        alt: image.alt || image.caption,
        tag: image.placement,
        evidence: evidence(page.url, 'imagem', image.alt || nome),
      });
    }
  }

  return candidates;
}

/** Remove registros repetidos e aplica o limite por modulo. */
function dedupeRecords(candidates: CollectionRecordCandidate[]): CollectionRecordCandidate[] {
  const seen = new Set<string>();
  const porModulo = new Map<ImportTarget, number>();
  const result: CollectionRecordCandidate[] = [];

  for (const candidate of candidates) {
    const chave = `${candidate.target}:${candidate.label.toLowerCase().slice(0, 120)}`;
    if (seen.has(chave)) continue;
    const total = porModulo.get(candidate.target) ?? 0;
    if (total >= IMPORT_LIMITS.maxRecordsPerModule) continue;
    seen.add(chave);
    porModulo.set(candidate.target, total + 1);
    result.push(candidate);
  }

  return result;
}

/**
 * Texto que sobrou sem destino.
 *
 * Exigencia da tela de revisao: mostrar o que **nao** foi identificado, para a
 * pessoa ver que a analise nao fingiu entender tudo. Sao os blocos de paginas
 * classificadas como `outra`, e os blocos de paginas de conteudo que nao
 * viraram candidato nenhum.
 */
function collectUnmapped(pages: readonly PageExtract[], candidates: readonly ImportCandidate[]): UnmappedText[] {
  const usados = new Set(
    candidates
      .filter((item) => item.kind !== 'imagem')
      .map((item) => `${item.evidence.pageUrl}|${item.evidence.excerpt}`),
  );

  const result: UnmappedText[] = [];
  for (const page of pages) {
    if (page.role === 'contato') continue;
    for (const block of page.blocks) {
      if (result.length >= 30) break;
      if (block.heading === '' || isSectionHeading(block.heading)) continue;
      const texto = block.paragraphs.join(' ');
      if (texto.length < 80) continue;
      if (usados.has(`${page.url}|${normalizeSpace(block.heading).slice(0, 400)}`)) continue;
      result.push({
        pageUrl: page.url,
        heading: block.heading.slice(0, 200),
        excerpt: texto.slice(0, 400),
      });
    }
  }
  return result;
}

/**
 * Entrada da camada: todas as paginas lidas viram candidatos.
 *
 * A ordem dos mapeadores define a ordem na tela de revisao, e ela segue o
 * menu do painel -- quem revisa percorre a lista na mesma sequencia em que
 * encontra os modulos depois.
 */
export function mapToModules(pages: readonly PageExtract[]): MappingResult {
  const conteudo: ImportCandidate[] = [
    ...mapInstitucional(pages),
    ...mapContato(pages),
    ...mapBanners(pages),
    ...mapImoveis(pages),
    ...mapObras(pages),
    ...mapServicos(pages),
    ...mapProdutos(pages),
    ...mapGalerias(pages),
    ...mapDepoimentos(pages),
    ...mapEquipe(pages),
    ...mapFaq(pages),
  ];

  const imagens = mapImagens(pages);
  const candidates: ImportCandidate[] = [
    ...conteudo,
    ...imagens,
    ...imagensReferenciadas(conteudo, imagens),
  ];

  return { candidates, unmapped: collectUnmapped(pages, candidates) };
}

/**
 * Imagens que um conteudo referencia mas que nao estao na lista de imagens.
 *
 * Acontece com dado estruturado: a foto de um produto declarada em
 * `Product.image` do Schema.org pode nao aparecer como `<img>` na pagina
 * analisada. Sem este complemento o produto entraria sem imagem, porque a
 * gravacao so aponta para arquivo que foi **baixado** -- nunca para o endereco
 * no site antigo.
 */
function imagensReferenciadas(
  conteudo: readonly ImportCandidate[],
  jaListadas: readonly ImageCandidate[],
): ImageCandidate[] {
  const existentes = new Set(jaListadas.map((image) => image.url));
  const extras: ImageCandidate[] = [];

  const registrar = (url: string, label: string, tag: string, evidencia: ImportEvidence): void => {
    if (url === '' || existentes.has(url)) return;
    if (jaListadas.length + extras.length >= IMPORT_LIMITS.maxImages) return;
    if (!/^https?:\/\//i.test(url)) return;
    existentes.add(url);
    extras.push({
      kind: 'imagem',
      target: MEDIA_TARGET,
      label,
      url,
      alt: label,
      tag,
      evidence: evidencia,
    });
  };

  for (const candidate of conteudo) {
    if (candidate.kind === 'colecao_registro' && candidate.imageUrl !== undefined) {
      registrar(candidate.imageUrl, candidate.label, candidate.target, candidate.evidence);
    }
    // O logotipo chega como campo de documento com o endereco da imagem.
    if (candidate.kind === 'documento_campo' && candidate.fieldKey === 'logoImageId') {
      registrar(String(candidate.value ?? ''), 'Logotipo', 'logo', candidate.evidence);
    }
  }

  return extras;
}

/** Chave usada para achar candidato repetido entre analises. */
export function candidateKey(candidate: ImportCandidate): string {
  if (candidate.kind === 'documento_campo') return `${candidate.target}:${candidate.fieldKey}`;
  if (candidate.kind === 'imagem') return `${candidate.target}:${candidate.url}`;
  return `${candidate.target}:${candidate.label.toLowerCase().slice(0, 120)}`;
}

/** Como o candidato aparece na revisao, em uma linha. */
export function candidatePreview(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return normalizeSpace(value).slice(0, 300);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => candidatePreview(item)).filter((text) => text !== '').join(', ').slice(0, 300);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Em registro de colecao, o que identifica e o titulo ou o nome.
    for (const key of ['title', 'name', 'question', 'authorName']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate !== '') return normalizeSpace(candidate).slice(0, 300);
    }
    return Object.entries(record)
      .filter(([key]) => !key.startsWith('__'))
      .map(([key, item]) => `${key}: ${candidatePreview(item)}`)
      .join(' · ')
      .slice(0, 300);
  }
  return '';
}
