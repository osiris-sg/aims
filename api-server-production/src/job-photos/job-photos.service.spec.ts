import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as sharp from 'sharp';
import { JobPhotosService } from './job-photos.service';
import { SiteClockInboundGuard } from './siteclock-inbound.guard';
import { hashInboundKey, newInboundKey, parsePhotoFields, PhotoFields } from './job-photos';

const ORG = 'org-wct';
const OTHER = 'org-other';
const D = '38696ae5-1b2c-4d3e-8f90-a1b2c3d4e5f6';
const GONE = '59bc9d0d-1b2c-4d3e-8f90-a1b2c3d4e5f6';

/** A tiny in-memory stand-in for the tables the service touches. */
function fakeDb() {
  const db: any = {
    deliveries: [
      { id: D, organizationId: ORG, status: 'completed', verificationState: 'rejected', orderId: null },
      { id: 'cancelled-run', organizationId: ORG, status: 'cancelled', verificationState: null, orderId: null },
    ],
    links: [{ deliveryId: GONE, organizationId: ORG }],
    items: [{ deliveryId: D, documentId: 'doc-1' }],
    docs: [{ id: 'doc-1', organizationId: ORG, name: 'DO202611009', type: 'DELIVERY_ORDER' }],
    photos: [] as any[],
    raceOnCreate: false,
  };
  const match = (row: any, where: any) =>
    Object.entries(where || {}).every(([k, v]: any) => {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('in' in v) return v.in.includes(row[k]);
        if ('not' in v) return row[k] !== v.not;
        return true;
      }
      return v === null ? row[k] == null : row[k] === v;
    });
  db.prisma = {
    delivery: {
      findFirst: async ({ where }: any) => db.deliveries.find((r: any) => match(r, where)) ?? null,
      updateMany: async ({ where, data }: any) => {
        const rows = db.deliveries.filter((r: any) => match(r, where));
        rows.forEach((r: any) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    deliverySiteClockJob: { findFirst: async ({ where }: any) => db.links.find((r: any) => match(r, where)) ?? null },
    deliveryItem: { findMany: async ({ where }: any) => db.items.filter((r: any) => where.deliveryId.in.includes(r.deliveryId)) },
    document: { findMany: async ({ where }: any) => db.docs.filter((d: any) => where.id.in.includes(d.id) && d.organizationId === where.organizationId) },
    jobPhoto: {
      findUnique: async ({ where }: any) => {
        const k = where.organizationId_source_sourcePhotoId;
        return db.photos.find((p: any) => p.organizationId === k.organizationId && p.source === k.source && p.sourcePhotoId === k.sourcePhotoId) ?? null;
      },
      findFirst: async ({ where }: any) => db.photos.find((p: any) => match(p, where)) ?? null,
      findMany: async ({ where }: any) => db.photos.filter((p: any) => match(p, where)),
      create: async ({ data }: any) => {
        if (db.raceOnCreate) {
          db.photos.push({ ...data, id: 'winner', createdAt: new Date(), deletedAt: null });
          throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        }
        const row = { ...data, createdAt: new Date(), deletedAt: null };
        db.photos.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const rows = db.photos.filter((p: any) => match(p, where));
        rows.forEach((p: any) => Object.assign(p, data));
        return { count: rows.length };
      },
    },
    order: { findFirst: async () => null },
  };
  return db;
}

function setup(linked = true) {
  const db = fakeDb();
  const s3 = {
    uploaded: [] as string[],
    deleted: [] as string[],
    uploadFile: jest.fn(async (k: string) => {
      s3.uploaded.push(k);
      return k;
    }),
    deleteFile: jest.fn(async (k: string) => {
      s3.deleted.push(k);
    }),
    getSignedUrl: jest.fn(async (k: string, ttl: number, as?: string) => `https://signed/${k}?ttl=${ttl}${as ? `&as=${as}` : ''}`),
  };
  const documents = {
    added: [] as any[],
    removed: [] as any[],
    addAttachments: jest.fn(async (doc: string, _o: string, files: any[]) => {
      documents.added.push({ doc, files });
    }),
    removeAttachment: jest.fn(async (doc: string, _o: string, key: string) => {
      documents.removed.push({ doc, key });
    }),
  };
  const link = { isLinked: jest.fn(async () => linked) };
  const svc = new JobPhotosService(db.prisma, s3 as any, documents as any, link as any);
  return { db, s3, documents, link, svc };
}

const jpeg = () =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: '#abcdef' } })
    .jpeg()
    .toBuffer();
