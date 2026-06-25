import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();
import { BIOFUEL_ORG_ID, getXeroTokens, xeroGet } from "./_common";

const prisma = new PrismaClient();

async function main() {
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);
  // Use summaryOnly to keep response small. Iterate pages of 1000 to estimate total.
  // Xero doesn't return a total count — we paginate.
  const types: Array<"ACCREC" | "ACCPAY"> = ["ACCREC", "ACCPAY"];
  for (const t of types) {
    let page = 1;
    let total = 0;
    while (true) {
      const data = await xeroGet<{ Invoices: any[] }>(tokens, "/Invoices", {
        page,
        summaryOnly: "true",
        pageSize: 1000,
        where: `Type=="${t}"`,
      });
      const n = data.Invoices?.length || 0;
      total += n;
      if (n < 1000) break;
      page++;
    }
    console.log(`Xero ${t} (${t === "ACCREC" ? "sales/AR" : "purchase/AP"}) invoices: ${total}`);
  }

  // Also count credit notes
  for (const t of types) {
    const data = await xeroGet<{ CreditNotes: any[] }>(tokens, "/CreditNotes", {
      page: 1,
      pageSize: 1000,
      where: `Type=="${t === "ACCREC" ? "ACCRECCREDIT" : "ACCPAYCREDIT"}"`,
    });
    console.log(`Xero ${t === "ACCREC" ? "AR" : "AP"} credit notes (page 1, max 1000): ${data.CreditNotes?.length || 0}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
