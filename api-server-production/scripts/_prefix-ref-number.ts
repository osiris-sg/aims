// Reference = "<reserved number> (…)" exactly like Jul/Aug refs:
//   "BI{YEAR}{MONTH NO}005 ({NTH} mth DE195 … )" → "BI202609005 (5th mth …)"
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, orderBy: { code: "asc" } });
  let n = 0;
  for (const t of tpls) {
    const c: any = t.config;
    if (!c.documentNumber) continue;
    let body: string = (c.reference || "").trim();
    body = body.replace(/^BI\{[^}]+\}\{[^}]+\}\d{3}\s*/, "").trim(); // idempotent
    if (body && !body.startsWith("(")) body = `(${body}`;
    if (body && !body.endsWith(")")) body = `${body})`;
    const ref = body ? `${c.documentNumber} ${body}` : c.documentNumber;
    await prisma.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { config: { ...c, reference: ref, documentInfo: { ...(c.documentInfo || {}), referenceNo: ref } } } });
    n++;
  }
  console.log(`prefixed reserved number into ${n} template refs`);
  const sample = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code: "REC-005" } });
  console.log("sample REC-005:", (sample!.config as any).reference);
  process.exit(0);
})();
