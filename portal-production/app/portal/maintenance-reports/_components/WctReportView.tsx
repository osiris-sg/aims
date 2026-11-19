"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, ListItemIcon, Menu, MenuItem, Stack, Typography } from "@mui/material";
import PrintIcon from "@mui/icons-material/Print";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import UndoIcon from "@mui/icons-material/Undo";
import CheckIcon from "@mui/icons-material/Check";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import { WCT_MAX_PHOTOS_PER_GRID, wctSlotsFor, type WctDraft } from "@/lib/msr-templates";

/**
 * A WCT service report on the office page (2026-10-27).
 *
 * The WCT paper is drawn ONLY by the server (letterhead on every page, photo
 * pages, the SCDF / NEA advisory, the frequency table) — the same HTML the
 * customer's PDF is printed from. The office sees that HTML in an iframe
 * instead of a second, hand-drawn copy of the paper: what the office sees is
 * what the customer got. Print prints the paper (the plain render, never the
 * edit controls); Download fetches the server's PDF through the authenticated API.
 *
 * EDIT IN PLACE (2026-11-16, a report not completed yet): the server draws the
 * same paper with click targets (GET :id/html?edit=1) and this component wires
 * them inside the iframe: a photo box opens the file picker (add several into
 * an empty box, or replace), each photo has a ⋮ (Replace, Remove, Move earlier
 * / later), the job-type ticks and the ✓ work lines toggle, and Company,
 * Location, Date of Servicing, Remarks and the box captions are typed in place
 * (Enter or leaving the field saves). Changes are batched into one save of the
 * report's draft (PATCH :id/inplace, the same draft the form keeps, so "Continue
 * on the form" picks it up), which returns the redrawn paper. Undo puts back
 * the draft before the last change.
 */

const API = (process.env.NEXT_PUBLIC_BACKEND_API_URL || "").replace(/\/$/, "");
const A4_WIDTH_PX = 794;
const SAVE_DELAY_MS = 700;

type Grid = "before" | "after" | "photos";
type Target = { k: string; g: Grid; i: number; filled: boolean };

const clone = (d: WctDraft): WctDraft => JSON.parse(JSON.stringify(d));

/** The ticked-line default of a section (all of them), from the catalogue. */
function linesOf(d: WctDraft, key: string): number[] {
  const slot = wctSlotsFor({ jobTypes: d.jobTypes, units: d.units }).find((s) => s.key === key);
  return slot ? slot.lines.map((_, i) => i) : [];
}

function gridOf(d: WctDraft, key: string) {
  if (!d.grids[key]) d.grids[key] = { before: [], after: [], photos: [], lines: linesOf(d, key) };
  return d.grids[key];
}

