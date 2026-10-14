/**
 * Guided-test fix round (2026-10-14): negative invoice totals, the customer's
 * Japanese name / address / contact on JP documents, LME month / unit-price /
 * due-date defaults, date ranges, COA analysis date, SG→JP capitals, the loose
 * B/L comparison, the Documents hub (links, customer vs recipient, chip
 * counts), Files-tab counting and reopening a shipment under a completed
 * contract.
 */
import { BadRequestException } from '@nestjs/common';
import { docDateErrors, tradeDateError } from './shipments.rules';
import { ShipmentsService } from './shipments.service';
import { documentSummary, TradeConfigService } from './trade-config.service';
import { blDraftChecks, looseKey, looselySame } from './trade-extract.rules';
import { renderGeneratedHtml } from './trade-generated.html';
import { buildDefaultHeader, customerDocHeader, jpParty, TradeGeneratedService } from './trade-generated.service';
import { recipientOf, TradeHubService } from './trade-hub.service';
import { amountOf, InvoiceLine, invoiceTotals, unitPriceOf } from './trade-invoice';
import { renderSgjpV2Html, SgjpHeaderV2 } from './trade-logistics-docs';

const ORG = 'org-1';
const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

describe('#1 negative totals are real amounts', () => {
  it('documentSummary keeps a negative stamped / candidate total (Invoice #2 差額)', () => {
    const d = { id: 'd', name: 'ADH-INV-2026-0002', type: 'INVOICE', status: 'confirmed', createdAt: new Date(), documentTemplateId: 't' };
    expect(documentSummary({ ...d, config: { nettTotal: -29424.51, items: [{ amount: -147947 }] } }).total).toBe(-29424.51);
    // No stamped gross: the first NON-ZERO candidate wins (a "> 0" test skipped it and summed the tax-exclusive lines).
    expect(documentSummary({ ...d, config: { summary: { grandTotal: -29424.51 }, items: [{ amount: -147947 }] } }).total).toBe(-29424.51);
    expect(documentSummary({ ...d, config: { grandTotal: 0, total: '-12.5' } }).total).toBe(-12.5);
  });
});

describe('#2 customer Japanese legal name / address / contact', () => {
  const SUS = { name: 'SUS Co., Ltd.', address: null, jpName: 'SUS株式会社', jpAddress: '〒962-0728 福島県須賀川市虹の台21-1', jpContact: '福島製造グループ 押出チーム 有馬 英幸 (TEL 0248-89-1210)' };
  it('jpParty: the Japanese fields when any is set (no English address mixed in), else the English record', () => {
    expect(jpParty(SUS)).toEqual({ name: 'SUS株式会社', address: '〒962-0728 福島県須賀川市虹の台21-1', contact: '福島製造グループ 押出チーム 有馬 英幸 (TEL 0248-89-1210)' });
    expect(jpParty({ name: 'SUS Co., Ltd.', address: 'Tokyo', jpName: 'SUS株式会社' })).toEqual({ name: 'SUS株式会社', address: null, contact: null });
    expect(jpParty({ name: 'Kato', address: '  ', jpName: null })).toEqual({ name: 'Kato', address: null, contact: null });
  });
  const ship = {
    blNumber: 'BL1',
    vessel: null,
    voyageNo: null,
    portOfLoading: null,
    portOfDischarge: 'Yokohama, Japan',
    commodity: null,
    sizeSpec: '203 MM X 5800 MM',
    hsCode: '7601.20',
    countryOfOrigin: 'India',
    ciNumber: 'XP1',
    totalPieces: 600,
    customer: SUS,
    contract: { contractNo: 'C1', piNumber: null },
    contractLine: { grade: '6063', product: 'Aluminium Billet', sizeSpec: null },
  };
  const header = (docType: 'CUSTOMER_PL' | 'CUSTOMER_COA', customer: any = SUS) =>
    customerDocHeader(
      buildDefaultHeader(null, { ...ship, customer } as any, docType === 'CUSTOMER_PL' ? '計量検収票' : '納品書兼分析試験成績報告書', docType, '2026-07-22'),
      { ...ship, customer },
      docType,
      {},
    );
  it('計量検収票 / 納品書兼… print the Japanese name + address + contact under 御中', () => {
    for (const t of ['CUSTOMER_PL', 'CUSTOMER_COA'] as const) {
      const h = header(t);
      expect(h.to).toEqual({ name: 'SUS株式会社', address: SUS.jpAddress, contact: SUS.jpContact });
      const text = strip(renderGeneratedHtml(t, h, [], [{ batch: 'B1', netMt: 1, grossMt: 1, bundles: 1, netwt: 1 }]));
      expect(text).toContain('SUS株式会社　御中');
      expect(text).toContain('〒962-0728 福島県須賀川市虹の台21-1');
      expect(text).toContain('有馬 英幸 (TEL 0248-89-1210)');
      expect(text).not.toContain('SUS Co., Ltd.');
    }
  });
  it('a blank address / contact prints no empty line', () => {
    const h = header('CUSTOMER_PL', { ...SUS, jpAddress: null, jpContact: null });
    const html = renderGeneratedHtml('CUSTOMER_PL', h, [], []);
    expect(html).toMatch(/<div class="addr pre"><\/div>/);
  });
});

