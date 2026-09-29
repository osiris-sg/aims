/**
 * DB-level accounting guards — the "never again" layer for the double-posting
 * and orphan-journal incidents (ACCOUNTING_REVIEW_2026-09-28.md).
 *
 * Installs three plpgsql triggers per accounting schema:
 *   1. aims_je_guard (INSERT/UPDATE on JournalEntry):
 *      a. a non-null sourceDocumentId must reference an existing Document
 *         (referential integrity — done as a trigger, NOT a Prisma FK, so
 *         `prisma db push` can never drop it);
 *      b. one ACTIVE document-posting journal per (organizationId,
 *         sourceDocumentId, type). Excluded from (b): VOID rows, Xero GL
 *         imports (createdBy='xero-import' is the book-of-record mirror),
 *         settlement journals (type PAYMENT / sourcePaymentId set — an invoice
 *         legitimately takes many part-payments), and ADJUSTMENT reversals.
 *   2. aims_doc_delete_guard (DELETE on Document): a document with an active
 *      (non-VOID) journal cannot be deleted — void the journal first.
 *      deleteDocument() already voids before deleting, so app flows pass.
 *
 * Layout aware: on the old single-schema layout (staging/prod) it targets
 * `public`; on the per-org layout (dev since 2026-09-28) it targets every
 * org_* schema that has a JournalEntry table. Schemas without a Document
 * table (books-only orgs: yourworld, u2can) get variant SQL that instead
 * rejects ANY non-null sourceDocumentId (there are no documents to point at).
 *
 * Usage (from api-server-production/):
 *   npx ts-node --transpile-only scripts/journal-guards.ts audit  .env
 *   npx ts-node --transpile-only scripts/journal-guards.ts apply  .env
 *   npx ts-node --transpile-only scripts/journal-guards.ts test   .env   # dev only; proves the guards fire, rolls back
 *   npx ts-node --transpile-only scripts/journal-guards.ts drop   .env
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const CMD = process.argv[2];
const ENV = process.argv[3] || ".env";
if (!CMD || !["audit", "apply", "test", "drop"].includes(CMD)) {
  console.error("usage: journal-guards.ts <audit|apply|test|drop> <envfile>");
  process.exit(2);
}
const url = fs.readFileSync(ENV, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1];
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) } as any);
const q = <T = any>(sql: string, ...args: any[]) => prisma.$queryRawUnsafe(sql, ...args) as Promise<T[]>;
const x = (sql: string) => prisma.$executeRawUnsafe(sql);

// The dup guard's scope: active, native, document-posting journals only.
const NATIVE_ACTIVE = `
      je."sourceDocumentId" IS NOT NULL
  AND je.status <> 'VOID'
  AND je."createdBy" IS DISTINCT FROM 'xero-import'
  AND je."sourcePaymentId" IS NULL
  AND je.type NOT IN ('PAYMENT','ADJUSTMENT')`;

async function accountingSchemas(): Promise<Array<{ schema: string; hasDoc: boolean }>> {
  const rows = await q<{ s: string; je: string | null; doc: string | null }>(`
    select n.nspname::text as s,
           to_regclass(format('%I.%I', n.nspname, 'JournalEntry'))::text as je,
           to_regclass(format('%I.%I', n.nspname, 'Document'))::text as doc
    from pg_namespace n
    where n.nspname = 'public' or n.nspname like 'org\\_%' escape '\\'
    order by 1`);
  const targets = rows.filter((r) => r.je).map((r) => ({ schema: r.s, hasDoc: !!r.doc }));
  if (targets.length === 0) throw new Error("no schema with a JournalEntry table found");
  return targets;
}

function jeGuardSql(s: string, hasDoc: boolean) {
  const existence = hasDoc
    ? `IF NOT EXISTS (SELECT 1 FROM "${s}"."Document" d WHERE d.id::text = NEW."sourceDocumentId") THEN
        RAISE EXCEPTION 'AIMS guard: journal % (%) references document % which does not exist in this org',
          COALESCE(NEW."journalNumber",'?'), NEW.type, NEW."sourceDocumentId";
      END IF;`
    : `RAISE EXCEPTION 'AIMS guard: this org has no Document table — journal % (%) must not carry sourceDocumentId %',
          COALESCE(NEW."journalNumber",'?'), NEW.type, NEW."sourceDocumentId";`;
  return [
    `CREATE OR REPLACE FUNCTION "${s}".aims_je_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."sourceDocumentId" IS NULL OR NEW.status = 'VOID' THEN
    RETURN NEW;
  END IF;
  ${existence}
  IF NEW."createdBy" IS DISTINCT FROM 'xero-import'
     AND NEW."sourcePaymentId" IS NULL
     AND NEW.type NOT IN ('PAYMENT','ADJUSTMENT') THEN
    IF EXISTS (
      SELECT 1 FROM "${s}"."JournalEntry" je
      WHERE je."organizationId" = NEW."organizationId"
        AND je."sourceDocumentId" = NEW."sourceDocumentId"
        AND je.type = NEW.type
        AND je.id <> NEW.id
        AND ${NATIVE_ACTIVE}
    ) THEN
      RAISE EXCEPTION 'AIMS guard: document % already has an active % journal — void it before posting another',
        NEW."sourceDocumentId", NEW.type;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;`,
    `DROP TRIGGER IF EXISTS aims_je_guard ON "${s}"."JournalEntry";`,
    `CREATE TRIGGER aims_je_guard
       BEFORE INSERT OR UPDATE OF "sourceDocumentId", type, status, "organizationId", "sourcePaymentId", "createdBy"
       ON "${s}"."JournalEntry" FOR EACH ROW EXECUTE FUNCTION "${s}".aims_je_guard();`,
  ];
}

function docGuardSql(s: string) {
  return [
    `CREATE OR REPLACE FUNCTION "${s}".aims_doc_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE j record;
BEGIN
  SELECT "journalNumber", type INTO j FROM "${s}"."JournalEntry"
   WHERE "sourceDocumentId" = OLD.id::text AND status <> 'VOID' LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'AIMS guard: document % still has active journal % (%) — void it before deleting the document',
      OLD.id, COALESCE(j."journalNumber",'?'), j.type;
  END IF;
  RETURN OLD;
END $fn$;`,
    `DROP TRIGGER IF EXISTS aims_doc_delete_guard ON "${s}"."Document";`,
    `CREATE TRIGGER aims_doc_delete_guard
       BEFORE DELETE ON "${s}"."Document" FOR EACH ROW EXECUTE FUNCTION "${s}".aims_doc_delete_guard();`,
  ];
}

async function audit() {
  for (const { schema: s, hasDoc } of await accountingSchemas()) {
    const [tot] = await q<{ n: number; src: number }>(
      `select count(*)::int n, count("sourceDocumentId")::int src from "${s}"."JournalEntry" je`);
    const dups = await q(
      `select je."organizationId" org, je."sourceDocumentId" doc, je.type, count(*)::int n
         from "${s}"."JournalEntry" je where ${NATIVE_ACTIVE}
        group by 1,2,3 having count(*) > 1 order by n desc limit 10`);
    let orphans: any[] = [];
    if (hasDoc) {
      orphans = await q(
        `select je.id, je."journalNumber", je.type, je."sourceDocumentId"
           from "${s}"."JournalEntry" je
          where je."sourceDocumentId" is not null and je.status <> 'VOID'
            and not exists (select 1 from "${s}"."Document" d where d.id::text = je."sourceDocumentId")
          limit 10`);
    } else {
      orphans = await q(
        `select je.id, je."journalNumber", je.type, je."sourceDocumentId"
           from "${s}"."JournalEntry" je
          where je."sourceDocumentId" is not null and je.status <> 'VOID' limit 10`);
    }
    const trig = await q(
      `select tgname::text as tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1 and tgname like 'aims_%' and not tgisinternal`, s);
    console.log(
      `${s.padEnd(16)} journals=${tot.n} withSourceDoc=${tot.src} hasDocTable=${hasDoc} ` +
      `dupGroups=${dups.length} orphans=${orphans.length} triggers=[${trig.map((t: any) => t.tgname).join(",") || "none"}]`);
    for (const d of dups) console.log(`   DUP  ${JSON.stringify(d)}`);
    for (const o of orphans) console.log(`   ORPH ${JSON.stringify(o)}`);
  }
}

async function apply() {
  for (const { schema: s, hasDoc } of await accountingSchemas()) {
    for (const sql of jeGuardSql(s, hasDoc)) await x(sql);
    if (hasDoc) for (const sql of docGuardSql(s)) await x(sql);
    console.log(`✓ ${s}: aims_je_guard${hasDoc ? " + aims_doc_delete_guard" : " (no Document table — sourceDocumentId fully rejected)"}`);
  }
}

async function drop() {
  for (const { schema: s, hasDoc } of await accountingSchemas()) {
    await x(`DROP TRIGGER IF EXISTS aims_je_guard ON "${s}"."JournalEntry";`);
    await x(`DROP FUNCTION IF EXISTS "${s}".aims_je_guard();`);
    if (hasDoc) {
      await x(`DROP TRIGGER IF EXISTS aims_doc_delete_guard ON "${s}"."Document";`);
      await x(`DROP FUNCTION IF EXISTS "${s}".aims_doc_delete_guard();`);
    }
    console.log(`✓ ${s}: guards dropped`);
  }
}

// Prove each guard fires. Every probe is a statement that SHOULD raise; a
// raised exception aborts its own implicit transaction, so nothing persists.
async function test() {
  if (!/localhost|dev/.test(ENV) && ENV !== ".env") {
    console.error("test runs against dev (.env) only");
    process.exit(2);
  }
  let failures = 0;
  const expectGuard = async (label: string, sql: string) => {
    try {
      await x(sql);
      console.error(`✗ ${label}: statement SUCCEEDED — guard did not fire`);
      failures++;
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("AIMS guard")) console.log(`✓ ${label}: blocked (${msg.match(/AIMS guard[^"\\\n]*/)?.[0].slice(0, 110)})`);
      else { console.error(`✗ ${label}: failed for the WRONG reason: ${msg.slice(0, 200)}`); failures++; }
    }
  };
  for (const { schema: s, hasDoc } of await accountingSchemas()) {
    const [seed] = await q<{ id: string }>(
      `select je.id from "${s}"."JournalEntry" je where ${NATIVE_ACTIVE} limit 1`);
    if (seed) {
      await expectGuard(`${s} duplicate-journal insert`,
        `insert into "${s}"."JournalEntry"
           select (jsonb_populate_record(je, jsonb_build_object(
                     'id', gen_random_uuid()::text,
                     'journalNumber', je."journalNumber" || '-DUPTEST'))).*
             from "${s}"."JournalEntry" je where je.id = '${seed.id.replace(/'/g, "")}'`);
      if (hasDoc) {
        await expectGuard(`${s} orphan sourceDocumentId update`,
          `update "${s}"."JournalEntry" set "sourceDocumentId" = gen_random_uuid()::text
            where id = '${seed.id.replace(/'/g, "")}'`);
        await expectGuard(`${s} delete document with active journal`,
          `delete from "${s}"."Document" d
            where d.id::text = (select je."sourceDocumentId" from "${s}"."JournalEntry" je
                                 where je.id = '${seed.id.replace(/'/g, "")}')`);
      }
    } else {
      console.log(`- ${s}: no active native doc journal to probe with — skipped`);
    }
  }
  process.exit(failures ? 1 : 0);
}

(async () => {
  if (CMD === "audit") await audit();
  if (CMD === "apply") await apply();
  if (CMD === "test") await test();
  if (CMD === "drop") await drop();
  await prisma.$disconnect();
})().catch((e) => { console.error("FATAL", e?.message || e); process.exit(2); });
