import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLANS,
  apexOf,
  canAssignRole,
  checkLimit,
  dnsInstructions,
  formatPublicAddress,
  formatWhatsAppNumber,
  isApexDomain,
  isPlatformHost,
  isReservedPageSlug,
  isValidDomain,
  normalizeDomain,
  normalizeWhatsAppNumber,
  planHasFeature,
  platformRoleCan,
  roleCan,
  slugify,
  tenantCapabilities,
  uniqueSlug,
  whatsAppLink,
} from '@codeca/shared';

describe('slugs', () => {
  it('remove acentos e caracteres especiais', () => {
    expect(slugify('Construtora Corrêa & Filhos Ltda.')).toBe('construtora-correa-filhos-ltda');
    expect(slugify('  Edifício  São   João  ')).toBe('edificio-sao-joao');
    expect(slugify('!!!')).toBe('');
  });

  it('garante unicidade no mesmo escopo', () => {
    expect(uniqueSlug('Residencial Aurora', [])).toBe('residencial-aurora');
    expect(uniqueSlug('Residencial Aurora', ['residencial-aurora'])).toBe('residencial-aurora-2');
    expect(uniqueSlug('Residencial Aurora', ['residencial-aurora', 'residencial-aurora-2'])).toBe(
      'residencial-aurora-3',
    );
  });

  it('protege slugs reservados pelo renderizador', () => {
    expect(isReservedPageSlug('imoveis')).toBe(true);
    expect(isReservedPageSlug('sobre')).toBe(false);
  });
});

describe('dominios', () => {
  it('normaliza entradas digitadas pelo usuario', () => {
    expect(normalizeDomain('HTTPS://WWW.Construtora.com.BR/sobre?x=1')).toBe('www.construtora.com.br');
    expect(normalizeDomain('www.construtora.com.br.')).toBe('www.construtora.com.br');
    expect(normalizeDomain('construtora.com.br:443')).toBe('construtora.com.br');
    expect(normalizeDomain('nao-e-dominio')).toBeNull();
    expect(normalizeDomain('http://localhost')).toBeNull();
    expect(normalizeDomain('')).toBeNull();
  });

  it('valida formato', () => {
    expect(isValidDomain('construtora.com.br')).toBe(true);
    expect(isValidDomain('a.io')).toBe(true);
    expect(isValidDomain('-invalido.com')).toBe(false);
    expect(isValidDomain('dominio..com')).toBe(false);
  });

  it('distingue apex de subdominio, inclusive em sufixos .com.br', () => {
    expect(isApexDomain('construtora.com.br')).toBe(true);
    expect(isApexDomain('www.construtora.com.br')).toBe(false);
    expect(isApexDomain('exemplo.com')).toBe(true);
    expect(isApexDomain('www.exemplo.com')).toBe(false);
    expect(apexOf('www.construtora.com.br')).toBe('construtora.com.br');
  });

  it('sugere registro A para apex e CNAME para subdominio', () => {
    const options = { aRecordIp: '76.76.21.21', cnameTarget: 'cname.vercel-dns.com', verificationTxt: null };
    expect(dnsInstructions('construtora.com.br', options).records[0]?.type).toBe('A');
    const sub = dnsInstructions('www.construtora.com.br', options);
    expect(sub.records[0]?.type).toBe('CNAME');
    expect(sub.records[0]?.name).toBe('www');
  });

  it('reconhece hosts da propria plataforma, incluindo curinga', () => {
    const hosts = ['app.codecabuild.com', '*.vercel.app', 'localhost'];
    expect(isPlatformHost('app.codecabuild.com', hosts)).toBe(true);
    expect(isPlatformHost('codeca-build-abc.vercel.app', hosts)).toBe(true);
    expect(isPlatformHost('localhost:5173', hosts)).toBe(true);
    expect(isPlatformHost('www.construtora.com.br', hosts)).toBe(false);
  });
});

