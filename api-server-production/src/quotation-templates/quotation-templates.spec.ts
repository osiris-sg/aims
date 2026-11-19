import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QuotationTemplatesService } from './quotation-templates.service';
import { QuotationTemplatesController } from './quotation-templates.controller';
import { ActionLogInterceptor } from '../action-log/action-log.interceptor';
import { linesToItems, sanitizeLines, templateTotals } from './quotation-template-lines';
import { DEFAULT_ORG_FEATURES } from '../organizations/default-features';
import { lastValueFrom, of } from 'rxjs';
import { CustomResponseInterceptor } from '../../helpers/custom-sucess.filter';
import { CustomExceptionFilter } from '../../helpers/custom-exception.filter';

/**
 * Quotation templates (2026-11-18, WCT group; reworked 2026-11-19: made only from a quotation, lines kept exactly). The service runs on a small
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
      // Fixed stamps: "never saves ... dates" looks for the quotation's date (2026-11-19) in the row.
      const row = { id: `t${++n}`, hiddenAt: null, hiddenBy: null, createdAt: new Date('2026-01-02T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'), ...data };
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

// A real quotation's editor lines (WCT group, as the editor stores them): a title, a service with its SV code, a
// product with its inventory link and UOM (Racking), tax / account codes, and the editor's blank last row.
const QUOTE_ITEMS = [
  { id: 1763500000001, isGroupHeader: true, description: 'Kitchen hood', quantity: null, unitPrice: null, amount: null },
  { id: 1763500000002, itemCode: 'SV001', inventoryItemId: '', description: 'Kitchen exhaust cleaning', quantity: 2, unitPrice: 350, amount: 700, uom: 'lot', isService: true, revenueTag: 'service', tax: 'SR', accountCode: '4000' },
  { id: 1763500000003, itemCode: 'FLT-1', inventoryItemId: 'inv-1', description: 'Baffle filter', quantity: 4, unitPrice: 45.5, amount: 182, uom: 'pcs', isService: false, tax: 'SR', accountCode: '4100' },
  { id: 1763500000004, itemCode: '', inventoryItemId: '', description: '', quantity: 1, unitPrice: 0, amount: 0 },
];
const withoutId = ({ id: _id, ...rest }: any) => rest;
const QUOTE = { name: 'Hood standard', items: QUOTE_ITEMS, category: 'Service', subject: 'Hood cleaning', termsAndConditions: '50% deposit', remarks: 'Call first', customer: { id: 'c1' }, issueDate: '2026-11-19' };

describe('QuotationTemplatesService (2026-11-19: made only from a quotation)', () => {
  it('Save as template copies the quotation lines exactly (row id dropped, blank row skipped) and the Category', async () => {
    const { svc, rows } = harness();
    const t = await svc.saveFromQuotation(QUOTE, ORG_A, { id: 'u1', name: 'Ann' });
    expect(rows[0].lines).toEqual(QUOTE_ITEMS.slice(0, 3).map((it) => ({ item: withoutId(it) })));
    expect(rows[0].category).toBe('Service');
    expect(t).toMatchObject({ name: 'Hood standard', lineCount: 2, total: 882, unlinked: 0, category: 'Service', createdByName: 'Ann' });
    expect(t.lines.map((l: any) => [l.itemCode, l.isGroupHeader, l.uom, l.lineType])).toEqual([
      ['', true, '', 'SERVICE'],
      ['SV001', false, 'lot', 'SERVICE'],
      ['FLT-1', false, 'pcs', 'PRODUCT'],
    ]);
  });

  it('never saves Subject, T&Cs, customer, dates or Remarks', async () => {
    const { svc, rows } = harness();
    await svc.saveFromQuotation(QUOTE, ORG_A);
    expect(rows[0].subject).toBeNull();
    expect(rows[0].termsAndConditions).toBeNull();
    expect(JSON.stringify(rows[0])).not.toMatch(/Hood cleaning|50% deposit|Call first|"c1"|2026-11-19/);
  });

  it('Use creates a draft whose lines are identical to the quotation it came from (fresh ids), no Subject / T&Cs', async () => {
    const { svc, documents } = harness();
    const t = await svc.saveFromQuotation(QUOTE, ORG_A);
    const res = await svc.use(t.id, { documentTemplateId: LAYOUT, type: 'quotation' }, ORG_A, { id: 'u1', name: 'Ann' });
    expect(res).toEqual({ success: true, data: { id: 'doc1', type: 'QUOTATION', documentTemplateId: LAYOUT, name: 'QO202611-0001' } });
    const [layoutId, type, org, config, projectId, actor] = documents.createBasicDocument.mock.calls[0];
    expect([layoutId, type, org, projectId, actor]).toEqual([LAYOUT, 'QUOTATION', ORG_A, undefined, { id: 'u1', name: 'Ann' }]);
    expect(config.items.map(withoutId)).toEqual(QUOTE_ITEMS.slice(0, 3).map(withoutId));
    const ids = config.items.map((i: any) => i.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain(QUOTE_ITEMS[1].id);
    expect(config.documentInfo).toEqual({ quotationCategory: 'Service' });
    expect(config.quotationCategory).toBe('Service');
    expect(config.fromQuotationTemplate).toEqual({ id: t.id, name: 'Hood standard' });
    expect(config.customer).toBeUndefined();
    // Using twice gives two separate copies (no shared objects with the template).
    config.items[1].quantity = 99;
    await svc.use(t.id, { documentTemplateId: LAYOUT }, ORG_A);
    expect(documents.createBasicDocument.mock.calls[1][3].items[1].quantity).toBe(2);
  });

  it('a name in use: refused until Replace (same template, new lines) or Save as new ("Name (2)")', async () => {
    const { svc, rows } = harness();
    const first = await svc.saveFromQuotation(QUOTE, ORG_A);
    const changed = { ...QUOTE, name: 'hood STANDARD', category: 'Maintenance', items: [QUOTE_ITEMS[1]] };
    await expect(svc.saveFromQuotation(changed, ORG_A)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.saveFromQuotation(changed, ORG_A)).rejects.toMatchObject({ response: { existingId: first.id } });
    expect(rows).toHaveLength(1);

    const replaced = await svc.saveFromQuotation({ ...changed, onExisting: 'replace' }, ORG_A);
    expect(rows).toHaveLength(1);
    expect(replaced).toMatchObject({ id: first.id, name: 'Hood standard', lineCount: 1, total: 700, category: 'Maintenance', replaced: true });

    const asNew = await svc.saveFromQuotation({ ...changed, onExisting: 'new' }, ORG_A);
    expect(rows).toHaveLength(2);
    expect(asNew.name).toBe('hood STANDARD (2)');
    const again = await svc.saveFromQuotation({ ...QUOTE, onExisting: 'new' }, ORG_A);
    expect(again.name).toBe('Hood standard (3)');
    // A free name saves straight away, whatever onExisting says.
    await expect(svc.saveFromQuotation({ ...QUOTE, name: 'Fresh', onExisting: 'replace' }, ORG_A)).resolves.toMatchObject({ name: 'Fresh' });
  });

  it('rejects a blank name and a quotation with no lines', async () => {
    const { svc } = harness();
    await expect(svc.saveFromQuotation({ ...QUOTE, name: ' ' }, ORG_A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.saveFromQuotation({ ...QUOTE, items: [QUOTE_ITEMS[3]] }, ORG_A)).rejects.toBeInstanceOf(BadRequestException);
    // Another org may use the same name.
    await svc.saveFromQuotation(QUOTE, ORG_A);
    await expect(svc.saveFromQuotation(QUOTE, ORG_B)).resolves.toMatchObject({ name: 'Hood standard' });
  });

  it('rename only: the lines cannot be edited through the API any more', async () => {
    const { svc, rows } = harness();
    const t = await svc.saveFromQuotation(QUOTE, ORG_A);
    const r = await svc.update(t.id, { name: 'New name', lines: [], subject: 'x' } as any, ORG_A);
    expect(r).toMatchObject({ name: 'New name', lineCount: 2 });
    expect(rows[0].subject).toBeNull();
    await svc.saveFromQuotation({ ...QUOTE, name: 'Other' }, ORG_A);
    await expect(svc.update(t.id, { name: 'OTHER' }, ORG_A)).rejects.toThrow('already exists');
  });

  it('an older typed template still lists and Uses; its lines with no product / service code are flagged', async () => {
    const { svc, rows, documents } = harness();
    rows.push({ id: 'old1', organizationId: ORG_A, name: 'Typed', hiddenAt: null, createdAt: new Date(), updatedAt: new Date(), subject: 'Old subject', termsAndConditions: 'Old T&Cs', category: null, lines: sanitizeLines(LINES.concat([{ description: 'Free text line', itemCode: '' } as any])) });
    const [view] = await svc.list(ORG_A);
    expect(view).toMatchObject({ name: 'Typed', lineCount: 3, unlinked: 1 });
    expect(view.lines.map((l: any) => l.linked)).toEqual([true, true, false]);
    await svc.use('old1', { documentTemplateId: LAYOUT }, ORG_A);
    const config = documents.createBasicDocument.mock.calls[0][3];
    expect(config.items).toHaveLength(3);
    expect(config.items[1]).toMatchObject({ inventoryItemId: 'inv-1', amount: 182, isService: false });
    // Subject / T&Cs stay behind even on an older template.
    expect(config.documentInfo).toEqual({});
  });

  it('delete hides the row (kept); a hidden template cannot be read, renamed or used; its name is free', async () => {
    const { svc, rows } = harness();
    const t = await svc.saveFromQuotation({ ...QUOTE, name: 'Gone' }, ORG_A);
    await svc.hide(t.id, ORG_A, { id: 'u1' });
    expect(rows[0].hiddenAt).toBeInstanceOf(Date);
    expect(rows[0].hiddenBy).toBe('u1');
    expect(await svc.list(ORG_A)).toEqual([]);
    await expect(svc.get(t.id, ORG_A)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.update(t.id, { name: 'x' }, ORG_A)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.use(t.id, { documentTemplateId: LAYOUT }, ORG_A)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.saveFromQuotation({ ...QUOTE, name: 'Gone' }, ORG_A)).resolves.toMatchObject({ name: 'Gone' });
  });

  it('use: numberFormatId passes through; only quotation types and quotation layouts', async () => {
    const { svc, documents } = harness();
    const t = await svc.saveFromQuotation(QUOTE, ORG_A);
    await svc.use(t.id, { documentTemplateId: LAYOUT, numberFormatId: 'nf1' }, ORG_A);
    expect(documents.createBasicDocument.mock.calls[0][3].numberFormatId).toBe('nf1');
    await expect(svc.use(t.id, { documentTemplateId: LAYOUT, type: 'INVOICE' }, ORG_A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.use(t.id, { documentTemplateId: 'layout-inv' }, ORG_A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.use(t.id, {}, ORG_A)).rejects.toBeInstanceOf(BadRequestException);
    expect(documents.createBasicDocument).toHaveBeenCalledTimes(1);
  });

  it('per-org isolation: org B cannot list, read, rename, hide, replace or use org A templates', async () => {
    const { svc, documents, rows } = harness();
    const a = await svc.saveFromQuotation({ ...QUOTE, name: 'A only' }, ORG_A);
    expect(await svc.list(ORG_B)).toEqual([]);
    await expect(svc.get(a.id, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.update(a.id, { name: 'stolen' }, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.hide(a.id, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.use(a.id, { documentTemplateId: LAYOUT }, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    // Org B saving the same name with Replace makes its own template; org A's is untouched.
    await svc.saveFromQuotation({ ...QUOTE, name: 'A only', items: [QUOTE_ITEMS[1]], onExisting: 'replace' }, ORG_B);
    expect(rows.find((r) => r.id === a.id).lines).toHaveLength(3);
    expect(documents.createBasicDocument).not.toHaveBeenCalled();
  });

  it('setting off: every endpoint refuses and nothing is read or written (other orgs unchanged)', async () => {
    const { svc, quotationTemplate, documents } = harness({ flags: { [ORG_A]: true, [ORG_B]: false } });
    const a = await svc.saveFromQuotation(QUOTE, ORG_A);
    quotationTemplate.findFirst.mockClear();
    quotationTemplate.findMany.mockClear();
    quotationTemplate.create.mockClear();
    quotationTemplate.update.mockClear();
    for (const call of [
      () => svc.list(ORG_B),
      () => svc.get(a.id, ORG_B),
      () => svc.saveFromQuotation(QUOTE, ORG_B),
      () => svc.update(a.id, { name: 'x' }, ORG_B),
      () => svc.hide(a.id, ORG_B),
      () => svc.use(a.id, { documentTemplateId: LAYOUT }, ORG_B),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(quotationTemplate.findFirst).not.toHaveBeenCalled();
    expect(quotationTemplate.findMany).not.toHaveBeenCalled();
    expect(quotationTemplate.create).not.toHaveBeenCalled();
    expect(quotationTemplate.update).not.toHaveBeenCalled();
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

/**
 * 2026-11-19 prod bug ("Save as template" saved, but Create from template said "No templates yet"): the API wraps
 * every reply in { success, data, message } (main.ts CustomResponseInterceptor) and sends errors as
 * { success: false, message, data } (CustomExceptionFilter). The portal read the list as a bare array. These are the
 * exact bodies the browser gets; portal-production/helpers/quotationTemplates.test.mjs parses the same shapes.
 */
