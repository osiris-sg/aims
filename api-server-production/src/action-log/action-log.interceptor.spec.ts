import { lastValueFrom, of, throwError } from 'rxjs';
import { ActionLogInterceptor } from './action-log.interceptor';

// Only what the permanent-delete row needs: the PURGE verb and the handler's
// summary (req.actionLogResult) landing on the row's details.
function run(req: any, handle: () => any) {
  const rows: any[] = [];
  const interceptor = new ActionLogInterceptor({ log: async (e: any) => void rows.push(e) } as any);
  const ctx: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) };
  return { rows, out: lastValueFrom(interceptor.intercept(ctx, { handle } as any)) };
}

const RUN = '9931cce0-c309-4e8b-a52c-76543b087eb2';
const base = () => ({
  method: 'POST',
  originalUrl: `/deliveries/${RUN}/purge`,
  url: `/deliveries/${RUN}/purge`,
  params: { id: RUN },
  headers: {},
  body: {},
  user: { id: 'u1', firstName: 'Elroy' },
  userOrganization: { id: 'org1' },
});

describe('ActionLogInterceptor — permanent delivery delete', () => {
  it('logs PURGE with what the handler removed', async () => {
    const req: any = base();
    const { rows, out } = run(req, () => {
      req.actionLogResult = { deliveryNumber: 9, placeholderDocs: ['DO-PENDING-02'] };
      return of({ deleted: true });
    });
    await out;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'PURGE', resource: 'deliveries', resourceId: RUN, actorType: 'USER', status: 'SUCCESS' });
    expect(rows[0].details.result).toEqual({ deliveryNumber: 9, placeholderDocs: ['DO-PENDING-02'] });
  });

  it('a refused delete logs the error and no result', async () => {
    const req: any = base();
    req.actionLogResult = { stale: true };
    const { rows, out } = run(req, () => throwError(() => Object.assign(new Error('Only a cancelled delivery can be deleted permanently'), { status: 400 })));
    await expect(out).rejects.toThrow(/cancelled/);
    expect(rows[0]).toMatchObject({ action: 'PURGE', status: 'FAILURE', statusCode: 400 });
    expect(rows[0].details.result).toBeUndefined();
  });
});

describe('ActionLogInterceptor — split payment (enableInvoiceSplit)', () => {
  const DOC = '2f1c1d7e-1111-4c3b-9b1a-0a0a0a0a0a0a';
  it.each([
    ['split-invoice', 'SPLIT', { split: 'INV202611-0014', parts: ['INV202611-0014-1 3270.00', 'INV202611-0014-2 7630.00'] }],
    ['undo-split', 'UNDO_SPLIT', { mergedInto: 'INV202611-0014', removed: ['INV202611-0014-2'] }],
  ])('POST /documents/:id/%s logs %s with what changed', async (verb, action, result) => {
    const req: any = { ...base(), originalUrl: `/documents/${DOC}/${verb}`, url: `/documents/${DOC}/${verb}`, params: { id: DOC } };
    const { rows, out } = run(req, () => {
      req.actionLogResult = result;
      return of({ ok: true });
    });
    await out;
    expect(rows[0]).toMatchObject({ action, resource: 'documents', resourceId: DOC, status: 'SUCCESS' });
    expect(rows[0].details.result).toEqual(result);
  });
});

describe('ActionLogInterceptor — imported orders, Link existing document (round 19)', () => {
  const ORDER = '6b1c1d7e-2222-4c3b-9b1a-0a0a0a0a0a0b';
  it.each([
    ['link-document', 'LINK', { linked: 'QUOTATION QO202611-0050', order: 'ORD-Q-014154' }],
    ['unlink-document', 'UNLINK', { unlinked: 'INVOICE I-014521', order: 'ORD-Q-014154' }],
  ])('POST /orders/:id/%s logs %s with the document and the order', async (verb, action, result) => {
    const req: any = { ...base(), originalUrl: `/orders/${ORDER}/${verb}`, url: `/orders/${ORDER}/${verb}`, params: { id: ORDER }, body: { type: 'QUOTATION', id: 'x' } };
    const { rows, out } = run(req, () => {
      req.actionLogResult = result;
      return of({ ok: true });
    });
    await out;
    expect(rows[0]).toMatchObject({ action, resource: 'orders', resourceId: ORDER, status: 'SUCCESS' });
    expect(rows[0].details.result).toEqual(result);
  });
});

describe('ActionLogInterceptor — jobs calendar panel (WCT round 36)', () => {
  const JOB = '6b1c1d7e-3333-4c3b-9b1a-0a0a0a0a0a0c';
  it.each([
    ['POST', 'calendar-cancel', 'CANCEL', {}],
    ['POST', 'calendar-uncancel', 'UNDO', {}],
    ['POST', 'reschedule', 'RESCHEDULE', { date: '2026-11-25', time: '14:30' }],
    ['PATCH', 'style', 'UPDATE', { sticker: true }],
    ['PATCH', 'ptw', 'UPDATE', { ptwStatus: 'APPROVED' }],
    ['PUT', 'category', 'UPDATE', { category: 'Site visit' }],
  ])('%s /deliveries/:id/%s logs %s on the job', async (method, verb, action, body) => {
    const req: any = { ...base(), method, originalUrl: `/deliveries/${JOB}/${verb}`, url: `/deliveries/${JOB}/${verb}`, params: { id: JOB }, body };
    const { rows, out } = run(req, () => of({ ok: true }));
    await out;
    expect(rows[0]).toMatchObject({ action, resource: 'deliveries', resourceId: JOB, status: 'SUCCESS' });
  });
});

describe('ActionLogInterceptor — Delivery contacts "Add new contact" (enableOfficeDoEdits)', () => {
  const CUST = '3a2b1c0d-2222-4c3b-9b1a-0b0b0b0b0b0b';
  const PROJ = '4b3c2d1e-3333-4c3b-9b1a-0c0c0c0c0c0c';
  it('POST /customers/:customerId/contacts logs a CREATE on the customer (not a VIEW)', async () => {
    const req: any = {
      ...base(),
      originalUrl: `/customers/${CUST}/contacts`,
      url: `/customers/${CUST}/contacts`,
      params: { customerId: CUST },
      body: { name: 'Tan Ah Kow', phone: '91234567' },
    };
    const { rows, out } = run(req, () => of({ id: 'c1' }));
    await out;
    expect(rows[0]).toMatchObject({ action: 'CREATE', resource: 'customers', resourceId: CUST, status: 'SUCCESS' });
    expect(rows[0].details.body).toEqual({ name: 'Tan Ah Kow', phone: '91234567' });
  });
  it('PUT /projects/:id/contacts logs an UPDATE on the project', async () => {
    const req: any = {
      ...base(),
      method: 'PUT',
      originalUrl: `/projects/${PROJ}/contacts`,
      url: `/projects/${PROJ}/contacts`,
      params: { id: PROJ },
      body: { contacts: [{ contactId: 'c1', group: null }] },
    };
    const { rows, out } = run(req, () => of({ ok: true }));
    await out;
    expect(rows[0]).toMatchObject({ action: 'UPDATE', resource: 'projects', resourceId: PROJ, status: 'SUCCESS' });
  });
});
