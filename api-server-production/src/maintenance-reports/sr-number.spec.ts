import { MaintenanceReportsService } from './maintenance-reports.service';
import { claimSrNumber, formatSrNumber, nextSrSerial, reportNoLabel, reportTitle, srNumberOf, srPrefix } from './sr-number';
import { serviceReportFileName } from './service-report-filename';
import { DocLinksService } from '../orders/doc-links.service';

// WCT group service report numbers + the service report flow fixes (UAT 2026-11-25).
const ORG = 'org-wct';
const FOLDER = `maintenance-reports/${ORG}/uploads`;
const PDF = { fileKey: `${FOLDER}/scan.pdf`, fileName: 'scan.pdf', mimeType: 'application/pdf' };

describe('SR number format (pure)', () => {
  it('SR<yyyymm>-<4 digits> from the org day', () => {
    expect(srPrefix('2026-11-25')).toBe('SR202611-');
    expect(formatSrNumber('2026-11-25', 1)).toBe('SR202611-0001');
    expect(formatSrNumber('2026-12-01', 42)).toBe('SR202612-0042');
    expect(formatSrNumber('2026-12-01', 12345)).toBe('SR202612-12345');
    expect(() => srPrefix('')).toThrow();
  });
  it('the next serial: one past the highest of the same month, anything else ignored', () => {
    expect(nextSrSerial([], 'SR202611-')).toBe(1);
    expect(nextSrSerial(['SR202611-0001', 'SR202611-0007', 'SR202610-0099', null, 'SR202611-x', '#5'], 'SR202611-')).toBe(8);
  });
  it('labels: the SR number, else #n, else null', () => {
    expect(srNumberOf({ srNumber: 'SR202611-0003' })).toBe('SR202611-0003');
    expect(srNumberOf({ srNumber: 'junk' })).toBeNull();
    expect(reportNoLabel({ reportNumber: 5, serviceData: { srNumber: 'SR202611-0003' } })).toBe('SR202611-0003');
    expect(reportNoLabel({ reportNumber: 5, serviceData: {} })).toBe('#5');
    expect(reportNoLabel({ reportNumber: null, serviceData: null })).toBeNull();
    expect(reportTitle({ reportNumber: null })).toBe('Service report (draft)');
    expect(reportTitle({ reportNumber: 4, serviceData: { srNumber: 'SR202611-0001' } })).toBe('Service report SR202611-0001');
  });
  it('the file name carries the SR number (else #n as before)', () => {
    expect(serviceReportFileName({ id: 'abcdef123', reportNumber: 4, serviceData: { srNumber: 'SR202611-0001', customerName: 'Acme Pte Ltd', serviceDate: '2026-11-25' } })).toBe('Service report SR202611-0001 Acme 2026-11-25.pdf');
    expect(serviceReportFileName({ id: 'abcdef123', reportNumber: 4, serviceData: { customerName: 'Acme Pte Ltd', serviceDate: '2026-11-25' } })).toBe('Service report #4 Acme 2026-11-25.pdf');
  });
  it('claimSrNumber: takes the org lock, then one past the highest of the month', async () => {
    const tx: any = {
      $executeRawUnsafe: jest.fn(async () => 1),
      maintenanceServiceReport: { findMany: jest.fn(async () => [{ serviceData: { srNumber: 'SR202611-0002' } }, { serviceData: { srNumber: 'SR202611-0009', deletedAt: 'x' } }]) },
    };
    expect(await claimSrNumber(tx, ORG, '2026-11-25')).toBe('SR202611-0010');
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), `sr-number:${ORG}`);
    expect(tx.maintenanceServiceReport.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: ORG, serviceData: { path: ['srNumber'], string_starts_with: 'SR202611-' } } }));
  });
});

