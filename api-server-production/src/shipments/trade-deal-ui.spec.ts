/**
 * Deal page / step cards (2026-10): server-side auto-complete, Mark done,
 * reopen holds, deposit due, shipment #1 + Add shipment, contract completion
 * across its shipments, thumbnails, Invoice #2 due days and LME remarks.
 */
import { BadRequestException } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { autoCompletePlan, fieldRequirements } from './shipments.rules';
import { ShipmentsService } from './shipments.service';
import { TradeConfigService } from './trade-config.service';
import { depositDueDate, depositDueText, parseDepositDue } from './trade-deposit';
import { dueBusinessDays, helperRemarks } from './trade-invoice';
import { TradeStepsService } from './trade-steps.service';
import { renderThumbnail, thumbable, thumbKeyOf, THUMB_WIDTH } from './trade-thumbs.service';

const ORG = 'org-1';
const actor = { id: 'u1', name: 'Tester' };

const step = (id: string, sortOrder: number, over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  displayNo: String(sortOrder),
  sortOrder,
  status: 'NOT_STARTED',
  isOngoing: false,
  requiredDocTypes: [] as string[],
  requiredFields: [] as string[],
  holdOpen: false,
  ...over,
});

describe('autoCompletePlan', () => {
  it('completes every step whose documents are all there, and makes the first open one current', () => {
    const steps = [step('s1', 1, { requiredDocTypes: ['PI', 'DEPOSIT_PROOF'], status: 'IN_PROGRESS' }), step('s2', 2, { requiredDocTypes: ['INVOICE_1'] }), step('s3', 3, { requiredDocTypes: ['BL'] })];
    const plan = autoCompletePlan(steps, ['PI', 'DEPOSIT_PROOF', 'BL'], {});
    expect(plan.complete.map((s) => s.id)).toEqual(['s1', 's3']); // any order: B/L arrived early
    expect(plan.start?.id).toBe('s2');
  });
  it('never auto-completes a step with nothing required ("Mark done") or an ongoing step', () => {
    const plan = autoCompletePlan([step('five', 5), step('ongoing', 14, { isOngoing: true, requiredDocTypes: ['OTHER'] })], ['OTHER'], {});
    expect(plan.complete).toEqual([]);
    expect(plan.start?.id).toBe('five');
  });
  it('needs the required record fields too (shipment step 2: B/L no. + product line)', () => {
    const s2 = step('bl', 2, { requiredDocTypes: ['BL_DRAFT'], requiredFields: ['blNumber', 'contractLineId'] });
    expect(autoCompletePlan([s2], ['BL_DRAFT'], { blNumber: null, contractLineId: 'L1' }).complete).toEqual([]);
    expect(autoCompletePlan([s2], ['BL_DRAFT'], { blNumber: '  ', contractLineId: 'L1' }).complete).toEqual([]);
    expect(autoCompletePlan([s2], ['BL_DRAFT'], { blNumber: '198GX04822', contractLineId: 'L1' }).complete.map((s) => s.id)).toEqual(['bl']);
    expect(fieldRequirements(['blNumber'], { blNumber: '' })).toEqual([{ field: 'blNumber', label: 'B/L no.', satisfied: false }]);
  });
  it('a reopened (held) step waits until one of ITS documents changes', () => {
    const held = step('s3', 3, { requiredDocTypes: ['BL'], status: 'IN_PROGRESS', holdOpen: true });
    expect(autoCompletePlan([held], ['BL'], {}).complete).toEqual([]);
    expect(autoCompletePlan([held], ['BL'], {}, { docTypes: ['CI'] }).complete).toEqual([]); // another step's document
    const plan = autoCompletePlan([held], ['BL'], {}, { docTypes: ['BL'] });
    expect(plan.complete.map((s) => s.id)).toEqual(['s3']);
    expect(plan.release.map((s) => s.id)).toEqual(['s3']);
  });
});

