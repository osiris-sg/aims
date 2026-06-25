/**
 * Xero → AIMS migration · Stage 1 (XLSX/CSV path) · Contacts
 *
 * Imports contacts from Xero's "Contacts → Export" CSV. Unlike the API path,
 * the CSV lacks IsCustomer/IsSupplier flags so we infer role from:
 *   • The Payable Invoice Detail XLSX section headers (authoritative for
 *     anyone who has actually been invoiced as a supplier — 249 names)
 *   • AP-side fields: AccountsPayableTaxCodeName, DueDateBillDay/Term,
 *     DefaultTaxBills, POAddressLine* — supplier signal
 *   • AR-side fields: AccountsReceivableTaxCodeName, DueDateSalesDay/Term,
 *     DefaultTaxSales, SAAddressLine* — customer signal
 * Falls back to customer when neither side has signal (conservative — avoids
 * polluting Supplier with one-off contacts).
 *
 * Idempotent: matched by Customer.name / Supplier.name (case-insensitive)
 * within the org. Re-runs upsert fresh contact details.
 *
 * Run: npx ts-node scripts/xero-migration/01a-contacts-from-csv.ts
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as xlsx from "xlsx";

const prisma = new PrismaClient();
const BIOFUEL_ORG_ID = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";

const CONTACTS_CSV = "/Users/guru/Downloads/Contacts.csv";
const AP_XLSX = "/Users/guru/Downloads/Biofuel_Industries_Pte_Ltd_-_Payable_Invoice_Detail.xlsx";

// Minimal CSV parser that handles quoted fields containing commas + escaped
// double quotes. Xero's export uses standard RFC 4180 quoting.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuote = false;
      } else cell += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (cell !== "" || row.length) { row.push(cell); rows.push(row); row = []; cell = ""; }
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else cell += c;
    }
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function buildSupplierNameSetFromBills(): Set<string> {
  const wb = xlsx.readFile(AP_XLSX);
  const rows: any[][] = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
  const set = new Set<string>();
  for (const r of rows) {
    const c0 = String(r[0] || "").trim();
    if (!c0) continue;
    if (/^\d{1,2}\s\w{3}\s\d{4}$/.test(c0)) continue; // date row
    if (c0.startsWith("Total ") || c0.startsWith("Payable") || c0.startsWith("Biofuel") || c0.startsWith("For the") || c0 === "Invoice Date") continue;
    // Section header — supplier name
    set.add(c0.toLowerCase());
  }
  return set;
}

function joinAddress(parts: (string | undefined | null)[]): string | null {
  const cleaned = parts.map((s) => (s || "").trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(", ") : null;
}

async function main() {
  if (!fs.existsSync(CONTACTS_CSV)) throw new Error(`Missing ${CONTACTS_CSV}`);
  console.log(`[Contacts CSV] reading ${CONTACTS_CSV}`);
  const text = fs.readFileSync(CONTACTS_CSV, "utf8");
  const rows = parseCsv(text);
  const header = rows[0].map((h) => h.replace(/^\*/, ""));
  const body = rows.slice(1).filter((r) => r.some((c) => c && c.trim()));
  console.log(`[Contacts CSV] ${body.length} contact rows`);

  // Column index lookup
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Column ${name} not found in CSV header`);
    return i;
  };
  const COL = {
    name: idx("ContactName"),
    account: idx("AccountNumber"),
    email: idx("EmailAddress"),
    firstName: idx("FirstName"),
    lastName: idx("LastName"),
    poLine1: idx("POAddressLine1"),
    poLine2: idx("POAddressLine2"),
    poCity: idx("POCity"),
    poRegion: idx("PORegion"),
    poPostal: idx("POPostalCode"),
    poCountry: idx("POCountry"),
    saLine1: idx("SAAddressLine1"),
    saLine2: idx("SAAddressLine2"),
    saCity: idx("SACity"),
    saRegion: idx("SARegion"),
    saPostal: idx("SAPostalCode"),
    saCountry: idx("SACountry"),
    phone: idx("PhoneNumber"),
    mobile: idx("MobileNumber"),
    tax: idx("TaxNumber"),
    arTax: idx("AccountsReceivableTaxCodeName"),
    apTax: idx("AccountsPayableTaxCodeName"),
    legalName: idx("LegalName"),
    dueDateBillDay: idx("DueDateBillDay"),
    dueDateBillTerm: idx("DueDateBillTerm"),
    dueDateSalesDay: idx("DueDateSalesDay"),
    dueDateSalesTerm: idx("DueDateSalesTerm"),
    defaultTaxBills: idx("DefaultTaxBills"),
    defaultTaxSales: idx("DefaultTaxSales"),
  };

  console.log(`[Contacts CSV] scanning Bills XLSX for authoritative supplier names...`);
  const billSupplierNames = buildSupplierNameSetFromBills();
  console.log(`[Contacts CSV] ${billSupplierNames.size} supplier names found in Bills XLSX`);

  let custCreated = 0, custUpdated = 0, supCreated = 0, supUpdated = 0, skipped = 0;

  for (const r of body) {
    const name = (r[COL.name] || "").trim();
    if (!name) { skipped++; continue; }

    const email = (r[COL.email] || "").trim() || null;
    const phone = (r[COL.phone] || r[COL.mobile] || "").trim() || null;
    const gstRegNo = (r[COL.tax] || "").trim() || null;
    const poAddress = joinAddress([r[COL.poLine1], r[COL.poLine2], r[COL.poCity], r[COL.poRegion], r[COL.poPostal], r[COL.poCountry]]);
    const saAddress = joinAddress([r[COL.saLine1], r[COL.saLine2], r[COL.saCity], r[COL.saRegion], r[COL.saPostal], r[COL.saCountry]]);

    const apSignal =
      !!(r[COL.apTax] || "").trim() ||
      !!(r[COL.dueDateBillDay] || "").trim() ||
      !!(r[COL.dueDateBillTerm] || "").trim() ||
      !!(r[COL.defaultTaxBills] || "").trim() ||
      !!(r[COL.poLine1] || "").trim();
    const arSignal =
      !!(r[COL.arTax] || "").trim() ||
      !!(r[COL.dueDateSalesDay] || "").trim() ||
      !!(r[COL.dueDateSalesTerm] || "").trim() ||
      !!(r[COL.defaultTaxSales] || "").trim() ||
      !!(r[COL.saLine1] || "").trim();

    const isSupplier = apSignal || billSupplierNames.has(name.toLowerCase());
    // Customer default — fire when there's a customer signal OR when there's
    // no supplier signal at all (we don't want to drop the contact entirely).
    const isCustomer = arSignal || !isSupplier;

    if (isCustomer) {
      try {
        // Match existing by case-insensitive name within org.
        const existing = await prisma.customer.findFirst({
          where: { organizationId: BIOFUEL_ORG_ID, name: { equals: name, mode: "insensitive" } },
        });
        const payload = {
          organizationId: BIOFUEL_ORG_ID,
          name,
          email,
          phone,
          address: saAddress || poAddress,
          gstRegNo,
        };
        if (existing) {
          await prisma.customer.update({ where: { id: existing.id }, data: payload });
          custUpdated++;
        } else {
          await prisma.customer.create({ data: payload });
          custCreated++;
        }
      } catch (e: any) {
        // Email-collision fallback — adopt the row by email.
        if (e?.code === "P2002" && email) {
          try {
            const byEmail = await prisma.customer.findUnique({
              where: { email_organizationId: { email, organizationId: BIOFUEL_ORG_ID } },
            });
            if (byEmail) {
              await prisma.customer.update({
                where: { id: byEmail.id },
                data: { name, phone, address: saAddress || poAddress, gstRegNo },
              });
              custUpdated++;
              continue;
            }
          } catch { /* fall through */ }
        }
        console.warn(`  customer ${name}: ${e.message?.slice(0, 120)}`);
      }
    }

    if (isSupplier) {
      try {
        const existing = await prisma.supplier.findFirst({
          where: { organizationId: BIOFUEL_ORG_ID, name: { equals: name, mode: "insensitive" } },
        });
        const payload = {
          organizationId: BIOFUEL_ORG_ID,
          name,
          email,
          phone,
          address: poAddress || saAddress,
          gstRegNo,
        };
        if (existing) {
          await prisma.supplier.update({ where: { id: existing.id }, data: payload });
          supUpdated++;
        } else {
          await prisma.supplier.create({ data: payload });
          supCreated++;
        }
      } catch (e: any) {
        if (e?.code === "P2002" && email) {
          try {
            const byEmail = await prisma.supplier.findUnique({
              where: { email_organizationId: { email, organizationId: BIOFUEL_ORG_ID } },
            });
            if (byEmail) {
              await prisma.supplier.update({
                where: { id: byEmail.id },
                data: { name, phone, address: poAddress || saAddress, gstRegNo },
              });
              supUpdated++;
              continue;
            }
          } catch { /* fall through */ }
        }
        console.warn(`  supplier ${name}: ${e.message?.slice(0, 120)}`);
      }
    }
  }

  console.log("\n[Contacts CSV] ✓ done");
  console.log(`  Customers: created=${custCreated} updated=${custUpdated}`);
  console.log(`  Suppliers: created=${supCreated} updated=${supUpdated}`);
  console.log(`  Skipped (empty name): ${skipped}`);

  const cTotal = await prisma.customer.count({ where: { organizationId: BIOFUEL_ORG_ID } });
  const sTotal = await prisma.supplier.count({ where: { organizationId: BIOFUEL_ORG_ID } });
  console.log(`\n  Final counts: ${cTotal} customers, ${sTotal} suppliers`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