export default function WctReportView({
  reportId,
  reportNumber,
  extraActions,
  editable = false,
}: {
  reportId: string;
  reportNumber: number | null;
  /** Buttons placed before Download PDF / Print (the photos file controls). */
  extraActions?: React.ReactNode;
  /** In-place editing (a WCT report not completed yet). */
  editable?: boolean;
}) {
  const { getToken } = useAuth();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const printRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [height, setHeight] = useState(1123);
  // ── in-place editing state ──
  const [draft, setDraft] = useState<WctDraft | null>(null);
  const draftRef = useRef<WctDraft | null>(null);
  const undoStack = useRef<WctDraft[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [save, setSave] = useState<"idle" | "pending" | "saving" | "saved" | "failed">("idle");
  const [uploading, setUploading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pick = useRef<Target | null>(null);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; t: Target; count: number } | null>(null);

  const api = useCallback(
    async (path: string, method: "GET" | "PATCH", body: any = {}) => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res: any = await request({ path, method, ownError: true }, body, token);
      if (res?.success === false) throw new Error(res?.message || "Something went wrong");
      return res?.data ?? res;
    },
    [getToken],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (editable) {
          const st = await api(`/maintenance-reports/${reportId}/edit-state`, "GET");
          if (cancelled) return;
          draftRef.current = st.draft;
          setDraft(st.draft);
        }
        const res = await api(`/maintenance-reports/${reportId}/html${editable ? "?edit=1" : ""}`, "GET");
        if (cancelled) return;
        const served: string | undefined = res?.html;
        if (!served) throw new Error(res?.message ?? "Could not render the report");
        setHtml(served);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Could not render the report");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId, editable, api]);

  // ── saving: batched, one request (one Activity Log row) per save ──
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const d = draftRef.current;
    if (!d) return;
    setSave("saving");
    try {
      const res = await api(`/maintenance-reports/${reportId}/inplace`, "PATCH", { draft: d });
      if (res?.html) setHtml(res.html);
      setSave("saved");
    } catch (e: any) {
      setSave("failed");
      toast.error(e?.message ?? "Could not save the change");
    }
  }, [api, reportId]);

  const commit = useCallback(
    (change: (d: WctDraft) => void, opts: { now?: boolean } = {}) => {
      const cur = draftRef.current;
      if (!cur) return;
      const next = clone(cur);
      change(next);
      if (JSON.stringify(next) === JSON.stringify(cur)) return;
      undoStack.current.push(cur);
      if (undoStack.current.length > 30) undoStack.current.shift();
      setUndoCount(undoStack.current.length);
      draftRef.current = next;
      setDraft(next);
      setSave("pending");
      if (timer.current) clearTimeout(timer.current);
      if (opts.now) void flush();
      else timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const undo = () => {
    const prev = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (!prev) return;
    draftRef.current = prev;
    setDraft(prev);
    void flush();
  };

  // ── photos ──
  const openPicker = (t: Target) => {
    pick.current = t;
    const input = fileRef.current;
    if (!input) return;
    input.multiple = !t.filled; // add several into an empty box; replace one
    input.value = "";
    input.click();
  };

  const onFiles = async (files: FileList | null) => {
    const t = pick.current;
    if (!t || !files?.length || !draftRef.current) return;
    const cur = gridOf(clone(draftRef.current), t.k)[t.g];
    const room = t.filled ? 1 : Math.max(0, WCT_MAX_PHOTOS_PER_GRID - cur.length);
    const list = Array.from(files).slice(0, room);
    if (!list.length) {
      toast.info(`This box already has the most photos (${WCT_MAX_PHOTOS_PER_GRID}).`);
      return;
    }
    if (files.length > list.length) toast.info(`Only ${list.length} more photo${list.length === 1 ? "" : "s"} fit here (most ${WCT_MAX_PHOTOS_PER_GRID}).`);
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Show them at once in the box while they upload and save.
      const doc = frameRef.current?.contentDocument;
      const slot = doc?.querySelector(`[data-k="${t.k}"][data-g="${t.g}"][data-i="${t.i}"]`) as HTMLElement | null;
      if (slot) {
        slot.classList.remove("empty");
        slot.innerHTML = `<img src="${URL.createObjectURL(list[0])}" alt="" style="width:100%;height:100%;object-fit:cover;opacity:.6" />`;
      }
      const keys: string[] = [];
      for (const f of list) {
        const key = await uploadImage({ blob: f, folderName: "maintenance-reports", token });
        if (!key) throw new Error("Could not upload the photo");
        keys.push(key);
      }
      commit(
        (d) => {
          const arr = gridOf(d, t.k)[t.g];
          if (t.filled) arr[t.i] = keys[0];
          else arr.splice(Math.min(t.i, arr.length), 0, ...keys);
          gridOf(d, t.k)[t.g] = arr.slice(0, WCT_MAX_PHOTOS_PER_GRID);
        },
        { now: true },
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Could not upload the photo");
      void flush(); // redraw as saved
    } finally {
      setUploading(false);
    }
  };

  const photoAction = (kind: "replace" | "remove" | "earlier" | "later") => {
    const m = menu;
    setMenu(null);
    if (!m) return;
    const { t } = m;
    if (kind === "replace") return openPicker({ ...t, filled: true });
    commit(
      (d) => {
        const arr = gridOf(d, t.k)[t.g];
        if (kind === "remove") arr.splice(t.i, 1);
        else {
          const j = kind === "earlier" ? t.i - 1 : t.i + 1;
          if (j < 0 || j >= arr.length) return;
          [arr[t.i], arr[j]] = [arr[j], arr[t.i]];
        }
      },
      { now: true },
    );
  };

  // ── wire the click targets inside the iframe (after every redraw) ──
  const wire = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!editable || !doc || !frame) return;
    const frameRect = () => frame.getBoundingClientRect();
    const style = doc.createElement("style");
    style.textContent = `.ed-dots{top:4px;right:4px;width:24px;height:24px;border-radius:12px;background:rgba(0,0,0,.6);color:#fff;font:700 15px/24px Arial,sans-serif;text-align:center;cursor:pointer;}.ed-dots:hover{background:#1a73e8;}`;
    doc.head.appendChild(style);

    doc.querySelectorAll<HTMLElement>("[data-k][data-g]").forEach((el) => {
      const t: Target = { k: el.dataset.k!, g: el.dataset.g as Grid, i: Number(el.dataset.i), filled: !el.classList.contains("empty") };
      el.title = t.filled ? "Click to replace" : "Click to add photos";
      el.addEventListener("click", () => openPicker(t));
      if (t.filled) {
        const dots = doc.createElement("div");
        dots.className = "ed-ui ed-dots";
        dots.textContent = "⋮";
        dots.title = "More";
        dots.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const r = frameRect();
          const count = gridOf(clone(draftRef.current!), t.k)[t.g].length;
          setMenu({ pos: { left: r.left + ev.clientX, top: r.top + ev.clientY }, t, count });
        });
        el.appendChild(dots);
      }
    });
    doc.querySelectorAll<HTMLElement>("[data-jt]").forEach((el) =>
      el.addEventListener("click", () => {
        const id = el.dataset.jt!;
        commit((d) => {
          d.jobTypes = d.jobTypes.includes(id) ? d.jobTypes.filter((x) => x !== id) : [...d.jobTypes, id];
        });
      }),
    );
    doc.querySelectorAll<HTMLElement>("[data-l]").forEach((el) =>
      el.addEventListener("click", () => {
        const k = el.dataset.k!;
        const i = Number(el.dataset.l);
        commit((d) => {
          const g = gridOf(d, k);
          g.lines = g.lines.includes(i) ? g.lines.filter((x) => x !== i) : [...g.lines, i].sort((a, b) => a - b);
        });
      }),
    );
    // Text typed in place: Enter or leaving the field saves (Shift+Enter: new line in Remarks).
    const typeIn = (el: HTMLElement, multiline: boolean, save: (text: string) => void) => {
      el.addEventListener("click", () => {
        if (el.isContentEditable) return;
        el.contentEditable = "true";
        el.focus();
        const range = doc.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = doc.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      });
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !(multiline && ev.shiftKey)) {
          ev.preventDefault();
          el.blur();
        }
        if (ev.key === "Escape") el.blur();
      });
      el.addEventListener("blur", () => {
        el.contentEditable = "false";
        save((el.innerText ?? "").replace(/ /g, " ").trim());
      });
    };
    doc.querySelectorAll<HTMLElement>("[data-f]").forEach((el) => {
      const f = el.dataset.f as "customerName" | "jobLocation" | "remarks" | "serviceDate";
      if (f === "serviceDate") {
        el.addEventListener("click", () => {
          const input = doc.createElement("input");
          input.type = "date";
          input.className = "ed-ui";
          input.value = el.dataset.v ?? "";
          input.style.cssText = "position:static;font:14px Arial,sans-serif;padding:2px 4px;";
          el.replaceWith(input);
          input.focus();
          const done = () => commit((d) => void (d.serviceDate = input.value || ""), { now: true });
          input.addEventListener("change", done);
          input.addEventListener("blur", () => (input.value === (el.dataset.v ?? "") ? input.replaceWith(el) : undefined));
        });
        return;
      }
      typeIn(el, f === "remarks", (text) => commit((d) => void ((d as any)[f] = text)));
    });
    doc.querySelectorAll<HTMLElement>("[data-label]").forEach((el) =>
      typeIn(el, false, (text) =>
        commit((d) => {
          d.labels = { ...(d.labels ?? {}) };
          if (text) d.labels[el.dataset.label!] = text;
          else delete d.labels[el.dataset.label!];
        }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, commit]);

  // Size the frame to its document so the page scrolls, not the frame.
  const onLoad = () => {
    const doc = frameRef.current?.contentDocument;
    const h = doc?.documentElement?.scrollHeight ?? doc?.body?.scrollHeight;
    if (h && h > 200) setHeight(h + 24);
    wire();
  };

  // Print the paper only: the plain render (no edit controls) in a hidden frame.
  const print = async () => {
    try {
      let plain = html;
      if (editable) {
        if (save === "pending") await flush();
        plain = (await api(`/maintenance-reports/${reportId}/html`, "GET"))?.html ?? null;
      }
      const frame = editable ? printRef.current : frameRef.current;
      if (!frame || !plain) return;
      if (editable) {
        frame.onload = () => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        };
        frame.srcdoc = plain;
      } else {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not print");
    }
  };

  const download = async () => {
    setBusy("Preparing the PDF…");
    setError(null);
    try {
      if (editable && save === "pending") await flush();
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      // Admin "Viewing as org": the API scopes the read to this org.
      try {
        const aorg = window.sessionStorage.getItem("aims-admin-active-org");
        if (aorg) headers["X-Active-Org-Id"] = aorg;
      } catch {
        /* sessionStorage unavailable — plain org read */
      }
      const res = await fetch(`${API}/maintenance-reports/${reportId}/pdf`, { headers });
      if (!res.ok) throw new Error(`Could not download the PDF (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `service-report-${reportNumber != null ? String(reportNumber).padStart(6, "0") : reportId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e: any) {
      setError(e?.message ?? "Could not download the PDF");
    } finally {
      setBusy(null);
    }
  };

  const saveText =
    uploading ? "Uploading…" : save === "saving" || save === "pending" ? "Saving…" : save === "saved" ? "Saved" : save === "failed" ? "Not saved. Check the connection." : "";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center" flexWrap="wrap" useFlexGap sx={{ "@media print": { display: "none" } }}>
        {editable && draft && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mr: "auto" }} data-tour="service-report-edit-in-place">
            {saveText && (
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: save === "failed" ? "error.main" : save === "saved" && !uploading ? "success.main" : "text.secondary" }}>
                {save === "saved" && !uploading ? <CheckIcon fontSize="small" /> : save !== "failed" ? <CircularProgress size={12} /> : null}
                <Typography variant="caption">{saveText}</Typography>
              </Stack>
            )}
            <Button size="small" startIcon={<UndoIcon />} onClick={undo} disabled={!undoCount || uploading} data-tour="service-report-undo">
              Undo
            </Button>
          </Stack>
        )}
        {extraActions}
        <Button variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={download} disabled={!html || !!busy} data-tour="service-report-download-pdf">
          {busy ?? "Download PDF"}
        </Button>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => void print()} disabled={!html} data-tour="service-report-print">
          Print
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {!html && !error && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {html && (
        // White paper on a neutral backdrop in both themes; the frame is the
        // document, so the portal's dark palette never reaches it.
        <Box sx={{ bgcolor: "action.hover", p: { xs: 1, md: 3 }, borderRadius: 1, overflowX: "auto" }}>
          <Box
            component="iframe"
            ref={frameRef}
            title="Service report"
            srcDoc={html}
            onLoad={onLoad}
            sx={{ display: "block", width: A4_WIDTH_PX, maxWidth: "100%", height, border: 0, bgcolor: "#fff", mx: "auto", boxShadow: 3 }}
          />
        </Box>
      )}
      {editable && (
        <>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onFiles(e.target.files)} />
          <iframe ref={printRef} title="Service report print" style={{ position: "absolute", width: 0, height: 0, border: 0, visibility: "hidden" }} />
          <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
            <MenuItem onClick={() => photoAction("replace")}>
              <ListItemIcon>
                <SwapHorizIcon fontSize="small" />
              </ListItemIcon>
              Replace
            </MenuItem>
            <MenuItem onClick={() => photoAction("earlier")} disabled={!menu || menu.t.i === 0}>
              <ListItemIcon>
                <ArrowBackIcon fontSize="small" />
              </ListItemIcon>
              Move to the previous slot
            </MenuItem>
            <MenuItem onClick={() => photoAction("later")} disabled={!menu || menu.t.i >= menu.count - 1}>
              <ListItemIcon>
                <ArrowForwardIcon fontSize="small" />
              </ListItemIcon>
              Move to the next slot
            </MenuItem>
            <MenuItem onClick={() => photoAction("remove")} sx={{ color: "error.main" }}>
              <ListItemIcon>
                <DeleteOutlineIcon fontSize="small" color="error" />
              </ListItemIcon>
              Remove
            </MenuItem>
          </Menu>
        </>
      )}
    </Box>
  );
}
