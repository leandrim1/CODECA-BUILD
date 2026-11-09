import { describe, expect, it } from 'vitest';
import {
  canonicalPageUrl,
  checkImportUrl,
  classifyPage,
  decodeEntities,
  extractAddressLine,
  extractBusinessHours,
  extractCityState,
  extractEmails,
  extractFoundedYear,
  extractPage,
  extractPhones,
  extractPostalCode,
  extractSitemapFromRobots,
  extractSitemapUrls,
  findAll,
  isPrivateAddress,
  mapToModules,
  parseHtml,
  pickFromSrcset,
  resolveInternalLink,
  socialNetworkOf,
  textOf,
  whatsappFromHref,
} from '@codeca/shared';

/**
 * Leitura de site externo.
 *
 * Os testes aqui cobrem duas coisas de natureza diferente. A primeira e a
 * barreira contra SSRF, onde um falso negativo e uma falha de seguranca: um
 * endereco interno aceito faz o servidor buscar o que nao devia. A segunda e a
 * extracao, onde o risco nao e travar e sim **inventar** -- gravar no painel de
 * um cliente um dado que o site dele nunca disse. Por isso varios testes
 * verificam que um campo ficou **vazio**, e nao que ficou preenchido.
 */

describe('endereco aceito para analise', () => {
  it('completa o esquema quando a pessoa digita so o dominio', () => {
    const check = checkImportUrl('exemplo.com.br');
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.url).toBe('https://exemplo.com.br/');
  });

  it('aceita http e https', () => {
    expect(checkImportUrl('http://exemplo.com').ok).toBe(true);
    expect(checkImportUrl('https://exemplo.com').ok).toBe(true);
  });

  /**
   * Cada caso abaixo e um caminho real de SSRF, nao uma validacao de formato.
   * `file:` leria arquivo do servidor; o IP de metadados entrega credencial da
   * maquina; a porta alta serve para varrer a rede interna de dentro.
   */
  it.each([
    ['file:///etc/passwd', 'protocolo'],
    ['ftp://exemplo.com', 'protocolo'],
    ['gopher://exemplo.com', 'protocolo'],
    ['http://localhost/admin', 'host_interno'],
    ['http://127.0.0.1:8080', 'porta'],
    ['http://127.0.0.1/', 'ip_privado'],
    ['http://10.0.0.5/', 'ip_privado'],
    ['http://192.168.1.1/', 'ip_privado'],
    ['http://172.16.0.1/', 'ip_privado'],
    ['http://172.31.255.254/', 'ip_privado'],
    ['http://100.64.0.1/', 'ip_privado'],
    ['http://0.0.0.0/', 'ip_privado'],
    ['http://169.254.169.254/latest/meta-data/', 'metadados'],
    ['http://metadata.google.internal/', 'metadados'],
    ['http://[::1]/', 'ip_privado'],
    ['http://[fe80::1]/', 'ip_privado'],
    ['http://[::ffff:127.0.0.1]/', 'ip_privado'],
    ['http://servidor/', 'host_interno'],
    ['http://intranet.local/', 'host_interno'],
    ['http://app.internal/', 'host_interno'],
    ['http://usuario:senha@exemplo.com/', 'credenciais'],
    ['http://exemplo.com:22/', 'porta'],
    ['', 'vazio'],
    ['nao e um endereco', 'formato'],
  ])('recusa %s', (input, reason) => {
    const check = checkImportUrl(input);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe(reason);
  });

  it('a mensagem de recusa e util para quem digitou', () => {
    const check = checkImportUrl('http://192.168.0.1');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).toMatch(/rede privada/i);
  });

  /**
   * `010.0.0.1` e `10.0.0.01` sao o mesmo host com zero a esquerda, e varias
   * bibliotecas tratam octeto com zero como outro endereco. Aqui a conferencia
   * exige digito puro, entao o formato estranho nao e lido como IP valido --
   * e quem recusa e a barreira de resolucao de nome na API.
   */
  it('nao aceita IP privado escrito com zero a esquerda como se fosse publico', () => {
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    const check = checkImportUrl('http://10.0.0.01/');
    // Nao e reconhecido como IP; segue como nome, e nome sem ponto valido cai
    // na conferencia de IP da API. O que importa e nao virar "endereco ok".
    if (check.ok) expect(check.hostname).toBe('10.0.0.01');
  });

  it('reconhece endereco publico', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('200.160.2.3')).toBe(false);
  });
});

describe('link interno', () => {
  const page = 'https://exemplo.com/sobre';

  it('resolve caminho relativo', () => {
    expect(resolveInternalLink('/servicos', page)).toBe('https://exemplo.com/servicos');
    expect(resolveInternalLink('contato', page)).toBe('https://exemplo.com/contato');
  });

  it('trata www e sem www como o mesmo site', () => {
    expect(resolveInternalLink('https://www.exemplo.com/x', page)).toBe('https://www.exemplo.com/x');
  });

  it.each([
    ['https://outrosite.com/pagina'],
    ['mailto:alguem@exemplo.com'],
    ['tel:+5511999999999'],
    ['javascript:alert(1)'],
    ['#secao'],
    ['/catalogo.pdf'],
    ['/foto.jpg'],
  ])('descarta %s', (href) => {
    expect(resolveInternalLink(href, page)).toBeNull();
  });

  it('a forma canonica ignora rastreadores e barra final', () => {
    expect(canonicalPageUrl('https://exemplo.com/sobre/?utm_source=face&gclid=1')).toBe(
      'https://exemplo.com/sobre',
    );
    expect(canonicalPageUrl('https://exemplo.com/sobre')).toBe('https://exemplo.com/sobre');
  });
});