describe('#3/#4 prices: no price until the LME is typed', () => {
  const line: InvoiceLine = {
    description: '6063',
    quantity: 305.804,
    unit: 'トン',
    unitPrice: null,
    amountOverride: null,
    remarks: '',
    dueDate: null,
    lme: null,
    qmjp: 351.5,
    premium: 230,
    upcharge: null,
  };
  it('QMJP + premium alone is not a unit price (was 581.50)', () => {
    expect(unitPriceOf(line)).toBeNull();
    expect(amountOf(line)).toBe(0);
    expect(invoiceTotals([line], 10, null).total).toBe(0);
  });
  it('once the LME is typed: LME + QMJP + premium', () => {
    expect(unitPriceOf({ ...line, lme: 3155.98, qmjp: 395 })).toBe(3780.98);
    // A typed unit price (no helper) is unaffected.
    expect(unitPriceOf({ ...line, qmjp: null, premium: null, unitPrice: 4000 })).toBe(4000);
  });
});

describe('#6 dates are 2000–2100', () => {
  it('tradeDateError', () => {
    expect(tradeDateError('2026-08-20', 'd')).toBeNull();
    expect(tradeDateError('2026-08', 'm')).toBeNull();
    expect(tradeDateError('2026-08-20T00:00:00.000Z', 'd')).toBeNull();
    expect(tradeDateError('', 'd')).toBeNull();
    expect(tradeDateError(null, 'd')).toBeNull();
    expect(tradeDateError('72026-08-20', 'issueDate')).toBe('issueDate: the year must be between 2000 and 2100');
    expect(tradeDateError('1999-12-31', 'd')).toMatch(/2000 and 2100/);
    expect(tradeDateError('2101-01-01', 'd')).toMatch(/2000 and 2100/);
    expect(tradeDateError('2026-02-30', 'd')).toBe('d has an invalid day');
    expect(tradeDateError('20/08/2026', 'd')).toMatch(/must be a date/);
  });
  it('docDateErrors walks header and row dates', () => {
    expect(docDateErrors({ issueDate: '2026-10-05', dueDate: '2026-10-14', lmeMonth: '2026-07' }, [{ dueDate: '2026-10-14' }])).toEqual([]);
    expect(docDateErrors({ issueDate: '72026-10-05' }, [{ dueDate: '2026-10-14' }, { shipDate: '20260-09-07' }])).toEqual([
      'issueDate: the year must be between 2000 and 2100',
      'row 2 shipDate: the year must be between 2000 and 2100',
    ]);
  });
});

describe('#7 COA analysis date is never "today"', () => {
  it('blank by default (filled from the source / a Vedanta COA PDF, or typed)', () => {
    const base = buildDefaultHeader(null, { customer: { name: 'SUS' }, contract: null, contractLine: null, sizeSpec: null, totalPieces: null } as any, 'COA', 'CUSTOMER_COA', '2026-10-14');
    expect(customerDocHeader(base, {}, 'CUSTOMER_COA', {}).analysisDate).toBe('');
  });
});

describe('#8 SG→JP ports and places print in capitals; stored values unchanged', () => {
  const h = {
    layout: 2,
    invoiceNo: 'ADH20260820',
    invoiceDate: '2026-08-20',
    shipperBlock: '',
    consigneeBlock: '',
    sellerBlock: '',
    buyerBlock: '',
    placeOfReceipt: 'Visakhapatnam, India',
    portOfLoading: 'Visakhapatnam, India',
    portOfDischarge: 'Yokohama, Japan',
    placeOfDelivery: 'Yokohama, Japan',
    payment: '',
    countryOfOrigin: 'India',
    vessel: 'RACHA BHUM / 211E',
    others: '',
    shippingMarks: '',
    signBlock: '',
    currency: 'USD',
    lmeMonth: '2026-07',
  } as SgjpHeaderV2;
  it('renders VISAKHAPATNAM, INDIA / YOKOHAMA, JAPAN', () => {
    const text = strip(renderSgjpV2Html(h, []));
    expect(text).toContain('VISAKHAPATNAM, INDIA');
    expect(text).toContain('YOKOHAMA, JAPAN');
    expect(text).not.toContain('Yokohama, Japan');
    expect(h.portOfDischarge).toBe('Yokohama, Japan');
  });
});

