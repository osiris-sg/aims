// "Create Payment Voucher" for one supplier invoice (guru 2026-11-27): a new voucher, already set
// to pay this invoice (supplier, invoice ticked for what is owing), opened in a NEW TAB so the
// Purchase Journal stays where it is. The user keys the bank on the voucher; nothing is paid here.
import { toast } from "react-toastify";

type Request = <T = any>(path: string, init?: RequestInit) => Promise<T>;

export async function openPaymentVoucherForBill(request: Request, billId: string): Promise<boolean> {
  // The tab is opened before the request: a tab opened after an await is a blocked pop-up.
  // No "noopener": the new tab must inherit this tab's "viewing as org" (sessionStorage).
  const tab = window.open("about:blank", "_blank");
  try {
    const v: any = await request("/payment-vouchers", { method: "POST", body: JSON.stringify({ billId }) });
    const id = v?.id ?? v?.data?.id;
    if (!id) throw new Error("Could not create the payment voucher");
    const url = `/portal/accounting/payment-vouchers/${id}`;
    if (tab) tab.location.href = url;
    else window.location.href = url; // pop-ups blocked: same tab
    return true;
  } catch (e: any) {
    tab?.close();
    toast.error(e?.message || "Could not create the payment voucher");
    return false;
  }
}
