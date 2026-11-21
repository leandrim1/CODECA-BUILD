import {
  CONSENT_CATEGORIES,
  type ConsentCategory,
  type ConsentManager,
} from './consent.js';

/**
 * Banner e painel de preferencias, em JavaScript puro.
 *
 * Sem framework porque o pacote nao tem dependencia, e porque o site do
 * cliente pode ser feito em qualquer coisa. Quem tiver desenho proprio ignora
 * este arquivo e usa so o nucleo.
 *
 * A aparencia sai de variaveis CSS com valor padrao: trocar a cor da marca e
 * uma linha no `:root` do site, sem reescrever nada aqui.
 */

export interface ConsentUiOptions {
  manager: ConsentManager;
  /** Quem responde pelos dados. Aparece no banner; nao e a CODECA por padrao. */
  controlador?: string;
  politicaDePrivacidade?: string;
  politicaDeCookies?: string;
  /** Texto do titulo. O padrao serve a maioria dos sites. */
  titulo?: string;
  descricao?: string;
}

const CSS = `
.codeca-consent *, .codeca-consent *::before, .codeca-consent *::after { box-sizing: border-box; }
/*
  O atributo hidden precisa vencer o display daqui.
  A regra [hidden] { display: none } vem do navegador, com a menor
  especificidade que existe: qualquer display declarado no elemento a
  derruba, e o banner nunca some. Visto em navegador -- ele continuava
  interceptando o clique de tudo no rodape da pagina.
*/
.codeca-consent[hidden] { display: none !important; }
.codeca-consent {
  --cc-fundo: #ffffff;
  --cc-texto: #1e293b;
  --cc-texto-fraco: #475569;
  --cc-borda: #cbd5e1;
  --cc-marca: #1d4ed8;
  --cc-marca-texto: #ffffff;
  --cc-raio: 14px;
  --cc-sombra: 0 10px 40px -8px rgb(15 23 42 / 0.25);
  position: fixed; inset: auto 0 0 0; z-index: 2147483000;
  display: flex; justify-content: center; padding: 16px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--cc-texto);
}
@media (prefers-color-scheme: dark) {
  .codeca-consent:not([data-tema="claro"]) {
    --cc-fundo: #0f172a; --cc-texto: #e2e8f0; --cc-texto-fraco: #cbd5e1;
    --cc-borda: #334155; --cc-sombra: 0 10px 40px -8px rgb(0 0 0 / 0.6);
  }
}
.codeca-consent__caixa {
  width: 100%; max-width: 760px; background: var(--cc-fundo);
  border: 1px solid var(--cc-borda); border-radius: var(--cc-raio);
  box-shadow: var(--cc-sombra); padding: 20px;
}
.codeca-consent__titulo { margin: 0 0 6px; font-size: 1.0625rem; font-weight: 600; }
.codeca-consent__texto { margin: 0; font-size: 0.9375rem; line-height: 1.55; color: var(--cc-texto-fraco); }
.codeca-consent__links { margin-top: 10px; font-size: 0.875rem; }
.codeca-consent__links a { color: var(--cc-marca); text-underline-offset: 2px; }
.codeca-consent__acoes { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
/* Os tres botoes tem o mesmo peso: recusar nao pode ser mais dificil que aceitar. */
.codeca-consent__botao {
  flex: 1 1 180px; min-height: 44px; padding: 10px 16px; border-radius: 10px;
  font: inherit; font-size: 0.9375rem; font-weight: 500; cursor: pointer;
  border: 1px solid var(--cc-borda); background: transparent; color: var(--cc-texto);
}
.codeca-consent__botao:hover { border-color: var(--cc-marca); }
.codeca-consent__botao:focus-visible { outline: 2px solid var(--cc-marca); outline-offset: 2px; }
.codeca-consent__botao--principal { background: var(--cc-marca); border-color: var(--cc-marca); color: var(--cc-marca-texto); }
.codeca-consent__categorias { margin: 16px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.codeca-consent__categoria { border: 1px solid var(--cc-borda); border-radius: 10px; padding: 12px 14px; }
.codeca-consent__linha { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.codeca-consent__nome { font-weight: 600; font-size: 0.9375rem; }
.codeca-consent__descricao { margin: 4px 0 0; font-size: 0.875rem; line-height: 1.5; color: var(--cc-texto-fraco); }
.codeca-consent__sempre { font-size: 0.8125rem; color: var(--cc-texto-fraco); }
.codeca-consent__interruptor { width: 44px; height: 26px; flex: none; }
`;

function elemento<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classe?: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto) el.textContent = texto;
  return el;
}

/**
 * Monta o banner e o painel, e devolve o que precisa ser chamado de fora.
 *
 * O banner so aparece quando nao ha escolha valida. O painel abre a qualquer
 * momento, pelo link "Configurações de cookies" que o site coloca onde quiser
 * -- normalmente no rodape, ao lado das politicas.
 */