describe('replies as the browser receives them', () => {
  const wire = (value: any) =>
    lastValueFrom(new CustomResponseInterceptor().intercept({ getType: () => 'http' } as any, { handle: () => of(value) } as any));
  const wireError = (err: any) => {
    const sent: any = {};
    const res = { status: (c: number) => ((sent.status = c), res), setHeader: () => res, send: (b: any) => ((sent.body = b), res) };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    new CustomExceptionFilter().catch(err, { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ method: 'POST', url: '/quotation-templates' }) }) } as any);
    warn.mockRestore();
    return sent;
  };

  it('the list is wrapped: { success, data: [templates] }, never a bare array', async () => {
    const { svc } = harness();
    const saved = await svc.saveFromQuotation(QUOTE, ORG_A);
    const body: any = await wire(await svc.list(ORG_A));
    expect(Array.isArray(body)).toBe(false);
    expect(body.success).toBe(true);
    expect(body.data.map((t: any) => t.id)).toEqual([saved.id]);
    expect(body.data[0]).toMatchObject({ name: 'Hood standard', lineCount: 2 });
  });

  it('a save is wrapped once ({ data: template }); Use is wrapped twice ({ data: { data: quotation } })', async () => {
    const { svc } = harness();
    const saveBody: any = await wire(await svc.saveFromQuotation(QUOTE, ORG_A));
    expect(saveBody).toMatchObject({ success: true, data: { name: 'Hood standard' } });
    expect(typeof saveBody.data.id).toBe('string');
    const useBody: any = await wire(await svc.use(saveBody.data.id, { documentTemplateId: LAYOUT }, ORG_A));
    expect(useBody.data.id).toBeUndefined();
    expect(useBody).toMatchObject({ success: true, data: { success: true, data: { id: 'doc1', type: 'QUOTATION', documentTemplateId: LAYOUT } } });
  });

  it('a name in use reaches the browser as 409 { success: false, message, data: { existingId, existingName } }', async () => {
    const { svc } = harness();
    const first = await svc.saveFromQuotation(QUOTE, ORG_A);
    const err = await svc.saveFromQuotation({ ...QUOTE, name: 'HOOD standard' }, ORG_A).catch((e) => e);
    const sent = wireError(err);
    expect(sent.status).toBe(409);
    expect(sent.body).toEqual({
      success: false,
      message: 'A template named Hood standard already exists',
      data: { existingId: first.id, existingName: 'Hood standard' },
    });
  });

  it('the setting off reaches the browser as 403 with a message (other orgs: no template calls are made)', async () => {
    const { svc } = harness({ flags: { [ORG_A]: false } });
    const sent = wireError(await svc.list(ORG_A).catch((e) => e));
    expect(sent.status).toBe(403);
    expect(sent.body).toMatchObject({ success: false, message: 'Quotation templates are not enabled for this organisation' });
  });
});
