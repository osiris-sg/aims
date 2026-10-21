/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// The inbox actions (Confirm / Undo / Not shipment / Ignore / Triage again)
// with their confirmations and toasts — shared by the Inbox page and the Sales
// dashboard (round P). `onChanged` re-fetches whatever the caller shows.

import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type InboxRow } from "../../_lib/api";
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
  return { run, pending: act.isPending, open, setOpen, assign, setAssign, confirm, setConfirm, dialogs };
}
