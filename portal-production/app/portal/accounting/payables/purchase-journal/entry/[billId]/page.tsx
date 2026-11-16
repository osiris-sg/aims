"use client";

// Full-page Purchase Journal editor route (guru 2026-11-16, Chong Aik).
// /portal/accounting/payables/purchase-journal/entry/<billId|new>?kind=SIN|SPR
// Only reached when enablePurchaseJournalGrid is on (the list routes here); the
// page itself just renders the editor so a deep link works too.
import { useParams, useSearchParams } from "next/navigation";
import PurchaseJournalEditor from "../../_components/PurchaseJournalEditor";

export default function PurchaseJournalEntryPage() {
  const params = useParams();
  const search = useSearchParams();
  const billId = String((params as any)?.billId || "new");
  const kind = search.get("kind") === "SPR" ? "SPR" : "SIN";
  return <PurchaseJournalEditor billId={billId} initialKind={kind} />;
}
