"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AccountingIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/portal/accounting/general-ledger");
  }, [router]);
  return null;
}