/** Minimal Prisma stub for syncSteps on one shipment. */
function syncDb(steps: any[], opts: { status?: string; files?: string[]; record?: any } = {}) {
  const prisma: any = {
    shipment: { findFirst: jest.fn().mockResolvedValue({ id: 'sh1', status: opts.status ?? 'OPEN', blNumber: null, contractLineId: 'L1', ...(opts.record ?? {}) }) },
    contract: { findFirst: jest.fn().mockResolvedValue(null) },
    tradeStep: { findMany: jest.fn().mockResolvedValue(steps), update: jest.fn().mockResolvedValue({}) },
    tradeFileLink: { findMany: jest.fn().mockResolvedValue((opts.files ?? []).map((t) => ({ file: { docType: t } }))) },
    tradeDocumentLink: { findMany: jest.fn().mockResolvedValue([]) },
    document: { findMany: jest.fn().mockResolvedValue([]) },
  };
  prisma.$transaction = (fn: any) => fn(prisma);
  return prisma;
}

describe('TradeConfigService.syncSteps (server-side auto-complete)', () => {
  it('marks the satisfied step DONE with the actor, starts the next one, and returns the labels', async () => {
    const steps = [step('a', 3, { title: 'Receive shipping documents', requiredDocTypes: ['BL', 'CI'], status: 'IN_PROGRESS' }), step('b', 4, { title: 'Create customer documents', requiredDocTypes: ['CUSTOMER_PL'] })];
    const prisma = syncDb(steps, { files: ['BL', 'CI'] });
    const done = await new TradeConfigService(prisma).syncSteps(prisma, ORG, [{ shipmentId: 'sh1' }], actor, { docTypes: ['CI'] });
    expect(done).toEqual(['3. Receive shipping documents']);
    const updates = prisma.tradeStep.update.mock.calls.map((c: any) => [c[0].where.id, c[0].data.status]);
    expect(updates).toEqual([
      ['a', 'DONE'],
      ['b', 'IN_PROGRESS'],
    ]);
    expect(prisma.tradeStep.update.mock.calls[0][0].data).toMatchObject({ updatedById: 'u1', updatedByName: 'Tester', holdOpen: false });
  });
  it('leaves a completed / cancelled record alone', async () => {
    const prisma = syncDb([step('a', 3, { requiredDocTypes: ['BL'] })], { status: 'COMPLETED', files: ['BL'] });
    expect(await new TradeConfigService(prisma).syncSteps(prisma, ORG, [{ shipmentId: 'sh1' }], actor)).toEqual([]);
    expect(prisma.tradeStep.update).not.toHaveBeenCalled();
  });
});

describe('TradeStepsService — Mark done, reopen hold', () => {
  function setup(s: any, files: string[] = []) {
    const prisma = syncDb([], { files });
    prisma.tradeStep.findFirst = jest.fn().mockResolvedValueOnce(s).mockResolvedValue({ ...s, status: 'DONE' });
    prisma.tradeDocType = { findMany: jest.fn().mockResolvedValue([]) };
    return { prisma, svc: new TradeStepsService(prisma, new TradeConfigService(prisma)) };
  }
  const base = { id: 'st', title: 'Send documents & ask schedule', displayNo: '5', status: 'IN_PROGRESS', requiredDocTypes: [], requiredFields: [], contractId: null, shipmentId: 'sh1', contract: null };
  it('"Mark done" completes a step with nothing to upload', async () => {
    const { prisma, svc } = setup({ ...base, shipment: { blNumber: 'B', status: 'OPEN' } });
    await svc.complete(ORG, 'st', actor);
    expect(prisma.tradeStep.update.mock.calls[0][0].data).toMatchObject({ status: 'DONE', holdOpen: false, updatedByName: 'Tester' });
  });
  it('refuses while a required field is empty, naming it', async () => {
    const { svc } = setup({ ...base, requiredDocTypes: ['BL_DRAFT'], requiredFields: ['blNumber'], shipment: { blNumber: null, status: 'OPEN' } }, ['BL_DRAFT']);
    await expect(svc.complete(ORG, 'st', actor)).rejects.toThrow(/fill in B\/L no\./);
  });
  it('reopen holds the step open (auto-complete waits for a changed document)', async () => {
    const { prisma, svc } = setup({ ...base, status: 'DONE', shipment: { blNumber: 'B', status: 'OPEN' } });
    await svc.reopen(ORG, 'st', actor);
    expect(prisma.tradeStep.update.mock.calls[0][0].data).toMatchObject({ status: 'IN_PROGRESS', holdOpen: true, completedAt: null });
  });
});

