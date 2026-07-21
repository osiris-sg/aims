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
import { toast } from "react-toastify";
import { useGetCustomers } from "@/app/portal/hooks/api";

const unwrap = (r: any) => (r && typeof r === "object" && r.data !== undefined ? r.data : r);

export default function OfficialReceiptPage() {
  const params = useParams();
  const router = useRouter();
  const documentId = params.documentId as string;
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { customers = [] } = useGetCustomers({ limit: 1000 });

  const [existingData, setExistingData] = useState<any>(null);
  const [receipts, setReceipts] = useState<any[]>([]); // newest first, for ‹ › nav
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const [receiptRes, listRes] = await Promise.all([
          request({ path: `/receipts/${documentId}`, method: "GET" }, {}, token),
          request({ path: `/receipts`, method: "GET" }, {}, token),
        ]);
        const r = unwrap(receiptRes);
        if (!r?.id) throw new Error("Receipt not found");
        if (cancelled) return;
        setReceipts(unwrap(listRes) || []);
        // Shape the receipt into the editor's existingData contract. Receipt
        // state rides in orData (see OfficialReceiptSection).
        setExistingData({
          id: r.id,
          name: r.receiptNumber,
          status: r.status,
          documentTemplateId: r.documentTemplateId,
          customerId: r.customerId,
          customer: r.customerId ? { id: r.customerId, name: r.customerName || "" } : undefined,
          documentInfo: { documentNumber: r.receiptNumber, date: r.date },
          savedBy: r.savedBy,
          savedAt: r.savedAt,
          lastUsedBy: r.savedBy,
          lastUsedAt: r.savedAt,
          updatedAt: r.updatedAt,
          orData: {
            date: r.date || new Date().toISOString().slice(0, 10),
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
      } catch (e: any) {
        console.error("Error loading receipt:", e);
        toast.error(e?.message || "Failed to load receipt");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, getToken]);

  const handleSave = async (data: any) => {
    const token = await getToken();
    if (!token) {
      toast.error("Authentication required");
      throw new Error("Authentication required");
    }
    const od = data?.orData || {};
    const response = await request(
      { path: `/receipts/${documentId}`, method: "PUT" },
      {
        date: od.date,
        chequeNo: od.chequeNo || null,
        remarks: od.remarks || null,
        customerId: data?.customer?.id,
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
    return unwrap(response);
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

  if (loading || !existingData) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", flex: 1, minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <TabbedDocumentCreator
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
  );
}
