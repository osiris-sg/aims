"use client";

// Journal Voucher editor page — the legacy J/V screen on the REAL document
// editor (TabbedDocumentCreator), like the Official Receipt and Payment
// Voucher (guru 2026-11-09). Header rows from JV_FIELD_DEFINITIONS, body =
// the Dr/Cr lines grid + Remarks memo. Saves go to PUT /journal-vouchers/:id,
// which posts / updates ONE manual journal numbered as the voucher.

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import TabbedDocumentCreator from "@/containers/DocumentTemplates/components/TabbedDocumentCreator";
import { JV_FIELD_DEFINITIONS } from "@/containers/DocumentTemplates/components/JournalVoucherSection";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { failureLine, listFrom, requestFailed } from "@/helpers/requestOutcome";
import LoadErrorAlert from "@/components/LoadErrorAlert";
import { toast } from "react-toastify";
import { useGetSuppliers } from "@/app/portal/hooks/api/useSuppliers";
import { todayIso } from "@/helpers/orgToday";

const unwrap = (r: any) => (r && typeof r === "object" && r.data !== undefined ? r.data : r);

const toExisting = (v: any) => ({
  id: v.id,
  name: v.voucherNumber,
  status: v.status,
  documentTemplateId: v.documentTemplateId,
  documentInfo: { documentNumber: v.voucherNumber, date: v.date },
  savedBy: v.savedBy,
  savedAt: v.savedAt,
  incompleteReason: v.incompleteReason ?? null,
  lastUsedBy: v.savedBy,
  lastUsedAt: v.savedAt,
  updatedAt: v.updatedAt,
  jvData: {
    date: v.date || todayIso(),
    preparedBy: v.preparedBy || "",
    notes: v.notes || "",
    creditorAccountCode: v.creditorAccountCode || null,
    debtorAccountCode: v.debtorAccountCode || null,
    lines: Array.isArray(v.lines) ? v.lines : [],
  },
});

export default function JournalVoucherPage() {
  const params = useParams();
  const router = useRouter();
  const documentId = params.documentId as string;
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { suppliers = [] } = useGetSuppliers({ limit: 1000 });

  const [existingData, setExistingData] = useState<any>(null);
  const [vouchers, setVouchers] = useState<any[]>([]);
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
        const [one, list] = await Promise.all([
          request({ path: `/journal-vouchers/${documentId}`, method: "GET", ownError: true }, {}, token),
          request({ path: `/journal-vouchers`, method: "GET", ownError: true }, {}, token),
        ]);
        if (requestFailed(one)) throw new Error(failureLine(one, "Could not load the journal voucher"));
        const v = unwrap(one);
        if (!v?.id) throw new Error("Journal voucher not found");
        if (cancelled) return;
        const navList = listFrom<any>(list, "Could not load the journal voucher list");
        setVouchers(navList.rows);
        setListError(navList.error);
        setExistingData(toExisting(v));
      } catch (e: any) {
        console.error("Error loading journal voucher:", e);
        if (!cancelled) setLoadError(e?.message || "Could not load the journal voucher");
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
    const navList = listFrom<any>(await request({ path: `/journal-vouchers`, method: "GET", ownError: true }, {}, token), "Could not load the journal voucher list");
    setVouchers(navList.rows);
    setListError(navList.error);
  };

  const handleSave = async (data: any) => {
    const token = await getToken();
    if (!token) {
      toast.error("Authentication required");
      throw new Error("Authentication required");
    }
    const jd = data?.jvData || {};
    const lines = (Array.isArray(jd.lines) ? jd.lines : [])
      .filter((l: any) => l.accountCode || parseFloat(String(l.debit)) || parseFloat(String(l.credit)) || l.offset)
      .map((l: any) => ({
        id: l.id,
        accountCode: l.accountCode || null,
        description: l.description || null,
        remarks: l.remarks || null,
        debit: Math.round((parseFloat(String(l.debit)) || 0) * 100) / 100,
        credit: Math.round((parseFloat(String(l.credit)) || 0) * 100) / 100,
        offset: l.offset
          ? {
              // Supplier (AP control) or customer (AR control) — the server reads the party from which id is present.
              party: l.offset.party || (l.offset.customerId ? "customer" : "supplier"),
              supplierId: l.offset.supplierId || null,
              customerId: l.offset.customerId || null,
              rate: Number(l.offset.rate) || 1,
              allocations: (l.offset.allocations || []).map((a: any) => ({ documentId: a.documentId, amount: Number(a.amount) || 0 })),
              updateFx: l.offset.updateFx !== false,
              fxAccountCode: l.offset.fxAccountCode || null,
            }
          : null,
      }));
    const response = await request(
      { path: `/journal-vouchers/${documentId}`, method: "PUT", ownError: true },
      {
        voucherNumber: data?.documentInfo?.documentNumber || data?.name || null,
        date: jd.date,
        preparedBy: jd.preparedBy || null,
        notes: jd.notes || null,
        lines,
      },
      token,
    );
    if (response?.success === false) {
      toast.error(response?.message || "Failed to save journal voucher");
      throw new Error(response?.message || "Failed to save journal voucher");
    }
    const saved = unwrap(response);
    // Re-mount the editor ONLY when the SERVER issued the number (placeholder →
    // real number on the first complete save). A number the user is typing
    // comes back unchanged and must not re-mount — the field lost focus after
    // every autosaved keystroke (guru 2026-11-18: "after the first letter, it
    // saved and pushed me out of the field").
    const typedNumber = String(data?.documentInfo?.documentNumber || data?.name || "").trim();
    if (saved?.voucherNumber && saved.voucherNumber !== existingData?.name && saved.voucherNumber !== typedNumber) {
      toast.info(`Voucher numbered ${saved.voucherNumber}`);
      setExistingData(toExisting(saved));
    }
    if (saved?.id) setVouchers((prev) => prev.map((x: any) => (x.id === saved.id ? { ...x, ...saved } : x)));
    // Posted = confirmed on a complete autosave (2026-11-18): refresh the status
    // pill in place (no re-mount — only the status key changes).
    if (saved?.status && saved.status !== existingData?.status) setExistingData((prev: any) => (prev ? { ...prev, status: saved.status } : prev));
    return saved;
  };

  const savedVouchers = useMemo(() => vouchers.filter((v: any) => v.savedAt || v.id === documentId), [vouchers, documentId]);
  const currentIndex = savedVouchers.findIndex((v: any) => v.id === documentId);
  const goTo = (v: any) => v && router.push(`/portal/accounting/journal-vouchers/${v.id}${typeof window !== "undefined" ? window.location.search : ""}`);

  const suppliersList = useMemo(
    () =>
      (suppliers || []).map((s: any) => ({
        id: s.id,
        supplierCode: s.supplierCode || "",
        customerCode: s.supplierCode || "",
        name: s.name,
        address: s.address || "",
        phone: s.phone || "",
        email: s.email || "",
        currency: s.currency || "SGD",
      })),
    [suppliers],
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
        documentType="JOURNAL_VOUCHER"
        actualDocumentType="JOURNAL_VOUCHER"
        documentId={documentId}
        templateId={existingData.documentTemplateId}
        fieldDefinitions={JV_FIELD_DEFINITIONS}
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
    </>
  );
}
