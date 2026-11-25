'use client';

import { useEffect, useRef } from 'react';
import type { ContactContent } from '@codeca/sdk';

/**
 * Mapa do endereco da empresa.
 *
 * Por baixo e o elemento `<codeca-map>` do SDK -- um web component, e nao um
 * componente React. A razao e que o mesmo elemento serve site React, site
 * Astro e pagina estatica; aqui ele so ganha um involucro para ficar com cara
 * de JSX e aceitar `ContactContent` direto, sem o site traduzir nada.
 *
 * O que chega e o formato NORMALIZADO da plataforma. Se amanha a CODECA
 * trocar o provedor de mapas, este arquivo nao muda.
 */
export function CodecaMap({ contato }: { contato: ContactContent }) {
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Importado dentro do efeito: o registro do elemento e efeito colateral e
    // so pode rodar no navegador.
    void import('@codeca/sdk/map');
  }, []);

  if (contato.latitude === null || contato.longitude === null) {
    // Sem coordenada nao ha mapa -- e nem por isso o endereco some.
    return contato.addressLine ? (
      <address>
        {contato.addressLine}
        {contato.city ? `, ${contato.city}` : ''}
        {contato.state ? ` - ${contato.state}` : ''}
      </address>
    ) : null;
  }

  const address = {
    street: contato.addressLine,
    number: contato.addressNumber,
    neighborhood: contato.neighborhood,
    city: contato.city,
    state: contato.state,
    postalCode: contato.postalCode,
    lat: contato.latitude,
    lng: contato.longitude,
  };

  return (
    <div ref={caixa}>
      {/* @ts-expect-error -- elemento customizado, registrado pelo import acima */}
      <codeca-map
        address={JSON.stringify(address)}
        settings={JSON.stringify(contato.mapSettings ?? {})}
        label="Mapa do endereço da empresa"
      />
    </div>
  );
}
