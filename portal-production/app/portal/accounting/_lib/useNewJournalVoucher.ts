"use client";

// "Journal Voucher" / "New Journal Entry" buttons (AR home, AP home, Finance
// Hub, Audit Trail) all open the legacy-style J/V document editor since
// 2026-11-09: create a blank shell, go to its page, come back to `from`.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { useAccountingApi } from "./api";

export function useNewJournalVoucher(from?: string) {
  const router = useRouter();
  const { request } = useAccountingApi();
  const [opening, setOpening] = useState(false);
  const open = useCallback(async () => {
    setOpening(true);
    try {
      const v = await request<{ id: string }>("/journal-vouchers", { method: "POST", body: JSON.stringify({}) });
      if (!v?.id) throw new Error("Couldn't create the journal voucher");
      const back = from || (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/portal/accounting");
      router.push(`/portal/accounting/journal-vouchers/${v.id}?from=${encodeURIComponent(back)}`);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't open a journal voucher");
      setOpening(false);
    }
  }, [request, router, from]);
  return { open, opening };
}
