"use client";
/*
 * Row selection for list tables + the floating BulkActionBar (guru 2026-11-21:
 * "a lot of the checkboxes don't do anything — we need to add bulk actions,
 * all pages need to have them").
 *
 * One hook gives a list page everything the invoices list hand-rolled:
 *   • the selection, keyed by id so it SURVIVES PAGING, and holding the row
 *     objects it has seen so status rules (drafts only, pending only…) work on
 *     server-paged lists where only the current page is in memory;
 *   • a tanstack column with the header checkbox (toggles the CURRENT page)
 *     and the row checkboxes (stopPropagation — the row-click still opens the
 *     record, CLAUDE.md table pattern);
 *   • reset whenever the list is re-scoped (`resetKey`: tab / search / filter
 *     — the rows a user ticked are no longer the rows on screen).
 *
 * Usage:
 *   const bulk = useBulkSelection(pageRows, { resetKey: `${tab}|${search}` });
 *   <PageTable noSelectionColumn columns={[bulk.column, ...columns]} … />
 *   <BulkActionBar count={bulk.count} onClear={bulk.clear} actions={[…]} />
 *   <BulkConfirmDialog … />   // before anything destructive
 *   await runBulk(rows, (r) => api.delete(r.id), { done: (n) => `${n} deleted` });
 *
 * Table.tsx's built-in index-keyed column is gone from PageTable lists (it
 * was the dead checkbox): a list shows checkboxes ONLY through this hook.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import { toast } from "react-toastify";
import BulkActionBar, { type BulkAction } from "./BulkActionBar";
import DeleteIcon from "@mui/icons-material/Delete";

type Options<T> = {
  /** Row id; defaults to `row.id`. */
  getId?: (row: T) => string;
  /** Any value whose change clears the selection (tab, search, filters…). Objects are compared by JSON. */
  resetKey?: unknown;
};

export function useBulkSelection<T extends Record<string, any>>(pageRows: T[], opts: Options<T> = {}) {
  const getIdRef = useRef(opts.getId ?? ((r: T) => String(r.id)));
  getIdRef.current = opts.getId ?? ((r: T) => String(r.id));
  const getId = useCallback((r: T) => getIdRef.current(r), []);

  const [selected, setSelected] = useState<Map<string, T>>(() => new Map());

  const key = typeof opts.resetKey === "string" ? opts.resetKey : JSON.stringify(opts.resetKey ?? null);
  const firstKey = useRef(key);
  useEffect(() => {
    if (firstKey.current === key) return;
    firstKey.current = key;
    setSelected(new Map());
  }, [key]);

  const toggle = useCallback(
    (row: T) =>
      setSelected((prev) => {
        const next = new Map(prev);
        const id = getId(row);
        if (next.has(id)) next.delete(id);
        else next.set(id, row);
        return next;
      }),
    [getId],
  );
  const clear = useCallback(() => setSelected(new Map()), []);
  /** Drop ids that no longer exist (after a bulk delete). */
  const remove = useCallback(
    (ids: Iterable<string>) =>
      setSelected((prev) => {
        const next = new Map(prev);
        for (const id of ids) next.delete(id);
        return next;
      }),
    [],
  );

  const column = useMemo(() => {
    const allChecked = pageRows.length > 0 && pageRows.every((r) => selected.has(getId(r)));
    const someChecked = pageRows.some((r) => selected.has(getId(r)));
    return {
      id: "_select",
      accessorKey: "_select",
      enableSorting: false,
      nowrap: true,
      align: "center" as const,
      pxWidth: 56,
      header: () => (
        <Checkbox
          size="small"
          // p:0 — the fixed 56px cell (minus its 16px side paddings) only leaves ~24px; any padding clips it.
          sx={{ p: 0 }}
          checked={allChecked}
          indeterminate={!allChecked && someChecked}
          onClick={(e) => e.stopPropagation()}
          onChange={() =>
            setSelected((prev) => {
              const next = new Map(prev);
              if (allChecked) pageRows.forEach((r) => next.delete(getId(r)));
              else pageRows.forEach((r) => next.set(getId(r), r));
              return next;
            })
          }
          inputProps={{ "aria-label": "Select all on this page" }}
        />
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => (
        <Checkbox
          size="small"
          sx={{ p: 0 }}
          checked={selected.has(getId(row.original))}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggle(row.original)}
          inputProps={{ "aria-label": "Select row" }}
        />
      ),
    };
  }, [pageRows, selected, getId, toggle]);

  const selectedRows = useMemo(() => Array.from(selected.values()), [selected]);

  return {
    /** Selected ids (survives paging). */
    selectedIds: useMemo(() => new Set(selected.keys()), [selected]),
    /** The selected row objects, as last seen on screen. */
    selectedRows,
    count: selected.size,
    isSelected: (row: T) => selected.has(getId(row)),
    toggle,
    clear,
    remove,
    column,
  };
}

/**
 * Run one request per row, one after another (never in parallel: deletes
 * void journals server-side and a burst risks version conflicts), then say
 * what happened in one toast.
 */
