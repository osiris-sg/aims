// Rephrase the Nishio-pasted REMARKS + T&C into Biofuel wording (guru's
// 2026-09-14 redlines on QO202609-0063) — on the live quote AND the org's
// QUOTATION doc defaults so every future quote inherits it.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const NOTES = [
  "• Please provide your Purchase Order, or chop & sign this quotation, as confirmation of order.",
  "• Kindly indicate the site address, delivery date and site contact person.",
  "• For painting / cementing / plastering works, the Hirer must cover and protect the equipment and the surrounding work area. Costs to repair, repaint or wash equipment or surroundings damaged through inadequate protection will be borne by the Hirer. Flooring must be protected from possible oil leakage. Biofuel Industries Pte Ltd is not responsible for damage caused by the Hirer's failure to do so.",
].map(l => `<div>${l}</div>`).join("");
const TNC = [
  "1) Rates quoted are for a maximum of 12 hours' usage per day.",
  "2) For twenty-four (24) hours' usage, the rate is doubled. The Hirer must inform Biofuel Industries before proceeding.",
  "3) The Hirer shall maintain the equipment in good working condition, e.g. daily checks of engine oil, radiator water and diesel.",
  "4) The Hirer shall insure the equipment against all risks.",
  "5) All other terms & conditions are as per the Standard Rental Agreement.",
  "6) Delivery and waiting time shall not exceed three (3) hours from Biofuel's yard to job completion at site; overtime charges beyond this are borne by the Hirer.",
].map(l => `<div>${l}</div>`).join("");
(async () => {
  // org defaults
  const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { docTypeDefaults: true } });
  const dd: any = (org?.docTypeDefaults as any) || {};
  dd.QUOTATION = { ...(dd.QUOTATION || {}), notes: NOTES, tnc: TNC };
  await prisma.organization.update({ where: { id: ORG }, data: { docTypeDefaults: dd } });
  console.log("✓ org QUOTATION defaults: notes + tnc set (Biofuel wording)");
  // the live quote
  const q = await prisma.document.findFirst({ where: { organizationId: ORG, name: "QO202609-0063" } });
  const c: any = q!.config;
  await prisma.document.update({ where: { id: q!.id }, data: { config: { ...c, notes: NOTES, note: NOTES, termsAndConditions: TNC, paymentTerms: c.paymentTerms || "30 days", documentInfo: { ...(c.documentInfo || {}), paymentTerms: (c.documentInfo?.paymentTerms || "30 days") } } } });
  console.log("✓ QO202609-0063 rewritten (notes + T&C, terms 30 days)");
  process.exit(0);
})();
