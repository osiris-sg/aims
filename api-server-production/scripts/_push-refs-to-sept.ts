// Copy the accountant's adjusted template references onto the generated Sept
// drafts. The draft keeps ITS OWN number prefix (slots shifted after the
// Lian Beng delete); tokens resolve for the September run.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const p2 = (n: number) => String(n).padStart(2, "0");
const ord = (n: number) => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? "th" : ["th","st","nd","rd"][n % 10] || "th"}`; };
function resolve(str: string, runNo: number): string {
  const y = 2026, m = 8; // September (0-based)
  const map: Record<string, string> = {
    MONTH: MONTHS[m], "MONTH YEAR": `${MONTHS[m]} ${y}`, PERIOD: `Sep ${y}`, YEAR: String(y),
    "MONTH NO": p2(m + 1), "PREV MONTH NO": p2(m), "MONTH START": `01/09/${y}`, "MONTH END": `30/09/${y}`,
    "PREV MONTH START": `01/08/${y}`, "PREV MONTH END": `31/08/${y}`, "PREV MONTH": MONTHS[m - 1],
    NTH: ord(runNo), "RUN NO": String(runNo),
  };
  return (str || "").replace(/\{([A-Z ]+)\}/g, (w, t) => (t in map ? map[t] : w));
}
const APPLY = process.argv.includes("--apply");
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, orderBy: { code: "asc" } });
  let changed = 0, same = 0, skipped = 0;
  for (const t of tpls) {
    if (!t.lastRunDocumentId) continue;
    const doc = await prisma.document.findFirst({ where: { id: t.lastRunDocumentId, organizationId: ORG, type: "INVOICE" } });
    if (!doc || !doc.name?.startsWith("BI202609")) continue;
    const dc: any = doc.config || {};
    const xs = String(dc.xeroStatus || "").toUpperCase();
    const sent = !["draft", "unconfirmed"].includes(String(doc.status)) || ["AUTHORISED", "PAID"].includes(xs) || Boolean(dc.sentAt);
    const tplRef = String((t.config as any)?.reference || "").trim();
    if (!tplRef) continue;
    const body = tplRef.replace(/^BI\{YEAR\}\{MONTH NO\}\d{3}\s*/, "").replace(/^BI\d{9}\s*/, "").trim();
    // {NTH}: trust the DRAFT's existing ordinal when it has one — her template
    // edits sometimes reset nextRunNo, and the draft was minted with the
    // correct planner value (e.g. REC-051 draft says 4th mth, template counter
    // says 2). Fall back to nextRunNo−1 only when the draft has no ordinal.
    const curOrd = /(\d{1,3})(?:st|nd|rd|th)\s*mth/i.exec(String(dc.reference || ""));
    const runNo = curOrd ? parseInt(curOrd[1], 10) : (t.nextRunNo ?? 2) - 1;
    const newRef = `${doc.name} ${resolve(body, runNo)}`.trim();
    const curRef = String(dc.reference || "").trim();
    if (newRef === curRef) { same++; continue; }
    if (sent) console.log(`(confirmed/synced — updating anyway per guru) ${doc.name} status=${doc.status} xero=${xs || "-"} xeroId=${dc.xeroInvoiceId ? "yes" : "no"}`);
    changed++;
    console.log(`${t.code} → ${doc.name}`);
    console.log(`   old: ${curRef.slice(0, 95)}`);
    console.log(`   new: ${newRef.slice(0, 95)}`);
    if (APPLY) {
      await prisma.document.update({ where: { id: doc.id }, data: { config: { ...dc, reference: newRef, documentInfo: { ...(dc.documentInfo || {}), referenceNo: newRef } } } });
    }
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"}: ${changed} changed · ${same} already match · ${skipped} skipped (sent)`);
  process.exit(0);
})();
