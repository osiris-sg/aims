"use client";

// One job form (WCT group, 2026-11-24): opens a job in THE job pop-up (the New job form, titled "Edit job", filled
// in), or straight into Complete job. Used by the calendar side panel's Edit / Complete job and by the Jobs list.
// Loads the job as the old job page did (GET /deliveries/:id) so the pop-up also shows its items and proof of job.

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import QuickJobDialog, { type QuickJobEdit } from "./QuickJobDialog";
import OfficeCompleteJobDialog from "@/components/delivery/OfficeCompleteJobDialog";
import { useCalendarApi } from "./calendarAddApi";
import type { JobEditRun } from "./JobEditDetails";

export interface JobEditTarget {
  id: string;
  mode: "edit" | "complete";
  /** Another company's job (group calendar): its company id, so every call goes there. */
  orgId?: string | null;
  createdBy?: string | null;
  /** Repeating jobs (2026-11-25): editing a series ("All events" / "This and following events" of its template). */
  repeat?: { seriesId: string; rrule: string } | null;
}

/** GET /deliveries/:id → the form's edit values (same mapping the old job page used). */
export function jobEditOf(run: any): QuickJobEdit {
  return {
    id: run.id,
    customer: run.customer ? ({ id: run.customer.id, name: run.customer.name, customerCode: run.customer.customerCode ?? null } as any) : null,
    siteAddress: run.siteAddress ?? null,
    scheduledFor: run.scheduledFor ?? null,
    scheduledAllDay: !!run.scheduledAllDay,
    notes: run.notes ?? null,
    ptwStatus: run.ptwStatus ?? null,
    ptwRemark: run.ptwRemark ?? null,
    workers: [
      ...(run.siteclock?.workerId ? [{ id: run.siteclock.workerId, name: run.siteclock.workerName ?? run.siteclock.workerId }] : []),
      ...(Array.isArray(run.crewWorkers) ? run.crewWorkers : []),
    ],
    durationMin: run.siteclock?.durationMin ?? null,
    category: run.jobCategory?.value ?? null,
  };
}

export default function JobEditHost({ target, onClose, onSaved }: { target: JobEditTarget | null; onClose: () => void; onSaved: () => void }) {
  const baseApi = useCalendarApi();
  const api = useCallback(<T = any,>(m: string, p: string, b?: any) => baseApi<T>(m, p, b, target?.orgId ?? null), [baseApi, target?.orgId]);
  const [run, setRun] = useState<any | null>(null);
  const [mode, setMode] = useState<"edit" | "complete" | null>(null);

  const load = useCallback(async () => {
    if (!target) return;
    const r = await api<any>("GET", `/deliveries/${target.id}`);
    if (!r.ok || !r.data) {
      toast.error(r.message || "Couldn't open the job");
      onClose();
      return;
    }
    // Complete job needs the job's own lines (a later job on an order whose DO has them cannot be completed here).
    if (target.mode === "complete" && !(r.data.items ?? []).length) {
      toast.info("This job has no lines of its own: complete its DO from the order page instead");
      setMode("edit");
    }
    setRun(r.data);
  }, [api, target, onClose]);

  useEffect(() => {
    setRun(null);
    setMode(target?.mode ?? null);
    if (target) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, target?.mode]);

  if (!target || !run) return null;
  const done = () => {
    onSaved();
    onClose();
  };
  return (
    <>
      <QuickJobDialog
        open={mode === "edit"}
        onClose={onClose}
        edit={jobEditOf(run)}
        run={run as JobEditRun}
        createdBy={target.createdBy ?? null}
        onRunChanged={() => void load()}
        onComplete={() => setMode("complete")}
        onSaved={() => {
          toast.success("Job saved");
          done();
        }}
        onDeleted={done}
        repeat={target.repeat ?? null}
      />
      {mode === "complete" && (
        <OfficeCompleteJobDialog
          open
          onClose={() => (target.mode === "complete" ? onClose() : setMode("edit"))}
          deliveryId={run.id}
          jobLabel={run.customer?.name ? `the job for ${run.customer.name}` : "the job"}
          productSlots={(run.items ?? [])
            .filter((i: any) => !!i.asset && !i.inventory)
            .map((i: any) => ({ assetId: i.asset.id, name: i.asset.name ?? i.description ?? "Product", quantity: i.quantity ?? 1 }))}
          defaultName={run.customer?.name ?? null}
          // Send for signature (2026-11-25): the job's DO sign link; signing completes the job the on-screen way.
          signDocId={(run.items ?? []).find((i: any) => i.document?.id || i.documentId)?.document?.id ?? (run.items ?? []).find((i: any) => i.documentId)?.documentId ?? null}
          signCustomer={{ name: run.customer?.name ?? null, email: run.customer?.email ?? null, phone: run.customer?.phone ?? null }}
          onDone={done}
        />
      )}
    </>
  );
}
