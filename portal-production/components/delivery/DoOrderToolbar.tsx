"use client";

// Manual order flow, DO first (2026-11-13): the DO page's toolbar for a DO on
// an order, like the quotation's. Complete DO (the same 3-way dialog, with the
// unit picker for product lines; a DO with a scheduled job is completed the
// job's way by the server), Customer sign link, Add job (optional, for the
// calendar / a technician). Once completed the buttons go (the title row's
// tag reads Completed), leaving the way back to the order. Service reports are added from the order page only (2026-11-13).

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Button, CircularProgress } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import OfficeCompleteJobDialog from "./OfficeCompleteJobDialog";
import DoSignLinkDialog, { doSignCustomerOf } from "./DoSignLinkDialog";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { showBackToOrder } from "@/helpers/wctDocUi";

export default function DoOrderToolbar({ documentId, doName, status, config }: { documentId: string; doName: string | null; status: string; config: any }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const c: any = config || {};
  const completed = String(status || "").startsWith("delivered");
  // Imported from the old ERP (config.erpImport, 2026-11-19): read-only, no job / sign link / Complete DO.
  const imported = !!c.erpImport?.source;
  const [completeOpen, setCompleteOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // enableWctDocNav: the sign link lives in the toolbar Send menu instead.
  const { isWctDocNavEnabled } = useOrganizationFeatures();
  const customer = c.customerId || c.customer?.id ? { id: c.customerId || c.customer?.id, name: c.customerName || c.customer?.name || "" } : null;
  const products = (Array.isArray(c.items) ? c.items : []).filter((it: any) => it?.assetId && !it.inventoryItemId);
  const orderHref = c.orderId ? `/portal/orders/${c.orderId}` : null;

  const addJob = async () => {
    setBusy(true);
    try {
      const token = await getToken();
      const res: any = await request({ path: `/deliveries/order-dos/${documentId}/job`, method: "POST", ownError: true }, {}, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not add the job");
      const r = res?.data ?? res;
      if (r?.id) router.push(`/portal/deliveries/${r.id}?open=schedule`);
    } catch (e: any) {
      toast.error(e?.message || "Could not add the job");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* enableWctDocNav: no "Back to order" (the editor's left Back returns to the order). */}
      {orderHref && showBackToOrder(isWctDocNavEnabled) && (
        <Button size="small" variant="text" startIcon={<ArrowBackIcon />} onClick={() => router.push(orderHref)} data-tour="do-back-to-order">
          Back to order {c.orderNo || ""}
        </Button>
      )}
      {/* A completed DO shows nothing here: its Completed tag sits beside the
          DO number in the title row (guru 2026-11-18, "remove the status on the
          right cos we added the left one"). */}
      {!completed && !imported && (
        <>
          <Button size="small" variant="outlined" disabled={busy} onClick={() => void addJob()} data-tour="do-add-job">
            Add job
          </Button>
          {/* enableWctDocNav (2026-11-25): Send (toolbar Send menu) + Confirm (DoConfirmButton), like the quotation. */}
          {!isWctDocNavEnabled && (
            <>
              <Button size="small" variant="outlined" onClick={() => setLinkOpen(true)} data-tour="do-sign-link">
                Send for signature
              </Button>
              <Button size="small" variant="contained" disableElevation onClick={() => setCompleteOpen(true)} data-tour="do-complete">
                Complete DO
              </Button>
            </>
          )}
        </>
      )}

      {completeOpen && (
        <OfficeCompleteJobDialog
          open
          onClose={() => setCompleteOpen(false)}
          deliveryId=""
          doId={documentId}
          jobLabel={doName || "the DO"}
          defaultName={customer?.name ?? null}
          productSlots={products.map((p: any) => ({ assetId: p.assetId, name: String(p.description || p.itemCode || "Product"), quantity: 1 }))}
          signCustomer={doSignCustomerOf(c)}
          onDone={() => {
            setCompleteOpen(false);
            window.location.reload();
          }}
        />
      )}
      <DoSignLinkDialog open={linkOpen} documentId={documentId} doName={doName} customer={doSignCustomerOf(c)} onClose={() => setLinkOpen(false)} />
    </>
  );
}

/**
 * The DO toolbar's "Confirm" (manual order flow + enableWctDocNav, 2026-11-25), like the quotation's: completes
 * the DO without a signature in one click. A DO with product lines first asks for their units (the same dialog).
 */
export function DoConfirmButton({ documentId, doName, config, onDone, sx }: { documentId: string; doName: string | null; config: any; onDone?: () => void; sx?: any }) {
  const { getToken } = useAuth();
  const c: any = config || {};
  const [busy, setBusy] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const products = (Array.isArray(c.items) ? c.items : []).filter((it: any) => it?.assetId && !it.inventoryItemId);
  const done = () => (onDone ? onDone() : window.location.reload());
  const confirm = async () => {
    if (products.length) {
      setUnitsOpen(true);
      return;
    }
    setBusy(true);
    try {
      const token = await getToken();
      const res: any = await request({ path: `/deliveries/order-dos/${documentId}/complete`, method: "POST", ownError: true }, { mode: "confirm" }, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not confirm the DO");
      toast.success(`${doName || "The DO"} is completed`);
      done();
    } catch (e: any) {
      toast.error(e?.message || "Could not confirm the DO");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        size="small"
        variant="contained"
        disableElevation
        startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <CheckCircleIcon />}
        disabled={busy}
        onClick={() => void confirm()}
        sx={sx ?? { bgcolor: "#15803D", color: "#fff", "&:hover": { bgcolor: "#116632" } }}
        data-tour="do-confirm"
        data-hotkey="confirm"
      >
        Confirm
      </Button>
      {unitsOpen && (
        <OfficeCompleteJobDialog
          open
          onClose={() => setUnitsOpen(false)}
          deliveryId=""
          doId={documentId}
          jobLabel={doName || "the DO"}
          productSlots={products.map((p: any) => ({ assetId: p.assetId, name: String(p.description || p.itemCode || "Product"), quantity: 1 }))}
          signCustomer={doSignCustomerOf(c)}
          onDone={() => {
            setUnitsOpen(false);
            done();
          }}
        />
      )}
    </>
  );
}

/** The DO ⋮ menu's "Attach signed copy" (manual order flow, 2026-11-25): attaching the signed copy completes the DO. */
export function DoAttachSignedDialog({ open, documentId, doName, config, onClose }: { open: boolean; documentId: string; doName: string | null; config: any; onClose: () => void }) {
  if (!open) return null;
  const c: any = config || {};
  const products = (Array.isArray(c.items) ? c.items : []).filter((it: any) => it?.assetId && !it.inventoryItemId);
  return (
    <OfficeCompleteJobDialog
      open
      onClose={onClose}
      deliveryId=""
      doId={documentId}
      jobLabel={doName || "the DO"}
      initialMode="stamped_do"
      productSlots={products.map((p: any) => ({ assetId: p.assetId, name: String(p.description || p.itemCode || "Product"), quantity: 1 }))}
      onDone={() => window.location.reload()}
    />
  );
}
