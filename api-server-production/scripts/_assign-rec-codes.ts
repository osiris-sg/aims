// Assign REC-NNN codes to the 80 recurring templates, ordered to match the
// September sheet (customer A→Z, then chain). Also map template → current
// Aug Xero invoice for the Excel link.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
import * as fs from "fs";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, customerId: true, lastRunDocumentId: true, code: true } });
  const custs = await prisma.customer.findMany({ where: { id: { in: [...new Set(tpls.map(t => t.customerId))] } }, select: { id: true, name: true } });
  const cn = new Map(custs.map(c => [c.id, c.name]));
  // template → aug xero invoice number (via lastRunDocumentId → doc → xeroInvoiceId → aug-state)
  const docs = await prisma.document.findMany({ where: { id: { in: tpls.map(t => t.lastRunDocumentId!).filter(Boolean) as string[] } }, select: { id: true, name: true, config: true } });
  const docById = new Map(docs.map(d => [d.id, d]));
  const augState = JSON.parse(fs.readFileSync("scripts/_aug-state.json", "utf8"));
  const augByXeroId = new Map(augState.map((a: any) => [a.xeroId, a.xeroNum]));
  const rows = tpls.map(t => {
    const doc = t.lastRunDocumentId ? docById.get(t.lastRunDocumentId) : null;
    const xeroNum = doc ? (augByXeroId.get((doc.config as any)?.xeroInvoiceId) || "") : "";
    return { ...t, custName: cn.get(t.customerId) || "?", aimsDoc: doc?.name || "", augXero: xeroNum };
  });
  rows.sort((a, b) => a.custName.toLowerCase().localeCompare(b.custName.toLowerCase()) || String(a.augXero).localeCompare(String(b.augXero)));
  const out: any[] = [];
  let n = 0;
  for (const r of rows) {
    n++;
    const code = `REC-${String(n).padStart(3, "0")}`;
    await prisma.recurringInvoiceTemplate.update({ where: { id: r.id }, data: { code } });
    out.push({ code, cust: r.custName, augXero: r.augXero, aimsDoc: r.aimsDoc, tplName: r.name });
  }
  fs.writeFileSync("scripts/_rec-codes.json", JSON.stringify(out, null, 1));
  console.log(`assigned ${n} codes (REC-001…REC-${String(n).padStart(3, "0")})`);
  for (const o of out.slice(0, 5)) console.log(` ${o.code} · ${o.cust.slice(0, 30)} · aug=${o.augXero || "—"}`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
