// Document.status alignment for BILLs: Xero AUTHORISED/PAID must not sit as
// AIMS 'draft' (GST report + verifier skip drafts). Mirror Xero truth.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "BILL", status: "draft" as any }, select: { id: true, name: true, config: true } });
  let n = 0;
  for (const d of docs) {
    const c: any = d.config;
    const xs = (c.xeroStatus || "").toUpperCase();
    if (!["AUTHORISED", "PAID"].includes(xs)) continue;
    await prisma.document.update({ where: { id: d.id }, data: { status: (xs === "PAID" ? "paid" : "confirmed") as any } });
    n++;
  }
  console.log(`aligned ${n} bills draft → confirmed/paid (Xero truth)`);
  process.exit(0);
})();