describe('deposit due', () => {
  it('parses the PI wording into days + unit; anything else stays blank', () => {
    expect(parseDepositDue('within 5 business days')).toEqual({ days: 5, unit: 'BUSINESS' });
    expect(parseDepositDue('10% Adv with 3 Business Days')).toEqual({ days: 3, unit: 'BUSINESS' });
    expect(parseDepositDue('within 7 days')).toEqual({ days: 7, unit: 'CALENDAR' });
    expect(parseDepositDue('14 calendar days')).toEqual({ days: 14, unit: 'CALENDAR' });
    expect(parseDepositDue('against B/L copy')).toBeNull();
    expect(parseDepositDue(null)).toBeNull();
  });
  it('computes the date from the PI date: business days skip weekends and Japanese holidays', () => {
    expect(depositDueDate('2026-06-30', 3, 'BUSINESS')).toBe('2026-07-03');
    // Fri 17 Jul + 1 business day: Mon 20 Jul is Marine Day → Tue 21 Jul.
    expect(depositDueDate('2026-07-17', 1, 'BUSINESS')).toBe('2026-07-21');
    expect(depositDueDate(new Date('2026-06-30T00:00:00Z'), 3, 'CALENDAR')).toBe('2026-07-03');
    expect(depositDueDate(null, 3, 'BUSINESS')).toBeNull();
    expect(depositDueText(1, 'CALENDAR')).toBe('1 calendar day');
  });
});

/** Contract create / complete with a stubbed transaction. */
function contractDb(opts: { shipments?: any[] } = {}) {
  const tx: any = {
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: 'sup' }) },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cus' }) },
    contract: {
      findFirst: jest.fn().mockImplementation(({ where, select }: any) =>
        Promise.resolve(
          where?.contractNo
            ? null
            : select?.steps
              ? { id: 'c1', contractNo: 'C1', status: 'OPEN', steps: [step('p', 1, { status: 'DONE' })], shipments: opts.shipments ?? [] }
              : { id: 'c1', contractNo: 'C1', status: 'OPEN', customerId: 'cus', currency: 'USD', deliveryMonth: null, lines: [{ id: 'L1', grade: '6063', product: 'Aluminium Billet', sizeSpec: '203MM' }] },
        ),
      ),
      create: jest.fn().mockResolvedValue({ id: 'c1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    contractLine: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    shipment: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 's1' }) },
  };
  const prisma: any = { ...tx, $transaction: (fn: any) => fn(tx) };
  // snapshotSteps returns how many contract-level steps it made: > 0 = an org still on the contract-level flow.
  const config: any = { snapshotSteps: jest.fn().mockResolvedValue(2), syncSteps: jest.fn().mockResolvedValue([]), getSettings: jest.fn().mockResolvedValue({}), profileOf: jest.fn().mockResolvedValue({ billingMode: 'TWO_STAGE', docVariants: {} }), supplierProfileOf: jest.fn().mockResolvedValue({ hasPI: true }) };
  const svc = new ContractsService(prisma, config, new ShipmentsService(prisma, config));
  jest.spyOn(svc, 'getById').mockResolvedValue({} as any);
  return { tx, svc, config };
}

describe('the deal: contract + shipments', () => {
  const dto = { contractNo: 'C1', supplierId: 'sup', customerId: 'cus', lines: [{ grade: '6063' }] } as any;
  it('a new contract (contract-level flow) defaults the deposit to 3 business days and gets shipment #1 (B/L pending)', async () => {
    const { tx, config } = await (async () => {
      const x = contractDb();
      await x.svc.create(ORG, dto, actor);
      return x;
    })();
    expect(tx.contract.create.mock.calls[0][0].data).toMatchObject({ depositDueDays: 3, depositDueUnit: 'BUSINESS', depositDueNote: '3 business days' });
    expect(tx.shipment.create).toHaveBeenCalledTimes(1);
    expect(tx.shipment.create.mock.calls[0][0].data).toMatchObject({ contractId: 'c1', blNumber: null, contractLineId: 'L1' });
    expect(config.snapshotSteps).toHaveBeenCalledWith(tx, ORG, 'SHIPMENT', { shipmentId: 's1' }, expect.objectContaining({ billingMode: 'TWO_STAGE' }), expect.objectContaining({ hasPI: true }));
  });
  it('with orders (no contract-level steps) a contract is just the LTC master: no steps, no shipment', async () => {
    const x = contractDb();
    x.config.snapshotSteps.mockResolvedValue(0);
    await x.svc.create(ORG, dto, actor);
    expect(x.tx.contract.create).toHaveBeenCalledTimes(1);
    expect(x.tx.shipment.create).not.toHaveBeenCalled();
  });
  it('reads the deposit term from the PI wording when given', async () => {
    const { tx, svc } = contractDb();
    await svc.create(ORG, { ...dto, depositDueNote: 'within 5 business days' }, actor);
    expect(tx.contract.create.mock.calls[0][0].data).toMatchObject({ depositDueDays: 5, depositDueUnit: 'BUSINESS', depositDueNote: 'within 5 business days' });
  });
  it('"Complete contract" waits for every open shipment', async () => {
    const { svc } = contractDb({ shipments: [{ blNumber: '198GX04822', status: 'COMPLETED' }, { blNumber: null, status: 'OPEN' }] });
    await expect(svc.complete(ORG, 'c1')).rejects.toThrow(BadRequestException);
    await expect(svc.complete(ORG, 'c1')).rejects.toThrow(/complete its shipment\(s\) first — B\/L pending/);
    const ok = contractDb({ shipments: [{ blNumber: 'X', status: 'COMPLETED' }, { blNumber: 'Y', status: 'CANCELLED' }] });
    await ok.svc.complete(ORG, 'c1');
    expect(ok.tx.contract.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'COMPLETED' } }));
  });
});