/** A small in-memory Prisma for the numbering paths; `flags` = the org's features. */
function world(flags: Record<string, unknown>, rows: any[] = []) {
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: flags })) },
    accountingSetting: { findUnique: jest.fn(async () => ({ timeZone: 'Asia/Singapore' })) },
    customer: { findFirst: jest.fn(async () => ({ id: 'c1', name: 'Acme Pte Ltd', email: 'acme@x.sg' })) },
    $executeRawUnsafe: jest.fn(async () => 1),
    maintenanceServiceReport: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.reportNumber) {
          const nums = rows.map((r) => r.reportNumber).filter((n) => n != null);
          return nums.length ? { reportNumber: Math.max(...nums) } : null;
        }
        return rows.find((r) => r.id === where.id) ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => typeof r.serviceData?.srNumber === 'string' && r.serviceData.srNumber.startsWith(where.serviceData.string_starts_with))),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `r${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
    },
    delivery: { findFirst: jest.fn(async () => null) },
    document: { findFirst: jest.fn(async () => null) },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const svc: any = Object.create(MaintenanceReportsService.prototype);
  Object.assign(svc, { prisma, ordersService: { addOrderAttachment: jest.fn(async () => []) }, sendReportEmailInBackground: jest.fn(async () => undefined) });
  return { svc, prisma, rows };
}

describe('uploaded and template reports share the SR number (WCT group only)', () => {
  it('WCT group (enableWctDocNav): an upload gets SR<yyyymm>-0001 next to its running number', async () => {
    const { svc, prisma } = world({ enableWctDocNav: true }, [{ id: 'old', reportNumber: 4, serviceData: {} }]);
    const r: any = await svc.createUploaded(PDF, ORG, 'u1');
    expect(r.reportNumber).toBe(5);
    expect(r.serviceData.srNumber).toMatch(/^SR\d{6}-0001$/);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('every other org: no SR number, no transaction, the plain running number as before', async () => {
    const { svc, prisma } = world({ enableWctOrders: true }, [{ id: 'old', reportNumber: 4, serviceData: {} }]);
    const r: any = await svc.createUploaded(PDF, ORG, 'u1');
    expect(r.reportNumber).toBe(5);
    expect(r.serviceData.srNumber).toBeUndefined();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a template (office) report completed in a WCT group org gets the next SR number of the month', async () => {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    const prefix = srPrefix(day);
    const { svc } = world({ enableWctDocNav: true }, [
      { id: 'up', reportNumber: 7, serviceData: { uploaded: true, srNumber: `${prefix}0001` } },
      { id: 'r9', reportNumber: null, status: 'draft', deliveryId: null, serviceData: { scheduled: true, office: true, doDocumentId: 'd1' } },
    ]);
    const out: any = await svc.completeScheduled('r9', { serviceData: { remarks: 'ok' } }, ORG, 'u1');
    expect(out.reportNumber).toBe(8);
    expect(out.serviceData.srNumber).toBe(`${prefix}0002`);
  });

  it('a reopened old report keeps its number: no SR number is added', async () => {
    const { svc, prisma } = world({ enableWctDocNav: true }, [{ id: 'r3', reportNumber: 3, status: 'draft', deliveryId: null, serviceData: { scheduled: true, office: true, doDocumentId: 'd1' } }]);
    const out: any = await svc.completeScheduled('r3', { serviceData: {} }, ORG, 'u1');
    expect(out.reportNumber).toBe(3);
    expect(out.serviceData.srNumber).toBeUndefined();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('the Finish step does not get the customer email', () => {
  it('createOffice stores no customer email (the email box starts empty)', async () => {
    const writes: any[] = [];
    const prisma: any = {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableWctOrders: true, enableManualOrderFlow: true } })) },
      customer: { findFirst: jest.fn(async () => ({ id: 'c1', name: 'Acme', email: 'acme@x.sg' })) },
      document: { findFirst: jest.fn(async () => ({ id: 'd1', name: 'DO1', config: { customerId: 'c1' } })) },
      deliveryItem: { findFirst: jest.fn(async () => ({ deliveryId: 'j1', delivery: { siteAddress: 'x' } })) },
      maintenanceServiceReport: {
        findFirst: jest.fn(async () => ({ id: 'open', serviceData: { scheduled: true, clientEmail: 'acme@x.sg' } })),
        update: jest.fn(async (a: any) => (writes.push(a), { id: 'open' })),
        create: jest.fn(async (a: any) => (writes.push(a), { id: 'new' })),
      },
      accountingSetting: { findUnique: jest.fn(async () => null) },
    };
    const svc: any = Object.create(MaintenanceReportsService.prototype);
    Object.assign(svc, { prisma });
    await svc.createOffice({ customerId: 'c1', doDocumentId: 'd1' }, ORG, 'u1');
    expect(writes[0].data.serviceData.clientEmail).toBeNull();
  });

  it('completing an office report keeps only the typed address, never the job customer email', async () => {
    const { svc } = world({}, [{ id: 'r1', reportNumber: null, status: 'draft', deliveryId: null, serviceData: { scheduled: true, office: true, doDocumentId: 'd1', clientEmail: 'stamped@x.sg' } }]);
    const blank: any = await svc.completeScheduled('r1', { serviceData: { clientEmail: null } }, ORG, 'u1');
    expect(blank.serviceData.clientEmail).toBeNull();
  });
});

describe('the report page links (Order / DO / Job pills)', () => {
  it('findById returns the DO (own link) and the job', async () => {
    const prisma: any = {
      maintenanceServiceReport: { findFirst: jest.fn(async () => ({ id: 'r1', deliveryId: 'j1', serviceData: { orderId: 'o1', doDocumentId: 'd1', doNumber: 'DO202611-0007' } })) },
      delivery: { findFirst: jest.fn(async () => ({ id: 'j1', deliveryNumber: 88, orderId: 'o1' })) },
      deliveryItem: { findFirst: jest.fn(async () => null) },
      order: { findFirst: jest.fn(async () => ({ id: 'o1', orderNumber: 'ORDW202611-001' })) },
    };
    const svc: any = Object.create(MaintenanceReportsService.prototype);
    Object.assign(svc, { prisma });
    const r: any = await svc.findById('r1', ORG);
    expect(r.order).toEqual({ id: 'o1', orderNumber: 'ORDW202611-001' });
    expect(r.links).toEqual({ do: { id: 'd1', name: 'DO202611-0007' }, job: { id: 'j1', number: 88 } });
  });

  it("a job report without its own DO link: the job's DO", async () => {
    const prisma: any = {
      maintenanceServiceReport: { findFirst: jest.fn(async () => ({ id: 'r1', deliveryId: 'j1', serviceData: {} })) },
      delivery: { findFirst: jest.fn(async () => ({ id: 'j1', deliveryNumber: 3, orderId: null })) },
      deliveryItem: { findFirst: jest.fn(async () => ({ documentId: 'd2', document: { name: 'DO-2' } })) },
      order: { findFirst: jest.fn(async () => null) },
    };
    const svc: any = Object.create(MaintenanceReportsService.prototype);
    Object.assign(svc, { prisma });
    expect(((await svc.findById('r1', ORG)) as any).links).toEqual({ do: { id: 'd2', name: 'DO-2' }, job: { id: 'j1', number: 3 } });
  });
});

describe('the doc chain lists the order service reports', () => {
  const DO = '00000000-0000-4000-8000-000000000002';
  const ORDER = '00000000-0000-4000-8000-000000000009';
  const REP = '00000000-0000-4000-8000-000000000031';
  function chainWorld(reports: any[]) {
    const prisma: any = {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableWctOrders: true } })) },
      document: {
        findFirst: jest.fn(async () => ({ id: DO, name: 'DO202611-0007', type: 'DELIVERY_ORDER', status: 'draft', documentTemplateId: 'td', config: { customerId: 'c1', orderId: ORDER } })),
        findMany: jest.fn(async () => []),
      },
      order: {
        findFirst: jest.fn(async () => ({ id: ORDER, orderNumber: 'ORDW202611-001', status: 'OPEN', sourceQuotationId: null, linkedDocuments: {}, attachments: [{ kind: 'report', reportId: REP }] })),
        findMany: jest.fn(async () => [{ id: ORDER, orderNumber: 'ORDW202611-001', linkedDocuments: {} }]),
      },
      deliveryItem: { findMany: jest.fn(async () => []) },
      delivery: { findMany: jest.fn(async () => []) },
      maintenanceServiceReport: { findMany: jest.fn(async () => reports) },
      $queryRawUnsafe: jest.fn(async () => []),
    };
    return { svc: new DocLinksService(prisma, {} as any, {} as any), prisma };
  }

  it('numbered, draft and deleted reports: SR number / #n / Draft, deleted left out, each opens the report page', async () => {
    const { svc, prisma } = chainWorld([
      { id: REP, reportNumber: 5, serviceData: { srNumber: 'SR202611-0001' } },
      { id: 'r2', reportNumber: 4, serviceData: {} },
      { id: 'r3', reportNumber: null, serviceData: {} },
      { id: 'r4', reportNumber: 6, serviceData: { deletedAt: '2026-11-25' } },
    ]);
    const c: any = await svc.chain('org', DO);
    expect(c.reports).toEqual([
      { id: REP, name: 'SR202611-0001', type: 'SERVICE_REPORT', href: `/portal/maintenance-reports/${REP}` },
      { id: 'r2', name: '#4', type: 'SERVICE_REPORT', href: '/portal/maintenance-reports/r2' },
      { id: 'r3', name: 'Draft', type: 'SERVICE_REPORT', href: '/portal/maintenance-reports/r3' },
    ]);
    const where = prisma.maintenanceServiceReport.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(expect.arrayContaining([{ id: { in: [REP] } }, { serviceData: { path: ['orderId'], equals: ORDER } }]));
  });

  it('a failed read leaves the reports out, the rest of the chain still shows', async () => {
    const { svc, prisma } = chainWorld([]);
    prisma.maintenanceServiceReport.findMany = jest.fn(async () => {
      throw new Error('down');
    });
    const c: any = await svc.chain('org', DO);
    expect(c.order.orderNumber).toBe('ORDW202611-001');
    expect(c.reports).toEqual([]);
  });
});
