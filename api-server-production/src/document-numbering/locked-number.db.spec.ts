import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import { Client } from 'pg';
import ws = require('ws');
import { DocumentNumberingService } from './document-numbering.service';
import { insertWithLockedNumber } from './locked-number';
import { invoiceNumberGuardSql } from './invoice-number-guard';

// Round 36 (WCT group): invoice numbers claimed inside the transaction that writes the invoice, and the
// aims_inv_number_guard trigger, against a REAL Postgres. Needs TEST_DATABASE_URL (skipped otherwise), e.g. the dev DB:
//   TEST_DATABASE_URL="$(node -e "require('dotenv').config();console.log(process.env.DATABASE_URL)")" npx jest src/document-numbering/locked-number.db.spec.ts
// Nothing shared is touched: the spec copies the Document / DocumentNumberFormat / OrganizationUIConfig tables into a
// throwaway schema (CREATE TABLE … LIKE … INCLUDING ALL: same columns and unique indexes, no rows, no triggers),
// installs the guard there, runs the app's Prisma driver (Neon adapter) against it and drops the schema at the end.
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const url = process.env.TEST_DATABASE_URL;
const maybe = url ? describe : describe.skip;
jest.setTimeout(120_000);

maybe('locked invoice numbers + aims_inv_number_guard (real Postgres)', () => {
  const schema = `r36t_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  let pg: Client;
  let prisma: PrismaClient;
  let numbering: DocumentNumberingService;
  const flagged = randomUUID();
  const legacyOrg = randomUUID();
  const other = randomUUID();
  const ym = (() => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const cleanUrl = () => {
    const u = new URL(url!);
    for (const k of ['pool_timeout', 'connect_timeout', 'connection_limit', 'schema']) u.searchParams.delete(k);
    return u.toString();
  };

  /** A raw insert from ANOTHER connection (autocommit): a writer that does not go through the helper. */
  const rawInvoice = (org: string, name: string, template = 'tpl-other') =>
    pg.query(`INSERT INTO "${schema}"."Document" (id, "updatedAt", config, "documentTemplateId", type, "organizationId", name) VALUES (gen_random_uuid(), now(), '{}'::jsonb, $1, 'INVOICE', $2, $3)`, [template, org, name]);

  const create = (org: string, insertHook?: (attempt: number, name: string) => Promise<void>) => {
    let attempt = 0;
    return insertWithLockedNumber(prisma, numbering, {
      organizationId: org,
      documentType: 'INVOICE',
      legacyPrefix: `INV${ym}-`,
      what: 'invoice',
      insert: async (tx, name) => {
        attempt++;
        if (insertHook) await insertHook(attempt, name);
        return tx.document.create({ data: { documentTemplateId: 'tpl-inv', type: 'INVOICE', organizationId: org, name, config: {}, revisionNumber: 0 }, select: { id: true, name: true } });
      },
    });
  };

  beforeAll(async () => {
    pg = new Client({ connectionString: cleanUrl() });
    await pg.connect();
    const where = async (table: string, prefer: string[]) => {
      const r = await pg.query(
        `SELECT n.nspname s FROM pg_namespace n WHERE to_regclass(format('%I.%I', n.nspname, $1::text)) IS NOT NULL AND (n.nspname::text = ANY($2::text[]) OR n.nspname LIKE 'org\\_%') ORDER BY array_position($2::text[], n.nspname::text) NULLS LAST, 1 LIMIT 1`,
        [table, prefer],
      );
      if (!r.rows[0]) throw new Error(`no ${table} table found`);
      return r.rows[0].s as string;
    };
    const docSrc = await where('Document', ['public']);
    const uiSrc = await where('OrganizationUIConfig', ['public', 'platform']);
    await pg.query(`CREATE SCHEMA "${schema}"`);
    await pg.query(`CREATE TABLE "${schema}"."Document" (LIKE "${docSrc}"."Document" INCLUDING ALL)`);
    // Prisma casts enum values to "<schema>"."DocumentStatus": the throwaway schema gets its own copy of the enum.
    const labels = (await pg.query(`SELECT e.enumlabel l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'DocumentStatus' AND n.nspname = $1 ORDER BY e.enumsortorder`, [docSrc])).rows.map((r) => r.l);
    await pg.query(`CREATE TYPE "${schema}"."DocumentStatus" AS ENUM (${labels.map((l) => `'${String(l).replace(/'/g, "''")}'`).join(', ')})`);
    await pg.query(`ALTER TABLE "${schema}"."Document" ALTER COLUMN status DROP DEFAULT, ALTER COLUMN status TYPE "${schema}"."DocumentStatus" USING status::text::"${schema}"."DocumentStatus", ALTER COLUMN status SET DEFAULT 'unconfirmed'`);
    await pg.query(`CREATE TABLE "${schema}"."DocumentNumberFormat" (LIKE "${docSrc}"."DocumentNumberFormat" INCLUDING ALL)`);
    await pg.query(`CREATE TABLE "${schema}"."OrganizationUIConfig" (LIKE "${uiSrc}"."OrganizationUIConfig" INCLUDING ALL)`);
    for (const sql of invoiceNumberGuardSql(schema, schema)) await pg.query(sql);
    const ui = (org: string, features: object) => pg.query(`INSERT INTO "${schema}"."OrganizationUIConfig" (id, "organizationId", features, "updatedAt") VALUES (gen_random_uuid(), $1, $2::jsonb, now())`, [org, JSON.stringify(features)]);
    await ui(flagged, { enableWctOrderInvoice: true, enableWctOrders: true });
    await ui(legacyOrg, { enableImportedOrders: true });
    await ui(other, { enableProjects: true });
    await pg.query(
      `INSERT INTO "${schema}"."DocumentNumberFormat" (id, "organizationId", "documentType", label, pattern, "nextSerial", "resetPolicy", "isActive", "sortOrder", "updatedAt") VALUES (gen_random_uuid(), $1, 'INVOICE', 'Default', '{DOC}{YYYY}{MM}-{####}', 1, 'never', true, 0, now())`,
      [flagged],
    );
    prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: cleanUrl() }, { schema }) } as any);
    numbering = new DocumentNumberingService(prisma as any);
  });

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    if (pg) {
      await pg.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await pg.end().catch(() => undefined);
    }
  });

  it('two creates at the same moment get different numbers (the org counter), the counter moves past both', async () => {
    const [a, b] = await Promise.all([create(flagged), create(flagged)]);
    expect(new Set([a.name, b.name]).size).toBe(2);
    expect([a.name, b.name].sort()).toEqual([`INV${ym}-0001`, `INV${ym}-0002`]);
    const f = await pg.query(`SELECT "nextSerial" FROM "${schema}"."DocumentNumberFormat" WHERE "organizationId" = $1`, [flagged]);
    expect(f.rows[0].nextSerial).toBe(3);
  });

  it('five at once: five different, consecutive numbers', async () => {
    const out = await Promise.all([1, 2, 3, 4, 5].map(() => create(flagged)));
    expect(out.map((o) => o.name).sort()).toEqual([3, 4, 5, 6, 7].map((n) => `INV${ym}-${String(n).padStart(4, '0')}`));
  });

  it('an org with no invoice number format: the legacy INV<yyyymm>-NNN, still different at the same moment', async () => {
    const out = await Promise.all([create(legacyOrg), create(legacyOrg), create(legacyOrg)]);
    expect(out.map((o) => o.name).sort()).toEqual([`INV${ym}-001`, `INV${ym}-002`, `INV${ym}-003`]);
  });

  it('the guard refuses a second invoice with a number already used in the org (another template too)', async () => {
    await expect(rawInvoice(flagged, `INV${ym}-0001`, 'tpl-x')).rejects.toThrow(/AIMS guard: invoice number INV\d{6}-0001 is already used/);
    // A revision-style or non-invoice name is not touched; a different number is fine.
    await expect(rawInvoice(flagged, `INV${ym}-0001 (Rev-1)`, 'tpl-x')).resolves.toBeTruthy();
    await expect(pg.query(`INSERT INTO "${schema}"."Document" (id, "updatedAt", config, "documentTemplateId", type, "organizationId", name) VALUES (gen_random_uuid(), now(), '{}'::jsonb, 'tpl-q', 'QUOTATION', $1, $2)`, [flagged, `INV${ym}-0001`])).resolves.toBeTruthy();
  });

  it('renaming an invoice onto a used number is refused; saving its config is not checked', async () => {
    const r = await pg.query(`SELECT id FROM "${schema}"."Document" WHERE "organizationId" = $1 AND name = $2`, [flagged, `INV${ym}-0002`]);
    await expect(pg.query(`UPDATE "${schema}"."Document" SET name = $2 WHERE id = $1`, [r.rows[0].id, `INV${ym}-0001`])).rejects.toThrow(/AIMS guard/);
    await expect(pg.query(`UPDATE "${schema}"."Document" SET config = '{"x":1}'::jsonb WHERE id = $1`, [r.rows[0].id])).resolves.toBeTruthy();
  });

  it('another org (order invoicing off) is unchanged: the same number under two templates is still accepted', async () => {
    await expect(rawInvoice(other, 'INV-SAME', 'tpl-a')).resolves.toBeTruthy();
    await expect(rawInvoice(other, 'INV-SAME', 'tpl-b')).resolves.toBeTruthy();
    const n = await pg.query(`SELECT count(*)::int n FROM "${schema}"."Document" WHERE "organizationId" = $1 AND name = 'INV-SAME'`, [other]);
    expect(n.rows[0].n).toBe(2);
  });

  it('a clash with a writer outside the helper (the guard fires): retried with the next number', async () => {
    const out = await create(flagged, async (attempt, name) => {
      // Another writer commits the number this attempt was given, just before it is written.
      if (attempt === 1) await rawInvoice(flagged, name, 'tpl-x');
    });
    expect(out.attempts).toBe(2);
    expect(out.name).toBe(`INV${ym}-0009`);
    const n = await pg.query(`SELECT count(*)::int n FROM "${schema}"."Document" WHERE "organizationId" = $1 AND name = $2`, [flagged, `INV${ym}-0008`]);
    expect(n.rows[0].n).toBe(1);
  });

  it('a clash on the per-template unique index (Prisma P2002, org without the guard) is retried too', async () => {
    const out = await create(other, async (attempt, name) => {
      if (attempt === 1) await rawInvoice(other, name, 'tpl-inv');
    });
    expect(out.attempts).toBe(2);
    expect(out.name).toBe(`INV${ym}-002`);
  });

  it('gives up after 3 clashes with a 409 (nothing written, the counter not moved)', async () => {
    const before = await pg.query(`SELECT "nextSerial" FROM "${schema}"."DocumentNumberFormat" WHERE "organizationId" = $1`, [flagged]);
    await expect(create(flagged, async (_a, name) => void (await rawInvoice(flagged, name, 'tpl-x')))).rejects.toMatchObject({ status: 409 });
    const after = await pg.query(`SELECT "nextSerial" FROM "${schema}"."DocumentNumberFormat" WHERE "organizationId" = $1`, [flagged]);
    // Each attempt rolled back its claim; only the outside writer's rows exist.
    expect(after.rows[0].nextSerial).toBe(before.rows[0].nextSerial);
  });
});