describe('#9 B/L check: case, punctuation, company suffixes and "PORT" are not differences', () => {
  it('looseKey / looselySame', () => {
    expect(looselySame('WAN HAI LINES LTD.', 'Wan Hai Lines')).toBe(true);
    expect(looselySame('Vedanta Limited', 'VEDANTA LTD')).toBe(true);
    expect(looselySame('Asia Deal Hub Pte. Ltd.', 'ASIA DEAL HUB')).toBe(true);
    expect(looselySame('VISAKHAPATNAM PORT, INDIA', 'Visakhapatnam, India', { place: true })).toBe(true);
    expect(looselySame('VISAKHAPATNAM PORT, INDIA', 'Visakhapatnam, India')).toBe(false); // PORT only ignored for places
    expect(looselySame('WAN HAI LINES', 'EVERGREEN LINE')).toBe(false);
    expect(looseKey('Co., Ltd.')).toBe('');
  });
  it('the guided-test shipment: only real differences are flagged', () => {
    const draft: any = {
      contractNo: null,
      blNumber: '198GX04630',
      shippingLine: 'WAN HAI LINES LTD.',
      vessel: 'RACHA BHUM',
      voyageNo: '211E',
      etd: null,
      portOfLoading: 'VISAKHAPATNAM PORT, INDIA',
      portOfDischarge: 'YOKOHAMA, JAPAN',
      netWeightMt: null,
      grossWeightMt: null,
      totalBundles: null,
      totalPieces: null,
      containerCount: null,
      hsCode: null,
      countryOfOrigin: 'INDIA',
    };
    const shipment = { ...draft, shippingLine: 'WAN HAI LINES', portOfLoading: 'Visakhapatnam, India', countryOfOrigin: 'India' };
    const fields = blDraftChecks({ draft, contract: null, line: null, shipment }).find((c) => c.key === 'fields')!;
    expect(fields.status).toBe('ok');
    const real = blDraftChecks({ draft, contract: null, line: null, shipment: { ...shipment, vessel: 'RACHA BHUMI', portOfLoading: 'Chennai, India' } }).find((c) => c.key === 'fields')!;
    expect(real.items!.map((i) => i.item)).toEqual(['Vessel', 'Port of loading']);
  });
});