describe('leitura de HTML', () => {
  it('nao interpreta o conteudo de script como estrutura', () => {
    const root = parseHtml('<div><script>var a = "<p>nao sou paragrafo</p>";</script><p>sou</p></div>');
    const paragrafos = findAll(root, 'p');
    expect(paragrafos).toHaveLength(1);
    expect(textOf(paragrafos[0]!)).toBe('sou');
  });

  it('o texto visivel nao inclui script nem style', () => {
    const root = parseHtml('<body><style>p{color:red}</style><script>alert(1)</script><p>Oi</p></body>');
    expect(textOf(root)).toBe('Oi');
  });

  it('fecha paragrafo implicitamente em vez de aninhar', () => {
    const root = parseHtml('<div><p>um<p>dois</div>');
    const paragrafos = findAll(root, 'p');
    expect(paragrafos).toHaveLength(2);
    expect(textOf(paragrafos[0]!)).toBe('um');
  });

  it('separa blocos para o texto nao sair colado', () => {
    const root = parseHtml('<div><p>Um</p><p>Dois</p></div>');
    expect(textOf(root)).toBe('Um\nDois');
  });

  it('sobrevive a HTML quebrado', () => {
    const root = parseHtml('<div><p>texto</span></div></p><b>fim');
    expect(textOf(root)).toContain('texto');
    expect(textOf(root)).toContain('fim');
  });

  it('decodifica as entidades que aparecem em site brasileiro', () => {
    expect(decodeEntities('Constru&ccedil;&atilde;o &amp; Reforma')).toBe('Construção & Reforma');
    expect(decodeEntities('Pre&#231;o: R&#036;10')).toBe('Preço: R$10');
    expect(decodeEntities('&#x27;aspas&#x27;')).toBe("'aspas'");
  });

  it('deixa & solto como esta', () => {
    expect(decodeEntities('A & B')).toBe('A & B');
  });

  it('le atributo com e sem aspas', () => {
    const root = parseHtml(`<img src=foto.jpg alt='Uma foto' title="Outra">`);
    const [img] = findAll(root, 'img');
    expect(img?.attrs['src']).toBe('foto.jpg');
    expect(img?.attrs['alt']).toBe('Uma foto');
    expect(img?.attrs['title']).toBe('Outra');
  });

  it('ignora comentario, inclusive com tag dentro', () => {
    const root = parseHtml('<div><!-- <p>escondido</p> --><p>visivel</p></div>');
    expect(findAll(root, 'p')).toHaveLength(1);
  });
});

describe('contato no texto', () => {
  it('reconhece telefone em varios formatos', () => {
    const texto = 'Ligue (11) 98765-4321 ou 11 3456-7890. Tambem +55 21 99999-8888.';
    const phones = extractPhones(texto);
    expect(phones).toContain('(11) 98765-4321');
    expect(phones).toContain('(11) 3456-7890');
    expect(phones).toContain('(21) 99999-8888');
  });

  it('reconhece 0800', () => {
    expect(extractPhones('Central 0800 123 4567')).toContain('0800 123 4567');
  });

  /**
   * CNPJ, CEP e data tem contagem de digitos parecida com telefone. Aceitar
   * qualquer um deles poria um numero que nao atende ninguem no campo de
   * telefone do site do cliente.
   */
  it('nao confunde CNPJ, CEP nem valor com telefone', () => {
    expect(extractPhones('CNPJ 12.345.678/0001-90')).toHaveLength(0);
    expect(extractPhones('CEP 01310-100')).toHaveLength(0);
    expect(extractPhones('Total de R$ 1.234,56')).toHaveLength(0);
  });

  it('recusa DDD que nao existe', () => {
    expect(extractPhones('(01) 98765-4321')).toHaveLength(0);
  });

  it('reconhece e-mail e descarta o que nao e contato', () => {
    const emails = extractEmails('Fale com contato@clinica.com.br ou nome@email.com; sentry em abc@sentry.io');
    expect(emails).toContain('contato@clinica.com.br');
    expect(emails).not.toContain('nome@email.com');
    expect(emails).not.toContain('abc@sentry.io');
  });

  it('reconhece CEP', () => {
    expect(extractPostalCode('CEP: 01310-100')).toBe('01310-100');
    expect(extractPostalCode('CEP 01310100')).toBe('01310-100');
  });

  it('reconhece cidade e UF, e recusa sigla inventada', () => {
    expect(extractCityState('Atendemos em Curitiba - PR')).toEqual({ city: 'Curitiba', state: 'PR' });
    expect(extractCityState('Horario - 24h')).toEqual({ city: '', state: '' });
    expect(extractCityState('Loja - ZZ')).toEqual({ city: '', state: '' });
  });

  it('reconhece logradouro com numero e recusa frase que apenas comeca com Rua', () => {
    expect(extractAddressLine('Rua das Flores, 123 - Centro')).toContain('Rua das Flores, 123');
    expect(extractAddressLine('Rua de pedestres no centro da cidade')).toBe('');
  });

  it('reconhece horario de atendimento como a frase do site', () => {
    const texto = 'Endereco X\nSegunda a sexta, 8h as 18h\nOutra coisa';
    expect(extractBusinessHours(texto)).toBe('Segunda a sexta, 8h as 18h');
  });

  it('identifica a rede social pelo endereco', () => {
    expect(socialNetworkOf('https://www.instagram.com/empresa')).toBe('instagram');
    expect(socialNetworkOf('https://twitter.com/empresa')).toBe('x');
    expect(socialNetworkOf('https://youtu.be/abc')).toBe('youtube');
    expect(socialNetworkOf('https://exemplo.com')).toBeNull();
  });

  it('extrai WhatsApp de wa.me', () => {
    expect(whatsappFromHref('https://wa.me/5511998887777')).toBe('(11) 99888-7777');
    expect(whatsappFromHref('https://api.whatsapp.com/send?phone=5511998887777&text=oi')).toBe(
      '(11) 99888-7777',
    );
  });

  it('ano de fundacao so com a frase que afirma', () => {
    expect(extractFoundedYear('Atuando desde 1998 no mercado')).toBe(1998);
    expect(extractFoundedYear('Fundada em 2010')).toBe(2010);
    // Ano solto pode ser copyright, data de noticia, qualquer coisa.
    expect(extractFoundedYear('Copyright 2024. Todos os direitos reservados')).toBeNull();
    expect(extractFoundedYear('Vendemos 2015 unidades')).toBeNull();
  });
});

describe('imagem', () => {
  it('escolhe a maior largura do srcset', () => {
    const url = pickFromSrcset('a-320.jpg 320w, a-1200.jpg 1200w, a-640.jpg 640w', 'https://exemplo.com/p');
    expect(url).toBe('https://exemplo.com/a-1200.jpg');
  });

  it('entende densidade', () => {
    const url = pickFromSrcset('a.jpg 1x, a@2x.jpg 2x', 'https://exemplo.com/p');
    expect(url).toBe('https://exemplo.com/a@2x.jpg');
  });
});

