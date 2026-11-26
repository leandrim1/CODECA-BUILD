// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ConsentimentoProvider, useConsentimento } from './ConsentimentoProvider.js';
import { PreferenciasDeCookies } from './PreferenciasDeCookies.js';
import { BannerDeConsentimento } from './BannerDeConsentimento.js';
import {
  CHAVE_DO_CONSENTIMENTO,
  VERSAO_DA_POLITICA,
  categoriasOpcionaisEmUso,
  haOpcionais,
  type FerramentaOpcional,
} from './inventario.js';
import { gravarDecisao, lerDecisao } from './armazenamento.js';
import {
  ATRIBUTO_CATEGORIA,
  ATRIBUTO_SRC,
  carregarScriptSeAutorizado,
  esquecerCarregados,
  liberarMarcados,
} from './carregarSeAutorizado.js';

/**
 * O consentimento do painel.
 *
 * O teste que mais importa nao e o do banner: e o do PORTAO. Um aviso bonito
 * que nao impede o script de carregar nao e consentimento -- e papel passado.
 */

const MEDIDOR: FerramentaOpcional = {
  chave: 'medidor',
  nome: 'Medidor de uso',
  fornecedor: 'Exemplo',
  categoria: 'estatisticos',
  finalidade: 'Conta quantas pessoas abrem cada tela.',
  cookies: ['_exemplo_id'],
};

function Tela({ ferramentas }: { ferramentas?: readonly FerramentaOpcional[] }) {
  return (
    <MemoryRouter initialEntries={['/painel']}>
      <ConsentimentoProvider {...(ferramentas ? { ferramentas } : {})}>
        <BannerDeConsentimento />
        <PreferenciasDeCookies />
        <Espiao />
      </ConsentimentoProvider>
    </MemoryRouter>
  );
}

/** Publica o estado do hook para o teste conferir sem olhar pixels. */
function Espiao() {
  const { permite, precisaDecidir, decisao } = useConsentimento();
  return (
    <output>
      {JSON.stringify({
        precisaDecidir,
        necessarios: permite('necessarios'),
        estatisticos: permite('estatisticos'),
        marketing: permite('marketing'),
        temDecisao: decisao !== null,
      })}
    </output>
  );
}

const estado = () => JSON.parse(screen.getByRole('status').textContent ?? '{}') as Record<string, boolean>;

