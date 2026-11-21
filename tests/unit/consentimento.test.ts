// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConsentManager,
  CONSENT_CATEGORIES,
  liberarMarcados,
  limparCookiesDe,
  aplicarConsentimento,
  pontearConsentModeDoGoogle,
  ATRIBUTO_CATEGORIA,
  ATRIBUTO_SRC,
  carregarConfiguracaoDeCookies,
  iniciarConsentimento,
} from '@codeca/sdk/consent';

/**
 * O que estes testes protegem.
 *
 * Um banner de cookies erra em silencio: a tela fica bonita, a escolha e
 * guardada, e o rastreador carrega do mesmo jeito. Nenhum usuario reclama,
 * porque ninguem ve. Entao o que se verifica aqui nao e a aparencia -- e se
 * o que nao foi autorizado realmente NAO entra na pagina.
 */

const POLITICA = '2026-11-21';

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('estado inicial', () => {
  it('nada opcional comeca ligado', () => {
    const m = createConsentManager({ policyVersion: POLITICA });
    expect(m.decidiu()).toBe(false);
    expect(m.permite('necessarios')).toBe(true);
    expect(m.permite('preferencias')).toBe(false);
    expect(m.permite('estatisticas')).toBe(false);
    expect(m.permite('marketing')).toBe(false);
  });

  it('so `necessarios` e obrigatoria', () => {
    const obrigatorias = CONSENT_CATEGORIES.filter((c) => c.obrigatoria).map((c) => c.id);
    expect(obrigatorias).toEqual(['necessarios']);
  });
});

describe('decisao e persistencia', () => {
  it('aceitar tudo libera as quatro', () => {
    const m = createConsentManager({ policyVersion: POLITICA });
    m.aceitarTudo();
    expect(m.permite('estatisticas')).toBe(true);
    expect(m.permite('marketing')).toBe(true);
  });

  it('recusar opcionais mantem so o necessario', () => {
    const m = createConsentManager({ policyVersion: POLITICA });
    m.recusarOpcionais();
    expect(m.decidiu()).toBe(true);
    expect(m.permite('necessarios')).toBe(true);
    expect(m.permite('estatisticas')).toBe(false);
  });

  it('a escolha sobrevive a recarga', () => {
    createConsentManager({ policyVersion: POLITICA }).salvar({ estatisticas: true });
    const depois = createConsentManager({ policyVersion: POLITICA });
    expect(depois.decidiu()).toBe(true);
    expect(depois.permite('estatisticas')).toBe(true);
    expect(depois.permite('marketing')).toBe(false);
  });

  it('`necessarios` nao pode ser desligado nem passando false', () => {
    const m = createConsentManager({ policyVersion: POLITICA });
    m.salvar({ necessarios: false, estatisticas: true } as never);
    expect(m.permite('necessarios')).toBe(true);
  });

  it('politica nova invalida a escolha antiga', () => {
    // Um "sim" dado a outro texto nao vale como "sim" a este.
    createConsentManager({ policyVersion: '2026-01-01' }).aceitarTudo();
    const comPoliticaNova = createConsentManager({ policyVersion: '2026-11-21' });
    expect(comPoliticaNova.decidiu()).toBe(false);
    expect(comPoliticaNova.permite('estatisticas')).toBe(false);
  });

  it('revogar volta ao estado inicial', () => {
    const m = createConsentManager({ policyVersion: POLITICA });
    m.aceitarTudo();
    m.revogar();
    expect(m.decidiu()).toBe(false);
    expect(m.permite('estatisticas')).toBe(false);
  });
});

describe('o registro', () => {
  it('guarda o que prova o consentimento, e nada de pessoal', () => {
    const m = createConsentManager({ policyVersion: POLITICA, now: () => new Date('2026-11-21T10:00:00Z') });
    m.salvar({ estatisticas: true });
    const registro = m.get().record!;

    expect(registro.decidedAt).toBe('2026-11-21T10:00:00.000Z');
    expect(registro.granted).toContain('estatisticas');
    expect(registro.denied).toContain('marketing');
    expect(registro.policyVersion).toBe(POLITICA);
    expect(registro.engineVersion).toBeTruthy();
    expect(registro.id).toBeTruthy();

    // O que NAO pode estar la.
    const chaves = Object.keys(registro);
    for (const proibida of ['ip', 'userAgent', 'email', 'userId', 'path', 'referrer']) {
      expect(chaves).not.toContain(proibida);
    }
  });
});

