import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG } });
  const owned = new Set(tpls.map(t => t.lastRunDocumentId).filter(Boolean));
  const slots = tpls.map(t => parseInt((/\{MONTH NO\}(\d{3})$/.exec(String((t.config as any)?.documentNumber || "")) || [])[1] || "0", 10)).filter(n => n > 0).sort((a, b) => a - b);
  const sgaps = []; for (let i = 1; i <= Math.max(...slots); i++) if (!slots.includes(i)) sgaps.push(i);
  console.log(`templates: ${tpls.length} · slots 1..${Math.max(...slots)} · slot gaps: ${sgaps.join(",") || "none"}`);
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { gte: "BI202609001", lte: "BI202609199" } }, select: { id: true, name: true, status: true, config: true }, orderBy: { name: "asc" } });
  const series = docs.filter(d => /^BI202609\d{3}$/.test(d.name!));
  console.log(`Sept series docs: ${series.length}`);
  const have = new Set(series.map(d => d.name));
  const maxN = Math.max(...series.map(d => parseInt(d.name!.slice(-3), 10)));
  const dgaps = []; for (let i = 1; i <= maxN; i++) if (!have.has(`BI202609${String(i).padStart(3, "0")}`)) dgaps.push(i);
  console.log(`doc number gaps: ${dgaps.join(",") || "none"} · max ${maxN}`);
  for (const d of series) {
    if (owned.has(d.id)) continue;
    const c: any = d.config;
    const xs = String(c?.xeroStatus || "").toUpperCase();
    const sent = !["draft", "unconfirmed"].includes(String(d.status)) || ["AUTHORISED", "PAID"].includes(xs) || Boolean(c?.sentAt);
    console.log(`ORPHAN ${d.name} [${d.status}${sent ? "/SENT" : ""}] $${c?.nettTotal ?? "?"} · ref=${String(c?.reference || "").slice(0, 60)}`);
  }
  process.exit(0);
})();