describe('#10–12 Documents hub', () => {
  it('recipientOf: SI → warehouse, SG→JP → buyer, customer documents → none', () => {
    expect(recipientOf('SHIPPING_INSTRUCTIONS', { toName: '三井倉庫株式会社' }, 'SUS Co., Ltd.')).toBe('三井倉庫株式会社');
    expect(recipientOf('SGJP_IV_PL', { buyerBlock: 'ASIA DEAL HUB JAPAN LLC.\n2-14-5 AKASAKA' }, 'SUS Co., Ltd.')).toBe('ASIA DEAL HUB JAPAN LLC.');
    expect(recipientOf('CUSTOMER_PL', { to: { name: 'SUS株式会社' } }, 'SUS Co., Ltd.')).toBeNull();
    expect(recipientOf('INVOICE_1', { toName: 'SUS株式会社' }, 'SUS Co., Ltd.')).toBeNull();
  });

  function hub() {
    const c1 = { contractNo: '454003255', customerId: 'cus-1', customer: { name: 'SUS Co., Ltd.' } };
    const c2 = { contractNo: '454003422', customerId: 'cus-1', customer: { name: 'SUS Co., Ltd.' } };
    const prisma: any = {
      tradeDocType: {
        findMany: jest.fn().mockResolvedValue([
          { code: 'INVOICE_1', label: 'Invoice #1', category: 'INVOICES' },
          { code: 'SHIPPING_INSTRUCTIONS', label: 'Shipping instructions', category: 'CUSTOMS' },
          { code: 'COO', label: 'Certificate of origin', category: 'SUPPLIER' },
        ]),
      },
      tradeFile: {
        findMany: jest.fn().mockResolvedValue([
          // The finalized Invoice #1 PDF, linked to both contracts.
          {
            id: 'pdf-1',
            docType: 'INVOICE_1',
            fileName: 'ADH-INV-2026-0001.pdf',
            uploadedByName: 'a',
            createdAt: new Date('2026-10-14'),
            links: [
              { id: 'l1', contractId: 'c1', shipmentId: null, contract: c1, shipment: null },
              { id: 'l2', contractId: 'c2', shipmentId: null, contract: c2, shipment: null },
            ],
          },
          {
            id: 'coo',
            docType: 'COO',
            fileName: 'COO.pdf',
            uploadedByName: 'a',
            createdAt: new Date('2026-10-13'),
            links: [{ id: 'l3', contractId: null, shipmentId: 's1', contract: null, shipment: { blNumber: 'BL1', customerId: 'cus-1', customer: c1.customer } }],
          },
        ]),
      },
      tradeDocumentLink: { findMany: jest.fn().mockResolvedValue([]) },
      tradeGeneratedDoc: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'g1',
            docType: 'INVOICE_1',
            number: 'ADH-INV-2026-0001',
            status: 'FINAL',
            header: { toName: 'SUS株式会社' },
            rows: [],
            finalFileId: 'pdf-1',
            documentId: 'doc-1',
            createdByName: 'a',
            updatedAt: new Date('2026-10-14'),
            shipment: null,
            contract: { id: 'c1', ...c1 },
          },
          {
            id: 'g2',
            docType: 'SHIPPING_INSTRUCTIONS',
            number: 'SI-BL1',
            status: 'FINAL',
            header: { toName: '三井倉庫株式会社' },
            rows: [],
            finalFileId: null,
            documentId: null,
            createdByName: 'a',
            updatedAt: new Date('2026-10-12'),
            shipment: { id: 's1', blNumber: 'BL1', customerId: 'cus-1', contractId: 'c2', customer: c2.customer, contract: { contractNo: '454003422' } },
            contract: null,
          },
        ]),
      },
      document: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new TradeHubService(prisma, {} as TradeConfigService);
  }

  it('#10 Invoice #1 billing two contracts is linked to both', async () => {
    const r = await hub().list(ORG, {});
    const inv = r.items.find((x) => x.key === 'generated:g1')!;
    expect(inv.links.map((l) => l.contractNo)).toEqual(['454003255', '454003422']);
    expect((await hub().list(ORG, { contractId: 'c2' })).items.map((x) => x.key)).toContain('generated:g1');
  });
  it('#11 Customer = the contract customer; Recipient = where it goes', async () => {
    const r = await hub().list(ORG, {});
    const si = r.items.find((x) => x.key === 'generated:g2')!;
    expect(si).toMatchObject({ customerName: 'SUS Co., Ltd.', recipient: '三井倉庫株式会社' });
    expect(r.items.find((x) => x.key === 'generated:g1')).toMatchObject({ customerName: 'SUS Co., Ltd.', recipient: null });
  });
  it('#12 chip counts follow the other filters (Source etc.)', async () => {
    const all = await hub().list(ORG, {});
    expect(all.allCount).toBe(3);
    expect(all.categoryCounts).toEqual({ INVOICES: 1, CUSTOMS: 1, SUPPLIER: 1 });
    const inApp = await hub().list(ORG, { source: 'IN_APP' });
    expect(inApp.allCount).toBe(2);
    expect(inApp.categoryCounts).toEqual({ INVOICES: 1, CUSTOMS: 1 });
    // The category chip itself filters the rows but not the counts.
    const chip = await hub().list(ORG, { source: 'IN_APP', category: 'CUSTOMS' });
    expect(chip.total).toBe(1);
    expect(chip.categoryCounts).toEqual({ INVOICES: 1, CUSTOMS: 1 });
  });
});

