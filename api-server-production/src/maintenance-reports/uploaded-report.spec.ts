import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import AdmZip = require('adm-zip');
import { MaintenanceReportsService } from './maintenance-reports.service';
import { uniqueFileName } from './service-report-filename';

/**
 * Uploaded service reports + the photos file (2026-11-12). Built without Nest:
 * a small in-memory Prisma, S3 returning the key's bytes, and spies on the
 * email path and the order link.
 */
const ORG = 'org-wct';
const FOLDER = `maintenance-reports/${ORG}/uploads`;
const PDF = { fileKey: `${FOLDER}/scan.pdf`, fileName: 'scan.pdf', mimeType: 'application/pdf' };
const JPG = { fileKey: `${FOLDER}/scan.jpg`, fileName: 'scan.jpg', mimeType: 'image/jpeg' };

function service(opts: { maxNumber?: number | null; wctOrders?: boolean; raceOnce?: boolean; rows?: any[] } = {}) {
  const rows: any[] = opts.rows ?? [];
  let raced = false;
  const create = jest.fn(async ({ data }: any) => {
    if (opts.raceOnce && !raced) {
      raced = true;
      throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
    }
    const row = { id: `new-${rows.length + 1}`, createdAt: new Date(), ...data };
    rows.push(row);
    return row;
  });
  let max = opts.maxNumber ?? null;
  const findFirstNumber = jest.fn(async () => {
    const out = max == null ? null : { reportNumber: max };
    if (opts.raceOnce && max != null) max += 1; // the racer took the number we saw
    return out;
  });
  const svc: any = Object.create(MaintenanceReportsService.prototype);
  svc.prisma = {
    maintenanceServiceReport: {
      create,
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.reportNumber) return findFirstNumber();
        return rows.find((r) => r.id === where.id && r.organizationId === where.organizationId) ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => where.id.in.includes(r.id) && r.organizationId === where.organizationId)),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
    },
    customer: { findFirst: jest.fn(async ({ where }: any) => (where.id === 'c1' && where.organizationId === ORG ? { id: 'c1', name: 'Capital Cranes Pte Ltd' } : null)) },
    order: { findFirst: jest.fn(async ({ where }: any) => (where.id === 'o1' && where.organizationId === ORG ? { id: 'o1' } : null)) },
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableWctOrders: !!opts.wctOrders } })) },
    accountingSetting: { findUnique: async () => ({ timeZone: 'Asia/Singapore' }) },
  };
  svc.s3Service = { downloadFile: jest.fn(async (key: string) => Buffer.from(`FILE ${key}`)) };
  svc.email = { sendServiceReportEmail: jest.fn(), getAdminEmail: () => 'admin@x' };
  svc.ordersService = { addOrderAttachment: jest.fn(async () => []) };
  svc.renderReportPdf = jest.fn(async (r: any) => Buffer.from(`%PDF ${r.id}`));
  svc.sendReportEmailInBackground = jest.fn(async () => undefined);
  return { svc: svc as any, rows, create };
}

