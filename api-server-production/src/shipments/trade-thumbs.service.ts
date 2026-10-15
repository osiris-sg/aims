import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';

/** Thumbnail width in px (the step row shows ~120 px; the Files tab ~48 px; 2× for sharp screens). */
export const THUMB_WIDTH = 360;
const SIGNED_URL_TTL = 600;

/** PDFs and the browser image types get a thumbnail; Office / Outlook files show a type icon instead. */
export const thumbable = (mimeType: string) => mimeType === 'application/pdf' || /^image\/(png|jpe?g|webp)$/.test(mimeType);

/** The thumbnail sits next to the file in S3. */
export const thumbKeyOf = (s3Key: string) => `${s3Key}.thumb.png`;

/**
 * First page of a PDF (pdf-to-png-converter = pdf.js + @napi-rs/canvas, both
 * already used for PDF work in this API; glyphs drawn as paths so the
 * Japanese fonts render) or a scaled-down image, as a PNG THUMB_WIDTH wide.
 * The libraries load lazily so nothing else pays for them.
 */
export async function renderThumbnail(buffer: Buffer, mimeType: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  let source: Buffer = buffer;
  if (mimeType === 'application/pdf') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { pdfToPng } = require('pdf-to-png-converter');
    const [page] = await pdfToPng(buffer, { pagesToProcess: [1], viewportScale: 1, returnPageContent: true, disableFontFace: true, useSystemFonts: false });
    if (!page?.content) throw new Error('The PDF has no pages');
    source = page.content;
  }
  const img = await loadImage(source);
  const width = Math.min(THUMB_WIDTH, img.width);
  const height = Math.max(1, Math.round((img.height * width) / img.width));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // White behind transparent PNGs (a seal or a scan) so they read on the dark theme too.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toBuffer('image/png');
}

/**
 * Thumbnails for trade files: made on upload (best effort — a file that can't
 * be rendered just has none), served through short-lived signed URLs under the
 * org's prefix like the file itself, and removed with the file.
 */
@Injectable()
export class TradeThumbsService {
  private readonly logger = new Logger(TradeThumbsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  /** Render + store the thumbnail; returns its key, or null when the type has none or rendering failed. */
  async make(organizationId: string, fileId: string, buffer?: Buffer): Promise<string | null> {
    const f = await this.prisma.tradeFile.findFirst({ where: { id: fileId, organizationId }, select: { s3Key: true, mimeType: true, fileName: true } });
    if (!f || !thumbable(f.mimeType)) return null;
    try {
      const png = await renderThumbnail(buffer ?? (await this.s3.downloadFile(f.s3Key)), f.mimeType);
      const key = thumbKeyOf(f.s3Key);
      await this.s3.uploadFile(key, png, 'image/png');
      await this.prisma.tradeFile.update({ where: { id: fileId }, data: { thumbKey: key } });
      return key;
    } catch (e) {
      this.logger.warn(`No thumbnail for ${f.fileName}: ${(e as Error)?.message}`);
      return null;
    }
  }

  /** Signed URL of a file's thumbnail; { url: null } when it has none. */
  async url(organizationId: string, fileId: string) {
    const f = await this.prisma.tradeFile.findFirst({ where: { id: fileId, organizationId }, select: { thumbKey: true } });
    if (!f) throw new NotFoundException('File not found');
    if (!f.thumbKey) return { url: null, expiresIn: 0 };
    if (!f.thumbKey.startsWith(`shipments/${organizationId}/`)) throw new ForbiddenException('File not in this organization');
    return { url: await this.s3.getSignedUrl(f.thumbKey, SIGNED_URL_TTL), expiresIn: SIGNED_URL_TTL };
  }

  async removeObject(key: string | null | undefined) {
    if (!key) return;
    await this.s3.deleteFile(key).catch((e) => this.logger.warn(`Could not remove thumbnail ${key}: ${e?.message}`));
  }
}
