// Photo and logo processing (PRD CAT-07): type detection, the 350 × 490 crop, metadata removal.
import sharp from 'sharp';
import { AppError } from '../../common/app-error.js';
import { detectImageType, LOGO_MAX_SIDE, processImage } from './image-processing.js';

const red = { r: 200, g: 40, b: 40 };

function image(width: number, height: number, format: 'jpeg' | 'png', alpha = false) {
  const base = sharp({
    create: { width, height, channels: alpha ? 4 : 3, background: { ...red, alpha: 0.5 } },
  });
  return format === 'jpeg'
    ? base
        .jpeg()
        .withExif({ IFD0: { Copyright: 'Kamera ya Juma', Software: 'Simu' } })
        .toBuffer()
    : base.png().toBuffer();
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error: unknown = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

describe('image processing', () => {
  it('recognises JPEG and PNG by their first bytes only', async () => {
    expect(detectImageType(await image(10, 10, 'jpeg'))).toBe('image/jpeg');
    expect(detectImageType(await image(10, 10, 'png'))).toBe('image/png');
    expect(detectImageType(Buffer.from('GIF89a……'))).toBeNull();
    expect(detectImageType(Buffer.from('name,phone\nJuma,0712'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });

  it('crops a photo to 350 × 490 JPEG and drops its metadata', async () => {
    const input = await image(1200, 900, 'jpeg');
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processImage('contester_photo', input);
    expect(out).toMatchObject({
      mimeType: 'image/jpeg',
      extension: 'jpg',
      width: 350,
      height: 490,
    });
    const meta = await sharp(out.data).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 350, height: 490 });
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  });

  it('enlarges small photos and fills transparent PNG areas', async () => {
    const out = await processImage('voter_photo', await image(70, 98, 'png', true));
    const meta = await sharp(out.data).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 350, height: 490, hasAlpha: false });
  });

  it('fits a logo inside 512 × 512 as PNG, keeping its shape and transparency', async () => {
    const out = await processImage('org_logo', await image(1600, 400, 'png', true));
    expect(out).toMatchObject({ mimeType: 'image/png', width: LOGO_MAX_SIDE, height: 128 });
    expect((await sharp(out.data).metadata()).hasAlpha).toBe(true);
    const small = await processImage('org_logo', await image(120, 60, 'jpeg'));
    expect([small.width, small.height]).toEqual([120, 60]);
  });

  it('refuses other types and damaged images as FILE_TYPE', async () => {
    await expectCode(processImage('contester_photo', Buffer.from('%PDF-1.7')), 'FILE_TYPE');
    const jpeg = await image(400, 400, 'jpeg');
    await expectCode(
      processImage('contester_photo', jpeg.subarray(0, jpeg.length / 3)),
      'FILE_TYPE',
    );
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 7),
    ]);
    await expectCode(processImage('org_logo', png), 'FILE_TYPE');
  });
});
