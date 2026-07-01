import { redirect } from "next/navigation";

// Bills (AP) moved from Inventory → Accounting on 2026-06-26.
// Keep this permanent redirect so old bookmarks / cached sidebar links resolve.
export default function BillsMovedRedirect() {
  redirect("/portal/accounting/bills");
}
