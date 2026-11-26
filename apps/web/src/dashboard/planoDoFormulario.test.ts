import { describe, expect, it } from 'vitest';
import { MODULE_REGISTRY } from '@codeca/shared';
import { campoOculto, larguraDoCampo, planoDoFormulario } from './DocumentModulePage.js';
import type { SiteModuleFieldView } from '../types/index.js';

/**
 * A grade de duas colunas das telas de conteudo.
 *
 * Os campos vem do REGISTRO, e nao de uma lista escrita aqui: o que o teste
 * garante e que acrescentar um campo ao registro continue caindo na grade
 * com a largura certa, sem ninguem precisar se lembrar desta tela.
 */

/** Os campos do modulo como a API os entrega para o painel. */
function camposDe(moduleKey: 'institucional' | 'contato'): SiteModuleFieldView[] {
  return MODULE_REGISTRY[moduleKey].fields.map((campo) => ({
    key: campo.key,
    label: campo.label,
    type: campo.type,
    editable: campo.editableByDefault,
    ...(campo.help ? { help: campo.help } : {}),
    ...(campo.required ? { required: campo.required } : {}),
    ...(campo.options ? { options: [...campo.options] } : {}),
  })) as SiteModuleFieldView[];
}

const chaves = (moduleKey: 'institucional' | 'contato') =>
  Object.fromEntries(
    planoDoFormulario(moduleKey, camposDe(moduleKey)).map((item) => [item.campo.key, item.largura]),
  );

describe('plano do formulário', () => {
  it('esconde os campos que o bloco de endereço já desenha', () => {
    const plano = chaves('contato');
    for (const chave of ['addressLine', 'addressNumber', 'addressComplement', 'neighborhood', 'city', 'state']) {
      expect(plano[chave]).toBeUndefined();
    }
    // A coordenada e o carimbo de auditoria também: quem os escreve é o
    // servidor, e o pino é quem os move.
    for (const chave of ['latitude', 'longitude', 'geocodedAt', 'geocodeSource']) {
      expect(plano[chave]).toBeUndefined();
    }
  });

  it('esconde o texto do horário enquanto a grade por dia está liberada', () => {
    const campos = camposDe('contato');
    const texto = campos.find((campo) => campo.key === 'businessHours')!;
    expect(campoOculto('contato', texto)).toBe(true);
    // Travado pela CODECA IA, ele volta a aparecer: campo travado se mostra.
    expect(campoOculto('contato', { ...texto, editable: false })).toBe(false);
  });

  it('põe os campos curtos em meia linha e os longos na linha inteira', () => {
    const plano = chaves('contato');
    expect(plano.email).toBe('metade');
    expect(plano.phone).toBe('metade');
    expect(plano.whatsapp).toBe('metade');

    expect(plano.whatsappMessage).toBe('inteira');
    expect(plano.postalCode).toBe('inteira');
    expect(plano.businessHoursSchedule).toBe('inteira');
    expect(plano.mapSettings).toBe('inteira');
    expect(plano.serviceArea).toBe('inteira');
    expect(plano.mapUrl).toBe('inteira');
    expect(plano.social).toBe('inteira');
  });

  it('deixa o institucional com os textos longos na linha inteira', () => {
    const plano = chaves('institucional');
    expect(plano.companyName).toBe('metade');
    expect(plano.tagline).toBe('metade');
    expect(plano.foundedYear).toBe('metade');
    expect(plano.history).toBe('inteira');
    expect(plano.values).toBe('inteira');
    expect(plano.logoImageId).toBe('metade');
    expect(plano.coverImageId).toBe('metade');
    expect(plano.galleryImageIds).toBe('inteira');
  });

  it('reserva a linha da dica no vizinho que não tem dica', () => {
    const campos: SiteModuleFieldView[] = [
      { key: 'a', label: 'Com dica', type: 'text', editable: true, help: 'Explica.' },
      { key: 'b', label: 'Sem dica', type: 'text', editable: true },
    ] as SiteModuleFieldView[];

    const plano = planoDoFormulario('contato', campos);
    expect(plano.map((item) => item.reservarDica)).toEqual([false, true]);
  });

  it('não reserva nada quando os dois vizinhos têm dica, ou nenhum tem', () => {
    const dois = (help?: string): SiteModuleFieldView[] =>
      [
        { key: 'a', label: 'A', type: 'text', editable: true, ...(help ? { help } : {}) },
        { key: 'b', label: 'B', type: 'text', editable: true, ...(help ? { help } : {}) },
      ] as SiteModuleFieldView[];

    expect(planoDoFormulario('contato', dois()).every((item) => !item.reservarDica)).toBe(true);
    expect(planoDoFormulario('contato', dois('Explica.')).every((item) => !item.reservarDica)).toBe(true);
  });

  it('não emparelha uma metade com o campo de linha inteira que vem depois', () => {
    const campos: SiteModuleFieldView[] = [
      { key: 'curto', label: 'Curto', type: 'text', editable: true },
      { key: 'longo', label: 'Longo', type: 'longText', editable: true, help: 'Explica.' },
      { key: 'outro', label: 'Outro', type: 'text', editable: true },
    ] as SiteModuleFieldView[];

    const plano = planoDoFormulario('contato', campos);
    expect(plano.map((item) => [item.campo.key, item.largura, item.reservarDica])).toEqual([
      ['curto', 'metade', false],
      ['longo', 'inteira', false],
      ['outro', 'metade', false],
    ]);
  });

  it('trata campo travado como campo com dica: o aviso do cadeado ocupa a linha', () => {
    const campos: SiteModuleFieldView[] = [
      { key: 'travado', label: 'Travado', type: 'text', editable: false },
      { key: 'livre', label: 'Livre', type: 'text', editable: true },
    ] as SiteModuleFieldView[];

    const plano = planoDoFormulario('institucional', campos);
    expect(plano.map((item) => item.reservarDica)).toEqual([false, true]);
  });

  it('a largura não depende do módulo para os tipos longos', () => {
    const campo = { key: 'x', label: 'X', type: 'longText', editable: true } as SiteModuleFieldView;
    expect(larguraDoCampo('institucional', campo)).toBe('inteira');
    expect(larguraDoCampo('contato', campo)).toBe('inteira');
  });
});