const fields = (over: Record<string, any> = {}) => parsePhotoFields({ externalRef: `aims-delivery:${D}`, siteclockPhotoId: 'ph_1', tag: 'STAMPED_DO', workerName: 'Ali', ...over }) as PhotoFields;

describe('JobPhotosService.receive', () => {
  it('stores the photo once: the same siteclockPhotoId again returns the same photoId and uploads nothing', async () => {
    const { svc, s3, db } = setup();
    const buf = await jpeg();
    const first = await svc.receive(ORG, fields(), { buffer: buf, size: buf.length });
    expect(first.created).toBe(true);
    expect(s3.uploaded).toHaveLength(2); // photo + thumb
    const again = await svc.receive(ORG, fields(), { buffer: buf, size: buf.length });
    expect(again).toEqual({ photoId: first.photoId, created: false });
    expect(s3.uploaded).toHaveLength(2);
    expect(db.photos).toHaveLength(1);
  });

  it("two sends at once: the loser answers with the winner's id and drops its own upload", async () => {
    const { svc, s3, db } = setup();
    db.raceOnCreate = true;
    const buf = await jpeg();
    const r = await svc.receive(ORG, fields(), { buffer: buf, size: buf.length });
    expect(r).toEqual({ photoId: 'winner', created: false });
    await new Promise((res) => setImmediate(res));
    expect(s3.deleted).toHaveLength(2);
  });

  it('the same siteclockPhotoId in another org is a different photo', async () => {
    const { svc, db } = setup();
    db.deliveries.push({ id: D, organizationId: OTHER, status: 'scheduled', verificationState: null });
    const buf = await jpeg();
    const a = await svc.receive(ORG, fields({ tag: 'SITE' }), { buffer: buf, size: buf.length });
    const b = await svc.receive(OTHER, fields({ tag: 'SITE' }), { buffer: buf, size: buf.length });
    expect(a.photoId).not.toBe(b.photoId);
  });

  it("404 for a job not in the key's org, 409 for a cancelled or deleted one", async () => {
    const { svc, s3 } = setup();
    const buf = await jpeg();
    const file = { buffer: buf, size: buf.length };
    await expect(svc.receive(OTHER, fields(), file)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.receive(ORG, { ...fields(), deliveryId: 'cancelled-run' }, file)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.receive(ORG, fields({ externalRef: `aims-delivery:${GONE}` }), file)).rejects.toThrow(/deleted/);
    expect(s3.uploaded).toHaveLength(0);
  });

  it('400 without a file or with a file that is not a photo', async () => {
    const { svc } = setup();
    await expect(svc.receive(ORG, fields(), undefined)).rejects.toBeInstanceOf(BadRequestException);
    const pdf = Buffer.from('%PDF-1.4');
    await expect(svc.receive(ORG, fields(), { buffer: pdf, size: pdf.length })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("a Stamped DO photo goes on the job's DO and sends a rejected job back to pending", async () => {
    const { svc, documents, db } = setup();
    const buf = await jpeg();
    await svc.receive(ORG, fields(), { buffer: buf, size: buf.length });
    expect(documents.added).toHaveLength(1);
    expect(documents.added[0]).toMatchObject({ doc: 'doc-1', files: [{ label: 'Stamped DO', fileName: 'Stamped DO (SiteClock).jpg' }] });
    expect(db.deliveries[0].verificationState).toBe('pending');
  });

  it('a Site photo is neither a DO attachment nor a verification change', async () => {
    const { svc, documents, db } = setup();
    const buf = await jpeg();
    await svc.receive(ORG, fields({ tag: 'SITE' }), { buffer: buf, size: buf.length });
    expect(documents.added).toHaveLength(0);
    expect(db.deliveries[0].verificationState).toBe('rejected');
  });
});

describe('JobPhotosService delete, hide, urls, lists', () => {
  async function withPhoto(tag = 'SIGNED_DO', linked = true) {
    const t = setup(linked);
    const buf = await jpeg();
    const { photoId } = await t.svc.receive(ORG, fields({ tag }), { buffer: buf, size: buf.length });
    return { ...t, photoId };
  }

  it('SiteClock DELETE is soft: hidden, file kept, DO attachment removed; deleting again is fine', async () => {
    const { svc, db, s3, documents, photoId } = await withPhoto();
    await svc.deleteFromSiteClock(ORG, photoId);
    expect(db.photos[0].deletedAt).toBeInstanceOf(Date);
    expect(db.photos[0].deletedBy).toBe('siteclock');
    expect(s3.deleted).toHaveLength(0);
    expect(documents.removed).toEqual([{ doc: 'doc-1', key: db.photos[0].fileKey }]);
    await expect(svc.deleteFromSiteClock(ORG, photoId)).resolves.toEqual({ ok: true });
    expect(documents.removed).toHaveLength(1);
    await expect(svc.urlFor(ORG, photoId, 'full')).rejects.toBeInstanceOf(NotFoundException);
    expect((await svc.forDelivery(ORG, D)).photos).toHaveLength(0);
  });

  it('another org can neither read, delete nor hide the photo', async () => {
    const { svc, photoId } = await withPhoto();
    await expect(svc.urlFor(OTHER, photoId, 'full')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.deleteFromSiteClock(OTHER, photoId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.hide(OTHER, photoId, { id: 'u' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('url: presigned for 15 minutes, thumb or full', async () => {
    const { svc, db, photoId } = await withPhoto();
    const r = await svc.urlFor(ORG, photoId, 'thumb');
    expect(r.url).toBe(`https://signed/${db.photos[0].thumbKey}?ttl=900`);
    expect(new Date(r.expiresAt).getTime() - Date.now()).toBeGreaterThan(890_000);
  });

  it('office Hide records who hid it', async () => {
    const { svc, db, photoId } = await withPhoto('SITE');
    await svc.hide(ORG, photoId, { id: 'user_1', name: 'Office Admin' });
    expect(db.photos[0]).toMatchObject({ deletedBy: 'user:user_1', deletedByName: 'Office Admin' });
  });

  it('office lists: urls + download name with the DO number; nothing for orgs without the link', async () => {
    const { svc } = await withPhoto();
    const r = await svc.forDelivery(ORG, D);
    expect(r.enabled).toBe(true);
    expect(r.photos[0]).toMatchObject({ tag: 'SIGNED_DO', tagLabel: 'Signed DO', workerName: 'Ali', source: 'siteclock' });
    expect(r.photos[0].downloadUrl).toContain('as=Signed DO - DO202611009.jpg');
    const off = await withPhoto('SITE', true);
    off.link.isLinked.mockResolvedValue(false);
    expect(await off.svc.forDelivery(ORG, D)).toEqual({ enabled: false, photos: [] });
  });
});

describe('SiteClockInboundGuard', () => {
  const key = newInboundKey();
  function guard(linked = true) {
    const conns = [{ id: 'conn-1', organizationId: ORG, inboundKeyHash: hashInboundKey(key), inboundKeyLastUsedAt: null }];
    const prisma: any = {
      siteClockConnection: {
        findUnique: async ({ where }: any) => conns.find((c) => c.inboundKeyHash === where.inboundKeyHash) ?? null,
        update: jest.fn(() => Promise.resolve({})),
      },
      organization: { findUnique: async () => ({ id: ORG, name: 'WCT' }) },
    };
    return new SiteClockInboundGuard(prisma, { isLinked: async () => linked } as any);
  }
  const ctx = (authorization?: string) => {
    const req: any = { headers: authorization ? { authorization } : {} };
    return { req, c: { switchToHttp: () => ({ getRequest: () => req }) } as any };
  };

  it('a valid key sets the org', async () => {
    const { req, c } = ctx(`Bearer ${key}`);
    await expect(guard().canActivate(c)).resolves.toBe(true);
    expect(req.userOrganization).toEqual({ id: ORG, name: 'WCT' });
    expect(req.siteclockInbound).toEqual({ connectionId: 'conn-1' });
  });

  it('401 with no key, a wrong key, a /v1 key or a revoked (rotated) key', async () => {
    for (const a of [undefined, 'Bearer ', `Bearer ${newInboundKey()}`, 'Bearer aims_live_abc', key]) {
      await expect(guard().canActivate(ctx(a).c)).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it("403 when the org's SiteClock link is turned off", async () => {
    await expect(guard(false).canActivate(ctx(`Bearer ${key}`).c)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
