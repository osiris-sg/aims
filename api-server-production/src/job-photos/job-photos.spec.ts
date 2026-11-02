import * as sharp from 'sharp';
import { deliveryIdFromRef, downloadName, hashInboundKey, INBOUND_KEY_PREFIX, newInboundKey, parsePhotoFields, photoKeys, verificationAfterDoPhoto, bearerOf } from './job-photos';
import { BadImageError, processJobPhoto } from './job-photos.image';

const D = '38696ae5-1b2c-4d3e-8f90-a1b2c3d4e5f6';
const base = {
  externalRef: `aims-delivery:${D}`,
  siteclockPhotoId: 'ph_1',
  tag: 'STAMPED_DO',
  note: 'stamped by guard',
  takenAt: '2026-11-02T06:30:00Z',
  workerSiteclockUserId: 'u1',
  workerName: 'Ali',
};

describe('deliveryIdFromRef', () => {
  it('reads the delivery id, with or without the re-create suffix', () => {
    expect(deliveryIdFromRef(`aims-delivery:${D}`)).toBe(D);
    expect(deliveryIdFromRef(`aims-delivery:${D}:2`)).toBe(D);
    expect(deliveryIdFromRef(`aims-delivery:${D.toUpperCase()}`)).toBe(D);
  });
  it('refuses anything else', () => {
    for (const r of ['', 'aims-delivery:', `delivery:${D}`, `aims-delivery:${D}:x`, `aims-delivery:not-a-uuid`, `aims-delivery:${D} extra`, null, undefined]) expect(deliveryIdFromRef(r)).toBeNull();
  });
});

describe('parsePhotoFields', () => {
  it('accepts the contract fields', () => {
    const f = parsePhotoFields(base) as any;
    expect(f).toMatchObject({ deliveryId: D, siteclockPhotoId: 'ph_1', tag: 'STAMPED_DO', note: 'stamped by guard', workerName: 'Ali', workerSiteclockUserId: 'u1' });
    expect(f.takenAt.toISOString()).toBe('2026-11-02T06:30:00.000Z');
  });
  it('takes the Idempotency-Key header when siteclockPhotoId is missing, and refuses a mismatch', () => {
    expect((parsePhotoFields({ ...base, siteclockPhotoId: undefined }, 'ph_9') as any).siteclockPhotoId).toBe('ph_9');
    expect((parsePhotoFields(base, 'ph_1') as any).siteclockPhotoId).toBe('ph_1');
    expect(parsePhotoFields(base, 'ph_2')).toMatch(/does not match/);
  });
  it('checks tag, note, takenAt and externalRef', () => {
    expect(parsePhotoFields({ ...base, tag: 'selfie' })).toMatch(/^tag must be/);
    expect((parsePhotoFields({ ...base, tag: 'signed_do' }) as any).tag).toBe('SIGNED_DO');
    expect(parsePhotoFields({ ...base, note: 'x'.repeat(301) })).toMatch(/note is too long/);
    expect(parsePhotoFields({ ...base, takenAt: 'yesterday' })).toMatch(/takenAt/);
    expect(parsePhotoFields({ ...base, externalRef: 'job-1' })).toMatch(/externalRef/);
    expect(parsePhotoFields({ ...base, siteclockPhotoId: '' })).toMatch(/siteclockPhotoId is required/);
    expect(parsePhotoFields({ ...base, note: '  ', takenAt: '' }) as any).toMatchObject({ note: null, takenAt: null });
  });
});

describe('keys and names', () => {
  it('stores under dev/ outside Render', () => {
    expect(photoKeys('o', D, 'p', false)).toEqual({ fileKey: `dev/job-photos/o/${D}/p.jpg`, thumbKey: `dev/job-photos/o/${D}/p_thumb.jpg` });
    expect(photoKeys('o', D, 'p', true).fileKey).toBe(`job-photos/o/${D}/p.jpg`);
  });
  it('names downloads by tag and DO number', () => {
    expect(downloadName('STAMPED_DO', 'DO202611009')).toBe('Stamped DO - DO202611009.jpg');
    expect(downloadName('SITE', null, 2)).toBe('Site - 2.jpg');
  });
  it('makes inbound keys that only hash-match themselves', () => {
    const k = newInboundKey();
    expect(k.startsWith(INBOUND_KEY_PREFIX)).toBe(true);
    expect(k.length).toBeGreaterThan(40);
    expect(hashInboundKey(k)).toHaveLength(64);
    expect(hashInboundKey(k)).not.toBe(hashInboundKey(newInboundKey()));
    expect(bearerOf(`Bearer ${k}`)).toBe(k);
    expect(bearerOf(k)).toBe('');
  });
});

describe('verificationAfterDoPhoto', () => {
  it('sends a rejected job back to pending, and leaves every other job alone', () => {
    expect(verificationAfterDoPhoto({ status: 'completed', verificationState: 'rejected' })).toBe('pending');
    expect(verificationAfterDoPhoto({ status: 'completed', verificationState: 'pending' })).toBeNull();
    expect(verificationAfterDoPhoto({ status: 'completed', verificationState: 'verified' })).toBeNull();
    expect(verificationAfterDoPhoto({ status: 'completed', verificationState: null })).toBeNull();
    expect(verificationAfterDoPhoto({ status: 'in_progress', verificationState: null })).toBeNull();
  });
});

describe('processJobPhoto', () => {
  const photoWithGps = () =>
    sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#8899aa' } })
      .withExif({ IFD0: { Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '1/1 17/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '103/1 51/1 0/1' } } as any)
      .jpeg()
      .toBuffer();

  it('re-encodes to JPEG at most 2560px, makes a 400px thumb, and drops EXIF (GPS included)', async () => {
    const input = await photoWithGps();
    expect((await sharp(input).metadata()).exif).toBeTruthy(); // the test photo really carries EXIF
    const out = await processJobPhoto(input);
    const full = await sharp(out.full).metadata();
    const thumb = await sharp(out.thumb).metadata();
    expect(full.format).toBe('jpeg');
    expect([full.width, full.height]).toEqual([2560, 1707]);
    expect([out.width, out.height]).toEqual([2560, 1707]);
    expect(thumb.width).toBe(400);
    expect(full.exif).toBeUndefined();
    expect(thumb.exif).toBeUndefined();
    expect(out.full.includes(Buffer.from('TestCam'))).toBe(false);
  });

  it('accepts PNG, refuses non-images and other formats', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#00000000' } })
      .png()
      .toBuffer();
    expect((await sharp((await processJobPhoto(png)).full).metadata()).format).toBe('jpeg');
    await expect(processJobPhoto(Buffer.from('%PDF-1.4 not a photo'))).rejects.toBeInstanceOf(BadImageError);
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
      .gif()
      .toBuffer();
    await expect(processJobPhoto(gif)).rejects.toThrow(/JPEG, PNG or WebP/);
  });
});