export async function runBulk<T>(
  rows: T[],
  fn: (row: T) => Promise<unknown>,
  msg: { done: (n: number) => string; failed?: (n: number) => string },
): Promise<{ ok: T[]; failed: T[] }> {
  const ok: T[] = [];
  const failed: T[] = [];
  for (const row of rows) {
    try {
      await fn(row);
      ok.push(row);
    } catch (err) {
      console.error("Bulk action failed for", row, err);
      failed.push(row);
    }
  }
  if (ok.length) toast.success(msg.done(ok.length));
  if (failed.length) toast.error(msg.failed ? msg.failed(failed.length) : `${failed.length} could not be processed`);
  return { ok, failed };
}

/** The confirm step before a destructive bulk action. */
export function BulkConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  color = "error",
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  color?: "error" | "primary" | "warning" | "success";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={() => !busy && onCancel()}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{body}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={onConfirm} color={color} variant="contained" disabled={busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Download the PDF of one document, or a ZIP of several, through POST /documents/bulk-download. */
export async function downloadDocumentPdfs(
  ids: string[],
  request: (opts: any, body: any, token?: string) => Promise<any>,
  token: string | null | undefined,
  fallbackName = "documents.zip",
): Promise<void> {
  if (!ids.length) return;
  // Generating many fresh PDFs (Puppeteer) can exceed the 30s default.
  const res = await request({ path: "/documents/bulk-download", method: "POST", timeout: 180000, ownError: true }, { ids }, token ?? undefined);
  const payload = res?.data;
  if (!res?.success || !payload?.base64) throw new Error((!res?.success && res?.message) || "Download failed");
  const bytes = Uint8Array.from(atob(payload.base64), (ch) => ch.charCodeAt(0));
  const blob = new Blob([bytes], { type: payload.mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = payload.filename || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  if (payload.failed?.length) toast.warn(`${payload.failed.length} not included`);
}

/**
 * The whole bar for a list whose bulk action is one destructive verb (Delete /
 * Void / Archive / Cancel): the pill, the confirm dialog, the sequential run.
 * `eligible` keeps the row rule in one place (drafts only, pending only…);
 * rows outside it stay selected but are skipped, and the bar says so.
 */
export function BulkDeleteBar<T extends Record<string, any>>({
  bulk,
  noun,
  plural = `${noun}s`,
  verb = "Delete",
  color = "error",
  run,
  eligible,
  skipNote = "cannot be processed",
  confirmBody,
  onDone,
  before = [],
  icon,
}: {
  bulk: ReturnType<typeof useBulkSelection<T>>;
  noun: string;
  plural?: string;
  verb?: string;
  color?: BulkAction["color"];
  run: (row: T) => Promise<unknown>;
  eligible?: (row: T) => boolean;
  /** "…n selected rows <skipNote>" — why the rest are skipped. */
  skipNote?: string;
  confirmBody?: React.ReactNode;
  onDone?: (ok: T[]) => void;
  /** Extra actions shown before the verb (download, export…). */
  before?: BulkAction[];
  /** The verb's icon (a bin by default). */
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = eligible ? bulk.selectedRows.filter(eligible) : bulk.selectedRows;
  const skipped = bulk.count - rows.length;
  const past = verb.endsWith("e") ? `${verb.toLowerCase()}d` : `${verb.toLowerCase()}ed`;
  const go = async () => {
    setBusy(true);
    const { ok } = await runBulk(rows, run, {
      done: (n) => `${n} ${n === 1 ? noun : plural} ${past}`,
      failed: (n) => `${n} could not be ${past}`,
    });
    bulk.remove(ok.map((r) => String(r.id)));
    setBusy(false);
    setOpen(false);
    onDone?.(ok);
  };
  return (
    <>
      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clear}
        actions={[
          ...before,
          {
            key: verb.toLowerCase(),
            label: rows.length > 0 && skipped > 0 ? `${verb} ${rows.length}` : verb,
            icon: icon ?? <DeleteIcon />,
            color,
            disabled: rows.length === 0 || busy,
            tooltip: rows.length === 0 ? `None of the selected ${plural} ${skipNote}` : skipped > 0 ? `${skipped} selected ${skipped === 1 ? noun : plural} ${skipNote} and will be skipped` : `${verb} the selected ${plural}`,
            onClick: () => setOpen(true),
          },
        ]}
      />
      <BulkConfirmDialog
        open={open}
        title={`${verb} ${rows.length} ${rows.length === 1 ? noun : plural}?`}
        body={
          <>
            {confirmBody ?? "This cannot be undone."}
            {skipped > 0 ? ` ${skipped} selected ${skipped === 1 ? noun : plural} ${skipNote} and will not be touched.` : ""}
          </>
        }
        confirmLabel={busy ? `${verb === "Delete" ? "Deleting" : verb + "ing"}…` : verb}
        color={color === "error" || color === "warning" || color === "primary" || color === "success" ? color : "error"}
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() => void go()}
      />
    </>
  );
}
