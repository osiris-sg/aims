/**
 * Import Biofuel General Ledger (Xero export) → AIMS JournalEntry / JournalEntryLine.
 *
 * Source: /Users/guru/Downloads/Biofuel_Industries_Pte_Ltd_-_General_Ledger_Detail.xlsx
 *
 * Each row is one GL posting line. Rows sharing the same Xero `Journal ID`
 * form one balanced JE. We group by Journal ID, validate balance, and upsert
 * one POSTED JournalEntry per Xero journal — keyed by journalNumber
 * `JV-XERO-<id>` for idempotency. The 30 Jun 2021 Conversion Balance Journal
 * becomes a single OPENING_BALANCE JE keyed `JV-XERO-OB`.
 *
 * Pre-flight: ensures the two extra CoA codes Biofuel uses in their GL but
 * weren't on the static CoA CSV exist — 499 (Realised Currency Gains) and
 * 999 (Contra Clearing AP/AR, for rows Xero exported with empty codes).
 *
 * Idempotent: re-runs upsert the same JE keyed on (organizationId, journalNumber).
 */

import { PrismaClient } from "@prisma/client";
import * as xlsx from "xlsx";
import * as path from "path";

const ORG_ID = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const XLSX_PATH = "/Users/guru/Downloads/Biofuel_Industries_Pte_Ltd_-_General_Ledger_Detail.xlsx";

const CONTRA_CODE = "999";
const EXCHANGE_CODE = "499";

const prisma = new PrismaClient();

type RawRow = {
  date: string;
  code: string;
  type: string;
  source: string;
  description: string;
  invoiceNumber: string;
  reference: string;
  journalId: string;
  debit: number;
  credit: number;
};

function parseNum(s: any): number {
  if (s === null || s === undefined) return 0;
  const cleaned = String(s).replace(/,/g, "").trim();
  if (!cleaned) return 0;
  return parseFloat(cleaned) || 0;
}

function parseDate(s: string): Date {
  // "04 Oct 2021"
  const [d, mon, y] = s.split(/\s+/);
  return new Date(`${mon} ${d} ${y} UTC`);
}

function sourceToType(source: string): string {
  const s = source.toLowerCase();
  if (s.includes("conversion balance")) return "OPENING_BALANCE";
  if (s.includes("manual")) return "MANUAL";
  if (s.includes("credit note")) return "CREDIT_NOTE";
  if (s.includes("invoice")) return "INVOICE";
  if (s.includes("payment") || s.includes("spend money") || s.includes("receive money") || s.includes("bank transfer")) return "PAYMENT";
  return "MANUAL";
}

async function ensureMissingCoaCodes() {
  const seeds = [
    {
      code: EXCHANGE_CODE,
      name: "Realised Currency Gains",
      accountType: "EXCHANGE_GAIN_LOSS",
      category: "PNL",
      normalBalance: "DEBIT",
    },
    {
      code: CONTRA_CODE,
      name: "Contra Clearing (AP/AR)",
      accountType: "CURRENT_ASSET",
      category: "BALANCE_SHEET",
      normalBalance: "DEBIT",
    },
  ] as const;

  for (const s of seeds) {
    await prisma.chartOfAccount.upsert({
      where: { organizationId_code: { organizationId: ORG_ID, code: s.code } },
      create: {
        organizationId: ORG_ID,
        code: s.code,
        name: s.name,
        accountType: s.accountType,
        category: s.category,
        normalBalance: s.normalBalance,
        isActive: true,
        isControlAccount: false,
        isSystem: false,
      },
      update: {},
    });
  }
}

