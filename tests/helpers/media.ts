/**
 * Arquivos de teste com conteudo de verdade.
 *
 * O upload decide o tipo pelos primeiros bytes, nao pelo rotulo. Um punhado de
 * zeros chamado `foto.jpg` nao e um JPG -- e e exatamente o que o upload passou
 * a recusar. Os testes que so precisam de "uma imagem qualquer" usam estes.
 */

/** Bytes que comecam como um JPEG (SOI + APP0/JFIF), completados com zeros. */
export function jpegBytes(size = 2048): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 16));
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  return bytes;
}

/** Bytes que comecam como um PNG. */
export function pngBytes(size = 2048): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 16));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

/** Bytes que comecam como um PDF. */
export function pdfBytes(size = 2048): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 16));
  bytes.set(Array.from('%PDF-1.7\n', (letra) => letra.charCodeAt(0)));
  return bytes;
}
