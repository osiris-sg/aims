// Unblock the 10 Sept invoices the push rejected.
//  A) account codes from house precedent: FIREFLY/AIS→227, Micro-Grid→214,
//     SIDS sale→220, transport→206 ("Sales - Transport charges"; NOT 202 which
//     is Transportation of Hardcore).
//  B) invoices pointing at a DUPLICATE customer row that has no xeroId →
//     repoint to the sibling row that carries the Xero contact id.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const APPLY = process.argv.includes("--apply");
const codeFor = (desc: string): string | null => {
  const d = desc.replace(/<[^>]+>/g, " ");
  if (/transport/i.test(d)) return "206";
  if (/firefly|advanced illumination/i.test(d)) return "227";
  if (/micro-?grid|lion\d/i.test(d)) return "214";
  if (/sale of one set sids|sids system/i.test(d)) return "220";
  return null;
};
(async () => {
  // ── A) account codes
  for (const n of ["BI202609066", "BI202609084", "BI202609086", "BI202609087", "BI202609089", "BI202609093"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: n } });
    const c: any = d!.config;
    let touched = 0;
    const items = (c.items || []).map((it: any) => {
      const amt = Number(it.amount) || 0, up = Number(it.unitPrice) || 0;
      if ((amt === 0 && up === 0) || it.accountCode) return it;
      const code = codeFor(String(it.description || ""));
      if (!code) return it;
      touched++;
      return { ...it, accountCode: code };
    });
    if (touched) {
      console.log(`${APPLY ? "FIX " : "would "}${n}: ${touched} line(s) coded`);
      if (APPLY) await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, items } } });
    }
  }
  // ── B) duplicate customer rows
  for (const n of ["BI202609033", "BI202609083", "BI202609089"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: n } });
    const c: any = d!.config;
    const mine = await prisma.customer.findUnique({ where: { id: c.customerId }, select: { id: true, name: true } });
    const twin = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { startsWith: (mine!.name || "").slice(0, 18) }, xeroId: { not: null }, NOT: { id: mine!.id } }, select: { id: true, name: true, xeroId: true } });
    if (!twin) { console.log(`  ✗ ${n}: no twin with a Xero id for "${mine!.name}"`); continue; }
    console.log(`${APPLY ? "FIX " : "would "}${n}: repoint "${mine!.name.slice(0, 30)}" → row with Xero id (${twin.xeroId!.slice(0, 8)})`);
    if (APPLY) await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, customerId: twin.id, customerName: twin.name } } });
  }
  console.log(APPLY ? "\napplied" : "\n[dry] re-run with --apply");
  process.exit(0);
})();
