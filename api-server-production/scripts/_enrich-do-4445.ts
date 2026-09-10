import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const fix = [
    { name: "DO202609-0044", date: "2026-09-07", serial: null,
      rem: "Delivered 07/09/2026 (Arun's log; DO created same day). Site: T5 Obayashi. DG confirmed 30001079/G060180 (ex-Jia Yi, returned 5/9). LION250 serial TBC from Arun. NO PO/quote on record — price decision pending (tracker)." },
    { name: "DO202609-0045", date: "2026-08-22", serial: "MG20260168",
      rem: "Delivered 22/08/2026 (Arun's log: 'CCG Location T5' — plate photo LION250 MG20260168); DO papered late on 09/09. Site: T5B/TC4. NO PO/quote on record — price decision pending (tracker)." },
  ];
  for (const f of fix) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name: f.name } });
    const c: any = d!.config;
    const items = (c.items || []).map((it: any) =>
      /^LION250/i.test(String(it.description || "").trim()) && f.serial
        ? { ...it, description: `LION250\nS/No.: ${f.serial}` } : it);
    await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, date: f.date, items, remarks: ((c.remarks || "") + " | " + f.rem).replace(/^ \| /, "") } } });
    console.log(`✓ ${f.name}: date=${f.date}${f.serial ? " serial=" + f.serial : ""}`);
  }
  process.exit(0);
})();