describe('whatsapp', () => {
  it('normaliza numeros brasileiros', () => {
    expect(normalizeWhatsAppNumber('(11) 99999-8888')).toBe('5511999998888');
    expect(normalizeWhatsAppNumber('+55 11 99999-8888')).toBe('5511999998888');
    expect(normalizeWhatsAppNumber('123')).toBeNull();
    expect(formatWhatsAppNumber('11999998888')).toBe('+55 (11) 99999-8888');
  });

  it('monta link com mensagem contextualizada e codificada', () => {
    const link = whatsAppLink('(11) 99999-8888', { kind: 'property', title: 'Residencial Aurora', reference: 'AUR-12' }, 'Construtora Exemplo');
    expect(link).toContain('https://wa.me/5511999998888?text=');
    expect(link).toContain(encodeURIComponent('Residencial Aurora'));
    expect(link).toContain(encodeURIComponent('AUR-12'));
  });

  it('retorna null quando a empresa nao configurou numero', () => {
    expect(whatsAppLink(null, { kind: 'generic' }, 'X')).toBeNull();
    expect(whatsAppLink('abc', { kind: 'generic' }, 'X')).toBeNull();
  });
});

describe('papeis e permissoes', () => {
  it('viewer apenas le', () => {
    expect(roleCan('viewer', 'content:read')).toBe(true);
    expect(roleCan('viewer', 'content:write')).toBe(false);
    expect(tenantCapabilities('viewer').every((c) => c.endsWith(':read'))).toBe(true);
  });

  it('editor publica conteudo mas nao gerencia a empresa', () => {
    expect(roleCan('editor', 'site:publish')).toBe(true);
    expect(roleCan('editor', 'members:invite')).toBe(false);
    expect(roleCan('editor', 'domains:manage')).toBe(false);
  });

  it('admin administra a empresa mas nao exclui nem altera assinatura', () => {
    expect(roleCan('admin', 'members:invite')).toBe(true);
    expect(roleCan('admin', 'domains:manage')).toBe(true);
    expect(roleCan('admin', 'tenant:delete')).toBe(false);
    expect(roleCan('admin', 'billing:manage')).toBe(false);
    expect(roleCan('owner', 'billing:manage')).toBe(true);
  });

  it('administrador de empresa nao recebe privilegios globais', () => {
    expect(platformRoleCan('none', 'platform:tenants:read')).toBe(false);
    expect(platformRoleCan('platform_admin', 'platform:tenants:read')).toBe(true);
  });

  it('somente owner cria outro owner', () => {
    expect(canAssignRole('owner', 'owner')).toBe(true);
    expect(canAssignRole('admin', 'owner')).toBe(false);
    expect(canAssignRole('admin', 'editor')).toBe(true);
    expect(canAssignRole('editor', 'viewer')).toBe(false);
  });
});

describe('planos', () => {
  it('planos padrao tem limites coerentes e crescentes', () => {
    const [trial, essencial, profissional] = DEFAULT_PLANS;
    expect(trial?.limits.maxDomains).toBe(0);
    expect(planHasFeature(trial!.limits, 'custom_domain')).toBe(false);
    expect(planHasFeature(essencial!.limits, 'custom_domain')).toBe(true);
    expect(profissional!.limits.maxPublishedProperties).toBeGreaterThan(essencial!.limits.maxPublishedProperties);
    expect(profissional!.limits.storageBytes).toBeGreaterThan(essencial!.limits.storageBytes);
  });

  it('bloqueia quando o limite foi alcancado', () => {
    expect(checkLimit(4, 5, 'imoveis').allowed).toBe(true);
    const blocked = checkLimit(5, 5, 'imoveis publicados');
    expect(blocked.allowed).toBe(false);
    expect(blocked.message).toContain('5');
  });
});

describe('endereco publico', () => {
  it('oculta rua e numero quando a empresa nao autoriza', () => {
    const address = {
      street: 'Rua das Acacias',
      number: '120',
      neighborhood: 'Centro',
      city: 'Campinas',
      state: 'SP',
      showFullAddress: false,
    };
    const result = formatPublicAddress(address);
    expect(result).not.toContain('Acacias');
    expect(result).toContain('Centro');
    expect(formatPublicAddress({ ...address, showFullAddress: true })).toContain('Acacias');
  });
});
