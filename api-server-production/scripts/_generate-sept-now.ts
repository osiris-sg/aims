// Direct September generation (prod cron not firing — guru "generate all, now").
// Replicates generateOne: token resolution, reserved-number naming, totals,
// draft-first; advances each template's schedule + counter.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const p2 = (n: number) => String(n).padStart(2, "0");
const ord = (n: number) => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? "th" : ["th","st","nd","rd"][n % 10] || "th"}`; };
function resolveText(str: string, dIn: Date, runNo?: number): string {
  // Anchor to SGT regardless of process TZ: shift +8h, read UTC fields.
  const d = new Date(dIn.getTime() + 8 * 3600 * 1000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const nM = (m + 1) % 12, nY = m === 11 ? y + 1 : y, pM = (m + 11) % 12, pY = m === 0 ? y - 1 : y;
  const map: Record<string, string> = {
    MONTH: MONTHS[m], "MONTH SHORT": MONTHS[m].slice(0, 3), "MONTH YEAR": `${MONTHS[m]} ${y}`,
    PERIOD: `${MONTHS[m].slice(0, 3)} ${y}`, YEAR: String(y), DAY: p2(d.getUTCDate()),
    DATE: `${p2(d.getUTCDate())}/${p2(m + 1)}/${y}`, "NEXT MONTH": MONTHS[nM], "NEXT MONTH YEAR": `${MONTHS[nM]} ${nY}`,
    "PREV MONTH": MONTHS[pM], "PREV MONTH YEAR": `${MONTHS[pM]} ${pY}`,
    "MONTH NO": p2(m + 1), "PREV MONTH NO": p2(pM + 1),
    "MONTH START": `01/${p2(m + 1)}/${y}`, "MONTH END": `${p2(new Date(y, m + 1, 0).getDate())}/${p2(m + 1)}/${y}`,
    "PREV MONTH START": `01/${p2(pM + 1)}/${pY}`, "PREV MONTH END": `${p2(new Date(pY, pM + 1, 0).getDate())}/${p2(pM + 1)}/${pY}`,
    ...(runNo != null ? { NTH: ord(runNo), "RUN NO": String(runNo) } : {}),
  };
  return (str || "").replace(/\{([A-Z ]+)\}/g, (w, t) => (t in map ? map[t] : w));
}
function resolveDeep(v: any, d: Date, runNo?: number): any {
  if (v == null) return v;
  if (typeof v === "string") return resolveText(v, d, runNo);
  if (Array.isArray(v)) return v.map((x) => resolveDeep(x, d, runNo));
  if (typeof v === "object") { const o: any = {}; for (const [k, val] of Object.entries(v)) o[k] = resolveDeep(val, d, runNo); return o; }
  return v;
}
(async () => {
  const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { logo: true, defaultStamp: true } });
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG, isActive: true, nextRunDate: { lte: new Date() } }, orderBy: { code: "asc" } });
  console.log(`${tpls.length} due templates`);
  let ok = 0, fail = 0;
  for (const t of tpls) {
    try {
      const runDate = t.nextRunDate;
      const config: any = resolveDeep(t.config || {}, runDate, t.nextRunNo ?? 1);
      delete config.email;
      config.customerId = t.customerId;
      config.date = new Date(runDate.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const items: any[] = Array.isArray(config.items) ? config.items : [];
      const net = R(items.reduce((s, it) => s + (Number(it.amount) || 0), 0));
      const gst = R(items.reduce((s, it) => s + (Number(it.amount) || 0) * ((Number(it.tax) || 0) / 100), 0));
      config.subTotal = net; config.gstAmount = gst; config.nettTotal = R(net + gst);
      const reserved = typeof config.documentNumber === "string" && config.documentNumber.trim() ? config.documentNumber.trim() : null;
      config.documentInfo = { ...(config.documentInfo || {}), ...(reserved ? { documentNumber: reserved } : {}), date: config.date, currency: "SGD", gstPercent: 9, paymentTerms: config.paymentTerms || "30 DAYS" };
      if (!config.logo && org?.logo) config.logo = org.logo;
      if (!config.stamp?.company && org?.defaultStamp) config.stamp = { ...(config.stamp || {}), company: org.defaultStamp };
      const exists = reserved ? await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: reserved } }) : null;
      if (exists) { console.log(`= ${reserved} exists — skipping ${t.code}`); continue; }
      const doc = await prisma.document.create({ data: {
        organizationId: ORG, type: "INVOICE", name: reserved || `REC-GEN-${t.code}`,
        status: "unconfirmed" as any, documentTemplateId: t.documentTemplateId, config,
        ...(t.projectId ? { projectId: t.projectId } : {}), ...(t.projectDeploymentId ? { projectDeploymentId: t.projectDeploymentId } : {}),
      } });
      const next = new Date(runDate); next.setMonth(next.getMonth() + 1);
      await prisma.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { lastRunAt: new Date(), lastRunDocumentId: doc.id, nextRunDate: next, nextRunNo: { increment: 1 } } });
      ok++;
    } catch (e: any) { fail++; console.log(`✗ ${t.code}: ${String(e?.message).slice(0, 120)}`); }
  }
  console.log(`generated ${ok}, failed ${fail}`);
  process.exit(0);
})();
