"use client";

// Manual order flow, DO first (2026-11-13): the DO page's toolbar for a DO on
// an order, like the quotation's. Complete DO (the same 3-way dialog, with the
// unit picker for product lines; a DO with a scheduled job is completed the
// job's way by the server), Customer sign link, Add job (optional, for the
// calendar / a technician), Add service report. Once completed it reads
// Completed, with the way back to the order.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import OfficeCompleteJobDialog from "./OfficeCompleteJobDialog";
import CustomerSignLink from "./CustomerSignLink";
import NewServiceReportDialog from "@/app/portal/maintenance-reports/_components/NewServiceReportDialog";
import UploadServiceReportDialog from "@/app/portal/maintenance-reports/_components/UploadServiceReportDialog";

export default function DoOrderToolbar({ documentId, doName, status, config }: { documentId: string; doName: string | null; status: string; config: any }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const c: any = config || {};
  const completed = String(status || "").startsWith("delivered");
  const [completeOpen, setCompleteOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [srChoose, setSrChoose] = useState(false);
  const [srNew, setSrNew] = useState(false);
  const [srUpload, setSrUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const customer = c.customerId || c.customer?.id ? { id: c.customerId || c.customer?.id, name: c.customerName || c.customer?.name || "" } : null;
  const products = (Array.isArray(c.items) ? c.items : []).filter((it: any) => it?.assetId && !it.inventoryItemId);
  const orderHref = c.orderId ? `/portal/orders/${c.orderId}` : null;

  const addJob = async () => {
    setBusy(true);
    try {
      const token = await getToken();
      const res: any = await request({ path: `/deliveries/order-dos/${documentId}/job`, method: "POST" }, {}, token ?? undefined);
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
      {orderHref && (
        <Button size="small" variant="text" startIcon={<ArrowBackIcon />} onClick={() => router.push(orderHref)} data-tour="do-back-to-order">
          Back to order {c.orderNo || ""}
        </Button>
      )}
      {completed ? (
        <Chip color="success" icon={<CheckCircleIcon />} label="Completed" data-tour="do-completed" />
      ) : (
        <>
          <Button size="small" variant="outlined" onClick={() => setSrChoose(true)} data-tour="do-add-service-report">
            Add service report
          </Button>
          <Button size="small" variant="outlined" disabled={busy} onClick={() => void addJob()} data-tour="do-add-job">
            Add job
          </Button>
          <Button size="small" variant="outlined" onClick={() => setLinkOpen(true)} data-tour="do-sign-link">
            Customer sign link
          </Button>
          <Button size="small" variant="contained" disableElevation onClick={() => setCompleteOpen(true)} data-tour="do-complete">
            Complete DO
          </Button>
        </>
      )}
      {completed && (
        <Button size="small" variant="outlined" onClick={() => setSrChoose(true)} data-tour="do-add-service-report">
          Add service report
        </Button>
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
          onDone={(mode) => {
            setCompleteOpen(false);
            if (mode === "sign_link") setLinkOpen(true);
            else window.location.reload();
          }}
        />
      )}
      <Dialog open={linkOpen} onClose={() => setLinkOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Customer sign link</DialogTitle>
        <DialogContent>
          <CustomerSignLink documentId={documentId} doName={doName} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setLinkOpen(false); window.location.reload(); }}>Close</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={srChoose} onClose={() => setSrChoose(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add a service report</DialogTitle>
        <DialogContent>
          <DialogContentText>Write it here on the WCT form, or upload a report you already have as a file. It is for {doName || "this DO"}.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSrChoose(false)}>Cancel</Button>
          <Button variant="outlined" onClick={() => { setSrChoose(false); setSrUpload(true); }}>
            Upload file
          </Button>
          <Button variant="contained" disableElevation onClick={() => { setSrChoose(false); setSrNew(true); }}>
            Create new
          </Button>
        </DialogActions>
      </Dialog>
      <NewServiceReportDialog open={srNew} onClose={() => setSrNew(false)} prefill={{ customer, doId: documentId }} />
      <UploadServiceReportDialog
        open={srUpload}
        onClose={() => setSrUpload(false)}
        wctOrders
        manualFlow
        prefill={{ customer, doId: documentId }}
        onUploaded={(r) => {
          setSrUpload(false);
          router.push(`/portal/maintenance-reports/${r.id}`);
        }}
      />
    </>
  );
}
