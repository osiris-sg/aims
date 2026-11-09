"use client";

// Payment Voucher editor page — mounts the REAL document editor
// (TabbedDocumentCreator) on a voucher Document row: same toolbar, tabs,
// locking, history, ‹ › and exit-prompt as every other document; only the
// field rows (PV_FIELD_DEFINITIONS) and the body (Payment Lines grid +
// Remarks memo, legacy P/V screen — 2026-11-09) differ. Saves route to
// PUT /payment-vouchers/:id, which reposts ONE journal (Dr each line /
// Cr bank) and replaces the BillPayment rows of the supplier offset line.

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import TabbedDocumentCreator from "@/containers/DocumentTemplates/components/TabbedDocumentCreator";
import { PV_FIELD_DEFINITIONS } from "@/containers/DocumentTemplates/components/PaymentVoucherSection";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import { useGetSuppliers } from "@/app/portal/hooks/api/useSuppliers";
import { todayIso } from "@/helpers/orgToday";

const unwrap = (r: any) => (r && typeof r === "object" && r.data !== undefined ? r.data : r);

// Shape a voucher into the editor's existingData contract. Voucher state
// rides in pvData (see PaymentVoucherSection). Used on load AND after a save
// that assigned the real number, so the editor re-mounts on the saved state.
const toExisting = (r: any) => ({
  id: r.id,
  name: r.voucherNumber,
  status: r.status,
  documentTemplateId: r.documentTemplateId,
  supplier: r.supplierId ? { id: r.supplierId, name: r.supplierName || "", supplierCode: r.supplierCode || "" } : undefined,
  documentInfo: { documentNumber: r.voucherNumber, date: r.date },
  savedBy: r.savedBy,
  savedAt: r.savedAt,
  lastUsedBy: r.savedBy,
  lastUsedAt: r.savedAt,
  updatedAt: r.updatedAt,
  pvData: {
    date: r.date || todayIso(),
    bankAccountCode: r.bankAccountCode || null,
    bankLabel: r.bankAccountCode || "",
    currency: r.currency || "SGD",
    rate: r.rate || 1,
    payee: r.payee || "",
    remarks: r.remarks || "",
    notes: r.notes || "",
    chequeNo: r.chequeNo || "",
    preparedBy: r.preparedBy || "",
    creditorAccountCode: r.creditorAccountCode || null,
    lines: Array.isArray(r.lines) ? r.lines : [],
  },
});

export default function PaymentVoucherPage() {
  const params = useParams();
  const router = useRouter();
  const documentId = params.documentId as string;
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { suppliers = [] } = useGetSuppliers({ limit: 1000 });

  const [existingData, setExistingData] = useState<any>(null);
  const [vouchers, setVouchers] = useState<any[]>([]); // newest first, for ‹ › nav
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const [voucherRes, listRes] = await Promise.all([
          request({ path: `/payment-vouchers/${documentId}`, method: "GET" }, {}, token),
          request({ path: `/payment-vouchers`, method: "GET" }, {}, token),
        ]);
        const v = unwrap(voucherRes);
        if (!v?.id) throw new Error("Payment voucher not found");
        if (cancelled) return;
        setVouchers(unwrap(listRes) || []);
        setExistingData(toExisting(v));
      } catch (e: any) {
        console.error("Error loading payment voucher:", e);
        toast.error(e?.message || "Failed to load payment voucher");
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
    const pd = data?.pvData || {};
    const lines = (Array.isArray(pd.lines) ? pd.lines : [])
      .filter((l: any) => l.accountCode || parseFloat(String(l.amount)) || l.offset)
      .map((l: any) => ({
        id: l.id,
        accountCode: l.accountCode || null,
        description: l.description || null,
        remarks: l.remarks || null,
        amount: Math.round((parseFloat(String(l.amount)) || 0) * 100) / 100,
        offset: l.offset
          ? {
              supplierId: l.offset.supplierId,
              rate: Number(l.offset.rate) || 1,
              allocations: (l.offset.allocations || []).map((a: any) => ({ documentId: a.documentId, amount: Number(a.amount) || 0 })),
              updateFx: l.offset.updateFx !== false,
              fxAccountCode: l.offset.fxAccountCode || null,
            }
          : null,
      }));
    const response = await request(
      { path: `/payment-vouchers/${documentId}`, method: "PUT" },
      {
        voucherNumber: data?.documentInfo?.documentNumber || data?.name || null,
        date: pd.date,
        bankAccountCode: pd.bankAccountCode,
        currency: pd.currency || "SGD",
        rate: parseFloat(pd.rate) || 1,
        payee: pd.payee || null,
        remarks: pd.remarks || null,
        notes: pd.notes || null,
        chequeNo: pd.chequeNo || null,
        preparedBy: pd.preparedBy || null,
        paymentMethod: pd.chequeNo ? "cheque" : "transfer",
        lines,
      },
      token,
    );
    if (response?.success === false) {
      toast.error(response?.message || "Failed to save payment voucher");
      throw new Error(response?.message || "Failed to save payment voucher");
    }
    const saved = unwrap(response);
    if (saved?.voucherNumber && saved.voucherNumber !== existingData?.name) {
      toast.info(`Voucher numbered ${saved.voucherNumber}`);
      setExistingData(toExisting(saved));
      setVouchers((prev) => prev.map((x: any) => (x.id === saved.id ? { ...x, ...saved } : x)));
    }
    return saved;
  };

  // ‹ › walk saved vouchers only (a blank shell someone else just opened is not a stop).
  const savedVouchers = useMemo(() => vouchers.filter((v: any) => v.savedAt || v.id === documentId), [vouchers, documentId]);
  const currentIndex = savedVouchers.findIndex((v: any) => v.id === documentId);
  const goTo = (v: any) =>
    v && router.push(`/portal/accounting/payment-vouchers/${v.id}${typeof window !== "undefined" ? window.location.search : ""}`);

  const suppliersList = useMemo(
    () =>
      (suppliers || []).map((s: any) => ({
        id: s.id,
        supplierCode: s.supplierCode || "",
        customerCode: s.supplierCode || "", // the shared Locate dialog reads customerCode
        name: s.name,
        address: s.address || "",
        phone: s.phone || "",
        email: s.email || "",
        currency: s.currency || "SGD",
      })),
    [suppliers],
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
      key={existingData.name || documentId}
      documentType="PAYMENT_VOUCHER"
      actualDocumentType="PAYMENT_VOUCHER"
      documentId={documentId}
      templateId={existingData.documentTemplateId}
      fieldDefinitions={PV_FIELD_DEFINITIONS}
      existingData={existingData}
      onSave={handleSave}
      customers={[]}
      suppliers={suppliersList}
      organization={organization}
      onPrevious={() => goTo(savedVouchers[currentIndex + 1])}
      onNext={() => goTo(savedVouchers[currentIndex - 1])}
      hasPrevious={currentIndex >= 0 && currentIndex < savedVouchers.length - 1}
      hasNext={currentIndex > 0}
    />
  );
}