// A one-page 200×200 pt PDF (same as the smoke test's).
const DUMMY_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
const isPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const pngWidth = (b: Buffer) => b.readUInt32BE(16);

describe('thumbnails', () => {
  it('PDFs and images get one; Office / Outlook files show an icon', () => {
    expect(thumbable('application/pdf')).toBe(true);
    expect(thumbable('image/jpeg')).toBe(true);
    expect(thumbable('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(false);
    expect(thumbable('application/vnd.ms-outlook')).toBe(false);
    expect(thumbKeyOf('shipments/o/2026/f_a.pdf')).toBe('shipments/o/2026/f_a.pdf.thumb.png');
  });
  it('renders the first page of a PDF to a PNG', () => {
    // pdf.js loads via an ESM dynamic import, which Jest's VM refuses — so run
    // renderThumbnail in a plain Node child process (as the API does).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawnSync } = require('child_process');
    const code = `require('./src/shipments/trade-thumbs.service').renderThumbnail(Buffer.from('${DUMMY_PDF.toString('base64')}', 'base64'), 'application/pdf').then((b) => process.stdout.write(b.toString('base64')))`;
    const r = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', code], { cwd: `${__dirname}/../..`, encoding: 'utf8', timeout: 60000 });
    expect(r.stderr).toBe('');
    const png = Buffer.from(r.stdout, 'base64');
    expect(isPng(png)).toBe(true);
    expect(pngWidth(png)).toBe(200); // never upscaled past the page
  }, 70000);
  it('scales a large image down to the thumbnail width', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createCanvas } = require('@napi-rs/canvas');
    const big = createCanvas(1200, 800).toBuffer('image/png');
    const png = await renderThumbnail(big, 'image/png');
    expect(pngWidth(png)).toBe(THUMB_WIDTH);
  });
});

describe('small items', () => {
  it('Invoice #2 is due in 6 business days, Invoice #1 in 7 (both overridable)', () => {
    expect(dueBusinessDays({}, 'INVOICE_2')).toBe(6);
    expect(dueBusinessDays({}, 'INVOICE_1')).toBe(7);
    expect(dueBusinessDays({ invoice2DueBusinessDays: 5, invoiceDueBusinessDays: 8 } as any, 'INVOICE_2')).toBe(5);
  });
  it('remarks leave out "(0USD)" while the LME is blank', () => {
    const line: any = { lme: null, qmjp: 351.5, premium: 190, upcharge: null, grade: '6063' };
    const r = helperRemarks(line, '2026-06');
    expect(r).not.toContain('(0USD)');
    expect(r).toContain('LME Cash 2026/6月平均 +351.5(QMJP)');
    expect(helperRemarks({ ...line, lme: 3458.64 }, '2026-06')).toContain('(3458.64USD)');
  });
});
