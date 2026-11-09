// Browser side of photo uploads (PRD CAT-07): the type and size check before anything is sent,
// and the 5:7 crop drawn at the stored size, 350 × 490. The server checks and crops again.
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, PHOTO_HEIGHT, PHOTO_WIDTH } from '@vote-kidigit/shared';

/** JPG or PNG up to 2 MB (the type the browser reports; the server reads the bytes). */
export function isAcceptedImage(file: Blob): boolean {
  return (
    (IMAGE_MIME_TYPES as readonly string[]).includes(file.type) && file.size <= MAX_IMAGE_BYTES
  );
}

export const ACCEPTED_IMAGE_TYPES = IMAGE_MIME_TYPES.join(',');

/** The part of the image chosen in the crop dialog, in the image's own pixels. */
export interface PixelArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image could not be read'));
    image.src = src;
  });
}

/** Draws `area` of the image at 350 × 490 and returns it as a JPEG (white behind transparency). */
export async function cropToPhoto(src: string, area: PixelArea): Promise<Blob> {
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_WIDTH;
  canvas.height = PHOTO_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available');
  context.fillStyle = 'white';
  context.fillRect(0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    PHOTO_WIDTH,
    PHOTO_HEIGHT,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The crop could not be saved'))),
      'image/jpeg',
      0.92,
    );
  });
}
