import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const TPL = "b4898f54-fec8-46dd-a3be-52fc47e34c05";
const DOS = [
  { name: "DO202608-005", date: "2026-08-08", cust: "Keller Foundations", items: [{ description: "1x 63A DB Box\nS/No.: SB321", serialNumbers: ["SB321"] }], to: "Jurong Port (KSIG2628)", note: "Signed DO in folder (Anamul). Invoiced within BI202608034 (bundled: LION125 + DG + DB Box SB321)." },
  { name: "DO202608-009", date: "2026-08-14", cust: "JIAYI", items: [{ description: "1x Micro-Grid System LION375\nS/No.: MG20250103\n1x Diesel Generator + 1x cable", serialNumbers: ["MG20250103"] }], to: "Sembawang", note: "Signed DO (Mr Ting). Unit MG20250103 redeployed from CCDC Canberra (returned RTN-DO202607-003 on 16.07). ⚠ NO RENTAL INVOICE FOUND for Aug — check billing." },
  { name: "DO202608-010", date: "2026-08-14", cust: "SCB Building Construction", items: [{ description: "EXCHANGE: AIS2026038 collected, AIS2026037 delivered", serialNumbers: ["AIS2026037"] }], to: "Opp Blk 280 Tampines St 22", note: "Signed DO (Li Rong). Serial swap on the SCB AIS chain (BI202608077 pair AIS2026032+038 → 032+037). Sept invoice descriptions must show AIS2026037." },
  { name: "DO202608-015", date: "2026-08-07", cust: "Teambuild", items: [{ description: "EXCHANGE: 1x 60KVA DG collected, 1x 100KVA DG delivered (for MGS MG20250077)" }], to: "Jurong N4C22", note: "Signed DO (Mr Woo Kai Dick). Genset upgrade on Teambuild chain (BI202608082 site). ⚠ Check if rental rate changes from Sept (60→100KVA)." },
  { name: "RTN-DO202608-001", date: "2026-08-14", cust: "JIAYI", items: [{ description: "Return/collection tied to Jia Yi Sembawang LION375 MG20250103 event (filename says RTN but body reads 'Rental of' — likely collection of the exchanged/previous unit)" }], to: "Sembawang", note: "⚠ AMBIGUOUS: signed file 'RTN-DO202608-001 dtd 20260814 Jia Yi (Sembawang Rental of 1xLION375 MG20250103…) Mr Tang' — same date as DO202608-009 (Mr Ting). Confirm what was collected." },
];
(async () => {
  for (const d of DOS) {
    const exists = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: d.name } });
    if (exists) { console.log(`= ${d.name} exists`); continue; }
    const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: d.cust, mode: "insensitive" } }, select: { id: true, name: true } });
    await prisma.document.create({ data: { organizationId: ORG, type: "DELIVERY_ORDER", name: d.name, status: "delivered_installed" as any, documentTemplateId: TPL, config: { date: d.date, customerId: cust?.id || "", customerName: cust?.name || d.cust, deliveryTo: d.to, items: d.items.map((it: any) => ({ quantity: 1, deploymentType: "RENTAL", ...it })), remarks: d.note, createdBy: "signed-DO backfill 2026-08-27" } } });
    console.log(`✓ ${d.name} · ${cust?.name || d.cust} · ${d.date}`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