describe('bloqueio de script -- o que de fato importa', () => {
  function pagina() {
    document.body.innerHTML = `
      <script type="text/plain" ${ATRIBUTO_CATEGORIA}="estatisticas"
              ${ATRIBUTO_SRC}="https://www.googletagmanager.com/gtag/js?id=G-X"></script>
      <script type="text/plain" ${ATRIBUTO_CATEGORIA}="marketing"
              ${ATRIBUTO_SRC}="https://connect.facebook.net/pixel.js"></script>
      <iframe ${ATRIBUTO_CATEGORIA}="marketing"
              ${ATRIBUTO_SRC}="https://www.youtube.com/embed/abc"></iframe>
    `;
  }

  it('sem autorizacao, nenhum script vira executavel', () => {
    pagina();
    const m = createConsentManager({ policyVersion: POLITICA });
    liberarMarcados(m.permite);

    // Continuam `text/plain`: o navegador nao executa, e nao ha corrida.
    const scripts = [...document.querySelectorAll('script')];
    expect(scripts.every((s) => s.getAttribute('type') === 'text/plain')).toBe(true);
    expect(scripts.every((s) => !s.src)).toBe(true);
    // O iframe continua sem endereco: nada e buscado.
    expect(document.querySelector('iframe')!.getAttribute('src')).toBeNull();
  });

  it('autorizar estatisticas libera SO a estatistica', () => {
    pagina();
    const m = createConsentManager({ policyVersion: POLITICA });
    m.salvar({ estatisticas: true });
    liberarMarcados(m.permite);

    const liberados = [...document.querySelectorAll('script')].filter(
      (s) => s.getAttribute('type') !== 'text/plain',
    );
    expect(liberados).toHaveLength(1);
    expect(liberados[0]!.src).toContain('googletagmanager');

    // O de marketing segue preso, e o video tambem.
    expect(document.body.innerHTML).toContain('connect.facebook.net');
    expect(document.querySelector('iframe')!.getAttribute('src')).toBeNull();
  });

  it('autorizar marketing libera o video incorporado', () => {
    pagina();
    const m = createConsentManager({ policyVersion: POLITICA });
    m.salvar({ marketing: true });
    liberarMarcados(m.permite);
    expect(document.querySelector('iframe')!.src).toContain('youtube.com');
  });

  it('liberar duas vezes nao duplica o script', () => {
    pagina();
    const m = createConsentManager({ policyVersion: POLITICA });
    m.aceitarTudo();
    liberarMarcados(m.permite);
    liberarMarcados(m.permite);
    const gtag = [...document.querySelectorAll('script')].filter((s) =>
      s.src.includes('googletagmanager'),
    );
    expect(gtag).toHaveLength(1);
  });

  it('a mudanca de escolha libera sem recarregar a pagina', () => {
    pagina();
    const m = createConsentManager({ policyVersion: POLITICA });
    const parar = aplicarConsentimento(m);
    expect(document.querySelector('script[src]')).toBeNull();

    m.salvar({ estatisticas: true });
    expect(document.querySelector('script[src]')!.getAttribute('src')).toContain('googletagmanager');
    parar();
  });
});

describe('ponte com o Consent Mode do Google', () => {
  it('o padrao e negado, e o sim vira update', () => {
    const chamadas: unknown[][] = [];
    (window as unknown as { gtag: (...a: unknown[]) => void }).gtag = (...a) => chamadas.push(a);

    const m = createConsentManager({ policyVersion: POLITICA });
    pontearConsentModeDoGoogle(m);

    expect(chamadas[0]![0]).toBe('consent');
    expect(chamadas[0]![1]).toBe('default');
    expect((chamadas[0]![2] as Record<string, string>).analytics_storage).toBe('denied');
    expect((chamadas[0]![2] as Record<string, string>).ad_storage).toBe('denied');

    m.salvar({ estatisticas: true });
    const ultima = chamadas[chamadas.length - 1]!;
    expect(ultima[1]).toBe('update');
    expect((ultima[2] as Record<string, string>).analytics_storage).toBe('granted');
    expect((ultima[2] as Record<string, string>).ad_storage).toBe('denied');
  });
});