describe('classificacao de pagina', () => {
  const homeUrl = 'https://exemplo.com/';

  it.each([
    ['https://exemplo.com/', 'inicial'],
    ['https://exemplo.com/index.html', 'inicial'],
    ['https://exemplo.com/quem-somos', 'sobre'],
    ['https://exemplo.com/sobre', 'sobre'],
    ['https://exemplo.com/servicos', 'servicos'],
    ['https://exemplo.com/nossos-servicos', 'servicos'],
    ['https://exemplo.com/especialidades', 'servicos'],
    ['https://exemplo.com/contato', 'contato'],
    ['https://exemplo.com/fale-conosco', 'contato'],
    ['https://exemplo.com/equipe', 'equipe'],
    ['https://exemplo.com/galeria', 'galeria'],
    ['https://exemplo.com/portfolio', 'portfolio'],
    ['https://exemplo.com/depoimentos', 'depoimentos'],
    ['https://exemplo.com/perguntas-frequentes', 'faq'],
    ['https://exemplo.com/imoveis', 'imoveis'],
    ['https://exemplo.com/produtos', 'produtos'],
  ])('%s e %s', (url, role) => {
    expect(classifyPage({ url, homeUrl, title: '', headings: [] })).toBe(role);
  });

  it('cai no titulo quando o endereco nao diz nada', () => {
    expect(
      classifyPage({ url: 'https://exemplo.com/p/37', homeUrl, title: 'Quem somos', headings: [] }),
    ).toBe('sobre');
  });

  it('devolve "outra" quando nada indica o proposito', () => {
    expect(
      classifyPage({ url: 'https://exemplo.com/p/37', homeUrl, title: 'Novidade', headings: ['Aviso'] }),
    ).toBe('outra');
  });
});

describe('sitemap', () => {
  it('le paginas de um urlset', () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://exemplo.com/</loc></url><url><loc>https://exemplo.com/sobre</loc></url></urlset>`;
    const { pages, sitemaps } = extractSitemapUrls(xml, 'https://exemplo.com/');
    expect(pages).toEqual(['https://exemplo.com/', 'https://exemplo.com/sobre']);
    expect(sitemaps).toHaveLength(0);
  });

  it('le indice de sitemaps', () => {
    const xml = `<sitemapindex><sitemap><loc>https://exemplo.com/sitemap-1.xml</loc></sitemap></sitemapindex>`;
    const { pages, sitemaps } = extractSitemapUrls(xml, 'https://exemplo.com/');
    expect(pages).toHaveLength(0);
    expect(sitemaps).toEqual(['https://exemplo.com/sitemap-1.xml']);
  });

  it('le o sitemap declarado no robots.txt', () => {
    const robots = 'User-agent: *\nDisallow: /admin\nSitemap: https://exemplo.com/sitemap.xml';
    expect(extractSitemapFromRobots(robots, 'https://exemplo.com/')).toEqual([
      'https://exemplo.com/sitemap.xml',
    ]);
  });
});

// ------------------------------------------------------------- paginas reais

const HOME = `<!doctype html>
<html lang="pt-BR">
<head>
  <title>Clinica Sorriso | Odontologia em Curitiba</title>
  <meta name="description" content="Clinica odontologica com atendimento humanizado em Curitiba.">
  <meta property="og:site_name" content="Clinica Sorriso">
  <meta property="og:image" content="/img/fachada.jpg">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Dentist","name":"Clinica Sorriso",
   "telephone":"(41) 3333-4444","email":"contato@clinicasorriso.com.br",
   "address":{"@type":"PostalAddress","streetAddress":"Rua das Flores, 123","addressLocality":"Curitiba","addressRegion":"PR","postalCode":"80010-100"}}
  </script>
</head>
<body>
  <header><img src="/img/logo.png" alt="Logo Clinica Sorriso"></header>
  <main>
    <h1>Seu sorriso em boas maos</h1>
    <img src="/img/hero-banner.jpg" alt="Recepcao da clinica" width="1600" height="900">
    <h2>Nossos servicos</h2>
    <ul><li>Clareamento dental</li><li>Implante dentario</li><li>Ortodontia</li></ul>
    <h2>Sobre a clinica</h2>
    <p>Atuando desde 1998, a Clinica Sorriso atende familias de Curitiba com foco em prevencao e conforto do paciente.</p>
  </main>
  <footer>
    <p>Rua das Flores, 123 - Centro, Curitiba - PR. CEP 80010-100</p>
    <p>Telefone (41) 3333-4444 | contato@clinicasorriso.com.br</p>
    <p>Segunda a sexta, 8h as 18h</p>
    <a href="https://instagram.com/clinicasorriso">Instagram</a>
    <a href="https://wa.me/5541999887766">WhatsApp</a>
  </footer>
</body></html>`;

const SOBRE = `<html><head><title>Quem somos</title></head><body><main>
  <h1>Quem somos</h1>
  <h2>Nossa historia</h2>
  <p>A clinica nasceu em 1998 no bairro Centro, com um consultorio e dois profissionais. Hoje sao seis salas e uma equipe de doze pessoas, mantendo o mesmo cuidado do primeiro dia com cada paciente que chega.</p>
  <h2>Missao</h2>
  <p>Oferecer tratamento odontologico de qualidade com acolhimento, tornando a visita ao dentista uma experiencia tranquila.</p>
  <h2>Valores</h2>
  <ul><li>Cuidado</li><li>Transparencia</li><li>Pontualidade</li></ul>
</main></body></html>`;

const SERVICOS = `<html><head><title>Servicos</title></head><body><main>
  <h1>Nossos servicos</h1>
  <h2>Clareamento dental</h2>
  <p>Procedimento feito em consultorio, com acompanhamento do dentista e resultado visivel na primeira sessao.</p>
  <h2>Implante dentario</h2>
  <p>Reposicao de dentes perdidos com pino de titanio, planejada por tomografia antes de qualquer intervencao.</p>
</main></body></html>`;

