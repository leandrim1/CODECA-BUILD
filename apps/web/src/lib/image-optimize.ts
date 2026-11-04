/**
 * Preparo de imagens no navegador, antes do envio.
 *
 * ## Por que
 *
 * O arquivo passa pela funcao da API (limite de corpo da Vercel e memoria da
 * funcao) e depois fica armazenado e e entregue aos visitantes do site. Uma
 * foto de celular tem 5 a 12 MB e 4000+ px de largura -- bem mais do que
 * qualquer tela mostra. Reduzir NO NAVEGADOR (o CPU e do usuario, nao do
 * servidor) faz o envio caber no limite, ser muito mais rapido e poupar a
 * franquia de armazenamento do plano.
 *
 * Regras de seguranca da conversao:
 * - so JPEG, PNG e WebP: GIF (animacao), SVG (vetor), AVIF e PDF passam intactos;
 * - o resultado so substitui o original se for MENOR; do contrario, envia o original;
 * - PNG com transparencia continua com transparencia (WebP preserva alfa);
 * - qualquer falha (navegador sem suporte, imagem corrompida) devolve o original.
 */

export const MAX_IMAGE_DIMENSION = 2560;
const OPTIMIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Abaixo disto e nao excede a dimensao maxima, nao vale reprocessar. */
const SKIP_BELOW_BYTES = 300 * 1024;
const WEBP_QUALITY = 0.85;

/** Cabe `width x height` em `max` mantendo a proporcao. Nunca amplia. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_DIMENSION): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function optimizedName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'imagem';
  return `${base}.webp`;
}

export interface PreparedImage {
  file: File;
  width: number | null;
  height: number | null;
  /** `true` quando o arquivo enviado e uma versao reduzida do original. */
  optimized: boolean;
}

export async function prepareImage(original: File): Promise<PreparedImage> {
  if (!original.type.startsWith('image/') || original.type === 'image/svg+xml') {
    return { file: original, width: null, height: null, optimized: false };
  }

  let bitmap: ImageBitmap;
  try {
    // `imageOrientation: from-image` aplica a rotacao EXIF antes de reencodar:
    // sem isso, a foto de celular em pe sairia deitada.
    bitmap = await createImageBitmap(original, { imageOrientation: 'from-image' });
  } catch {
    return { file: original, width: null, height: null, optimized: false };
  }

  const natural = { width: bitmap.width, height: bitmap.height };
  const target = fitWithin(natural.width, natural.height);
  const needsResize = target.width !== natural.width || target.height !== natural.height;
  const worthIt = OPTIMIZABLE.has(original.type) && (needsResize || original.size > SKIP_BELOW_BYTES);

  try {
    if (!worthIt) return { file: original, ...natural, optimized: false };

    const blob = await encodeWebp(bitmap, target.width, target.height);
    if (!blob || blob.size >= original.size) return { file: original, ...natural, optimized: false };

    const file = new File([blob], optimizedName(original.name), { type: 'image/webp', lastModified: Date.now() });
    return { file, ...target, optimized: true };
  } catch {
    return { file: original, ...natural, optimized: false };
  } finally {
    bitmap.close();
  }
}

async function encodeWebp(bitmap: ImageBitmap, width: number, height: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
    // Navegador sem encoder WebP devolve PNG: nao serve como "otimizacao".
    return blob.type === 'image/webp' ? blob : null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob && blob.type === 'image/webp' ? blob : null), 'image/webp', WEBP_QUALITY),
  );
}
