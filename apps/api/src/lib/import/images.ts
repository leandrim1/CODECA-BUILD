import { createHash } from 'node:crypto';
import { and, eq, schema, sql, type Database } from '@codeca/database';
import {
  MAX_UPLOAD_BYTES,
  formatBytes,
  isAllowedMimeType,
  mediaKindFor,
  safeFileName,
  sanitizeSvg,
  type AllowedMimeType,
} from '@codeca/shared';
import { buildBlobPathname } from '../blob.js';
import type { BlobStorage } from '../blob.js';
import { assertStorageAvailable, loadEffectivePlan } from '../plan-limits.js';
import { SiteFetchError, type SiteFetcher } from './fetcher.js';

/**
 * Traz uma imagem do site antigo para a biblioteca da empresa.
 *
 * Passa pela **mesma** infraestrutura que o painel usa: valida tipo e tamanho,
 * confere o limite de armazenamento do plano, grava no Vercel Blob sob
 * `tenants/<tenantId>/` e registra em `media_assets`. Nao existe caminho
 * paralelo -- o que o cliente ve depois na Biblioteca de imagens e um arquivo
 * igual a qualquer outro, e o site novo nunca aponta para o endereco antigo.
 */

/** Tamanho minimo. Abaixo disso e marcador, nao conteudo. */
const MIN_IMAGE_BYTES = 1024;

export interface ImportedImage {
  mediaId: string;
  url: string;
  fileName: string;
  sizeBytes: number;
  /** `true` quando o arquivo ja existia e foi reaproveitado. */
  reused: boolean;
}

export type ImageRejection =
  | 'indisponivel'
  | 'tipo_recusado'
  | 'svg_recusado'
  | 'pequena_demais'
  | 'grande_demais'
  | 'limite_de_plano'
  | 'armazenamento';

export class ImageImportError extends Error {
  constructor(
    readonly reason: ImageRejection,
    message: string,
  ) {
    super(message);
    this.name = 'ImageImportError';
  }
}

/**
 * Descobre o tipo real pelos primeiros bytes.
 *
 * O `content-type` do servidor nao serve como decisao: site mal configurado
 * devolve `application/octet-stream` para PNG, e um servidor hostil poderia
 * declarar `image/png` para qualquer coisa. Os bytes nao mentem, e e por eles
 * que o arquivo e aceito ou recusado.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const b = bytes;

  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';

  const ascii = (start: number, length: number): string =>
    Buffer.from(b.subarray(start, start + length)).toString('latin1');

  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  // AVIF e HEIF: a marca `ftyp` vem no segundo bloco de 4 bytes.
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4).toLowerCase();
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }

  // SVG e texto: pode comecar com declaracao XML, comentario ou a propria tag.
  const inicio = Buffer.from(b.subarray(0, Math.min(512, b.length))).toString('utf-8').trimStart();
  if (inicio.startsWith('<?xml') || inicio.startsWith('<svg') || inicio.startsWith('<!--')) {
    if (/<svg[\s>]/i.test(inicio)) return 'image/svg+xml';
  }

  return null;
}

/** Nome de arquivo a partir do endereco de origem. */
function fileNameFromUrl(url: string, mimeType: AllowedMimeType): string {
  let base = '';
  try {
    base = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    base = '';
  }
  return safeFileName(base !== '' ? base : 'imagem-importada', mimeType);
}

/**
 * Imagem que a propria empresa ja importou antes, pelo conteudo.
 *
 * Procura nos candidatos de importacoes anteriores desta empresa com o mesmo
 * resumo criptografico dos bytes. E o que evita que reanalisar o site encha a
 * biblioteca com copias do mesmo logotipo -- e por que `hash` e guardado no
 * candidato em vez de uma coluna nova em `media_assets`: o resumo diz respeito
 * a importacao, nao ao arquivo.
 */
async function findImportedBefore(
  db: Database,
  input: { tenantId: string; hash: string },
): Promise<{ mediaId: string; url: string; fileName: string; sizeBytes: number } | null> {
  const [item] = await db
    .select({ createdEntityId: schema.siteImportItems.createdEntityId })
    .from(schema.siteImportItems)
    .where(
      and(
        eq(schema.siteImportItems.tenantId, input.tenantId),
        eq(schema.siteImportItems.kind, 'imagem'),
        eq(schema.siteImportItems.outcome, 'importado'),
        sql`${schema.siteImportItems.value} ->> 'hash' = ${input.hash}`,
      ),
    )
    .limit(1);

  if (!item?.createdEntityId) return null;

  // O arquivo pode ter sido apagado da biblioteca depois: sem esta conferencia
  // a importacao reaproveitaria um identificador que nao existe mais, e o
  // conteudo ficaria apontando para o vazio.
  const [media] = await db
    .select({
      id: schema.mediaAssets.id,
      url: schema.mediaAssets.blobUrl,
      fileName: schema.mediaAssets.fileName,
      sizeBytes: schema.mediaAssets.sizeBytes,
    })
    .from(schema.mediaAssets)
    .where(
      and(
        eq(schema.mediaAssets.id, item.createdEntityId),
        eq(schema.mediaAssets.tenantId, input.tenantId),
      ),
    );

  if (!media) return null;
  return { mediaId: media.id, url: media.url, fileName: media.fileName, sizeBytes: media.sizeBytes };
}

