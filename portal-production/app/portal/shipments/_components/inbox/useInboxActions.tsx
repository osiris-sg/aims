/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// The inbox actions (Confirm / Undo / Not shipment / Ignore / Triage again)
// with their confirmations and toasts — shared by the Inbox page and the Sales
// dashboard (round P). `onChanged` re-fetches whatever the caller shows.

import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type InboxRow, type InboxThread, type OrderSeed, type PiExtraction } from "../../_lib/api";
import OrderFormDialog from "../OrderFormDialog";
import { useTradeMutation } from "../../_lib/hooks";
import { toast } from "../../_lib/toast";
import { acceptedText } from "../../_lib/inbox-text";
import { ConfirmDialog } from "../bits";
import { PickerDialog } from "./InboxPicker";
import { InboxDetailsDialog } from "./InboxDetails";

export type InboxAct = "accept" | "undo" | "dismiss" | "retriage" | "ignore";

export function useInboxActions(onChanged: () => Promise<unknown> | void) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<{ row: InboxRow; act: "undo" | "dismiss" } | null>(null);
  const [open, setOpen] = useState<InboxRow | null>(null);
  const [assign, setAssign] = useState<InboxRow | null>(null);
  // Round Q: "Create order from this thread" — from the thread's PI attachment (the PI extractor) when there is one,
  // else from the thread's keys / subject cues (seed).
  const api = useShipmentsApi();
  const [create, setCreate] = useState<{ prefill: PiExtraction | null; seed: OrderSeed | null } | null>(null);
  const [creating, setCreating] = useState(false);
  const createOrder = async (t: InboxThread) => {
    const withPi = t.messages.find((m) => m.attachments.some((a) => a.docType === "PI" || /\bPI\b|_PI_/i.test(a.name)));
    const seed = t.messages.map((m) => m.backlog?.seed).find(Boolean) ?? null;
    if (withPi) {
      setCreating(true);
      try {
        const pre = await api.inboxPiPrefill(withPi.id);
        setCreate({ prefill: pre, seed });
        return;
      } catch (e: any) {
        toast.error(e?.message || "Could not read the PI — starting from the thread's details");
      } finally {
        setCreating(false);
      }
    }
    setCreate({ prefill: null, seed });
  };
  const act = useTradeMutation((a, v: { id: string; act: InboxAct }): Promise<unknown> =>
    v.act === "accept" ? a.inboxAccept(v.id) : v.act === "undo" ? a.inboxUndo(v.id) : v.act === "dismiss" ? a.inboxDismiss(v.id) : v.act === "ignore" ? a.inboxIgnore(v.id) : a.inboxRetriage(v.id),
  );
  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["trade-inbox"] }), onChanged()]);
  };
  const run = async (row: InboxRow, what: InboxAct) => {
    try {
      const res = (await act.mutateAsync({ id: row.id, act: what })) as InboxRow | undefined;
      toast.success(
        what === "accept" ? acceptedText(res ?? row) : what === "undo" ? "Undone — back to Unprocessed" : what === "dismiss" ? "Removed (not shipment mail)" : what === "ignore" ? "Ignored — kept, nothing filed" : "Triaged again",
      );
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Could not do that");
    }
  };
  const dialogs = (
    <>
      <InboxDetailsDialog
        open={open}
        onClose={() => setOpen(null)}
        onAccept={(r) => void run(r, "accept")}
        onChangeOrder={(r) => setAssign(r)}
        onNotShipment={(r) => setConfirm({ row: r, act: "dismiss" })}
        pending={act.isPending}
        onRowChanged={setOpen}
      />
      <PickerDialog
        row={assign}
        onClose={() => setAssign(null)}
        onDone={async () => {
          setAssign(null);
          await refresh();
        }}
      />
      <OrderFormDialog
        open={!!create}
        onClose={() => setCreate(null)}
        prefill={create?.prefill ?? null}
        seed={create?.seed ?? null}
        onSaved={async () => {
          setCreate(null);
          toast.success("Order created — the thread's emails will match it on the next re-match");
          await refresh();
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.act === "undo" ? "Undo what this email did?" : "Delete this email (not shipment mail)?"}
        body={
          confirm?.act === "undo"
            ? "Its files are removed (steps they completed are reopened), the fields it filled are cleared and its sub-tasks unticked. The email goes back to Unprocessed."
            : "The stored email and its attachments are deleted; only a fingerprint of its Message-ID is kept so it isn't stored again."
        }
        confirmLabel={confirm?.act === "undo" ? "Undo" : "Delete"}
        destructive
        onClose={() => setConfirm(null)}
        onConfirm={() => run(confirm!.row, confirm!.act)}
      />
    </>
  );
  return { run, pending: act.isPending || creating, open, setOpen, assign, setAssign, confirm, setConfirm, createOrder, dialogs };
}
