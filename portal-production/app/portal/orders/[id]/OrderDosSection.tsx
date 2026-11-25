"use client";

// Manual order flow, DO first (2026-11-13): a DO is completed on its own
// (Complete DO: sign here / upload the signed DO / sign link); a job is optional
// (calendar, a technician) and is completed on its job page as before.
// 2026-11-17: the "Delivery orders" section is gone; the DOs are rows of the
// order page's Documents table (OrderPageLayout, round 24), with "Add DO" in the actions row
// and this menu on each DO row, anchored to the click position.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Menu, MenuItem } from "@mui/material";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";

export interface OrderDo {
  id: string;
  name: string | null;
  status: string;
  templateId: string | null;
  tag?: string | null;
  date?: string | null;
  completed: boolean;
  awaitingSignature: boolean;
  /** The uploaded signed / stamped DO (completed by upload), for the FILE column. */
  stampedFileKey?: string | null;
  invoiceId: string | null;
  hasProducts: boolean;
  /** Product rows without a unit yet: Complete DO picks one unit each. */
  products?: { assetId: string; name: string }[];
  jobs: { id: string; deliveryNumber: number; status: string; isDraft: boolean; scheduledFor?: string | null; verificationState?: string | null }[];
}

/** POST with a toast on failure; returns the API's data, or null. */
function usePost() {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const post = async (path: string, what: string) => {
    setBusy(what);
    try {
      const token = await getToken();
      const res: any = await request({ path, method: "POST", ownError: true }, {}, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || `Could not ${what}`);
      return res?.data ?? res;
    } catch (e: any) {
      toast.error(e?.message || `Could not ${what}`);
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { post, busy };
}

/** "Add DO": a draft DO prefilled with what is still to deliver. */
export function useAddDo(orderId: string, onReload: () => Promise<void> | void) {
  const { post, busy } = usePost();
  const addDo = async () => {
    const r = await post(`/deliveries/order/${orderId}/dos`, "add the DO");
    if (r) {
      // Empty when everything quoted is already on a DO.
      if (r.note) toast.info(`${r.doName || "A draft DO"} added. ${r.note}`);
      else toast.success(`${r.doName || "A draft DO"} added with what is still to deliver`);
      await onReload();
    }
  };
  return { addDo, adding: !!busy };
}

/** A DO row's menu: View DO, Complete DO, Add job, Customer sign link (service reports: the order's Service report step). */
export function OrderDoMenu({
  menu,
  onClose,
  cancelled,
  onCompleteDo,
  onUploadDo,
  onSignLink,
  extra,
}: {
  menu: { pos: { left: number; top: number }; d: OrderDo } | null;
  onClose: () => void;
  cancelled: boolean;
  onCompleteDo: (d: OrderDo) => void;
  /** 2026-11-23: Complete DO opened on its "Upload signed DO" way (the DO page's upload, same flow). */
  onUploadDo?: (d: OrderDo) => void;
  onSignLink: (d: OrderDo) => void;
  /** Round 24: the order page's row items after the DO's own (Unlink from order, Delete); an array, never a Fragment. */
  extra?: React.ReactNode[];
}) {
  const router = useRouter();
  const { post } = usePost();
  const addJob = async (d: OrderDo) => {
    onClose();
    const r = await post(`/deliveries/order-dos/${d.id}/job`, "add the job");
    if (r?.id) router.push(`/portal/deliveries/${r.id}?open=schedule`);
  };
  const open = !!menu;
  const d = menu?.d;
  return (
    <Menu open={open} onClose={onClose} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
      {d && d.templateId && (
        <MenuItem onClick={() => { onClose(); router.push(`/portal/documents/DELIVERY_ORDER/${d.templateId}/${d.id}`); }}>View DO</MenuItem>
      )}
      {d && !d.completed && !cancelled && (
        <MenuItem onClick={() => { onClose(); onCompleteDo(d); }} data-tour="wct-order-complete-do">
          Complete DO
        </MenuItem>
      )}
      {d && !d.completed && !cancelled && onUploadDo && (
        <MenuItem onClick={() => { onClose(); onUploadDo(d); }} data-tour="wct-order-upload-do">
          Attach signed copy
        </MenuItem>
      )}
      {d && !d.completed && !cancelled && <MenuItem onClick={() => void addJob(d)}>Add job</MenuItem>}
      {d && !d.completed && !cancelled && (
        <MenuItem onClick={() => { onClose(); onSignLink(d); }}>Send for signature</MenuItem>
      )}
      {extra}
    </Menu>
  );
}
