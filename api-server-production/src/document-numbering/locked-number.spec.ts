import { HttpException } from '@nestjs/common';
import { insertWithLockedNumber, isNumberConflict, legacySerialName, retryOnNumberConflict } from './locked-number';
import { INVOICE_NUMBER_GUARD_FLAGS, dropInvoiceNumberGuardSql, invoiceNumberGuardSql } from './invoice-number-guard';

// Round 36 (WCT group): the retry around a locked number claim, with the clash mocked (the real Postgres run is
// locked-number.db.spec.ts).
const p2002 = () => Object.assign(new Error('Unique constraint failed on the fields: (`name`,`organizationId`,`documentTemplateId`)'), { code: 'P2002' });
const guard = () => new Error('Invalid `tx.document.create()` invocation: AIMS guard: invoice number INV202611-0025 is already used in this organisation');

describe('isNumberConflict', () => {
  it('P2002, SQLSTATE 23505 and the guard text are clashes; anything else is not', () => {
    expect(isNumberConflict(p2002())).toBe(true);
    expect(isNumberConflict(guard())).toBe(true);
    expect(isNumberConflict({ code: '23505' })).toBe(true);
    expect(isNumberConflict({ message: 'duplicate key value violates unique constraint "Document_name_organizationId_documentTemplateId_key"' })).toBe(true);
    expect(isNumberConflict(new Error('connection reset'))).toBe(false);
    expect(isNumberConflict(new HttpException('Order not found', 404))).toBe(false);
    expect(isNumberConflict(null)).toBe(false);
  });
});

describe('retryOnNumberConflict', () => {
  it('a clash is retried and the second attempt wins', async () => {
    const run = jest.fn(async (n: number) => {
      if (n === 1) throw guard();
      return `ok-${n}`;
    });
    await expect(retryOnNumberConflict(run)).resolves.toBe('ok-2');
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('three clashes: a 409 asking to try again (bounded)', async () => {
    const run = jest.fn(async () => {
      throw p2002();
    });
    const e: any = await retryOnNumberConflict(run, { what: 'invoice' }).catch((x) => x);
    expect(e).toBeInstanceOf(HttpException);
    expect(e.getStatus()).toBe(409);
    expect(e.message).toMatch(/free invoice number/);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('any other failure is thrown at once, never retried', async () => {
    const run = jest.fn(async () => {
      throw new Error('The quotation of this order is gone.');
    });
    await expect(retryOnNumberConflict(run)).rejects.toThrow(/quotation of this order is gone/);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('insertWithLockedNumber (mocked database)', () => {
  function db(existing: string[] = []) {
    const names = [...existing];
    const tx: any = {
      $executeRawUnsafe: jest.fn(async () => 1),
      document: { findMany: jest.fn(async ({ where }: any) => names.filter((n) => n.startsWith(where.name?.startsWith ?? '')).map((name) => ({ name, config: {} }))) },
    };
    const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    return { prisma, tx, names };
  }
  it('claims inside the transaction (lock first), writes with that number; a clash takes the next one', async () => {
    const { prisma, tx } = db();
    let serial = 24;
    const numbering = { issueNumberLocked: jest.fn(async (_o: string, _t: string, _f: any, _w: any, t: any) => (t === tx ? `INV202611-${String(++serial).padStart(4, '0')}` : null)) };
    const insert = jest.fn(async (_tx: any, name: string) => {
      if (name === 'INV202611-0025') throw guard();
      return { id: 'inv1', name };
    });
    const out = await insertWithLockedNumber(prisma, numbering, { organizationId: 'org1', documentType: 'INVOICE', legacyPrefix: 'INV202611-', insert });
    expect(out).toEqual({ row: { id: 'inv1', name: 'INV202611-0026' }, name: 'INV202611-0026', attempts: 2 });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', 'doc-number:org1:INVOICE');
    expect(numbering.issueNumberLocked).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls.map((c) => c[1])).toEqual(['INV202611-0025', 'INV202611-0026']);
  });
  it('no number format: the legacy prefix + serial, read in the transaction (split parts count as their base)', async () => {
    const { prisma } = db(['INV202611-007', 'INV202611-009', 'QO202611-050']);
    const numbering = { issueNumberLocked: jest.fn(async () => null) };
    const out = await insertWithLockedNumber(prisma, numbering, { organizationId: 'org1', documentType: 'INVOICE', legacyPrefix: 'INV202611-', insert: async (_t, name) => ({ name }) });
    expect(out.name).toBe('INV202611-010');
  });
  it('legacySerialName: first of the month is -001', async () => {
    await expect(legacySerialName({ document: { findMany: async () => [] } }, 'org1', 'INV202612-')).resolves.toBe('INV202612-001');
  });
});

describe('aims_inv_number_guard SQL', () => {
  it('gated on the order-invoicing flags; checks INVOICE rows of the same org only; raises a unique violation', () => {
    const sql = invoiceNumberGuardSql('public', 'public').join('\n');
    expect(INVOICE_NUMBER_GUARD_FLAGS).toEqual(['enableWctOrderInvoice', 'enableImportedOrders', 'invoiceNumberGuard']);
    expect(sql).toContain(`COALESCE(c.features ->> 'enableWctOrderInvoice', '') = 'true' OR COALESCE(c.features ->> 'enableImportedOrders', '') = 'true'`);
    expect(sql).toContain(`WHEN (NEW.type = 'INVOICE' AND NEW.name IS NOT NULL AND NEW.name <> '')`);
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF name, type, "organizationId" ON "public"."Document"');
    expect(sql).toContain(`USING ERRCODE = 'unique_violation'`);
    expect(invoiceNumberGuardSql('org_wct', 'platform').join('\n')).toContain('"platform"."OrganizationUIConfig"');
    expect(dropInvoiceNumberGuardSql('public')).toEqual(['DROP TRIGGER IF EXISTS aims_inv_number_guard ON "public"."Document";', 'DROP FUNCTION IF EXISTS "public".aims_inv_number_guard();']);
    expect(() => invoiceNumberGuardSql('x"; drop table y; --', 'public')).toThrow(/bad schema/);
  });
});