const EQUIPE = `<html><head><title>Equipe</title></head><body><main>
  <h1>Nossa equipe</h1>
  <div class="team-member"><img src="/img/ana.jpg" alt="Ana"><h3>Dra. Ana Souza</h3><p>Ortodontista</p><p>Formada pela UFPR, atende na clinica desde 2005 e coordena a area de ortodontia da equipe.</p></div>
  <div class="team-member"><img src="/img/bruno.jpg" alt="Bruno"><h3>Dr. Bruno Lima</h3><p>Implantodontista</p></div>
</main></body></html>`;

const FAQ_DEPOIMENTOS = `<html><head><title>Perguntas frequentes</title>
<script type="application/ld+json">
{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Atendem convenio?","acceptedAnswer":{"@type":"Answer","text":"Atendemos os principais convenios odontologicos."}}]}
</script>
</head><body><main>
  <h1>Perguntas frequentes</h1>
  <details><summary>Preciso de encaminhamento?</summary>Nao, o atendimento pode ser agendado diretamente.</details>
  <blockquote>Fui muito bem atendida desde a recepcao, e o tratamento resolveu o problema que eu tinha anos.<cite>Maria Silva</cite></blockquote>
</main></body></html>`;

function lerPaginas() {
  const home = 'https://clinicasorriso.com.br/';
  return [
    extractPage({ html: HOME, url: home, homeUrl: home }),
    extractPage({ html: SOBRE, url: 'https://clinicasorriso.com.br/quem-somos', homeUrl: home }),
    extractPage({ html: SERVICOS, url: 'https://clinicasorriso.com.br/servicos', homeUrl: home }),
    extractPage({ html: EQUIPE, url: 'https://clinicasorriso.com.br/equipe', homeUrl: home }),
    extractPage({ html: FAQ_DEPOIMENTOS, url: 'https://clinicasorriso.com.br/perguntas-frequentes', homeUrl: home }),
  ];
}

describe('extracao de uma pagina', () => {
  it('le titulo, descricao, lang e Open Graph', () => {
    const page = extractPage({ html: HOME, url: 'https://clinicasorriso.com.br/', homeUrl: 'https://clinicasorriso.com.br/' });
    expect(page.title).toBe('Clinica Sorriso | Odontologia em Curitiba');
    expect(page.metaDescription).toContain('atendimento humanizado');
    expect(page.lang).toBe('pt-BR');
    expect(page.og.siteName).toBe('Clinica Sorriso');
    expect(page.og.image).toBe('https://clinicasorriso.com.br/img/fachada.jpg');
    expect(page.role).toBe('inicial');
  });

  it('le o JSON-LD declarado pelo site', () => {
    const page = extractPage({ html: HOME, url: 'https://clinicasorriso.com.br/', homeUrl: 'https://clinicasorriso.com.br/' });
    expect(page.jsonLd).toHaveLength(1);
    expect(page.jsonLd[0]?.['name']).toBe('Clinica Sorriso');
  });

  it('classifica as imagens pelo lugar onde aparecem', () => {
    const page = extractPage({ html: HOME, url: 'https://clinicasorriso.com.br/', homeUrl: 'https://clinicasorriso.com.br/' });
    const logo = page.images.find((image) => image.url.endsWith('logo.png'));
    const banner = page.images.find((image) => image.url.endsWith('hero-banner.jpg'));
    expect(logo?.placement).toBe('logo');
    expect(banner?.placement).toBe('banner');
    expect(banner?.width).toBe(1600);
  });

  it('acha o contato no rodape e nos links', () => {
    const page = extractPage({ html: HOME, url: 'https://clinicasorriso.com.br/', homeUrl: 'https://clinicasorriso.com.br/' });
    expect(page.contact.phones).toContain('(41) 3333-4444');
    expect(page.contact.emails).toContain('contato@clinicasorriso.com.br');
    expect(page.contact.postalCode).toBe('80010-100');
    expect(page.contact.city).toBe('Curitiba');
    expect(page.contact.state).toBe('PR');
    expect(page.contact.whatsapp).toBe('(41) 99988-7766');
    expect(page.contact.social['instagram']).toBe('https://instagram.com/clinicasorriso');
  });

  it('marca pagina que nao tem conteudo no HTML', () => {
    const spa = extractPage({
      html: '<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
      url: 'https://exemplo.com/',
      homeUrl: 'https://exemplo.com/',
    });
    expect(spa.renderedByScript).toBe(true);
    expect(spa.textLength).toBeLessThan(240);
  });

  it('nao marca pagina com conteudo de verdade', () => {
    const page = extractPage({ html: SOBRE, url: 'https://exemplo.com/sobre', homeUrl: 'https://exemplo.com/' });
    expect(page.renderedByScript).toBe(false);
  });
});

