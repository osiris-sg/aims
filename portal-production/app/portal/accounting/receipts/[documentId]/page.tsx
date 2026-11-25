"use client";

// Official Receipt editor page — mounts the REAL document editor
// (TabbedDocumentCreator) on a receipt Document row: same toolbar, tabs,
// locking, history and exit-prompt as every other document; only the field
// rows (OR_FIELD_DEFINITIONS) and the body (Offset Transactions grid) differ.
// Saves route to PUT /receipts/:id, which replaces the allocation Payment
// rows and posts ONE journal (Dr bank / Cr debtor per allocation).

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import TabbedDocumentCreator from "@/containers/DocumentTemplates/components/TabbedDocumentCreator";
import { OR_FIELD_DEFINITIONS } from "@/containers/DocumentTemplates/components/OfficialReceiptSection";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { failureLine, listFrom, requestFailed } from "@/helpers/requestOutcome";
import LoadErrorAlert from "@/components/LoadErrorAlert";
import { toast } from "react-toastify";
import { useCustomerPool } from "@/app/portal/hooks/api/useCustomerPicker";
import { todayIso } from "@/helpers/orgToday";

const unwrap = (r: any) => (r && typeof r === "object" && r.data !== undefined ? r.data : r);

// Shape a receipt into the editor's existingData contract. Receipt state
// rides in orData (see OfficialReceiptSection). Used on load AND after a save
// that assigned the real number (custom {BANK} numbering issues it on the
// first save), so the editor re-mounts on the saved state.
const toExisting = (r: any) => ({
    id: r.id,
    name: r.receiptNumber,
    status: r.status,
    documentTemplateId: r.documentTemplateId,
    customerId: r.customerId,
    customer: r.customerId ? { id: r.customerId, name: r.customerName || "" } : undefined,
    documentInfo: { documentNumber: r.receiptNumber, date: r.date },
    savedBy: r.savedBy,
    savedAt: r.savedAt,
    incompleteReason: r.incompleteReason ?? null,
    lastUsedBy: r.savedBy,
    // Per-document Lock button: a locked voucher opens read-only.
    config: { recordLocked: r.recordLocked === true, recordLockedAt: r.recordLockedAt, recordLockedBy: r.recordLockedBy },
    lastUsedAt: r.savedAt,
    updatedAt: r.updatedAt,
    orData: {
      date: r.date || todayIso(),
      chequeNo: r.chequeNo || "",
      remarks: r.remarks || "",
      creditAccountCode: r.creditAccountCode || null,
      debitAccountCode: r.debitAccountCode || null,
      depositLabel: r.debitAccountCode || "",
      currency: r.currency || "SGD",
      rate: r.rate || 1,
      receiptAmount: r.receiptAmount || 0,
      allocations: r.allocations || [],
    },
});


