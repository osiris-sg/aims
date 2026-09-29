/**
 * Nightly accounting invariants — every org, every environment, both layouts.
 *
 * Promotes the ad-hoc checks from the 2026-09-28 incident review
 * (_recheck-native / _stale-je-sweep2 / _gl-snapshot) into one standing sweep.
 * Run nightly (wired into nightly-biofuel-xero-sync.ts) and before releases.
 *
 * FAIL (exit 1) — these were the actual incidents, they must never recur:
 *   1. duplicate active native document journals (same org+doc+type)
 *   2. orphan sourceDocumentId (journal points at a document that is gone)
 *   3. journal internal imbalance (Σ line debits ≠ Σ line credits)
 *   4. GL out of balance (Σ debits ≠ Σ credits across active journals)
 *   5. stale document tie: an active native SGD document journal whose total
 *      no longer matches its document's gross (totalWithTax fallback chain)
 *
 * WARN (reported, not fatal — legitimate timing/layer differences exist):
 *   6. AR control (debtorControl) vs Σ outstandingBalance over open invoices
 *   7. AP control (creditorControl) vs Σ outstanding over open bills
 *
 * Layout aware: old single `public` schema (staging/prod) or per-org schemas
 * (dev since 2026-09-28). DATABASE_URL from the environment (Render cron) or
 * an envfile argument.
 *
 * Usage: npx ts-node --transpile-only scripts/verify-accounting-invariants.ts [.env|.env.staging|.env.production]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const ENV = process.argv[2];
const url = ENV
  ? fs.readFileSync(ENV, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1]
  : process.env.DATABASE_URL;
if (!url) { console.error("no DATABASE_URL (pass an envfile or set the env var)"); process.exit(2); }
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) } as any);
const q = <T = any>(sql: string, ...args: any[]) => prisma.$queryRawUnsafe(sql, ...args) as Promise<T[]>;

const NATIVE_ACTIVE = `
      je."sourceDocumentId" IS NOT NULL
  AND je.status <> 'VOID'
  AND je."createdBy" IS DISTINCT FROM 'xero-import'
  AND je."sourcePaymentId" IS NULL
  AND je.type NOT IN ('PAYMENT','ADJUSTMENT')`;

// config gross: canonical → legacy (matches the 2026-09-28 money-key canonicalisation)
const DOC_GROSS = `coalesce(
  nullif(d.config->>'totalWithTax','')::numeric,
  nullif(d.config->>'xeroGross','')::numeric,
  nullif(d.config->>'nettTotal','')::numeric,
  nullif(d.config->'documentInfo'->>'nettTotal','')::numeric)`;
const DOC_OUTSTANDING = `coalesce(
  nullif(d.config->>'outstandingBalance','')::numeric,
  nullif(d.config->>'xeroBalance','')::numeric,
  ${DOC_GROSS})`;

let fails = 0;
let warns = 0;
const FAIL = (s: string, msg: string, rows: any[] = []) => {
  fails++;
  console.error(`✗ FAIL [${s}] ${msg}`);
  for (const r of rows.slice(0, 5)) console.error(`     ${JSON.stringify(r)}`);
};
const WARN = (s: string, msg: string) => { warns++; console.warn(`~ warn [${s}] ${msg}`); };

async function schemas(): Promise<Array<{ schema: string; hasDoc: boolean }>> {
  const rows = await q<{ s: string; je: string | null; doc: string | null }>(`
    select n.nspname::text as s,
           to_regclass(format('%I.%I', n.nspname, 'JournalEntry'))::text as je,
           to_regclass(format('%I.%I', n.nspname, 'Document'))::text as doc
    from pg_namespace n
    where n.nspname = 'public' or n.nspname like 'org\\_%' escape '\\'
    order by 1`);
  return rows.filter((r) => r.je).map((r) => ({ schema: r.s, hasDoc: !!r.doc }));
}

async function checkSchema(s: string, hasDoc: boolean) {
  // 1. duplicate active native document journals
  const dups = await q(
    `select je."organizationId" org, je."sourceDocumentId" doc, je.type, count(*)::int n,
            array_agg(je."journalNumber") journals
       from "${s}"."JournalEntry" je where ${NATIVE_ACTIVE}
      group by 1,2,3 having count(*) > 1`);
  if (dups.length) FAIL(s, `${dups.length} document(s) double-posted`, dups);

  // 2. orphan sourceDocumentId
  const orphans = hasDoc
    ? await q(
        `select je."journalNumber", je.type, je."sourceDocumentId"
           from "${s}"."JournalEntry" je
          where je."sourceDocumentId" is not null and je.status <> 'VOID'
            and not exists (select 1 from "${s}"."Document" d where d.id::text = je."sourceDocumentId")`)
    : await q(
        `select je."journalNumber", je.type, je."sourceDocumentId"
           from "${s}"."JournalEntry" je
          where je."sourceDocumentId" is not null and je.status <> 'VOID'`);
  if (orphans.length) FAIL(s, `${orphans.length} journal(s) reference missing documents`, orphans);

  // 3. journal internal imbalance (per journal, from its lines)
  const unbalanced = await q(
    `select je."journalNumber", je.type, round((sum(l.debit) - sum(l.credit))::numeric, 2) diff
       from "${s}"."JournalEntry" je join "${s}"."JournalEntryLine" l on l."journalEntryId" = je.id
      where je.status <> 'VOID'
      group by je.id, je."journalNumber", je.type
     having abs(sum(l.debit) - sum(l.credit)) > 0.005`);
  if (unbalanced.length) FAIL(s, `${unbalanced.length} journal(s) internally unbalanced (Dr ≠ Cr)`, unbalanced);

  // 4. whole-GL balance
  const [gl] = await q<{ dr: number; cr: number }>(
    `select coalesce(sum(l.debit),0)::float dr, coalesce(sum(l.credit),0)::float cr
       from "${s}"."JournalEntryLine" l join "${s}"."JournalEntry" je on je.id = l."journalEntryId"
      where je.status <> 'VOID'`);
  if (Math.abs(gl.dr - gl.cr) > 0.01) FAIL(s, `GL out of balance: Dr ${gl.dr.toFixed(2)} vs Cr ${gl.cr.toFixed(2)}`);

  if (!hasDoc) return;

  // 5. stale document tie (SGD docs only — foreign docs post in base at a rate)
  const stale = await q(
    `select je."journalNumber", je.type, je."totalDebit"::float je_total, ${DOC_GROSS}::float doc_gross, d.name
       from "${s}"."JournalEntry" je
       join "${s}"."Document" d on d.id::text = je."sourceDocumentId"
      where ${NATIVE_ACTIVE}
        and coalesce(nullif(d.config->>'currency',''), 'SGD') = 'SGD'
        and ${DOC_GROSS} is not null
        and abs(je."totalDebit" - ${DOC_GROSS}) > 0.02`);
  if (stale.length) FAIL(s, `${stale.length} journal(s) disagree with their document's gross`, stale);

  // 6/7. control-account tie-outs per org (WARN — layers/timing make exact ties env-specific)
  const orgs = await q<{ org: string; controls: any }>(
    `select a."organizationId" org, a."controlAccounts" controls from "${s}"."AccountingSetting" a`);
  for (const { org, controls } of orgs) {
    const c = (controls as Record<string, string>) || {};
    for (const [side, code, docFilter] of [
      ["AR", c.debtorControl, `d.type in ('INVOICE') and lower(coalesce(d.config->>'status','')) in ('confirmed','pending_payment','partially_paid','overdue')`],
      ["AP", c.creditorControl, `d.type in ('BILL') and (d.config->>'billStatus' = 'POSTED' or d.config->>'xeroStatus' = 'AUTHORISED')`],
    ] as const) {
      if (!code) continue;
      try {
        const [bal] = await q<{ v: number | null }>(
          `select round((sum(l.debit) - sum(l.credit))::numeric, 2)::float v
             from "${s}"."JournalEntryLine" l
             join "${s}"."JournalEntry" je on je.id = l."journalEntryId"
             join "${s}"."ChartOfAccount" ca on ca.id = l."accountId"
            where je.status <> 'VOID' and coalesce(je."isUnconfirmed", false) = false
              and je."organizationId" = $1 and ca.code = $2`, org, code);
        const [docs] = await q<{ v: number | null }>(
          `select round(sum(${DOC_OUTSTANDING})::numeric, 2)::float v from "${s}"."Document" d
            where d."organizationId" = $1 and ${docFilter}`, org);
        const glV = bal?.v ?? 0;
        const docV = (docs?.v ?? 0) * (side === "AP" ? -1 : 1); // AP control is a credit balance
        if (Math.abs(glV - docV) > 0.01)
          WARN(s, `${side} control ${code} (org ${org.slice(0, 8)}…): GL ${glV.toFixed(2)} vs open-doc outstanding ${docV.toFixed(2)} (Δ ${(glV - docV).toFixed(2)})`);
      } catch (e: any) {
        WARN(s, `${side} tie-out skipped: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
  }
}

(async () => {
  const targets = await schemas();
  if (targets.length === 0) { console.error("no accounting schemas found"); process.exit(2); }
  for (const t of targets) {
    await checkSchema(t.schema, t.hasDoc);
    console.log(`checked ${t.schema}`);
  }
  console.log(fails ? `\n✗ INVARIANTS BROKEN: ${fails} failure(s), ${warns} warning(s)` : `\n✓ accounting invariants hold (${warns} warning(s))`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FATAL", e?.message || e); process.exit(2); });