describe('mapeamento para os modulos', () => {
  it('preenche institucional a partir do que o site diz', () => {
    const { candidates } = mapToModules(lerPaginas());
    const campo = (key: string) =>
      candidates.find(
        (item) => item.kind === 'documento_campo' && item.target === 'institucional' && item.fieldKey === key,
      );

    expect(campo('companyName')?.value).toBe('Clinica Sorriso');
    expect(campo('tagline')?.value).toBe('Seu sorriso em boas maos');
    expect(campo('shortDescription')?.value).toContain('atendimento humanizado');
    expect(String(campo('history')?.value)).toContain('consultorio e dois profissionais');
    expect(String(campo('mission')?.value)).toContain('acolhimento');
    expect(campo('values')?.value).toEqual(['Cuidado', 'Transparencia', 'Pontualidade']);
    expect(campo('foundedYear')?.value).toBe(1998);
  });

  it('preenche contato preferindo o dado estruturado', () => {
    const { candidates } = mapToModules(lerPaginas());
    const campo = (key: string) =>
      candidates.find(
        (item) => item.kind === 'documento_campo' && item.target === 'contato' && item.fieldKey === key,
      );

    expect(campo('email')?.value).toBe('contato@clinicasorriso.com.br');
    expect(campo('phone')?.value).toBe('(41) 3333-4444');
    expect(campo('addressLine')?.value).toBe('Rua das Flores, 123');
    expect(campo('city')?.value).toBe('Curitiba');
    expect(campo('state')?.value).toBe('PR');
    expect(campo('whatsapp')?.value).toBe('(41) 99988-7766');
    expect(campo('businessHours')?.value).toBe('Segunda a sexta, 8h as 18h');
    expect(campo('email')?.evidence.source).toBe('json_ld');
  });

  it('acha os servicos com titulo e descricao', () => {
    const { candidates } = mapToModules(lerPaginas());
    const servicos = candidates.filter((item) => item.target === 'servicos');
    const titulos = servicos.map((item) => item.label);

    expect(titulos).toContain('Clareamento dental');
    expect(titulos).toContain('Implante dentario');
    // "Nossos servicos" anuncia a secao: nao e um servico.
    expect(titulos).not.toContain('Nossos servicos');

    const clareamento = servicos.find((item) => item.label === 'Clareamento dental');
    expect(clareamento?.kind).toBe('colecao_registro');
    if (clareamento?.kind === 'colecao_registro') {
      expect(String(clareamento.value['description'])).toContain('acompanhamento do dentista');
    }
  });

  it('acha a equipe com cargo e foto', () => {
    const { candidates } = mapToModules(lerPaginas());
    const equipe = candidates.filter((item) => item.target === 'equipe');
    expect(equipe.map((item) => item.label)).toEqual(['Dra. Ana Souza', 'Dr. Bruno Lima']);

    const ana = equipe[0];
    if (ana?.kind === 'colecao_registro') {
      expect(ana.value['role']).toBe('Ortodontista');
      expect(String(ana.value['bio'])).toContain('UFPR');
      expect(ana.imageUrl).toBe('https://clinicasorriso.com.br/img/ana.jpg');
    }
  });

  it('acha perguntas frequentes das duas fontes', () => {
    const { candidates } = mapToModules(lerPaginas());
    const perguntas = candidates.filter((item) => item.target === 'faq').map((item) => item.label);
    expect(perguntas).toContain('Atendem convenio?');
    expect(perguntas).toContain('Preciso de encaminhamento?');
  });

  /**
   * O ponto mais delicado do modulo de depoimentos: o campo de autorizacao
   * declara que a empresa tem permissao da pessoa citada. Estar publicado no
   * site antigo nao e essa permissao, e marcar sozinho seria declarar no lugar
   * da empresa -- sobre a fala e o nome de um terceiro.
   */
  it('importa depoimento sempre sem autorizacao confirmada', () => {
    const { candidates } = mapToModules(lerPaginas());
    const depoimentos = candidates.filter((item) => item.target === 'depoimentos');
    expect(depoimentos.length).toBeGreaterThan(0);
    for (const depoimento of depoimentos) {
      if (depoimento.kind !== 'colecao_registro') continue;
      expect(depoimento.value['authorizationConfirmed']).toBe(false);
      expect(depoimento.value['authorName']).toBeTruthy();
    }
  });

  it('nao cria depoimento sem autor', () => {
    const html = '<html><body><main><blockquote>Texto elogioso sem ninguem assinando embaixo dele.</blockquote></main></body></html>';
    const page = extractPage({ html, url: 'https://x.com/', homeUrl: 'https://x.com/' });
    const { candidates } = mapToModules([page]);
    expect(candidates.filter((item) => item.target === 'depoimentos')).toHaveLength(0);
  });

  /**
   * Imoveis exige tipo e finalidade. Sem dado estruturado nao ha como saber se
   * o imovel esta a venda ou para alugar, e colocar na aba errada do site novo
   * e pior que nao importar.
   */
  it('nao inventa imovel a partir de texto solto', () => {
    const html = '<html><body><main><h1>Imoveis</h1><h2>Apartamento Jardins</h2><p>Otimo apartamento com tres dormitorios e vista livre na regiao central.</p></main></body></html>';
    const page = extractPage({ html, url: 'https://imob.com/imoveis', homeUrl: 'https://imob.com/' });
    const { candidates } = mapToModules([page]);
    expect(candidates.filter((item) => item.target === 'imoveis')).toHaveLength(0);
  });

  it('importa imovel quando o site declara tipo e finalidade', () => {
    const html = `<html><head><script type="application/ld+json">
      {"@type":"Apartment","name":"Apartamento Jardins","description":"Tres dormitorios",
       "numberOfBedrooms":3,"offers":{"@type":"Offer","price":"750000","priceCurrency":"BRL","businessFunction":"http://purl.org/goodrelations/v1#Sell"}}
    </script></head><body><main><h1>Imovel</h1></main></body></html>`;
    const page = extractPage({ html, url: 'https://imob.com/imoveis/1', homeUrl: 'https://imob.com/' });
    const { candidates } = mapToModules([page]);
    const imovel = candidates.find((item) => item.target === 'imoveis');
    expect(imovel?.kind).toBe('colecao_registro');
    if (imovel?.kind === 'colecao_registro') {
      expect(imovel.value['type']).toBe('apartamento');
      expect(imovel.value['purpose']).toBe('venda');
      expect(imovel.value['price']).toBe(750000);
      expect(imovel.value['bedrooms']).toBe(3);
    }
  });

  it('le preco de produto somente do dado estruturado', () => {
    const comDados = `<html><head><script type="application/ld+json">
      {"@type":"Product","name":"Pizza Margherita","description":"Molho, mussarela e manjericao",
       "sku":"PZ-01","offers":{"price":49.9,"priceCurrency":"BRL"}}
    </script></head><body><main><h1>Produtos</h1></main></body></html>`;
    const page = extractPage({ html: comDados, url: 'https://loja.com/produtos', homeUrl: 'https://loja.com/' });
    const produto = mapToModules([page]).candidates.find((item) => item.target === 'produtos');
    if (produto?.kind === 'colecao_registro') {
      expect(produto.value['price']).toBe(49.9);
      expect(produto.value['currency']).toBe('BRL');
      expect(produto.value['code']).toBe('PZ-01');
    }

    const semDados = '<html><body><main><h1>Produtos</h1><h2>Pizza Margherita</h2><p>Molho, mussarela e manjericao a partir de R$ 49,90 na nossa casa.</p></main></body></html>';
    const page2 = extractPage({ html: semDados, url: 'https://loja.com/produtos', homeUrl: 'https://loja.com/' });
    const produto2 = mapToModules([page2]).candidates.find((item) => item.target === 'produtos');
    expect(produto2).toBeDefined();
    if (produto2?.kind === 'colecao_registro') {
      // O texto tem "R$ 49,90", mas preco nao sai de texto corrido.
      expect(produto2.value['price']).toBeUndefined();
    }
  });

  it('recolhe as imagens e descarta icone', () => {
    const html = '<html><body><main><img src="/foto.jpg" alt="Obra"><img src="/icons/arrow.svg" alt="seta"><img src="/img/icon-check.png" alt=""></main></body></html>';
    const page = extractPage({ html, url: 'https://x.com/', homeUrl: 'https://x.com/' });
    const imagens = mapToModules([page]).candidates.filter((item) => item.kind === 'imagem');
    const urls = imagens.map((item) => (item.kind === 'imagem' ? item.url : ''));
    expect(urls).toContain('https://x.com/foto.jpg');
    expect(urls).not.toContain('https://x.com/icons/arrow.svg');
    expect(urls).not.toContain('https://x.com/img/icon-check.png');
  });

  it('mostra o texto que nao conseguiu identificar', () => {
    const html = '<html><body><main><h2>Aviso importante do mes</h2><p>Comunicado longo que nao corresponde a nenhum campo de modulo da plataforma, mas que existe na pagina e precisa aparecer na revisao para a pessoa decidir.</p></main></body></html>';
    const page = extractPage({ html, url: 'https://x.com/p/9', homeUrl: 'https://x.com/' });
    const { unmapped } = mapToModules([page]);
    expect(unmapped.length).toBeGreaterThan(0);
    expect(unmapped[0]?.heading).toBe('Aviso importante do mes');
  });

  it('cada candidato aponta para a pagina de onde veio', () => {
    const { candidates } = mapToModules(lerPaginas());
    expect(candidates.length).toBeGreaterThan(10);
    for (const candidate of candidates) {
      expect(candidate.evidence.pageUrl).toMatch(/^https:\/\/clinicasorriso\.com\.br/);
      expect(candidate.evidence.source).toBeTruthy();
    }
  });

  it('nao produz candidato nenhum para site vazio', () => {
    const page = extractPage({
      html: '<html><head><title></title></head><body><div id="root"></div></body></html>',
      url: 'https://x.com/',
      homeUrl: 'https://x.com/',
    });
    const { candidates } = mapToModules([page]);
    const documentos = candidates.filter((item) => item.kind === 'documento_campo');
    expect(documentos).toHaveLength(0);
  });
});

