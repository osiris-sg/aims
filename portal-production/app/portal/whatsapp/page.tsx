"use client";

// The WhatsApp screens moved under the CRM module (2026-07-19). This stub
// keeps old links/bookmarks working.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WhatsAppRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/portal/crm/whatsapp");
  }, [router]);
  return null;
}