export default function OfficialReceiptPage() {
  const params = useParams();
  const router = useRouter();
  const documentId = params.documentId as string;
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  const [existingData, setExistingData] = useState<any>(null);
  const [receipts, setReceipts] = useState<any[]>([]); // newest first, for ‹ › nav
  // Customers: the document's own customer (by id) plus every customer the
  // pickers have seen. Never a capped "first N" list: orgs have thousands
  // (WCT ~4,000), and a capped list lost the selected customer.
  const customers = useCustomerPool([existingData?.customer?.id, existingData?.customerId, ...receipts.map((r: any) => r.customerId)]);
  const [loading, setLoading] = useState(true);
  // A failed load shows its error with a Retry; a failed ‹ › list never crashes the editor (round 16).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const token = await getToken();
        if (!token) return;
        const [receiptRes, listRes] = await Promise.all([
          request({ path: `/receipts/${documentId}`, method: "GET", ownError: true }, {}, token),
          request({ path: `/receipts`, method: "GET", ownError: true }, {}, token),
        ]);
        if (requestFailed(receiptRes)) throw new Error(failureLine(receiptRes, "Could not load the receipt"));
        const r = unwrap(receiptRes);
        if (!r?.id) throw new Error("Receipt not found");
        if (cancelled) return;
        const navList = listFrom<any>(listRes, "Could not load the receipt list");
        setReceipts(navList.rows);
        setListError(navList.error);
        // Shape the receipt into the editor's existingData contract. Receipt
        // state rides in orData (see OfficialReceiptSection).
        setExistingData(toExisting(r));
      } catch (e: any) {
        console.error("Error loading receipt:", e);
        if (!cancelled) setLoadError(e?.message || "Could not load the receipt");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, getToken, attempt]);

  const reloadList = async () => {
    const token = await getToken();
    if (!token) return;
    const navList = listFrom<any>(await request({ path: `/receipts`, method: "GET", ownError: true }, {}, token), "Could not load the receipt list");
    setReceipts(navList.rows);
    setListError(navList.error);
  };

  const handleSave = async (data: any) => {
    const token = await getToken();
    if (!token) {
      toast.error("Authentication required");
      throw new Error("Authentication required");
    }
    const od = data?.orData || {};
    const response = await request(
      { path: `/receipts/${documentId}`, method: "PUT", ownError: true },
      {
        receiptNumber: data?.documentInfo?.documentNumber || data?.name || null,
        date: od.date,
        chequeNo: od.chequeNo || null,
        remarks: od.remarks || null,
        customerId: data?.customer?.id,
        creditAccountCode: od.creditAccountCode || null,
        debitAccountCode: od.debitAccountCode,
        currency: od.currency || "SGD",
        rate: parseFloat(od.rate) || 1,
        receiptAmount: Math.round((parseFloat(od.receiptAmount) || 0) * 100) / 100,
        paymentMethod: od.chequeNo ? "cheque" : "transfer",
        allocations: (Array.isArray(od.allocations) ? od.allocations : []).map((a: any) => ({
          documentId: a.documentId,
          amount: Number(a.amount) || 0,
        })),
      },
      token,
    );
    if (response?.success === false) {
      toast.error(response?.message || "Failed to save receipt");
      throw new Error(response?.message || "Failed to save receipt");
    }
    const saved = unwrap(response);
    // OR-PENDING → real number on the first save (custom {BANK} numbering):
    // re-mount the editor on the saved receipt so the toolbar shows it.
    // Re-mount the editor ONLY when the SERVER issued the number (placeholder →
    // real number on the first complete save). A number the user is typing
    // comes back unchanged and must not re-mount — the field lost focus after
    // every autosaved keystroke (guru 2026-11-18: "after the first letter, it
    // saved and pushed me out of the field").
    const typedNumber = String(data?.documentInfo?.documentNumber || data?.name || "").trim();
    if (saved?.receiptNumber && saved.receiptNumber !== existingData?.name && saved.receiptNumber !== typedNumber) {
      toast.info(`Receipt numbered ${saved.receiptNumber}`);
      setExistingData(toExisting(saved));
    }
    if (saved?.id) setReceipts((prev) => prev.map((x: any) => (x.id === saved.id ? { ...x, ...saved } : x)));
    // Posted = confirmed on a complete autosave (2026-11-18): refresh the status
    // pill in place (no re-mount — only the status key changes).
    if (saved?.status && saved.status !== existingData?.status) setExistingData((prev: any) => (prev ? { ...prev, status: saved.status } : prev));
    // Out of the books or back in: the editor's "Not posted" chip follows every save (guru 2026-11-25,
    // UOBOR2610-004 sat unposted for want of a deposit-to bank while the pill read "Saved").
    if (saved && (saved.incompleteReason ?? null) !== (existingData?.incompleteReason ?? null)) {
      setExistingData((prev: any) => (prev ? { ...prev, incompleteReason: saved.incompleteReason ?? null } : prev));
    }
    return saved;
  };

  // ‹ › browse saved receipts (newest first — Previous goes to the older one).
  const savedReceipts = useMemo(() => receipts.filter((r: any) => r.customerId || r.id === documentId), [receipts, documentId]);
  const currentIndex = savedReceipts.findIndex((r: any) => r.id === documentId);
  const goTo = (r: any) =>
    r && router.push(`/portal/accounting/receipts/${r.id}${typeof window !== "undefined" ? window.location.search : ""}`);

  // Customer master (currency preserved — the receipt follows it).
  const customersList = useMemo(
    () =>
      (customers || []).map((c: any) => ({
        id: c.id,
        customerCode: c.customerCode || "",
        name: c.name,
        address: c.address || "",
        phone: c.phone || "",
        email: c.email || "",
        currency: c.currency || "SGD",
        contacts: c.contacts || [],
      })),
    [customers],
  );

  if (loadError) {
    return (
      <Box sx={{ p: 3, width: "100%" }}>
        <LoadErrorAlert message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
      </Box>
    );
  }

  if (loading || !existingData) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", flex: 1, minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      {listError && <LoadErrorAlert message={listError} onRetry={reloadList} sx={{ mx: 2, mt: 2 }} />}
      <TabbedDocumentCreator
        key={existingData.name || documentId}
        documentType="OFFICIAL_RECEIPT"
        actualDocumentType="OFFICIAL_RECEIPT"
        documentId={documentId}
        templateId={existingData.documentTemplateId}
        fieldDefinitions={OR_FIELD_DEFINITIONS}
        existingData={existingData}
        onSave={handleSave}
        customers={customersList}
        organization={organization}
        onPrevious={() => goTo(savedReceipts[currentIndex + 1])}
        onNext={() => goTo(savedReceipts[currentIndex - 1])}
        hasPrevious={currentIndex >= 0 && currentIndex < savedReceipts.length - 1}
        hasNext={currentIndex > 0}
      />
    </>
  );
}