export interface ImageImportContext {
  db: Database;
  blob: BlobStorage;
  fetcher: SiteFetcher;
  tenantId: string;
  siteId: string;
  userId: string;
  now: () => Date;
}

/**
 * Baixa, valida e grava uma imagem.
 *
 * Devolve o resumo criptografico junto do resultado: quem chama grava o resumo
 * no candidato, e e isso que permite reconhecer a mesma imagem numa analise
 * futura.
 */
export async function importImage(
  ctx: ImageImportContext,
  input: { url: string; alt: string; tag: string },
): Promise<ImportedImage & { hash: string }> {
  if (!ctx.blob.configured) {
    throw new ImageImportError(
      'armazenamento',
      'O armazenamento de arquivos não está configurado nesta instalação.',
    );
  }

  let bytes: Uint8Array;
  try {
    const resource = await ctx.fetcher.fetch(input.url, {
      accept: 'image',
      wantBytes: true,
      maxBytes: MAX_UPLOAD_BYTES,
    });
    if (resource.status >= 400 || resource.bytes === null || resource.bytes.length === 0) {
      throw new ImageImportError(
        'indisponivel',
        resource.status >= 400
          ? `A imagem respondeu ${resource.status} no site de origem.`
          : 'A imagem não está mais disponível no site de origem.',
      );
    }
    if (resource.truncated) {
      throw new ImageImportError(
        'grande_demais',
        `A imagem passa de ${formatBytes(MAX_UPLOAD_BYTES)}, o limite por arquivo.`,
      );
    }
    bytes = resource.bytes;
  } catch (error) {
    if (error instanceof ImageImportError) throw error;
    if (error instanceof SiteFetchError) {
      const reason: ImageRejection =
        error.reason === 'grande_demais'
          ? 'grande_demais'
          : error.reason === 'tipo_recusado'
            ? 'tipo_recusado'
            : 'indisponivel';
      throw new ImageImportError(reason, error.message);
    }
    throw new ImageImportError('indisponivel', 'Não foi possível baixar a imagem.');
  }

  if (bytes.length < MIN_IMAGE_BYTES) {
    throw new ImageImportError(
      'pequena_demais',
      'O arquivo é pequeno demais para ser uma imagem de conteúdo.',
    );
  }

  const sniffed = sniffImageType(bytes);
  if (sniffed === null || !isAllowedMimeType(sniffed)) {
    throw new ImageImportError(
      'tipo_recusado',
      'O arquivo não é uma imagem em formato aceito (JPG, PNG, WEBP, AVIF ou GIF).',
    );
  }

  /**
   * SVG passa por limpeza, nao por recusa.
   *
   * Recusar era seguro e simples, mas custava caro no caso mais comum e mais
   * inocente: o **logotipo**, que boa parte dos sites tem em SVG, e que e
   * justamente a imagem que o cliente mais quer trazer.
   *
   * SVG e documento que o navegador executa -- `<script>`, `onload`,
   * `<foreignObject>`, referencia externa. Servir um de origem desconhecida
   * a partir do dominio do cliente seria publicar codigo de terceiro com a
   * confianca do dominio dele. Entao o arquivo e reconstruido por lista de
   * permissao em `sanitizeSvg`: o que nao for desenho reconhecido nao chega
   * a saida. Quando nao sobra desenho, volta a recusa e o pedido de envio
   * manual -- melhor nenhuma imagem do que uma imagem que executa.
   */
  if (sniffed === 'image/svg+xml') {
    const original = Buffer.from(bytes).toString('utf-8');
    const limpeza = sanitizeSvg(original);
    if (!limpeza.ok) {
      throw new ImageImportError('svg_recusado', limpeza.message);
    }
    // Os bytes gravados sao os limpos, nunca os originais -- inclusive para
    // o hash de duplicidade, que deve identificar o que foi de fato salvo.
    bytes = new Uint8Array(Buffer.from(limpeza.svg, 'utf-8'));
    if (limpeza.removed.length > 0) {
      console.info(
        `[import] SVG higienizado (${input.url}): removidos ${limpeza.removed.join(', ')}`,
      );
    }
  }

  const mimeType = sniffed as AllowedMimeType;
  const hash = createHash('sha256').update(bytes).digest('hex');

  const antes = await findImportedBefore(ctx.db, { tenantId: ctx.tenantId, hash });
  if (antes) {
    return { ...antes, reused: true, hash };
  }

  const plan = await loadEffectivePlan(ctx.db, ctx.tenantId);
  try {
    await assertStorageAvailable(ctx.db, ctx.tenantId, bytes.byteLength, plan);
  } catch (error) {
    throw new ImageImportError(
      'limite_de_plano',
      error instanceof Error ? error.message : 'Limite de armazenamento do plano alcançado.',
    );
  }

  const fileName = fileNameFromUrl(input.url, mimeType);
  const stored = await ctx.blob.put({
    pathname: buildBlobPathname(ctx.tenantId, fileName),
    body: bytes,
    contentType: mimeType,
  });

  const dimensoes = readDimensions(bytes, mimeType);
  const agora = ctx.now();

  const [row] = await ctx.db
    .insert(schema.mediaAssets)
    .values({
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      blobUrl: stored.url,
      blobPathname: stored.pathname,
      downloadUrl: stored.downloadUrl,
      fileName,
      mimeType,
      kind: mediaKindFor(mimeType),
      sizeBytes: bytes.byteLength,
      width: dimensoes?.width ?? null,
      height: dimensoes?.height ?? null,
      alt: input.alt.slice(0, 240),
      title: '',
      // A origem fica visivel na biblioteca: quem abrir depois sabe de onde
      // o arquivo veio sem precisar consultar o historico da importacao.
      tag: `importado-${input.tag}`.slice(0, 60),
      uploadedByUserId: ctx.userId,
      createdAt: agora,
      updatedAt: agora,
    })
    .returning({ id: schema.mediaAssets.id });

  if (!row) {
    // Evita arquivo orfao no Blob quando o registro no banco falha -- o mesmo
    // cuidado que a rota de upload do painel tem.
    await ctx.blob.remove(stored.url).catch(() => undefined);
    throw new ImageImportError('armazenamento', 'Não foi possível registrar a imagem importada.');
  }

  return {
    mediaId: row.id,
    url: stored.url,
    fileName,
    sizeBytes: bytes.byteLength,
    reused: false,
    hash,
  };
}