describe('#16 reopening a shipment under a completed contract', () => {
  function setup(contractStatus: string) {
    const prisma: any = {
      shipment: {
        findFirst: jest.fn().mockResolvedValue({ blNumber: 'BL1', status: 'COMPLETED', contract: { id: 'c1', contractNo: '454003422', status: contractStatus } }),
        update: jest.fn().mockResolvedValue({}),
      },
      contract: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    const svc = new ShipmentsService(prisma, {} as TradeConfigService);
    jest.spyOn(svc, 'getById').mockResolvedValue({ id: 's1', status: 'OPEN' } as any);
    return { svc, prisma };
  }
  it('reopens the completed contract too and reports it', async () => {
    const { svc, prisma } = setup('COMPLETED');
    const r = await svc.reopen(ORG, 's1');
    expect(prisma.contract.update).toHaveBeenCalledWith({ where: { id: 'c1', organizationId: ORG }, data: { status: 'OPEN' } });
    expect(r.reopenedContract).toBe('454003422');
  });
  it('an open contract is left alone; a cancelled one too', async () => {
    for (const st of ['OPEN', 'CANCELLED']) {
      const { svc, prisma } = setup(st);
      const r = await svc.reopen(ORG, 's1');
      expect(prisma.contract.update).not.toHaveBeenCalled();
      expect(r.reopenedContract).toBeNull();
    }
  });
  it('an open shipment is refused', async () => {
    const { svc, prisma } = setup('COMPLETED');
    prisma.shipment.findFirst.mockResolvedValue({ blNumber: 'BL1', status: 'OPEN', contract: null });
    await expect(svc.reopen(ORG, 's1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('#5 / #6 / #7 TradeGeneratedService', () => {
  function service(gen: any = null, settings: any = { docDefaults: {} }) {
    const prisma: any = {
      tradeGeneratedDoc: { findFirst: jest.fn().mockResolvedValue(gen), update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...gen, ...data })) },
      tradeFile: { findFirst: jest.fn().mockResolvedValue(null) },
      tradeStep: { findFirst: jest.fn().mockResolvedValue({ id: 'step-cd' }), findMany: jest.fn().mockResolvedValue([]) },
    };
    const files: any = { upload: jest.fn().mockResolvedValue({ id: 'pdf-1' }) };
    const pdf: any = { generatePdfFromHtml: jest.fn().mockResolvedValue(Buffer.from('%PDF')) };
    return { prisma, files, svc: new TradeGeneratedService(prisma, {} as any, pdf, { getSettings: async () => settings } as any, files, {} as any, {} as any) };
  }
  it('#5 due date: 7 Japanese bank business days after the issue date (weekends + holidays skipped)', async () => {
    const { svc } = service();
    // Mon 5 Oct 2026 + 7 business days: 6–9 Oct (4), Mon 12 Oct is Sports Day, 13–15 Oct (3) → Thu 15 Oct.
    expect(await svc.dueDateFor(ORG, '2026-10-05')).toEqual({ issueDate: '2026-10-05', dueDate: '2026-10-15', businessDays: 7 });
    const ten = service(null, { docDefaults: { invoiceDueBusinessDays: 10 } }).svc;
    expect((await ten.dueDateFor(ORG, '2026-10-05')).dueDate).toBe('2026-10-20');
    await expect(svc.dueDateFor(ORG, '72026-10-05')).rejects.toThrow(/YYYY-MM-DD/);
    await expect(svc.dueDateFor(ORG, '1999-10-05')).rejects.toThrow(/2000 and 2100/);
  });
  const coa = {
    id: 'g1',
    shipmentId: 'ship-1',
    docType: 'CUSTOMER_COA',
    status: 'DRAFT',
    number: null,
    finalFileId: null,
    header: { layout: 'jp', title: '納品書兼分析試験成績報告書', letterhead: { name: 'ADH' }, to: { name: 'SUS株式会社' }, date: '2026-07-22', refs: [], analysisDate: '' },
    columns: [],
    rows: [{ batch: 'A1', bundles: 15, netwt: 38.2 }],
    shipment: { id: 'ship-1', blNumber: 'BL1', status: 'OPEN', contractId: 'c1' },
  };
  it('#7 a COA without an analysis date cannot be finalized', async () => {
    const { svc, files } = service(coa);
    await expect(svc.finalize(ORG, 'g1', { id: 'u', name: 'U' })).rejects.toThrow(/analysis date/);
    expect(files.upload).not.toHaveBeenCalled();
    const ok = service({ ...coa, header: { ...coa.header, analysisDate: '2026-07-20' } });
    await expect(ok.svc.finalize(ORG, 'g1', { id: 'u', name: 'U' })).resolves.toMatchObject({ status: 'FINAL' });
  });
  it('#6 saving / finalizing refuses an out-of-range date', async () => {
    const { svc } = service({ ...coa, header: { ...coa.header, analysisDate: '72026-07-20' } });
    await expect(svc.finalize(ORG, 'g1', { id: 'u', name: 'U' })).rejects.toThrow(/analysisDate: the year must be between 2000 and 2100/);
    const draftInvoice = { ...coa, docType: 'INVOICE_1', header: {} };
    const s2 = service(draftInvoice).svc;
    await expect(s2.update(ORG, 'g1', { header: { issueDate: '2026-10-05', dueDate: '20266-10-14' }, rows: [] })).rejects.toThrow(/dueDate/);
    await expect(s2.update(ORG, 'g1', { rows: [{ dueDate: '3026-10-14' }] })).rejects.toThrow(/row 1 dueDate/);
  });
});
