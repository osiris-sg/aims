// Repair the Sept series (guru 2026-09-09): the deployed renamer stranded 29
// drafts under TMP- names when templates were deleted. 1) delete orphan drafts
// of deleted templates; 2) re-deal every owned, unsent Sept draft to its
// template's CURRENT slot (two-phase); 3) verify gap-free.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const APPLY = process.argv.includes("--apply");
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG } });
  const slotOf = (t: any) => parseInt((/\{MONTH NO\}(\d{3})$/.exec(String((t.config as any)?.documentNumber || "")) || [])[1] || "0", 10);
  const byDoc = new Map<string, number>();
  for (const t of tpls) if (t.lastRunDocumentId && slotOf(t) > 0) byDoc.set(t.lastRunDocumentId, slotOf(t));
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", OR: [{ name: { startsWith: "TMP-" } }, { name: { gte: "BI202609001", lte: "BI202609099" } }] } });
  const series = docs.filter(d => /^BI202609\d{3}$/.test(d.name!) || d.name!.startsWith("TMP-"));
  const isSent = (d: any) => { const c: any = d.config || {}; const xs = String(c.xeroStatus || "").toUpperCase(); return !["draft", "unconfirmed"].includes(String(d.status)) || ["AUTHORISED", "PAID"].includes(xs) || Boolean(c.sentAt); };
  // 1) orphans
  let orphans = 0;
  for (const d of series) {
    if (byDoc.has(d.id)) continue;
    if (isSent(d)) { console.log(`⚠ ORPHAN BUT SENT — left alone: ${d.name}`); continue; }
    console.log(`orphan → delete: ${d.name} $${(d.config as any)?.nettTotal ?? "?"} · ${String((d.config as any)?.reference || "").slice(0, 55)}`);
    orphans++;
    if (APPLY) await prisma.document.delete({ where: { id: d.id } });
  }
  // 2) renames to current slots
  const moves: { id: string; from: string; oldNum: string; to: string }[] = [];
  for (const d of series) {
    const slot = byDoc.get(d.id);
    if (!slot) continue;
    const to = `BI202609${String(slot).padStart(3, "0")}`;
    if (d.name === to) continue;
    if (isSent(d)) { console.log(`⚠ owned+sent, cannot move: ${d.name} → ${to}`); continue; }
    const oldNum = String((d.config as any)?.documentNumber || d.name!.replace(/^TMP-[0-9a-f]{6}-/, ""));
    moves.push({ id: d.id, from: d.name!, oldNum, to });
  }
  console.log(`\n${orphans} orphan(s) · ${moves.length} rename(s):`);
  for (const m of moves) console.log(`  ${m.from} → ${m.to}`);
  if (APPLY) {
    for (const m of moves) await prisma.document.update({ where: { id: m.id }, data: { name: `TMP2-${m.id.slice(0, 6)}` } });
    for (const m of moves) {
      const doc = await prisma.document.findUnique({ where: { id: m.id } });
      const c: any = doc!.config || {};
      const bump = (v: any) => (typeof v === "string" && m.oldNum ? v.split(m.oldNum).join(m.to) : v);
      const config: any = { ...c, documentNumber: m.to, reference: bump(c.reference) };
      if (config.documentInfo) config.documentInfo = { ...config.documentInfo, documentNumber: m.to, referenceNo: bump(config.documentInfo.referenceNo) };
      await prisma.document.update({ where: { id: m.id }, data: { name: m.to, config } });
    }
    console.log("renames applied");
  }
  // 3) verify
  if (APPLY) {
    const after = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { gte: "BI202609001", lte: "BI202609099" } }, select: { name: true } });
    const have = new Set(after.map(d => d.name));
    const max = Math.max(...[...have].map(n => parseInt(n!.slice(-3), 10)));
    const gaps = []; for (let i = 1; i <= max; i++) if (!have.has(`BI202609${String(i).padStart(3, "0")}`)) gaps.push(i);
    const tmpLeft = await prisma.document.count({ where: { organizationId: ORG, name: { startsWith: "TMP" } } });
    console.log(`\nAFTER: ${have.size} docs · 1..${max} · gaps: ${gaps.join(",") || "NONE"} · TMP left: ${tmpLeft}`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
