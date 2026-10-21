"use client";

// Payment Voucher editor page — mounts the REAL document editor
// (TabbedDocumentCreator) on a voucher Document row, exactly like the Official
// Receipt page: same toolbar, tabs, locking, history and exit prompt; only
// the field rows (PV_FIELD_DEFINITIONS) and the body (Offset Transactions over
// the supplier's unpaid bills) differ. Saves route to PUT /payment-vouchers/:id,
// which posts ONE journal (Dr creditors per allocation / Cr bank) and writes
// the allocations as BillPayment rows.

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

const unwrap = (r: any) => (r && typeof r === "object" && r.data !== undefined ? r.data : r);

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
        setExistingData({
          id: v.id,
          name: v.voucherNumber,
          status: v.status,
          documentTemplateId: v.documentTemplateId,
          supplier: v.supplierId ? { id: v.supplierId, name: v.supplierName || "", supplierCode: v.supplierCode || "" } : undefined,
          documentInfo: { documentNumber: v.voucherNumber, date: v.date },
          savedBy: v.savedBy,
          savedAt: v.savedAt,
          lastUsedBy: v.savedBy,
          lastUsedAt: v.savedAt,
          updatedAt: v.updatedAt,
          pvData: {
            date: v.date || new Date().toISOString().slice(0, 10),
            chequeNo: v.chequeNo || "",
            remarks: v.remarks || "",
            debitAccountCode: v.debitAccountCode || null,
            creditAccountCode: v.creditAccountCode || null,
            paidFromLabel: v.creditAccountCode || "",
            currency: v.currency || "SGD",
            rate: v.rate || 1,
            voucherAmount: v.voucherAmount || 0,
            allocations: v.allocations || [],
          },
        });
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
    const response = await request(
      { path: `/payment-vouchers/${documentId}`, method: "PUT" },
      {
        date: pd.date,
        chequeNo: pd.chequeNo || null,
        remarks: pd.remarks || null,
        supplierId: data?.supplier?.id,
        debitAccountCode: pd.debitAccountCode || null,
        creditAccountCode: pd.creditAccountCode,
        currency: pd.currency || "SGD",
        rate: parseFloat(pd.rate) || 1,
        voucherAmount: Math.round((parseFloat(pd.voucherAmount) || 0) * 100) / 100,
        paymentMethod: pd.chequeNo ? "cheque" : "transfer",
        allocations: (Array.isArray(pd.allocations) ? pd.allocations : []).map((a: any) => ({
          documentId: a.documentId,
          amount: Number(a.amount) || 0,
        })),
      },
      token,
    );
    if (response?.success === false) {
      toast.error(response?.message || "Failed to save payment voucher");
      throw new Error(response?.message || "Failed to save payment voucher");
    }
    return unwrap(response);
  };

  const savedVouchers = useMemo(() => vouchers.filter((v: any) => v.supplierId || v.id === documentId), [vouchers, documentId]);
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
