// Thorough AIMS sweep: EVERY invoice (any numbering) for the WhatsApp-audit
// customers, doc date or createdAt >= 1 Aug.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const TARGETS = ["prime builders", "integrate", "tanglin", "woh hup", "qji", "qingjian", "jiayi", "jia yi", "kim heng", "tenda", "shuan huat", "lian beng", "capital cranes", "scb building", "china construction", "cnqc"];
(async () => {
  const custs = await prisma.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true } });
  const wanted = new Map(custs.filter(c => TARGETS.some(t => c.name.toLowerCase().includes(t))).map(c => [c.id, c.name]));
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE" }, select: { name: true, status: true, createdAt: true, config: true } });
  let hits = 0;
  for (const d of docs) {
    const c: any = d.config || {};
    const cid = c.customerId;
    const cname = String(c.customerName || c.customer?.name || (cid ? wanted.get(cid) : "") || "");
    const isTarget = (cid && wanted.has(cid)) || TARGETS.some(t => cname.toLowerCase().includes(t));
    if (!isTarget) continue;
    const docDate = String(c.date || c.documentInfo?.date || "");
    const recent = docDate >= "2026-08-01" || d.createdAt >= new Date("2026-08-01");
    if (!recent) continue;
    // skip the already-known Sept series + Aug recurring series (reported)
    if (/^BI202609\d{3}$/.test(d.name!)) continue;
    if (/^BI202608\d{3}/.test(d.name!)) continue;
    hits++;
    console.log(`${d.name} [${d.status}] $${c.nettTotal ?? c.total ?? "?"} · ${cname.slice(0, 34)} · date=${docDate.slice(0, 10)} created=${d.createdAt.toISOString().slice(0, 10)} · ref=${String(c.reference || c.referenceNo || "").slice(0, 45)}`);
  }
  console.log(`\n${hits} non-series AIMS invoices since Aug for the audit customers (0 = nothing hidden)`);
  process.exit(0);
})();
