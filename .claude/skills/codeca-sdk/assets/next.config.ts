import type { NextConfig } from 'next';

/**
 * As imagens do conteudo vem do armazenamento da plataforma.
 *
 * Sem este endereco liberado, `next/image` recusa a URL e as fotos do site
 * nao aparecem -- com um erro que fala de configuracao, nao de conteudo, e
 * manda procurar no lugar errado.
 */
const config: NextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.public.blob.vercel-storage.com' }],
  },
};

export default config;
