// Image checks and processing for uploads (PRD CAT-07, Implementation Plan step 17). The type
// comes from the file's first bytes, never from its name or the browser's Content-Type.
import { PHOTO_HEIGHT, PHOTO_WIDTH } from '@vote-kidigit/shared';
import sharp from 'sharp';
import { AppError } from '../../common/app-error.js';
import type { FileKind } from '../../generated/prisma/enums.js';

export type ImageKind = Extract<
  FileKind,
  'org_logo' | 'category_picture' | 'contester_photo' | 'voter_photo'
>;

export interface ProcessedImage {
  data: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
  extension: 'jpg' | 'png';
  width: number;
  height: number;
}

/** Logos keep their shape (and PNG transparency) and fit inside this square. */
export const LOGO_MAX_SIDE = 512;

/** A 2 MB PNG can expand to a huge bitmap; refuse anything above 40 megapixels. */
const MAX_INPUT_PIXELS = 40_000_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** JPEG or PNG by magic number, or null for anything else. */
export function detectImageType(data: Buffer): 'image/jpeg' | 'image/png' | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  return null;
}

/**
 * Photos are cover-cropped to 350 × 490 (5:7) JPEG at quality 82; logos are scaled down to fit
 * 512 × 512 as PNG. sharp writes no metadata unless asked, so EXIF (GPS, camera) is dropped;
 * the orientation is applied to the pixels first.
 */
export async function processImage(kind: ImageKind, input: Buffer): Promise<ProcessedImage> {
  if (!detectImageType(input)) throw new AppError('FILE_TYPE');
  const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
  try {
    if (kind === 'org_logo') {
      const { data, info } = await image
        .resize(LOGO_MAX_SIDE, LOGO_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
      return {
        data,
        mimeType: 'image/png',
        extension: 'png',
        width: info.width,
        height: info.height,
      };
    }
    const { data, info } = await image
      .resize(PHOTO_WIDTH, PHOTO_HEIGHT, { fit: 'cover', position: 'centre' })
      // Transparent PNG areas become white rather than black in the JPEG.
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      data,
      mimeType: 'image/jpeg',
      extension: 'jpg',
      width: info.width,
      height: info.height,
    };
  } catch {
    // Damaged or oversized images: sharp's message is not shown to the user.
    throw new AppError('FILE_TYPE', 'The image could not be read.');
  }
}
