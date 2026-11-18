import { describe, expect, it } from 'vitest';
import { Button, Switch } from '@codeca/ui';
import type { ReactElement } from 'react';

/**
 * Geometria dos controles compartilhados.
 *
 * Estes testes existem por causa de um defeito real: o indicador do
 * interruptor era `absolute` SEM `left`. Sem `left`, o navegador usa a
 * *posicao estatica* do elemento -- e a trilha e um `<button>`, que o
 * navegador alinha ao centro. A posicao estatica resolvia em 22px (o meio dos
 * 44px da trilha), entao o indicador desligado encostava na borda direita e o
 * ligado saia INTEIRO da trilha, 20px a direita: o circulo branco solto, em
 * toda a plataforma.
 *
 * Nada disso aparece em teste de comportamento: o estado, o clique e o
 * `aria-checked` sempre estiveram certos. So a posicao estava errada. Por isso
 * o contrato aqui e sobre as CLASSES de posicionamento, nao sobre o que o
 * componente faz.
 *
 * Os componentes sao chamados como funcoes puras e a arvore devolvida e
 * inspecionada. Nao ha DOM nem biblioteca de renderizacao envolvida: o que
 * importa e o conjunto de classes que sai daqui.
 */

const TAILWIND_PASSO_PX = 4;

/** `size-5` -> 20, `translate-x-0` -> 0, `w-11` -> 44. */
function medida(classes: string, prefixo: string): number {
  const achado = classes
    .split(/\s+/)
    .find((c) => c === prefixo || c.startsWith(`${prefixo}-`));
  if (!achado) throw new Error(`classe "${prefixo}-*" ausente em: ${classes}`);
  const valor = achado.slice(prefixo.length + 1);
  const numero = Number(valor);
  if (Number.isNaN(numero)) throw new Error(`"${achado}" nao e numerico`);
  return numero * TAILWIND_PASSO_PX;
}

function temClasse(classes: string, classe: string): boolean {
  return classes.split(/\s+/).includes(classe);
}

function interruptor(checked: boolean, disabled = false) {
  const raiz = Switch({ label: 'Habilitado', checked, onChange: () => {}, disabled }) as ReactElement<{
    children: ReactElement[];
  }>;
  const trilha = raiz.props.children.find(
    (filho) => (filho as ReactElement<{ role?: string }>)?.props?.role === 'switch',
  ) as ReactElement<{ className: string; children: ReactElement<{ className: string }>; disabled?: boolean; 'aria-checked'?: boolean }>;
  return { trilha: trilha.props, indicador: trilha.props.children.props };
}