export function montarConsentimento(options: ConsentUiOptions): {
  abrirPreferencias: () => void;
  destruir: () => void;
} {
  const { manager } = options;
  const raiz = elemento('div', 'codeca-consent');
  raiz.setAttribute('role', 'dialog');
  raiz.setAttribute('aria-modal', 'false');
  raiz.setAttribute('aria-label', 'Aviso de cookies');
  raiz.hidden = true;

  const estilo = document.createElement('style');
  estilo.textContent = CSS;

  const caixa = elemento('div', 'codeca-consent__caixa');
  raiz.append(caixa);

  let modo: 'banner' | 'painel' = 'banner';

  const desenhar = () => {
    caixa.replaceChildren();
    const decisao = manager.get().decision;

    const titulo = elemento('h2', 'codeca-consent__titulo', options.titulo ?? 'Sua privacidade importa');
    titulo.id = 'codeca-consent-titulo';
    raiz.setAttribute('aria-labelledby', titulo.id);
    caixa.append(titulo);

    caixa.append(
      elemento(
        'p',
        'codeca-consent__texto',
        options.descricao
          ?? 'Usamos cookies necessários para o site funcionar e, com a sua autorização, cookies adicionais para entender como ele é usado e melhorá-lo.',
      ),
    );

    if (options.politicaDePrivacidade || options.politicaDeCookies || options.controlador) {
      const links = elemento('p', 'codeca-consent__links');
      if (options.controlador) {
        links.append(document.createTextNode(`Responsável pelos dados: ${options.controlador}. `));
      }
      if (options.politicaDeCookies) {
        const a = elemento('a', undefined, 'Política de Cookies');
        a.href = options.politicaDeCookies;
        links.append(a);
      }
      if (options.politicaDePrivacidade) {
        if (options.politicaDeCookies) links.append(document.createTextNode(' · '));
        const a = elemento('a', undefined, 'Política de Privacidade');
        a.href = options.politicaDePrivacidade;
        links.append(a);
      }
      caixa.append(links);
    }

    if (modo === 'painel') {
      const lista = elemento('ul', 'codeca-consent__categorias');
      for (const categoria of CONSENT_CATEGORIES) {
        const item = elemento('li', 'codeca-consent__categoria');
        const linha = elemento('div', 'codeca-consent__linha');
        const nome = elemento('span', 'codeca-consent__nome', categoria.titulo);
        linha.append(nome);

        if (categoria.obrigatoria) {
          // Nao e um interruptor desligado: e a ausencia de escolha, dita em
          // palavras. Um interruptor travado parece defeito.
          linha.append(elemento('span', 'codeca-consent__sempre', 'Sempre ativos'));
        } else {
          const caixaDeSelecao = document.createElement('input');
          caixaDeSelecao.type = 'checkbox';
          caixaDeSelecao.className = 'codeca-consent__interruptor';
          caixaDeSelecao.checked = decisao[categoria.id];
          caixaDeSelecao.id = `codeca-consent-${categoria.id}`;
          caixaDeSelecao.setAttribute('aria-describedby', `codeca-consent-desc-${categoria.id}`);
          nome.setAttribute('id', `codeca-consent-nome-${categoria.id}`);
          caixaDeSelecao.setAttribute('aria-labelledby', `codeca-consent-nome-${categoria.id}`);
          linha.append(caixaDeSelecao);
        }

        item.append(linha);
        const descricao = elemento('p', 'codeca-consent__descricao', categoria.descricao);
        descricao.id = `codeca-consent-desc-${categoria.id}`;
        item.append(descricao);
        lista.append(item);
      }
      caixa.append(lista);
    }

    const acoes = elemento('div', 'codeca-consent__acoes');

    if (modo === 'banner') {
      acoes.append(
        botao('Rejeitar opcionais', () => manager.recusarOpcionais()),
        botao('Personalizar', () => {
          modo = 'painel';
          desenhar();
        }),
        botao('Aceitar todos', () => manager.aceitarTudo(), true),
      );
    } else {
      acoes.append(
        botao('Rejeitar opcionais', () => manager.recusarOpcionais()),
        botao('Salvar escolhas', () => {
          const escolha: Partial<Record<ConsentCategory, boolean>> = {};
          for (const categoria of CONSENT_CATEGORIES) {
            if (categoria.obrigatoria) continue;
            const campo = caixa.querySelector<HTMLInputElement>(`#codeca-consent-${categoria.id}`);
            escolha[categoria.id] = Boolean(campo?.checked);
          }
          manager.salvar(escolha);
        }, true),
      );
      if (manager.decidiu()) {
        acoes.append(botao('Revogar tudo', () => manager.revogar()));
      }
    }

    caixa.append(acoes);
  };

  const botao = (rotulo: string, acao: () => void, principal = false) => {
    const el = elemento('button', `codeca-consent__botao${principal ? ' codeca-consent__botao--principal' : ''}`, rotulo);
    el.type = 'button';
    el.addEventListener('click', acao);
    return el;
  };

  const atualizarVisibilidade = () => {
    const precisaDecidir = !manager.decidiu();
    raiz.hidden = !precisaDecidir && modo === 'banner';
    if (!raiz.hidden) desenhar();
  };

  const cancelar = manager.aoMudar(() => {
    // Decidiu pelo painel: fecha. Revogou: volta ao banner.
    modo = manager.decidiu() ? 'banner' : modo;
    atualizarVisibilidade();
  });

  document.head.append(estilo);
  document.body.append(raiz);
  atualizarVisibilidade();

  return {
    abrirPreferencias: () => {
      modo = 'painel';
      raiz.hidden = false;
      desenhar();
      caixa.querySelector<HTMLElement>('input,button')?.focus();
    },
    destruir: () => {
      cancelar();
      raiz.remove();
      estilo.remove();
    },
  };
}