describe('limpeza de cookie na revogacao', () => {
  it('apaga os de primeira parte com o prefixo, e so esses', () => {
    document.cookie = '_ga=GA1.1.123; path=/';
    document.cookie = '_ga_ABC=GS1.1.456; path=/';
    document.cookie = 'carrinho=xyz; path=/';

    const apagados = limparCookiesDe(['_ga']);
    expect(apagados).toBeGreaterThanOrEqual(2);

    // O que vale nos dois mundos: o VALOR sumiu e o alheio ficou intacto.
    //
    // Nao se afirma aqui que o nome desaparece: num navegador de verdade
    // `Max-Age=0` remove a linha inteira (conferido em Chromium -- sobra so
    // `carrinho=xyz`), mas o happy-dom guarda o nome com valor vazio. Afirmar
    // a remocao aqui seria medir o simulador, nao o produto; a remocao real e
    // provada no percurso de navegador.
    expect(document.cookie).toContain('carrinho=xyz');
    expect(document.cookie).not.toContain('GA1.1.123');
    expect(document.cookie).not.toContain('GS1.1.456');
  });
});

describe('isolamento entre sites', () => {
  it('a escolha vive na origem, entao um site nao le a do outro', () => {
    // O `localStorage` e isolado por origem pelo proprio navegador. O teste
    // registra a garantia: nao ha cookie de dominio compartilhado, nao ha
    // identificador global, e a chave nao carrega nada de outro site.
    const m = createConsentManager({ policyVersion: POLITICA });
    m.aceitarTudo();
    const chaves = Object.keys(window.localStorage);
    expect(chaves).toEqual(['codeca:consentimento']);
    const guardado = JSON.parse(window.localStorage.getItem('codeca:consentimento')!);
    expect(guardado.domain).toBe(location.hostname);
  });
});

