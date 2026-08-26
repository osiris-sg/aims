// Rebuild each template's config from its chain's AIMS DRAFT (the perfected
// format) — tokenized — keeping amounts already verified against Xero.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
import * as fs from "fs";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round(n * 100) / 100;
(async () => {
  const aug = JSON.parse(fs.readFileSync("scripts/_aug-state.json", "utf8"));
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, orderBy: { code: "asc" } });
  // AIMS drafts by their Xero invoice id
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, select: { name: true, config: true } });
  const draftByXeroId = new Map(docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push").map(d => [(d.config as any).xeroInvoiceId, d]));
  const augByNum = new Map(aug.map((a: any) => [a.xeroNum, a]));
  const codesMap = JSON.parse(fs.readFileSync("scripts/_rec-codes.json", "utf8"));
  const augByCode = new Map(codesMap.map((c: any) => [c.code, c.augXero]));
  let done = 0, skipped: string[] = [];
  for (const t of tpls) {
    const augNum = augByCode.get(t.code!);
    if (!augNum) { skipped.push(`${t.code} (new chain — already hand-built)`); continue; }
    const a: any = augByNum.get(augNum);
    const draft: any = a ? draftByXeroId.get(a.xeroId) : null;
    if (!draft) { skipped.push(`${t.code} (${augNum}: no AIMS draft — her recreated invoice)`); continue; }
    const dc: any = draft.config;
    const ord = a.ordinal;
    // tokenize the perfected AIMS items
    const items = (dc.items || []).map((it: any, i: number) => {
      let desc: string = it.description || "";
      desc = desc.replace(/\b\d{2}\/08\/2026\b(?![\s\S]{0,12}dated)/g, (m: string) => m.startsWith("01/") ? "{MONTH START}" : "{MONTH END}");
      // July-period arrears chains bill previous month:
      desc = desc.replace(/\b01\/07\/2026\b(?![\s\S]{0,12}dated)/g, "{PREV MONTH START}").replace(/\b31\/07\/2026\b(?![\s\S]{0,12}dated)/g, "{PREV MONTH END}");
      if (ord != null) desc = desc.replace(new RegExp(`\\b${ord}(st|nd|rd|th)\\s*(mth|month)`, "gi"), `{NTH} $2`);
      return { ...it, id: 1810000000000 + done * 100 + i, description: desc };
    });
    let ref: string = (dc.reference || dc.referenceNo || "").replace(/^BI\w+\s*/, "");
    if (ord != null) ref = ref.replace(new RegExp(`\\b${ord}(st|nd|rd|th)\\s*(mth|month)`, "gi"), `{NTH} $2`);
    // amount truth: totals trued to Xero earlier; keep draft totals
    const config: any = {
      items, reference: ref, currency: "SGD",
      billTo: dc.billTo || undefined, customerAddress: dc.customerAddress || undefined,
      taxApplicable: "Y", gstPercent: 9,
      documentInfo: { referenceNo: ref, taxCode: "1", gstAmount: dc.gstAmount, subTotal: dc.subTotal, currency: "SGD", gstPercent: 9 },
      subTotal: dc.subTotal, gstAmount: dc.gstAmount, nettTotal: dc.nettTotal,
      note: /MBR/i.test(a.ref || "") ? "METERED — fill qty from meter reading before confirming" : undefined,
    };
    await prisma.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { config } });
    done++;
  }
  console.log(`retrofitted ${done} templates to the AIMS format; skipped ${skipped.length}:`);
  for (const s of skipped) console.log("  -", s);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
