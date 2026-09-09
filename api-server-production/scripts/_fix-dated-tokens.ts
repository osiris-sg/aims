// Repair wrongly-tokenized fixed dates (guru 2026-09-09):
//  REC-067 template: 3x "dated {MONTH END}" → "dated 05/08/2026"
//  Draft BI202609067: 3x "dated 30/09/2026" → "dated 05/08/2026" (same lines)
//  Draft BI202609026: "PO ... 14074 dated 30/09/2026" → "dated 07/08/2026"
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const fixText = (s: string, pairs: [RegExp, string][]) => pairs.reduce((acc, [re, to]) => acc.replace(re, to), s);
(async () => {
  // 1) template REC-067
  const t = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code: "REC-067" } });
  const tc: any = t!.config;
  const items = (tc.items || []).map((it: any) => ({
    ...it,
    description: fixText(String(it.description || ""), [
      [/(DO No\. DO202608-004 dated )\{MONTH END\}/g, "$1" + "05/08/2026"],
      [/(PO No\. SCB-PO-2608-16781 dated )\{MONTH END\}/g, "$1" + "05/08/2026"],
      [/(MRF No\. P135 - SITE MATERIALS dated )\{MONTH END\}/g, "$1" + "05/08/2026"],
    ]),
  }));
  await prisma.recurringInvoiceTemplate.update({ where: { id: t!.id }, data: { config: { ...tc, items } } });
  console.log("✓ REC-067 template: 3 fixed dates restored");
  // 2) drafts
  const FIX: Record<string, [RegExp, string][]> = {
    BI202609067: [
      [/(DO No\. DO202608-004 dated )30\/09\/2026/g, "$1" + "05/08/2026"],
      [/(PO No\. SCB-PO-2608-16781 dated )30\/09\/2026/g, "$1" + "05/08/2026"],
      [/(MRF No\. P135 - SITE MATERIALS dated )30\/09\/2026/g, "$1" + "05/08/2026"],
    ],
    BI202609026: [[/(PO No\. DEBY\/Y\/26\/08\/14074 dated )30\/09\/2026/g, "$1" + "07/08/2026"]],
  };
  for (const [name, pairs] of Object.entries(FIX)) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name } });
    const c: any = d!.config;
    const its = (c.items || []).map((it: any) => ({ ...it, description: fixText(String(it.description || ""), pairs) }));
    await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, items: its } } });
    console.log(`✓ ${name} [${d!.status}]: dates restored`);
  }
  process.exit(0);
})();
