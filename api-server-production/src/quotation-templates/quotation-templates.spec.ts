import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QuotationTemplatesService } from './quotation-templates.service';
import { QuotationTemplatesController } from './quotation-templates.controller';
import { ActionLogInterceptor } from '../action-log/action-log.interceptor';
import { linesToItems, sanitizeLines, templateTotals } from './quotation-template-lines';
import { DEFAULT_ORG_FEATURES } from '../organizations/default-features';

/**
 * Quotation templates (2026-11-18, WCT group). The service runs on a small
 * in-memory Prisma; DocumentsService.createBasicDocument is a stub that records
 * what the normal new-quotation path would receive.
 */
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const LAYOUT = 'layout-qo';

function harness(opts: { flags?: Record<string, boolean> } = {}) {
  const flags = opts.flags ?? { [ORG_A]: true, [ORG_B]: true };
  const rows: any[] = [];
  let n = 0;
  const match = (row: any, where: any = {}) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === 'NOT') return !match(row, v);
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('equals' in v) return String(row[k]).toLowerCase() === String(v.equals).toLowerCase();
        return true;
      }
      return (row[k] ?? null) === v;
    });
  const quotationTemplate = {
    findFirst: jest.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
    findMany: jest.fn(async ({ where }: any) => rows.filter((r) => match(r, where)).sort((a, b) => a.name.localeCompare(b.name))),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `t${++n}`, hiddenAt: null, hiddenBy: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
  };
  const prisma: any = {
    quotationTemplate,
    organizationUIConfig: { findUnique: async ({ where }: any) => ({ features: { enableQuotationTemplates: flags[where.organizationId] === true } }) },
    documentTemplate: {
      findUnique: async ({ where }: any) => (where.id === LAYOUT ? { id: LAYOUT, type: 'QUOTATION' } : where.id === 'layout-inv' ? { id: 'layout-inv', type: 'INVOICE' } : null),
    },
  };
  const created: any[] = [];
  const documents: any = {
    createBasicDocument: jest.fn(async (documentTemplateId: string, type: string, organizationId: string, config: any, projectId: any, actor: any) => {
      const doc = { id: `doc${created.length + 1}`, type, documentTemplateId, organizationId, name: `QO202611-${String(created.length + 1).padStart(4, '0')}`, config };
      created.push({ ...doc, projectId, actor });
      return doc;
    }),
  };
  const svc = new QuotationTemplatesService(prisma, documents);
  return { svc, rows, created, documents, quotationTemplate };
}

const LINES = [
  { itemCode: 'SV001', description: 'Kitchen exhaust cleaning', quantity: 2, unitPrice: 350, isService: true, revenueTag: 'service' },
  { itemCode: 'FLT-1', inventoryItemId: 'inv-1', description: 'Baffle filter', quantity: 4, unitPrice: 45.5, uom: 'pcs' },
  { description: '', itemCode: '' },
];

describe('quotation template lines', () => {
  it('keeps item, description, qty, unit price and line type; drops empty rows; infers the type', () => {
    const ls = sanitizeLines(LINES);
    expect(ls).toHaveLength(2);
    expect(ls[0]).toMatchObject({ itemCode: 'SV001', description: 'Kitchen exhaust cleaning', quantity: 2, unitPrice: 350, lineType: 'SERVICE', inventoryItemId: '' });
    expect(ls[1]).toMatchObject({ itemCode: 'FLT-1', inventoryItemId: 'inv-1', quantity: 4, unitPrice: 45.5, lineType: 'PRODUCT', uom: 'pcs' });
    expect(sanitizeLines([{ description: 'x', lineType: 'SERVICE', inventoryItemId: 'inv-9' }])[0].inventoryItemId).toBe('');
    expect(sanitizeLines('nope')).toEqual([]);
  });

  it('counts lines and totals qty x price (headers excluded)', () => {
    const ls = sanitizeLines([{ isGroupHeader: true, description: 'Hood' }, ...LINES]);
    expect(templateTotals(ls)).toEqual({ lineCount: 2, total: 882 });
  });

  it('turns lines back into editor lines with fresh ids, amounts and service flags', () => {
    const items = linesToItems(sanitizeLines([{ isGroupHeader: true, description: 'Hood' }, ...LINES]), 1000);
    expect(items.map((i) => i.id)).toEqual([1000, 1001, 1002]);
    expect(items[0]).toMatchObject({ isGroupHeader: true, description: 'Hood', amount: null });
    expect(items[1]).toMatchObject({ isService: true, revenueTag: 'service', amount: 700, inventoryItemId: '' });
    expect(items[2]).toMatchObject({ isService: false, inventoryItemId: 'inv-1', amount: 182, uom: 'pcs' });
    expect(items[2].revenueTag).toBeUndefined();
  });
});

