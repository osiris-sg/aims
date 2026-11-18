"use client";

// The Trial Balance lives in the General Ledger report shell like every other report
// (guru 2026-11-18: one report UI, no paper-document pages). This route stays
// for old links and sends them there.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/portal/accounting/ledger?tab=tb");
  }, [router]);
  return null;
}
