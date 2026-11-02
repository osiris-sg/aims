import * as sharp from 'sharp';
import { FULL_EDGE, THUMB_WIDTH } from './job-photos';

/** An upload AIMS refuses (not an image it can read). */
export class BadImageError extends Error {}

const ACCEPTED = new Set(['jpeg', 'png', 'webp']);

/**
 * The stored copies of an uploaded photo: re-encoded as JPEG, turned upright
 * from its EXIF orientation, at most FULL_EDGE px on the long edge, plus a
 * THUMB_WIDTH px thumbnail. sharp writes no metadata unless asked, so the
 * camera's EXIF (GPS location included) is gone from both. The type is read
 * from the bytes, never from the declared mime type.
 */
export async function processJobPhoto(input: Buffer): Promise<{ full: Buffer; thumb: Buffer; width: number; height: number }> {
  let format: string | undefined;
  try {
    format = (await sharp(input).metadata()).format;
  } catch {
    throw new BadImageError('The file is not an image');
  }
  if (!format || !ACCEPTED.has(format)) throw new BadImageError('Only JPEG, PNG or WebP photos are accepted');
  try {
    const full = await sharp(input)
      .rotate()
      .resize({ width: FULL_EDGE, height: FULL_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(full.data).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
    return { full: full.data, thumb, width: full.info.width, height: full.info.height };
  } catch {
    throw new BadImageError('The photo could not be read');
  }
}