/**
 * Largura e altura reais, lidas do cabecalho do arquivo.
 *
 * A dimensao declarada no HTML e a que o layout do site antigo usava, nao a do
 * arquivo. Guardar a real e o que permite ao painel mostrar a proporcao certa
 * e evitar corte -- sem redimensionar nada: o arquivo vai para o Blob
 * exatamente como estava no site, preservando a qualidade original.
 */
export function readDimensions(
  bytes: Uint8Array,
  mimeType: string,
): { width: number; height: number } | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  try {
    if (mimeType === 'image/png' && view.length >= 24) {
      // IHDR comeca no byte 16 e traz largura e altura em 32 bits.
      return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
    }

    if (mimeType === 'image/gif' && view.length >= 10) {
      return { width: view.readUInt16LE(6), height: view.readUInt16LE(8) };
    }

    if (mimeType === 'image/jpeg') {
      // Percorre os marcadores ate um SOF, que e quem carrega as dimensoes.
      let offset = 2;
      while (offset + 9 < view.length) {
        if (view[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = view[offset + 1] ?? 0;
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15.
        const isSof =
          marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) {
          return { height: view.readUInt16BE(offset + 5), width: view.readUInt16BE(offset + 7) };
        }
        const length = view.readUInt16BE(offset + 2);
        if (length <= 0) break;
        offset += 2 + length;
      }
      return null;
    }

    if (mimeType === 'image/webp' && view.length >= 30) {
      const formato = view.subarray(12, 16).toString('latin1');
      if (formato === 'VP8X') {
        // Canvas em 24 bits, menos um.
        const width = 1 + (view.readUIntLE(24, 3) & 0xffffff);
        const height = 1 + (view.readUIntLE(27, 3) & 0xffffff);
        return { width, height };
      }
      if (formato === 'VP8 ') {
        return {
          width: view.readUInt16LE(26) & 0x3fff,
          height: view.readUInt16LE(28) & 0x3fff,
        };
      }
      if (formato === 'VP8L') {
        const bits = view.readUInt32LE(21);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      }
      return null;
    }
  } catch {
    // Arquivo truncado ou cabecalho fora do padrao: a dimensao e opcional, e
    // o painel lida com ela ausente.
    return null;
  }

  // AVIF guarda a dimensao numa caixa aninhada; ler isso exigiria um leitor de
  // ISOBMFF, e a dimensao nao vale esse codigo.
  return null;
}