describe('createUploaded (Upload Service Report)', () => {
  it('takes the org’s highest number + 1, stored completed + uploaded, unsigned', async () => {
    const { svc } = service({ maxNumber: 41 });
    const r: any = await svc.createUploaded({ ...PDF, customerId: 'c1', location: ' 55 Chai Chee ', serviceDate: '2026-11-10' }, ORG, 'u1');
    expect(r.reportNumber).toBe(42);
    expect(r).toMatchObject({ status: 'completed', kind: 'SERVICE', technicianUserId: 'u1', paymentRequired: false });
    expect(r.signedAt).toBeUndefined();
    expect(r.serviceData).toMatchObject({
      uploaded: true,
      uploadedFile: { key: PDF.fileKey, fileName: 'scan.pdf', mimeType: 'application/pdf' },
      customerName: 'Capital Cranes Pte Ltd',
      jobLocation: '55 Chai Chee',
      serviceDate: '2026-11-10',
    });
  });

  it('the first report of an org is #1; a lost race retries with the next number', async () => {
    expect(((await service({ maxNumber: null }).svc.createUploaded(PDF, ORG, 'u1')) as any).reportNumber).toBe(1);
    const { svc, create } = service({ maxNumber: 7, raceOnce: true });
    const r: any = await svc.createUploaded(PDF, ORG, 'u1');
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.reportNumber).toBe(9);
  });

  it('never emails the customer', async () => {
    const { svc } = service({ maxNumber: 3 });
    await svc.createUploaded({ ...PDF, customerId: 'c1' }, ORG, 'u1');
    expect(svc.sendReportEmailInBackground).not.toHaveBeenCalled();
    expect(svc.email.sendServiceReportEmail).not.toHaveBeenCalled();
  });

  it('the background sender skips an uploaded report even if called', async () => {
    const { svc, rows } = service();
    rows.push({ id: 'u', organizationId: ORG, serviceData: { uploaded: true, uploadedFile: { key: PDF.fileKey, mimeType: 'application/pdf' }, clientEmail: 'a@b.c' } });
    const real = MaintenanceReportsService.prototype['sendReportEmailInBackground' as keyof MaintenanceReportsService] as any;
    (svc.prisma as any).maintenanceServiceReport.findUnique = jest.fn(async () => rows[0]);
    await real.call(svc, 'u');
    expect(svc.renderReportPdf).not.toHaveBeenCalled();
    expect(svc.email.sendServiceReportEmail).not.toHaveBeenCalled();
  });

  it('defaults the service date to today; links a WCT order through the order attachment', async () => {
    const { svc } = service({ maxNumber: 1, wctOrders: true });
    const r: any = await svc.createUploaded({ ...JPG, orderId: 'o1' }, ORG, 'u1');
    expect(r.serviceData.serviceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(svc.ordersService.addOrderAttachment).toHaveBeenCalledWith('o1', ORG, { kind: 'report', reportId: r.id }, { id: 'u1' });
  });

  it('refuses a key outside the org’s folder, a non-PDF/image, another org’s customer, or an order without WCT orders', async () => {
    const { svc, create } = service({ maxNumber: 1 });
    await expect(svc.createUploaded({ ...PDF, fileKey: 'maintenance-reports/org-other/x.pdf' }, ORG, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createUploaded({ ...PDF, mimeType: 'application/zip' }, ORG, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createUploaded({ ...PDF, customerId: 'c-other' }, ORG, 'u1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.createUploaded({ ...PDF, orderId: 'o1' }, ORG, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('downloads of an uploaded report', () => {
  const uploadedRow = (id: string, n: number, file = PDF) => ({
    id,
    organizationId: ORG,
    kind: 'SERVICE',
    status: 'completed',
    reportNumber: n,
    signedAt: null,
    createdAt: new Date('2026-11-12T03:00:00Z'),
    serviceData: { uploaded: true, uploadedFile: { key: file.fileKey, fileName: file.fileName, mimeType: file.mimeType }, customerName: 'Capital Cranes Pte Ltd', serviceDate: '2026-11-12' },
  });

  it('GET :id/pdf returns the uploaded file as stored, not a rendered report', async () => {
    const { svc } = service({ rows: [uploadedRow('a', 12), uploadedRow('b', 13, JPG)] });
    const pdf = await svc.getReportPdf('a', ORG);
    expect(pdf).toEqual({ buffer: Buffer.from(`FILE ${PDF.fileKey}`), filename: 'service-report-12.pdf', contentType: 'application/pdf' });
    const img = await svc.getReportPdf('b', ORG);
    expect(img.filename).toBe('service-report-13.jpg');
    expect(img.contentType).toBe('image/jpeg');
    expect(svc.renderReportPdf).not.toHaveBeenCalled();
  });

  it('"Download selected" puts the uploaded file in the zip next to rendered reports', async () => {
    const generated = { ...uploadedRow('g', 11), serviceData: { customerName: 'Capital Cranes Pte Ltd', serviceDate: '2026-11-12' } };
    const { svc } = service({ rows: [uploadedRow('a', 12), uploadedRow('b', 13, JPG), generated] });
    const { buffer } = await svc.getReportsZip(['b', 'a', 'g'], ORG);
    const got = new AdmZip(buffer).getEntries().map((e: any) => [e.entryName, e.getData().toString()]);
    expect(got).toEqual([
      ['Service report #13 Capital Cranes 2026-11-12.jpg', `FILE ${JPG.fileKey}`],
      ['Service report #12 Capital Cranes 2026-11-12.pdf', `FILE ${PDF.fileKey}`],
      ['Service report #11 Capital Cranes 2026-11-12.pdf', '%PDF g'],
    ]);
  });

  it('uniqueFileName numbers any extension', () => {
    const taken = new Set<string>();
    expect(['a.jpg', 'a.jpg', 'a.pdf'].map((n) => uniqueFileName(n, taken))).toEqual(['a.jpg', 'a (2).jpg', 'a.pdf']);
  });
});

describe('photos file', () => {
  const plain = () => ({ id: 'r1', organizationId: ORG, kind: 'SERVICE', status: 'completed', reportNumber: 5, serviceData: { customerName: 'X' } });

  it('attach, replace and remove on a signed report; the rest of serviceData is kept', async () => {
    const { svc, rows } = service({ rows: [plain()] });
    await svc.setPhotosFile('r1', PDF, ORG, 'u1');
    expect(rows[0].serviceData).toMatchObject({ customerName: 'X', photosFile: { key: PDF.fileKey, mimeType: 'application/pdf', addedBy: 'u1' } });
    await svc.setPhotosFile('r1', JPG, ORG, 'u1');
    expect(rows[0].serviceData.photosFile.key).toBe(JPG.fileKey);
    const file = await svc.getPhotosFile('r1', ORG);
    expect(file.filename).toBe('service-report-5-photos.jpg');
    await svc.removePhotosFile('r1', ORG);
    expect(rows[0].serviceData).toEqual({ customerName: 'X' });
    await expect(svc.removePhotosFile('r1', ORG)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.getPhotosFile('r1', ORG)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('another org’s report is a 404; a DO report cannot carry one', async () => {
    const { svc } = service({ rows: [{ ...plain(), organizationId: 'org-other' }, { ...plain(), id: 'd1', kind: 'DO_ACK' }] });
    await expect(svc.setPhotosFile('r1', PDF, ORG)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.setPhotosFile('d1', PDF, ORG)).rejects.toBeInstanceOf(BadRequestException);
  });
});