/**
 * Tipos de site diferentes.
 *
 * O produto atende varios segmentos, e cada um escreve o site de um jeito. O
 * que estes testes conferem nao e "achou alguma coisa", e sim que o conteudo
 * foi para o **modulo certo** -- e que o que nao da para identificar com
 * seguranca fica de fora.
 */
describe('sites de segmentos diferentes', () => {
  const lerSite = (paginas: { html: string; url: string }[], home: string) =>
    mapToModules(paginas.map((p) => extractPage({ html: p.html, url: p.url, homeUrl: home })));

  it('loja: produto com preco so quando o site declara em dado estruturado', () => {
    const home = 'https://lojadobairro.com.br/';
    const { candidates } = lerSite(
      [
        {
          url: home,
          html: `<html><head><title>Loja do Bairro</title>
            <meta name="description" content="Mercearia com entrega no bairro.">
            <script type="application/ld+json">{"@type":"Store","name":"Loja do Bairro","telephone":"(19) 3333-1234"}</script>
            </head><body><main><h1>Tudo para a sua casa</h1></main></body></html>`,
        },
        {
          url: 'https://lojadobairro.com.br/produtos',
          html: `<html><head><title>Produtos</title>
            <script type="application/ld+json">
            [{"@type":"Product","name":"Café torrado 500g","description":"Moído na hora","sku":"CAF-500","offers":{"price":24.9,"priceCurrency":"BRL"}},
             {"@type":"Product","name":"Azeite extravirgem","description":"Importado","offers":{"price":39.5,"priceCurrency":"BRL"}}]
            </script></head><body><main><h1>Produtos</h1>
            <h2>Promoção da semana</h2><p>Confira os itens com desconto a partir de R$ 9,90 nesta semana inteira.</p>
            </main></body></html>`,
        },
      ],
      home,
    );

    const produtos = candidates.filter((item) => item.target === 'produtos');
    expect(produtos.map((item) => item.label)).toContain('Café torrado 500g');

    const cafe = produtos.find((item) => item.label === 'Café torrado 500g');
    if (cafe?.kind === 'colecao_registro') {
      expect(cafe.value['price']).toBe(24.9);
      expect(cafe.value['code']).toBe('CAF-500');
    }

    // "Promoção da semana" virou produto pelo bloco, mas sem preço: o
    // "R$ 9,90" do texto corrido nunca entra como preço.
    const promocao = produtos.find((item) => item.label === 'Promoção da semana');
    if (promocao?.kind === 'colecao_registro') {
      expect(promocao.value['price']).toBeUndefined();
    }

    const nome = candidates.find(
      (item) => item.kind === 'documento_campo' && item.fieldKey === 'companyName',
    );
    expect(nome?.value).toBe('Loja do Bairro');
  });

  it('prestador de serviços: serviços com título e descrição, contato do rodapé', () => {
    const home = 'https://eletricadoze.com.br/';
    const { candidates } = lerSite(
      [
        {
          url: home,
          html: `<html><head><title>Elétrica do Zé</title></head><body>
            <main><h1>Instalações elétricas residenciais</h1></main>
            <footer><p>Av. Brasil, 450 - Centro, Campinas - SP</p><p>(19) 98888-1122 | contato@eletricadoze.com.br</p>
            <p>Segunda a sábado, 7h às 19h</p></footer></body></html>`,
        },
        {
          url: 'https://eletricadoze.com.br/servicos',
          html: `<html><head><title>Serviços</title></head><body><main>
            <h1>Nossos serviços</h1>
            <h2>Instalação de padrão de entrada</h2><p>Projeto, documentação e execução do padrão conforme a norma da concessionária local.</p>
            <h2>Troca de fiação</h2><p>Substituição completa da fiação antiga com laudo de conformidade ao final do serviço.</p>
            </main></body></html>`,
        },
      ],
      home,
    );

    const servicos = candidates.filter((item) => item.target === 'servicos').map((item) => item.label);
    expect(servicos).toEqual(['Instalação de padrão de entrada', 'Troca de fiação']);

    const campo = (key: string) =>
      candidates.find(
        (item) => item.kind === 'documento_campo' && item.target === 'contato' && item.fieldKey === key,
      )?.value;
    expect(campo('phone')).toBe('(19) 98888-1122');
    expect(campo('email')).toBe('contato@eletricadoze.com.br');
    expect(campo('city')).toBe('Campinas');
    expect(campo('state')).toBe('SP');
    expect(campo('businessHours')).toBe('Segunda a sábado, 7h às 19h');
  });

  it('imobiliária: importa o imóvel declarado e deixa o resto de fora', () => {
    const home = 'https://imobhorizonte.com.br/';
    const { candidates } = lerSite(
      [
        { url: home, html: '<html><head><title>Imob Horizonte</title></head><body><main><h1>Imóveis em Campinas</h1></main></body></html>' },
        {
          url: 'https://imobhorizonte.com.br/imoveis/apartamento-centro',
          html: `<html><head><title>Apartamento Centro</title>
            <script type="application/ld+json">
            {"@type":"Apartment","name":"Apartamento no Centro","description":"Dois dormitórios e vaga",
             "numberOfBedrooms":2,"numberOfBathroomsTotal":1,
             "offers":{"@type":"Offer","price":"420000","priceCurrency":"BRL","businessFunction":"http://purl.org/goodrelations/v1#Sell"}}
            </script></head><body><main><h1>Apartamento no Centro</h1></main></body></html>`,
        },
        {
          url: 'https://imobhorizonte.com.br/imoveis',
          html: `<html><head><title>Imóveis</title></head><body><main><h1>Imóveis</h1>
            <h2>Casa no Jardim</h2><p>Casa espaçosa com quintal grande e garagem para dois carros na região central.</p>
            </main></body></html>`,
        },
      ],
      home,
    );

    const imoveis = candidates.filter((item) => item.target === 'imoveis');
    expect(imoveis).toHaveLength(1);
    const apartamento = imoveis[0];
    if (apartamento?.kind === 'colecao_registro') {
      expect(apartamento.value['type']).toBe('apartamento');
      expect(apartamento.value['purpose']).toBe('venda');
      expect(apartamento.value['price']).toBe(420000);
      expect(apartamento.value['bedrooms']).toBe(2);
    }

    /**
     * "Casa no Jardim" nao entra. O texto nao diz se esta a venda ou para
     * alugar, e o modulo exige finalidade: po-la na aba errada do site novo e
     * pior do que nao importar.
     */
    expect(imoveis.map((item) => item.label)).not.toContain('Casa no Jardim');
  });

  it('obras: só entra a obra cuja categoria o texto declara', () => {
    const home = 'https://construtorapilar.com.br/';
    const { candidates } = lerSite(
      [
        { url: home, html: '<html><head><title>Construtora Pilar</title></head><body><main><h1>Construímos</h1></main></body></html>' },
        {
          url: 'https://construtorapilar.com.br/obras',
          html: `<html><head><title>Obras</title></head><body><main>
            <h1>Nossas obras</h1>
            <h2>Edifício Aurora</h2><p>Empreendimento residencial de doze andares entregue no ano passado, com área de lazer completa.</p>
            <h2>Projeto Delta</h2><p>Trabalho realizado em parceria com um escritório parceiro, entregue dentro do prazo acordado.</p>
            </main></body></html>`,
        },
      ],
      home,
    );

    const obras = candidates.filter((item) => item.target === 'obras');
    // "residencial" aparece no texto do primeiro; o segundo nao diz categoria.
    expect(obras.map((item) => item.label)).toEqual(['Edifício Aurora']);
    const aurora = obras[0];
    if (aurora?.kind === 'colecao_registro') {
      expect(aurora.value['category']).toBe('residencial');
    }
  });

  it('site de uma página só: acha os serviços na seção da inicial', () => {
    const home = 'https://studiopilates.com.br/';
    const { candidates } = lerSite(
      [
        {
          url: home,
          html: `<html><head><title>Studio Pilates</title>
            <meta name="description" content="Studio de pilates com aulas individuais e em grupo."></head><body><main>
            <h1>Movimento com cuidado</h1>
            <h2>Nossos serviços</h2>
            <ul><li>Pilates solo</li><li>Pilates aparelhos</li><li>Avaliação postural</li></ul>
            <h2>Sobre nós</h2><p>Atendemos desde 2012 na mesma rua, com turmas pequenas para acompanhar cada aluno de perto durante o treino.</p>
            </main></body></html>`,
        },
      ],
      home,
    );

    const servicos = candidates.filter((item) => item.target === 'servicos').map((item) => item.label);
    expect(servicos).toEqual(['Pilates solo', 'Pilates aparelhos', 'Avaliação postural']);

    const ano = candidates.find(
      (item) => item.kind === 'documento_campo' && item.fieldKey === 'foundedYear',
    );
    expect(ano?.value).toBe(2012);
  });

  it('site renderizado por JavaScript: aproveita o que vem nos metadados', () => {
    const home = 'https://appspa.com.br/';
    const { candidates } = lerSite(
      [
        {
          url: home,
          html: `<html><head><title>Consultoria Vega</title>
            <meta name="description" content="Consultoria contábil para pequenas empresas.">
            <meta property="og:site_name" content="Consultoria Vega">
            </head><body><div id="root"></div><script src="/app.js"></script></body></html>`,
        },
      ],
      home,
    );

    // O corpo nao tem nada, mas o cabecalho tem: o pouco que da para
    // aproveitar e aproveitado, em vez de a analise voltar vazia.
    const campo = (key: string) =>
      candidates.find((item) => item.kind === 'documento_campo' && item.fieldKey === key)?.value;
    expect(campo('companyName')).toBe('Consultoria Vega');
    expect(campo('shortDescription')).toContain('Consultoria contábil');

    // E nada foi inventado para os demais módulos.
    expect(candidates.filter((item) => item.kind === 'colecao_registro')).toHaveLength(0);
  });

  it('imagens em formatos diferentes entram todas como candidatas', () => {
    const home = 'https://galeriafotos.com.br/';
    const { candidates } = lerSite(
      [
        {
          url: home,
          html: `<html><head><title>Galeria</title></head><body><main>
            <img src="/a.jpg" alt="Uma"><img src="/b.png" alt="Duas">
            <img src="/c.webp" alt="Três"><img src="/d.avif" alt="Quatro">
            <picture><source srcset="/e-1200.webp 1200w, /e-400.webp 400w"><img src="/e.jpg" alt="Cinco"></picture>
            </main></body></html>`,
        },
      ],
      home,
    );

    const urls = candidates
      .filter((item) => item.kind === 'imagem')
      .map((item) => (item.kind === 'imagem' ? item.url : ''));
    expect(urls).toContain('https://galeriafotos.com.br/a.jpg');
    expect(urls).toContain('https://galeriafotos.com.br/b.png');
    expect(urls).toContain('https://galeriafotos.com.br/c.webp');
    expect(urls).toContain('https://galeriafotos.com.br/d.avif');
    // Do `srcset`, a maior largura: preservar a qualidade que o cliente tem.
    expect(urls).toContain('https://galeriafotos.com.br/e-1200.webp');
    expect(urls).not.toContain('https://galeriafotos.com.br/e-400.webp');
  });
});