beforeEach(() => {
  window.localStorage.clear();
  esquecerCarregados();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('o que fica guardado', () => {
  it('grava versão, data e as três categorias', () => {
    const decisao = gravarDecisao({ estatisticos: true, marketing: false }, new Date('2026-03-01T10:00:00Z'));
    expect(decisao).toEqual({
      versao: VERSAO_DA_POLITICA,
      data: '2026-03-01T10:00:00.000Z',
      necessarios: true,
      estatisticos: true,
      marketing: false,
    });
    expect(lerDecisao()).toEqual(decisao);
  });

  it('descarta a escolha quando a versão da política muda', () => {
    window.localStorage.setItem(
      CHAVE_DO_CONSENTIMENTO,
      JSON.stringify({ versao: 'anterior', data: '2026-01-01T00:00:00.000Z', necessarios: true, estatisticos: true, marketing: true }),
    );
    expect(lerDecisao()).toBeNull();
  });

  it('descarta conteúdo adulterado ou incompleto', () => {
    for (const bruto of ['{', 'null', '[]', JSON.stringify({ versao: VERSAO_DA_POLITICA })]) {
      window.localStorage.setItem(CHAVE_DO_CONSENTIMENTO, bruto);
      expect(lerDecisao()).toBeNull();
    }
  });

  it('não quebra quando o navegador recusa o armazenamento', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(lerDecisao()).toBeNull();
    // A decisão continua valendo nesta aba, mesmo sem conseguir gravar.
    expect(gravarDecisao({ estatisticos: true, marketing: true }).estatisticos).toBe(true);
  });
});

describe('o portão de scripts', () => {
  it('não cria a tag enquanto a categoria não está autorizada', async () => {
    const carregou = await carregarScriptSeAutorizado(
      { src: 'https://exemplo.test/medidor.js', categoria: 'estatisticos' },
      (c) => c === 'necessarios',
    );
    expect(carregou).toBe(false);
    expect(document.querySelector('script[src="https://exemplo.test/medidor.js"]')).toBeNull();
  });

  it('cria a tag quando autorizado, e uma só vez', async () => {
    /*
      Documento de mentira: o happy-dom recusa carregar script externo e
      dispara `error`, que aqui diria pouco. O que o teste quer saber é
      quantas tags o portão cria -- e isso se conta sem rede.
    */
    const inseridos: HTMLScriptElement[] = [];
    const fingido = {
      createElement: (tipo: string) => document.createElement(tipo),
      head: {
        append: (no: HTMLScriptElement) => {
          inseridos.push(no);
          no.dispatchEvent(new Event('load'));
        },
      },
    } as unknown as Document;

    const permite = () => true;
    const pedido = { src: 'https://exemplo.test/medidor.js', categoria: 'estatisticos' as const };
    expect(await carregarScriptSeAutorizado(pedido, permite, fingido)).toBe(true);
    expect(await carregarScriptSeAutorizado(pedido, permite, fingido)).toBe(true);
    expect(inseridos).toHaveLength(1);
    expect(inseridos[0]?.getAttribute(ATRIBUTO_CATEGORIA)).toBe('estatisticos');
  });

  it('libera só o que está marcado com a categoria autorizada', () => {
    // Raiz própria: varrer o documento inteiro pegaria restos de outro teste.
    const raiz = document.createElement('div');
    raiz.innerHTML = `
      <script type="text/plain" ${ATRIBUTO_CATEGORIA}="estatisticos" ${ATRIBUTO_SRC}="https://exemplo.test/e.js"></script>
      <iframe ${ATRIBUTO_CATEGORIA}="marketing" ${ATRIBUTO_SRC}="https://exemplo.test/anuncio"></iframe>
    `;
    const liberados = liberarMarcados((c) => c === 'estatisticos', raiz);
    expect(liberados).toBe(1);
    expect(raiz.querySelector('script[src="https://exemplo.test/e.js"]')).not.toBeNull();
    // O de marketing continua sem endereço: não foi autorizado.
    expect(raiz.querySelector('iframe')?.getAttribute('src')).toBeNull();
  });
});

describe('o banner', () => {
  it('não aparece enquanto não há ferramenta opcional declarada', () => {
    render(<Tela />);
    expect(screen.queryByRole('dialog', { name: 'Controle sua privacidade' })).toBeNull();
    expect(estado().precisaDecidir).toBe(false);
    // E o inventário de verdade continua vazio: é o que a política afirma.
    expect(haOpcionais()).toBe(false);
    expect(categoriasOpcionaisEmUso()).toEqual([]);
  });

  it('aparece quando uma ferramenta opcional é declarada', () => {
    render(<Tela ferramentas={[MEDIDOR]} />);
    expect(screen.getByRole('dialog', { name: 'Controle sua privacidade' })).toBeTruthy();
    expect(estado().precisaDecidir).toBe(true);
    // Nada opcional vale antes da resposta.
    expect(estado().estatisticos).toBe(false);
    expect(estado().necessarios).toBe(true);
  });

  it('não reaparece para quem já decidiu, e não pisca no primeiro quadro', () => {
    gravarDecisao({ estatisticos: false, marketing: false });
    render(<Tela ferramentas={[MEDIDOR]} />);
    expect(screen.queryByRole('dialog', { name: 'Controle sua privacidade' })).toBeNull();
  });

  it('leva os dois botões de decisão com o mesmo peso', () => {
    render(<Tela ferramentas={[MEDIDOR]} />);
    const aceitar = screen.getByRole('button', { name: 'Aceitar todos' });
    const recusar = screen.getByRole('button', { name: 'Recusar não essenciais' });
    expect(aceitar.className).toBe(recusar.className);
  });

  it('"Aceitar todos" libera o opcional; "Recusar" não', async () => {
    const usuario = userEvent.setup();
    const { unmount } = render(<Tela ferramentas={[MEDIDOR]} />);
    await usuario.click(screen.getByRole('button', { name: 'Aceitar todos' }));
    expect(estado().estatisticos).toBe(true);
    expect(estado().marketing).toBe(true);
    unmount();

    window.localStorage.clear();
    render(<Tela ferramentas={[MEDIDOR]} />);
    await usuario.click(screen.getByRole('button', { name: 'Recusar não essenciais' }));
    expect(estado().estatisticos).toBe(false);
    expect(estado().temDecisao).toBe(true);
  });

  it('Esc recusa o que é opcional, em vez de só sumir', async () => {
    const usuario = userEvent.setup();
    render(<Tela ferramentas={[MEDIDOR]} />);
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(estado().temDecisao).toBe(true));
    expect(estado().estatisticos).toBe(false);
  });

  it('recebe o foco ao aparecer', () => {
    render(<Tela ferramentas={[MEDIDOR]} />);
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Controle sua privacidade' }));
  });

  it('não cobre as páginas de política', () => {
    render(
      <MemoryRouter initialEntries={['/cookies']}>
        <ConsentimentoProvider ferramentas={[MEDIDOR]}>
          <BannerDeConsentimento />
        </ConsentimentoProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog', { name: 'Controle sua privacidade' })).toBeNull();
  });
});

describe('o modal de preferências', () => {
  it('mostra Necessários desligável por ninguém, e só as categorias em uso', async () => {
    const usuario = userEvent.setup();
    render(<Tela ferramentas={[MEDIDOR]} />);
    await usuario.click(screen.getByRole('button', { name: 'Personalizar' }));

    const necessarios = screen.getByRole('switch', { name: 'Necessários' });
    expect(necessarios.getAttribute('aria-checked')).toBe('true');
    expect((necessarios as HTMLButtonElement).disabled).toBe(true);

    expect(screen.getByRole('switch', { name: 'Estatísticos' })).toBeTruthy();
    // Marketing não tem ferramenta declarada: não vira interruptor.
    expect(screen.queryByRole('switch', { name: 'Marketing' })).toBeNull();
  });

  it('só consente quando a pessoa salva', async () => {
    const usuario = userEvent.setup();
    render(<Tela ferramentas={[MEDIDOR]} />);
    await usuario.click(screen.getByRole('button', { name: 'Personalizar' }));
    await usuario.click(screen.getByRole('switch', { name: 'Estatísticos' }));
    // Mexer no interruptor ainda não é consentir.
    expect(estado().temDecisao).toBe(false);

    await usuario.click(screen.getByRole('button', { name: 'Salvar preferências' }));
    expect(estado().estatisticos).toBe(true);
  });

  it('diz com todas as letras quando não há nada opcional', async () => {
    const usuario = userEvent.setup();
    // Sem banner, a porta de entrada é o menu da conta ou o rodapé; aqui, um
    // botão qualquer que chame o mesmo `abrirPreferencias`.
    render(
      <MemoryRouter>
        <ConsentimentoProvider>
          <AbrirPreferencias />
          <PreferenciasDeCookies />
        </ConsentimentoProvider>
      </MemoryRouter>,
    );
    await usuario.click(screen.getByRole('button', { name: 'abrir' }));
    expect(screen.getByText(/não carrega nenhuma ferramenta opcional/)).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Estatísticos' })).toBeNull();
    /*
      Sem o que decidir, nao ha o que salvar. Gravar uma decisao aqui faria o
      banner nao aparecer no dia em que a primeira ferramenta fosse
      declarada -- e a pessoa nunca seria perguntada.
    */
    expect(screen.queryByRole('button', { name: 'Salvar preferências' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Entendi' })).toBeTruthy();
    expect(lerDecisao()).toBeNull();
  });
});

function AbrirPreferencias() {
  const { abrirPreferencias } = useConsentimento();
  return (
    <button type="button" onClick={abrirPreferencias}>
      abrir
    </button>
  );
}
