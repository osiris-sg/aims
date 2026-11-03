import { BadRequestException, NotFoundException } from '@nestjs/common';
import AdmZip = require('adm-zip');
import { MaintenanceReportsService } from './maintenance-reports.service';
import { serviceReportFileName, uniqueFileName } from './service-report-filename';

/**
 * POST /maintenance-reports/bulk-pdf (2026-11-03): one zip of the separate
 * report PDFs. Built without Nest: a small in-memory Prisma that honours the
 * org + kind filter, and renderReportPdf stubbed to stamp the report's id.
 */
const ORG = 'org-biofuel';
type Row = { id: string; organizationId: string; kind: string; status: string; reportNumber: number | null; serviceData: any; signedAt: Date | null; createdAt: Date };

function row(n: number, extra: Partial<Row> = {}): Row {
  return {
    id: `r${n}`,
    organizationId: ORG,
    kind: 'SERVICE',
    status: 'completed',
    reportNumber: n,
    serviceData: { customerName: 'Capital Cranes Global Pte Ltd', serviceDate: '2026-11-03' },
    signedAt: new Date('2026-11-03T08:44:34Z'),
    createdAt: new Date(2026, 10, n),
    ...extra,
  };
}

function service(rows: Row[]) {
  const findMany = jest.fn(async ({ where }: any) =>
    // Deliberately NOT the request's order: the zip must follow the ids, not the DB.
    rows
      .filter((r) => where.id.in.includes(r.id) && r.organizationId === where.organizationId && r.kind === where.kind)
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
  const svc: any = Object.create(MaintenanceReportsService.prototype);
  svc.prisma = {
    maintenanceServiceReport: { findMany },
    accountingSetting: { findUnique: async () => ({ timeZone: 'Asia/Singapore' }) },
  };
  svc.renderReportPdf = jest.fn(async (r: Row) => Buffer.from(`%PDF ${r.id}`));
  return { svc: svc as MaintenanceReportsService, findMany, render: svc.renderReportPdf as jest.Mock };
}

const entries = (buffer: Buffer) =>
  new AdmZip(buffer).getEntries().map((e: any) => [e.entryName, e.getData().toString()]);

describe('getReportsZip (bulk download)', () => {
  it('zips one PDF per report, in the order asked (newest first), named for finding', async () => {
    const { svc } = service([row(143), row(145), row(144)]);
    const { buffer, filename } = await svc.getReportsZip(['r145', 'r144', 'r143'], ORG);
    expect(entries(buffer)).toEqual([
      ['Service report #145 Capital Cranes Global 2026-11-03.pdf', '%PDF r145'],
      ['Service report #144 Capital Cranes Global 2026-11-03.pdf', '%PDF r144'],
      ['Service report #143 Capital Cranes Global 2026-11-03.pdf', '%PDF r143'],
    ]);
    expect(filename).toMatch(/^Service reports \d{4}-\d{2}-\d{2} \(3\)\.zip$/);
  });

  it('another org’s report (or an unknown id) is a 404, and nothing is rendered', async () => {
    const { svc, render, findMany } = service([row(1), row(2, { organizationId: 'org-other' })]);
    await expect(svc.getReportsZip(['r1', 'r2'], ORG)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.getReportsZip(['r1', 'nope'], ORG)).rejects.toBeInstanceOf(NotFoundException);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ organizationId: ORG, kind: 'SERVICE' });
    expect(render).not.toHaveBeenCalled();
  });

  it('a DO report id is not a service report: 404', async () => {
    const { svc } = service([row(1, { kind: 'DO_ACK' })]);
    await expect(svc.getReportsZip(['r1'], ORG)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('at most 50 reports; 50 is fine, 51 is refused before any read', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => row(i + 1));
    const { svc, findMany } = service(rows);
    await expect(svc.getReportsZip(rows.map((r) => r.id), ORG)).rejects.toThrow(/At most 50 reports .*51 selected/);
    expect(findMany).not.toHaveBeenCalled();
    const ok = await svc.getReportsZip(rows.slice(0, 50).map((r) => r.id), ORG);
    expect(entries(ok.buffer)).toHaveLength(50);
  });

  it('a draft rejects the whole request and says which', async () => {
    const { svc, render } = service([row(10), row(12, { status: 'draft' }), row(15, { status: 'draft' })]);
    await expect(svc.getReportsZip(['r10', 'r12', 'r15'], ORG)).rejects.toThrow('Only signed reports can be downloaded. Still drafts: #12, #15');
    expect(render).not.toHaveBeenCalled();
  });

  it('repeated ids count once; empty or malformed lists are a 400', async () => {
    const { svc } = service([row(1)]);
    const { buffer } = await svc.getReportsZip(['r1', 'r1'], ORG);
    expect(entries(buffer)).toHaveLength(1);
    for (const bad of [[], undefined, 'r1', [1], ['']]) {
      await expect(svc.getReportsZip(bad, ORG)).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});

describe('serviceReportFileName', () => {
  it('drops the company tail and unsafe characters; falls back to the signed date', () => {
    expect(serviceReportFileName(row(7, { serviceData: { customerName: 'A/B Marine Pte. Ltd.' }, signedAt: new Date('2026-11-02T17:30:00Z') }), 'Asia/Singapore')).toBe(
      'Service report #7 A B Marine 2026-11-03.pdf',
    );
    expect(serviceReportFileName(row(8, { reportNumber: null, serviceData: {} }))).toBe('Service report r8 2026-11-03.pdf');
  });

  it('two reports with the same name get (2), (3)', () => {
    const taken = new Set<string>();
    expect(['a.pdf', 'a.pdf', 'A.pdf'].map((n) => uniqueFileName(n, taken))).toEqual(['a.pdf', 'a (2).pdf', 'A (3).pdf']);
  });
});