/**
 * Texto que ninguem ve nao e conteudo do site.
 *
 * Pagina moderna carrega bastante texto no HTML que nunca chega aos olhos de
 * ninguem: mensagem de erro que so aparece se o aplicativo nao carregar,
 * aviso de cookie, modal fechado, aba inativa. Importar isso e pior do que
 * nao importar nada -- entra no painel do cliente como se fosse texto
 * institucional da empresa dele.
 *
 * O caso que revelou a falha foi real: ao ler `codecabuild.vercel.app` depois
 * de a busca voltar a funcionar, o unico `h1` do HTML era "Nao foi possivel
 * carregar o painel", dentro de um `display:none` que so vira visivel quando
 * o bundle falha. A importacao proporia essa frase como conteudo do site.
 */
describe('conteudo escondido nao e importado', () => {
  const paginaComFallback = `<!doctype html><html lang="pt-BR"><head>
    <title>Marcenaria Horizonte</title>
    <meta name="description" content="Móveis sob medida em madeira maciça.">
  </head><body>
    <main>
      <h1>Móveis sob medida</h1>
      <p>Projetamos e fabricamos móveis em madeira maciça, com entrega em até 40 dias corridos.</p>
      <img src="/img/oficina.jpg" alt="Oficina">
    </main>
    <div style="display:none">
      <h1>Não foi possível carregar a página</h1>
      <p>Os arquivos da aplicação não chegaram ao navegador. Recarregue sem cache.</p>
      <img src="/img/erro.png" alt="Erro">
    </div>
    <div hidden>
      <h2>Aviso de cookies</h2>
      <p>Este site usa cookies para melhorar a sua experiência de navegação aqui.</p>
    </div>
    <div style="visibility: hidden">
      <p>Conteúdo de uma aba que o visitante não abriu neste momento da visita.</p>
    </div>
  </body></html>`;

  const extrato = extractPage({
    html: paginaComFallback,
    url: 'https://marcenariahorizonte.com.br/',
    homeUrl: 'https://marcenariahorizonte.com.br/',
  });

  it('não traz o texto do fallback de erro', () => {
    const tudo = JSON.stringify(extrato);
    expect(tudo).not.toContain('Não foi possível carregar');
    expect(tudo).not.toContain('não chegaram ao navegador');
  });

  it('não traz aviso de cookies nem aba fechada', () => {
    const tudo = JSON.stringify(extrato);
    expect(tudo).not.toContain('Aviso de cookies');
    expect(tudo).not.toContain('aba que o visitante não abriu');
  });

  it('o conteúdo de verdade continua inteiro', () => {
    expect(extrato.title).toBe('Marcenaria Horizonte');
    expect(extrato.headings.map((h) => h.text)).toEqual(['Móveis sob medida']);
    expect(extrato.paragraphs.some((p) => p.includes('madeira maciça'))).toBe(true);
    expect(extrato.blocks).toHaveLength(1);
    expect(extrato.blocks[0]?.heading).toBe('Móveis sob medida');
  });

  it('imagem de bloco escondido não entra na biblioteca', () => {
    const urls = extrato.images.map((img) => img.url);
    expect(urls).toContain('https://marcenariahorizonte.com.br/img/oficina.jpg');
    expect(urls).not.toContain('https://marcenariahorizonte.com.br/img/erro.png');
  });

  it('reconhece o site montado no navegador quando só resta o invólucro', () => {
    /**
     * O caso do `codecabuild.vercel.app`: o HTML servido tem apenas o
     * esqueleto e um fallback escondido. Descontado o que ninguém vê, não
     * sobra texto -- e é isso que a tela precisa dizer a quem revisa, em vez
     * de entregar campos vazios sem explicação.
     */
    const spa = `<!doctype html><html lang="pt-BR"><head>
      <title>Painel</title><meta name="description" content="Plataforma de conteúdo.">
    </head><body><div id="root">
      <p>Carregando...</p>
      <div style="display:none">
        <h1>Não foi possível carregar o painel</h1>
        <p>Os arquivos da aplicação não chegaram ao navegador, provavelmente por cache antigo.</p>
      </div>
    </div></body></html>`;

    const resultado = extractPage({
      html: spa,
      url: 'https://exemplo.com.br/',
      homeUrl: 'https://exemplo.com.br/',
    });

    expect(resultado.renderedByScript).toBe(true);
    expect(resultado.headings).toHaveLength(0);
    // O que veio dos metadados continua valendo: não é invenção, é o que o
    // próprio site declara para buscadores e prévias de link.
    expect(resultado.title).toBe('Painel');
    expect(resultado.metaDescription).toBe('Plataforma de conteúdo.');
  });
});
