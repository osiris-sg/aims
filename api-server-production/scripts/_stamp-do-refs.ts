// Stamp referenceNo + amount (nettTotal) on the August DO register; create the
// missing JIAYI customer and link 009/RTN-001.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const SET: Record<string, { ref: string; amt?: number }> = {
  "DO202608-001":  { ref: "Inv BI202608035 · LION135 MG20260159 + DG + cables", amt: 6322.00 },
  "DO202608-002":  { ref: "Inv BI202608021 · exchange add-on to DO202504-006/DO202602-001", amt: 2790.40 },
  "DO202608-003":  { ref: "ABORTED — Xero invoice zeroed ('RETURN') · LION500 no S/No." },
  "DO202608-004":  { ref: "PO SCB-PO-2608-16781 · Inv BI202608078 · 2xAIS", amt: 949.35 },
  "DO202608-005":  { ref: "PO K1930092 (KSIG2628) · bundled in Inv BI202608034 · DB Box SB321" },
  "DO202608-007":  { ref: "PO DEB_Y_26_08_14074 · Inv BI202608030", amt: 4725.67 },
  "DO202608-008":  { ref: "PO DEB_Y_26_08_14075 · Inv BI202608031", amt: 4134.97 },
  "DO202608-012":  { ref: "PO DEB_Y_26_08_14076 · Inv BI202608032 · serial TBC", amt: 2756.64 },
  "DO202608-009":  { ref: "Signed DO 14.08 (Mr Ting) · ⚠ NOT INVOICED — expect ≈$6,104/mth" },
  "DO202608-010":  { ref: "EXCHANGE AIS2026038 → AIS2026037 (chain Inv BI202608077)" },
  "DO202608-015":  { ref: "EXCHANGE 60KVA → 100KVA DG for MG20250077 (Teambuild N4C22)" },
  "DO202608-0038": { ref: "⚠ NO PO — BESS delivered 20.08, NOT INVOICED, serial TBC" },
  "DO202608-0041": { ref: "LION500 MG20260172 delivered 26.08 · ⚠ check billing/PO" },
  "DO202608-0042": { ref: "PO 23.07 (BESS 375kWh, Lentor Gdn) · ⚠ NOT INVOICED" },
  "RTN-DO202608-001": { ref: "paired with DO202608-009 (Jia Yi Sembawang) · confirm collected unit" },
  "DO202606-007":  { ref: "Uploaded scan · AIS2026032+038 · chain Inv BI202608077 (038 exchanged out 14.08)", amt: 1090.00 },
};
(async () => {
  // JIAYI customer
  let jiayi = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: "Jiayi", mode: "insensitive" } }, select: { id: true, name: true } });
  if (!jiayi) {
    jiayi = await prisma.customer.create({ data: { organizationId: ORG, name: "Jiayi Construction Engineering Pte. Ltd." }, select: { id: true, name: true } });
    console.log("✓ created customer:", jiayi.name, "(⚠ no Xero contact yet — needed before invoicing)");
  }
  for (const [name, v] of Object.entries(SET)) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name, type: { in: ["DELIVERY_ORDER", "RETURN_DELIVERY_ORDER"] } } });
    if (!d) { console.log(`✗ ${name} not found`); continue; }
    const c: any = d.config;
    const patch: any = { ...c, referenceNo: v.ref, documentInfo: { ...(c.documentInfo || {}), referenceNo: v.ref } };
    if (v.amt) patch.nettTotal = v.amt;
    if (/JIAYI/i.test(c.customerName || "") || name === "DO202608-009" || name === "RTN-DO202608-001") { patch.customerId = jiayi.id; patch.customerName = jiayi.name; }
    await prisma.document.update({ where: { id: d.id }, data: { config: patch } });
    console.log(`✓ ${name}: ref + ${v.amt ? "$" + v.amt : "no amt"}`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