async function main() {
  console.log(`[GL Import] org=${ORG_ID}`);
  console.log(`[GL Import] file=${path.basename(XLSX_PATH)}`);

  await ensureMissingCoaCodes();
  console.log(`[GL Import] ✓ ensured codes ${EXCHANGE_CODE} + ${CONTRA_CODE} exist in CoA`);

  const coa = await prisma.chartOfAccount.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, code: true },
  });
  const codeToId = new Map(coa.map((a) => [a.code, a.id]));
  console.log(`[GL Import] ✓ loaded ${coa.length} CoA codes`);

  const wb = xlsx.readFile(XLSX_PATH);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

  const dataRows: RawRow[] = raw
    .filter((r) => r[0] && /^\d{1,2}\s\w{3}\s\d{4}$/.test(String(r[0])))
    .map((r) => ({
      date: String(r[0]),
      code: String(r[1] || "").trim() || CONTRA_CODE, // empty code → Contra Clearing
      type: String(r[2] || ""),
      source: String(r[3] || ""),
      description: String(r[4] || ""),
      invoiceNumber: String(r[5] || ""),
      reference: String(r[6] || ""),
      journalId: String(r[7] || "").replace(/,/g, ""),
      debit: parseNum(r[8]),
      credit: parseNum(r[9]),
    }));
  console.log(`[GL Import] ✓ parsed ${dataRows.length} data rows`);

  // Group by Xero Journal ID
  type Bucket = { lines: RawRow[]; date: string; isOB: boolean };
  const buckets = new Map<string, Bucket>();
  for (const row of dataRows) {
    const key = row.source === "Conversion Balance Journal" ? "OB" : row.journalId;
    if (!buckets.has(key)) {
      buckets.set(key, { lines: [], date: row.date, isOB: key === "OB" });
    }
    buckets.get(key)!.lines.push(row);
  }
  console.log(`[GL Import] ✓ grouped into ${buckets.size} journals (1 opening + ${buckets.size - 1} regular)`);

  // Validate every bucket balances
  const unbalanced: { key: string; dr: number; cr: number }[] = [];
  buckets.forEach((b, key) => {
    const dr = b.lines.reduce((s, l) => s + l.debit, 0);
    const cr = b.lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(dr - cr) > 0.02) unbalanced.push({ key, dr, cr });
  });
  if (unbalanced.length) {
    console.error(`[GL Import] ✗ ${unbalanced.length} unbalanced journals found:`);
    unbalanced.slice(0, 5).forEach((u) => console.error("  ", u));
    process.exit(1);
  }

  // Verify all codes resolve
  const missingCodes = new Set<string>();
  buckets.forEach((b) => b.lines.forEach((l) => { if (!codeToId.has(l.code)) missingCodes.add(l.code); }));
  if (missingCodes.size) {
    console.error(`[GL Import] ✗ unmapped codes: ${[...missingCodes].join(", ")}`);
    process.exit(1);
  }

  let created = 0;
  let updated = 0;
  let failed = 0;
  let i = 0;
  const total = buckets.size;
  const startedAt = Date.now();

  for (const [key, bucket] of buckets.entries()) {
    i++;
    const journalNumber = key === "OB" ? "JV-XERO-OB" : `JV-XERO-${key}`;
    const firstLine = bucket.lines[0];
    const entryDate = parseDate(bucket.date);
    const type = bucket.isOB ? "OPENING_BALANCE" : sourceToType(firstLine.source);

    // Reference + description: prefer invoice number / reference, fall back to source
    const refSet = new Set<string>();
    bucket.lines.forEach((l) => {
      if (l.invoiceNumber) refSet.add(l.invoiceNumber);
      if (l.reference && l.reference !== l.invoiceNumber) refSet.add(l.reference);
    });
    const reference = [...refSet].slice(0, 3).join(" / ") || null;

    const descSet = new Set<string>();
    bucket.lines.forEach((l) => { if (l.description) descSet.add(l.description); });
    const description = bucket.isOB
      ? "Opening balances from Xero (30 Jun 2021)"
      : [...descSet].slice(0, 2).join(" | ").slice(0, 500) || `Xero ${firstLine.source}`;

    const totalDebit = bucket.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = bucket.lines.reduce((s, l) => s + l.credit, 0);

    const linesData = bucket.lines.map((l, idx) => ({
      accountId: codeToId.get(l.code)!,
      lineNumber: idx + 1,
      description: l.description.slice(0, 500) || null,
      debit: l.debit,
      credit: l.credit,
    }));

    try {
      const existing = await prisma.journalEntry.findUnique({
        where: { organizationId_journalNumber: { organizationId: ORG_ID, journalNumber } },
        select: { id: true },
      });

      if (existing) {
        // Wipe lines and rewrite — idempotent re-import
        await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: existing.id } });
        await prisma.journalEntry.update({
          where: { id: existing.id },
          data: {
            entryDate,
            type,
            status: "POSTED",
            reference,
            description,
            totalDebit,
            totalCredit,
            postedAt: entryDate,
            postedBy: "xero-import",
            lines: { create: linesData },
          },
        });
        updated++;
      } else {
        await prisma.journalEntry.create({
          data: {
            organizationId: ORG_ID,
            journalNumber,
            entryDate,
            type,
            status: "POSTED",
            reference,
            description,
            totalDebit,
            totalCredit,
            currency: "SGD",
            postedAt: entryDate,
            postedBy: "xero-import",
            createdBy: "xero-import",
            lines: { create: linesData },
          },
        });
        created++;
      }
    } catch (e: any) {
      failed++;
      if (failed <= 5) console.error(`  [fail] ${journalNumber}: ${e?.message?.slice(0, 200)}`);
    }

    if (i % 250 === 0 || i === total) {
      const pct = ((i / total) * 100).toFixed(1);
      const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`  [${pct}%] ${i}/${total} | created=${created} updated=${updated} failed=${failed} | ${secs}s`);
    }
  }

  const totalLines = await prisma.journalEntryLine.count({
    where: { journalEntry: { organizationId: ORG_ID, postedBy: "xero-import" } },
  });

  console.log("\n[GL Import] ✓ done");
  console.log(`  Journals: created=${created}  updated=${updated}  failed=${failed}`);
  console.log(`  Total JE lines from Xero import: ${totalLines}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
