"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import VerificationQueue from "../_components/VerificationQueue";

// WCT (enableWctOrders, 2026-11-03): the queue is the Jobs page's "To verify"
// tab; this old link goes there. Anyone else: the queue as before.
export default function VerificationQueuePage() {
  const router = useRouter();
  const { isWctOrdersEnabled, isLoading } = useOrganizationFeatures();
  useEffect(() => {
    if (!isLoading && isWctOrdersEnabled) router.replace("/portal/deliveries?status=to_verify");
  }, [isLoading, isWctOrdersEnabled, router]);
  if (isLoading || isWctOrdersEnabled) return null;
  return <VerificationQueue />;
}