describe('configuracao vinda do painel', () => {
  const PAINEL = {
    controllerName: 'Clinica Exemplo Ltda.',
    controllerDocument: '12.345.678/0001-90',
    controllerContact: 'privacidade@clinica.com.br',
    privacyPolicyUrl: 'https://clinica.com.br/privacidade',
    cookiePolicyUrl: 'https://clinica.com.br/cookies',
    policyVersion: '7',
    bannerEnabled: true,
    tools: [],
  };

  const respostaDe = (dado: unknown, ok = true) =>
    vi.fn(async () => ({ ok, json: async () => ({ data: dado }) }) as unknown as Response);

  it('le a configuracao do site pela chave publicavel', async () => {
    const buscar = respostaDe(PAINEL);
    const settings = await carregarConfiguracaoDeCookies({
      baseUrl: 'https://app.codecabuild.com.br/',
      publishableKey: 'cb_pub_abc',
      fetch: buscar as unknown as typeof fetch,
    });

    expect(settings?.controllerName).toBe('Clinica Exemplo Ltda.');
    expect(settings?.policyVersion).toBe('7');
    const [url, init] = buscar.mock.calls[0]! as [string, RequestInit];
    // Barra sobrando no `baseUrl` nao vira duas no caminho.
    expect(url).toBe('https://app.codecabuild.com.br/api/v1/consent/settings');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer cb_pub_abc');
  });

  it('falha de rede nao trava o banner: devolve null', async () => {
    const quebrado = vi.fn(async () => {
      throw new Error('rede caiu');
    });

    const settings = await carregarConfiguracaoDeCookies({
      baseUrl: 'https://app.codecabuild.com.br',
      publishableKey: 'cb_pub_abc',
      fetch: quebrado as unknown as typeof fetch,
    });

    expect(settings).toBeNull();
  });

  it('resposta recusada tambem devolve null, sem lancar', async () => {
    const settings = await carregarConfiguracaoDeCookies({
      baseUrl: 'https://app.codecabuild.com.br',
      publishableKey: 'cb_pub_abc',
      fetch: respostaDe(null, false) as unknown as typeof fetch,
    });

    expect(settings).toBeNull();
  });

  it('a versao do painel manda: escolha de outra versao deixa de valer', async () => {
    // Escolha guardada na versao antiga.
    createConsentManager({ policyVersion: '6' }).aceitarTudo();

    const iniciado = await iniciarConsentimento({
      baseUrl: 'https://app.codecabuild.com.br',
      publishableKey: 'cb_pub_abc',
      policyVersion: '6',
      fetch: respostaDe(PAINEL) as unknown as typeof fetch,
    });

    // O painel veio com `7`: o banner volta a perguntar.
    expect(iniciado.manager.decidiu()).toBe(false);
    expect(iniciado.manager.permite('estatisticas')).toBe(false);
    iniciado.destruir();
  });

  it('sem painel, vale a versao que o site passou -- e o banner aparece', async () => {
    const iniciado = await iniciarConsentimento({
      baseUrl: 'https://app.codecabuild.com.br',
      publishableKey: 'cb_pub_abc',
      policyVersion: POLITICA,
      fetch: (vi.fn(async () => {
        throw new Error('sem rede');
      }) as unknown) as typeof fetch,
    });

    expect(iniciado.settings).toBeNull();
    expect(document.querySelector('.codeca-consent')).not.toBeNull();
    iniciado.destruir();
  });

  it('banner desligado no painel nao monta interface, mas o portao continua', async () => {
    document.body.innerHTML = `
      <script type="text/plain" ${ATRIBUTO_CATEGORIA}="estatisticas" ${ATRIBUTO_SRC}="https://exemplo.test/ga.js"></script>
    `;

    const iniciado = await iniciarConsentimento({
      baseUrl: 'https://app.codecabuild.com.br',
      publishableKey: 'cb_pub_abc',
      fetch: respostaDe({ ...PAINEL, bannerEnabled: false }) as unknown as typeof fetch,
    });

    expect(document.querySelector('.codeca-consent')).toBeNull();
    // Nada autorizado: o script marcado segue fora da pagina.
    expect(document.querySelector('script[src="https://exemplo.test/ga.js"]')).toBeNull();
    iniciado.destruir();
  });

  /**
   * O envio NAO pode usar `navigator.sendBeacon`.
   *
   * Ele forca o modo de credenciais em `include`: anexaria os cookies que o
   * visitante tenha do dominio da plataforma a um registro que existe para ser
   * anonimo, e o preflight passaria a exigir `Allow-Credentials`, sem o qual o
   * navegador descarta tudo em silencio. Foi assim em Chromium -- o banner
   * funcionava e o registro nunca chegava ao banco. O teste trava as duas
   * coisas: o envio e por `fetch`, e com `credentials: 'omit'`.
   */
  it('o registro vai para a plataforma sem credencial, e `reportar: false` cala o envio', async () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const envios: Array<[string, RequestInit]> = [];
    // O envio usa o `fetch` GLOBAL, e nao o passado em `iniciarConsentimento`:
    // quem relata e o gerenciador, que nao recebe cliente nenhum.
    const buscar = vi.fn(async (url: unknown, init: unknown) => {
      if (String(url).endsWith('/api/v1/consent')) envios.push([String(url), init as RequestInit]);
      return { ok: true, json: async () => ({ data: PAINEL }) } as unknown as Response;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(buscar as unknown as typeof fetch);

    const ligado = await iniciarConsentimento({
      baseUrl: 'https://app.codecabuild.com.br',
      publishableKey: 'cb_pub_abc',
      fetch: buscar as unknown as typeof fetch,
    });
    ligado.manager.recusarOpcionais();

    expect(beacon).not.toHaveBeenCalled();
    expect(envios).toHaveLength(1);
    expect(envios[0]![0]).toBe('https://app.codecabuild.com.br/api/v1/consent');
    expect(envios[0]![1].credentials).toBe('omit');
    ligado.destruir();

    window.localStorage.clear();
    envios.length = 0;

    const calado = await iniciarConsentimento({
      baseUrl: 'https://app.codecabuild.com.br',
      publishableKey: 'cb_pub_abc',
      reportar: false,
      fetch: buscar as unknown as typeof fetch,
    });
    calado.manager.recusarOpcionais();
    expect(envios).toHaveLength(0);
    calado.destruir();
  });

  it('controlador vazio no painel nao vira o nome da plataforma', async () => {
    const iniciado = await iniciarConsentimento({
      baseUrl: 'https://app.codecabuild.com.br',
      publishableKey: 'cb_pub_abc',
      fetch: respostaDe({ ...PAINEL, controllerName: '' }) as unknown as typeof fetch,
    });

    const texto = document.querySelector('.codeca-consent')?.textContent ?? '';
    expect(texto).not.toContain('CODECA');
    iniciado.destruir();
  });
});