describe('Switch: geometria do indicador', () => {
  it('a trilha mede 44x24 e cria contexto para o indicador absoluto', () => {
    const { trilha } = interruptor(false);
    expect(medida(trilha.className, 'w')).toBe(44);
    expect(medida(trilha.className, 'h')).toBe(24);
    // Sem `relative` o indicador se posicionaria pela janela, nao pela trilha.
    expect(temClasse(trilha.className, 'relative')).toBe(true);
  });

  it('o indicador e ancorado nos DOIS eixos, nunca pela posicao estatica', () => {
    for (const ligado of [false, true]) {
      const { indicador } = interruptor(ligado);
      expect(temClasse(indicador.className, 'absolute')).toBe(true);
      // `left-0.5` e `top-0.5`: a origem e explicita. Era exatamente o `left`
      // que faltava, e o `<button>` centralizado resolvia a origem em 22px.
      expect(temClasse(indicador.className, 'left-0.5'), `ligado=${ligado}`).toBe(true);
      expect(temClasse(indicador.className, 'top-0.5'), `ligado=${ligado}`).toBe(true);
    }
  });

  it('o percurso cabe na trilha: 44 - 20 - 2 - 2 = 20px', () => {
    const { trilha, indicador } = interruptor(true);
    const larguraDaTrilha = medida(trilha.className, 'w');
    const tamanhoDoIndicador = medida(indicador.className, 'size');
    const folga = medida(indicador.className, 'left');
    const percursoEsperado = larguraDaTrilha - tamanhoDoIndicador - folga * 2;

    expect(medida(indicador.className, 'translate-x')).toBe(percursoEsperado);
    expect(percursoEsperado).toBe(20);
  });

  it('desligado, o indicador fica na origem', () => {
    const { indicador } = interruptor(false);
    expect(medida(indicador.className, 'translate-x')).toBe(0);
  });

  it('ligado e desligado deixam folgas espelhadas', () => {
    const desligado = interruptor(false);
    const ligado = interruptor(true);
    const largura = medida(ligado.trilha.className, 'w');
    const tamanho = medida(ligado.indicador.className, 'size');

    const esqDesligado = medida(desligado.indicador.className, 'left') + medida(desligado.indicador.className, 'translate-x');
    const esqLigado = medida(ligado.indicador.className, 'left') + medida(ligado.indicador.className, 'translate-x');

    expect(esqDesligado).toBe(2);
    expect(largura - (esqLigado + tamanho)).toBe(2);
    // O indicador nunca pode passar da trilha -- era o defeito original.
    expect(esqLigado + tamanho).toBeLessThanOrEqual(largura);
  });

  it('o indicador anima o deslocamento', () => {
    const { indicador } = interruptor(true);
    // No Tailwind v4 `translate-x-*` escreve a propriedade `translate`, e
    // `transition-transform` cobre `transform, translate, scale, rotate`.
    expect(temClasse(indicador.className, 'transition-transform')).toBe(true);
  });

  it('o estado anunciado acompanha o valor recebido', () => {
    expect(interruptor(true).trilha['aria-checked']).toBe(true);
    expect(interruptor(false).trilha['aria-checked']).toBe(false);
    expect(interruptor(false, true).trilha.disabled).toBe(true);
  });
});

describe('Button: tamanhos e estados', () => {
  const classes = (props: Parameters<typeof Button>[0]) =>
    (Button(props) as ReactElement<{ className: string }>).props.className;

  it('o botao de icone e um quadrado fixo que nao encolhe', () => {
    const c = classes({ size: 'icon', 'aria-label': 'Fechar' });
    expect(medida(c, 'h')).toBe(36);
    expect(medida(c, 'w')).toBe(36);
    // Sem `shrink-0` o flex o esmagava ao lado de um titulo longo, virando
    // elipse e caindo abaixo do alvo minimo de toque.
    expect(temClasse(c, 'shrink-0')).toBe(true);
  });

  it('as alturas dos tamanhos sao as do padrao e nunca abaixo do alvo de toque', () => {
    expect(medida(classes({ size: 'sm' }), 'h')).toBe(32);
    expect(medida(classes({ size: 'md' }), 'h')).toBe(40);
    expect(medida(classes({ size: 'lg' }), 'h')).toBe(48);
    for (const size of ['sm', 'md', 'lg', 'icon'] as const) {
      expect(medida(classes({ size }), 'h'), size).toBeGreaterThanOrEqual(24);
    }
  });

  it('todo botao tem foco visivel, recuo ao pressionar e desabilitado legivel', () => {
    const c = classes({});
    expect(temClasse(c, 'focus-visible:outline-2')).toBe(true);
    expect(temClasse(c, 'active:scale-[0.99]')).toBe(true);
    expect(temClasse(c, 'disabled:cursor-not-allowed')).toBe(true);
    expect(temClasse(c, 'disabled:opacity-55')).toBe(true);
    // Desabilitado nao reage ao clique.
    expect(temClasse(c, 'disabled:active:scale-100')).toBe(true);
  });

  it('carregando, o botao fica desabilitado: nao existe acao duplicada', () => {
    const el = Button({ loading: true }) as ReactElement<{ disabled?: boolean; 'aria-busy'?: boolean }>;
    expect(el.props.disabled).toBe(true);
    expect(el.props['aria-busy']).toBe(true);
    // E tambem quando desabilitado por regra, sem carregamento.
    const outro = Button({ disabled: true }) as ReactElement<{ disabled?: boolean }>;
    expect(outro.props.disabled).toBe(true);
  });
});
