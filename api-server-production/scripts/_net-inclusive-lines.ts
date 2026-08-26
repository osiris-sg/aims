// BILL lines with input-tax types where Σ(line.amount) == doc GROSS (i.e. the
// amounts are tax-INCLUSIVE) → store net (amount − taxAmount) so the GST
// report's line-level path reads true net. Doc totals untouched.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const INPUTS = new Set(["TAX002", "INPUTY24", "INPUTY23", "INPUT"]);
const DRY = process.argv.includes("--dry");
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: { in: ["BILL", "CREDIT_NOTE"] } }, select: { id: true, name: true, type: true, config: true } });
  let fixed = 0, lines = 0;
  for (const d of docs) {
    const c: any = d.config;
    if (c.voided) continue;
    if (d.type === "CREDIT_NOTE" && (c.subtype || "").toUpperCase() !== "AP") continue;
    const items: any[] = c.items || [];
    const typed = items.filter(it => it?.taxType && INPUTS.has(String(it.taxType)) && Number(it.taxAmount) > 0);
    if (!typed.length) continue;
    const sumAmt = R(items.reduce((s, it) => s + (Number(it.amount) || 0), 0));
    const gross = R(Number(c.xeroGross ?? c.totalAmount ?? c.nettTotal ?? 0) || 0);
    if (!gross || Math.abs(sumAmt - gross) > 0.01) continue; // already net (exclusive)
    const newItems = items.map(it => (it?.taxType && INPUTS.has(String(it.taxType)) && Number(it.taxAmount) > 0)
      ? { ...it, amount: R((Number(it.amount) || 0) - Number(it.taxAmount)) } : it);
    lines += typed.length; fixed++;
    if (!DRY) await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items: newItems, amountsAre: "EXCLUSIVE" } } });
    if (fixed <= 5) console.log(`  ${d.name}: ${typed.length} line(s) netted`);
  }
  console.log(`${DRY ? "[DRY] " : ""}netted ${lines} inclusive lines on ${fixed} docs`);
  process.exit(0);
})();