describe('QuotationTemplatesService', () => {
  it('create, list (name, line count, total), get', async () => {
    const { svc } = harness();
    const t = await svc.create({ name: '  Exhaust   standard ', lines: LINES, subject: 'Hood cleaning', category: 'Service', termsAndConditions: '50% deposit' }, ORG_A, { id: 'u1', name: 'Ann' });
    expect(t).toMatchObject({ name: 'Exhaust standard', lineCount: 2, total: 882, subject: 'Hood cleaning', category: 'Service', termsAndConditions: '50% deposit', createdByName: 'Ann' });
    const list = await svc.list(ORG_A);
    expect(list.map((x) => [x.name, x.lineCount, x.total])).toEqual([['Exhaust standard', 2, 882]]);
    expect((await svc.get(t.id, ORG_A)).lines).toHaveLength(2);
  });

  it('rejects a blank name, no lines and a duplicate name (any case)', async () => {
    const { svc } = harness();
    await expect(svc.create({ name: ' ', lines: LINES }, ORG_A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create({ name: 'A', lines: [{ description: '' }] }, ORG_A)).rejects.toBeInstanceOf(BadRequestException);
    await svc.create({ name: 'Monthly', lines: LINES }, ORG_A);
    await expect(svc.create({ name: 'monthly', lines: LINES }, ORG_A)).rejects.toThrow('already exists');
    // Another org may use the same name.
    await expect(svc.create({ name: 'Monthly', lines: LINES }, ORG_B)).resolves.toMatchObject({ name: 'Monthly' });
  });

  it('save as template: the editor lines are copied as sent', async () => {
    const { svc, rows } = harness();
    const editorItems = [
      { id: 17, itemCode: 'SV002', description: 'Duct cleaning', quantity: 1, unitPrice: 1200, amount: 1200, isService: true, revenueTag: 'service', rateMerge: { id: 'x' } },
    ];
    const t = await svc.create({ name: 'From QO202611-0026', lines: editorItems, subject: 'S' }, ORG_A);
    expect(rows[0].lines).toEqual([{ itemCode: 'SV002', inventoryItemId: '', description: 'Duct cleaning', quantity: 1, unitPrice: 1200, lineType: 'SERVICE' }]);
    expect(t.total).toBe(1200);
  });

  it('rename and edit change only the fields sent', async () => {
    const { svc } = harness();
    const t = await svc.create({ name: 'Old', lines: LINES, subject: 'Keep me' }, ORG_A);
    const r = await svc.update(t.id, { name: 'New name' }, ORG_A);
    expect(r).toMatchObject({ name: 'New name', subject: 'Keep me', lineCount: 2 });
    const e = await svc.update(t.id, { lines: [LINES[0]], subject: '' }, ORG_A);
    expect(e).toMatchObject({ name: 'New name', subject: null, lineCount: 1, total: 700 });
    await svc.create({ name: 'Other', lines: LINES }, ORG_A);
    await expect(svc.update(t.id, { name: 'OTHER' }, ORG_A)).rejects.toThrow('already exists');
    await expect(svc.update(t.id, { name: 'new NAME' }, ORG_A)).resolves.toMatchObject({ name: 'new NAME' });
  });

  it('delete hides the row (kept), and a hidden template cannot be read, edited or used', async () => {
    const { svc, rows } = harness();
    const t = await svc.create({ name: 'Gone', lines: LINES }, ORG_A);
    await svc.hide(t.id, ORG_A, { id: 'u1' });
    expect(rows).toHaveLength(1);
    expect(rows[0].hiddenAt).toBeInstanceOf(Date);
    expect(rows[0].hiddenBy).toBe('u1');
    expect(await svc.list(ORG_A)).toEqual([]);
    await expect(svc.get(t.id, ORG_A)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.update(t.id, { name: 'x' }, ORG_A)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.use(t.id, { documentTemplateId: LAYOUT }, ORG_A)).rejects.toBeInstanceOf(NotFoundException);
    // The name is free again.
    await expect(svc.create({ name: 'Gone', lines: LINES }, ORG_A)).resolves.toMatchObject({ name: 'Gone' });
  });

  it('use: a new draft quotation through createBasicDocument with the lines, Subject, Category and T&Cs', async () => {
    const { svc, created, documents } = harness();
    const t = await svc.create({ name: 'Std', lines: LINES, subject: 'Hood cleaning', category: 'Service', termsAndConditions: '50% deposit' }, ORG_A);
    const res = await svc.use(t.id, { documentTemplateId: LAYOUT, type: 'quotation' }, ORG_A, { id: 'u1', name: 'Ann' });
    expect(res).toEqual({ success: true, data: { id: 'doc1', type: 'QUOTATION', documentTemplateId: LAYOUT, name: 'QO202611-0001' } });
    expect(documents.createBasicDocument).toHaveBeenCalledTimes(1);
    const [layoutId, type, org, config, projectId, actor] = documents.createBasicDocument.mock.calls[0];
    expect([layoutId, type, org, projectId, actor]).toEqual([LAYOUT, 'QUOTATION', ORG_A, undefined, { id: 'u1', name: 'Ann' }]);
    expect(config.items).toHaveLength(2);
    expect(config.items[0]).toMatchObject({ description: 'Kitchen exhaust cleaning', quantity: 2, unitPrice: 350, amount: 700, isService: true });
    expect(config.items[1]).toMatchObject({ inventoryItemId: 'inv-1', amount: 182, isService: false });
    expect(config.documentInfo).toEqual({ subject: 'Hood cleaning', category: 'Service', termsAndConditions: '50% deposit' });
    expect(config.fromQuotationTemplate).toEqual({ id: t.id, name: 'Std' });
    // No customer is set: it is picked in the editor as normal.
    expect(config.customer).toBeUndefined();
    expect(config.customerId).toBeUndefined();
    expect(created[0].name).toBe('QO202611-0001');
  });

  it('use: an empty Subject / T&Cs leaves the org defaults to createBasicDocument; numberFormatId passes through', async () => {
    const { svc, documents } = harness();
    const t = await svc.create({ name: 'Bare', lines: LINES }, ORG_A);
    await svc.use(t.id, { documentTemplateId: LAYOUT, numberFormatId: 'nf1' }, ORG_A);
    const config = documents.createBasicDocument.mock.calls[0][3];
    expect(config.documentInfo).toEqual({});
    expect(config.numberFormatId).toBe('nf1');
  });

  it('use: only quotation types and quotation layouts', async () => {
    const { svc, documents } = harness();
    const t = await svc.create({ name: 'Std', lines: LINES }, ORG_A);
    await expect(svc.use(t.id, { documentTemplateId: LAYOUT, type: 'INVOICE' }, ORG_A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.use(t.id, { documentTemplateId: 'layout-inv' }, ORG_A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.use(t.id, { documentTemplateId: 'missing' }, ORG_A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.use(t.id, {}, ORG_A)).rejects.toBeInstanceOf(BadRequestException);
    expect(documents.createBasicDocument).not.toHaveBeenCalled();
  });

  it('per-org isolation: org B cannot list, read, edit, hide or use org A templates', async () => {
    const { svc, documents, rows } = harness();
    const a = await svc.create({ name: 'A only', lines: LINES }, ORG_A);
    expect(await svc.list(ORG_B)).toEqual([]);
    await expect(svc.get(a.id, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.update(a.id, { name: 'stolen' }, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.hide(a.id, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.use(a.id, { documentTemplateId: LAYOUT }, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    expect(documents.createBasicDocument).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ name: 'A only', hiddenAt: null });
  });

  it('setting off: every endpoint refuses and nothing is read or written (other orgs unchanged)', async () => {
    const { svc, quotationTemplate, documents } = harness({ flags: { [ORG_A]: true, [ORG_B]: false } });
    const a = await svc.create({ name: 'A', lines: LINES }, ORG_A);
    quotationTemplate.findFirst.mockClear();
    quotationTemplate.findMany.mockClear();
    quotationTemplate.create.mockClear();
    for (const call of [
      () => svc.list(ORG_B),
      () => svc.get(a.id, ORG_B),
      () => svc.create({ name: 'B', lines: LINES }, ORG_B),
      () => svc.update(a.id, { name: 'x' }, ORG_B),
      () => svc.hide(a.id, ORG_B),
      () => svc.use(a.id, { documentTemplateId: LAYOUT }, ORG_B),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(quotationTemplate.findFirst).not.toHaveBeenCalled();
    expect(quotationTemplate.findMany).not.toHaveBeenCalled();
    expect(quotationTemplate.create).not.toHaveBeenCalled();
    expect(documents.createBasicDocument).not.toHaveBeenCalled();
  });

  it('the setting defaults off for new orgs', () => {
    expect(DEFAULT_ORG_FEATURES.enableQuotationTemplates).toBe(false);
  });
});

describe('Activity Log for the template endpoints', () => {
  const action = (method: string, path: string) =>
    (ActionLogInterceptor.prototype as any).resolveAction.call({}, method, path, path.split('/').filter(Boolean));
  const paths = () => {
    const proto = QuotationTemplatesController.prototype as any;
    return Object.getOwnPropertyNames(proto).filter((k) => k !== 'constructor');
  };

  it('controller exposes list / get / create / update / hide / use only', () => {
    expect(paths().sort()).toEqual(['create', 'get', 'hide', 'list', 'update', 'use']);
  });

  it('writes log as CREATE / UPDATE / DELETE; the list is a GET (never a bogus CREATE)', () => {
    expect(action('POST', '/quotation-templates')).toBe('CREATE');
    expect(action('PATCH', '/quotation-templates/0b0c7c39-3c1d-4c49-9f3e-0b7d5a1c2e11')).toBe('UPDATE');
    expect(action('DELETE', '/quotation-templates/0b0c7c39-3c1d-4c49-9f3e-0b7d5a1c2e11')).toBe('DELETE');
    expect(action('POST', '/quotation-templates/0b0c7c39-3c1d-4c49-9f3e-0b7d5a1c2e11/use')).toBe('CREATE');
  });
});
