"use client";

// The Purchase Journal moved under the AP path (guru 2026-08-01). This stub
// forwards old links — query string (e.g. ?new=1) is preserved.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BillsRedirect() {
  const router = useRouter();
  useEffect(() => {
    const qs = typeof window !== "undefined" ? window.location.search : "";
    router.replace(`/portal/accounting/payables/purchase-journal${qs}`);
  }, [router]);
  return null;
}
