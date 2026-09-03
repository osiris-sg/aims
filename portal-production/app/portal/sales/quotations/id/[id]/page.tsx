"use client";

// Interior-design quotation editor (feature flag enableIdQuotation).
// Layout: sticky header bar · left outline rail · sectioned canvas · sticky
// summary. State is one `IdQuote` tree saved into Document.config.quote
// (plus a flattened config.items[] for downstream features), autosaved with
// optimistic concurrency. ⌘K opens the work-library palette.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, Paper, Stack, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import MergeIcon from "@mui/icons-material/CallMergeRounded";
import { toast } from "react-toastify";
import { useIdQuoteApi, ApiError } from "../_lib/api";
import type { IdQuote, QuoteDocument, QuoteItem, QuoteSection, WorkItem, WorkSection } from "../_lib/types";
import { defaultQuote, emptyItem, emptySection, normalizeQuote, sectionFromPreset } from "../_lib/defaults";
import { flattenItems, itemAmount, itemCost, quoteTotals } from "../_lib/math";
import HeaderBar, { type SaveState } from "../_components/HeaderBar";
import DetailsCard from "../_components/DetailsCard";
import OutlineRail from "../_components/OutlineRail";
import SectionCard from "../_components/SectionCard";
import LibraryPalette from "../_components/LibraryPalette";
import SummaryPanel from "../_components/SummaryPanel";
import TermsDialog from "../_components/TermsDialog";
import PreviewDialog from "../_components/PreviewDialog";
import SignLinkDialog from "../_components/SignLinkDialog";
import DesignerSignDialog from "../_components/DesignerSignDialog";

const RAIL_W = 264;
const INTERNAL_KEY = "aims-idq-internal-view";

export default function IdQuotationEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const api = useIdQuoteApi();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("md"));

  const [doc, setDoc] = useState<QuoteDocument | null>(null);
  const [quote, setQuote] = useState<IdQuote>(defaultQuote());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [internalView, setInternalView] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [presets, setPresets] = useState<WorkSection[]>([]);
  const [library, setLibrary] = useState<WorkItem[]>([]);
  const [palette, setPalette] = useState<{ sectionId: string; areaId: string } | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRev, setPreviewRev] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [customer, setCustomer] = useState<any | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [designerSignOpen, setDesignerSignOpen] = useState(false);
  const [signedBy, setSignedBy] = useState<{ name: string | null; signedAt: string } | null>(null);
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [undoLen, setUndoLen] = useState(0);
  const undoRef = useRef<IdQuote[]>([]);
  const lastPickRef = useRef<string | null>(null);

  const versionRef = useRef<number>(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const alertedRef = useRef<string | null>(null);
  const quoteRef = useRef(quote);
  quoteRef.current = quote;

  const readOnly = doc?.status === "confirmed";
  const designerSigned = !!(doc?.config?.designerSignature);

  // ── load ──────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      setInternalView(window.localStorage.getItem(INTERNAL_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [d, secs, items] = await Promise.all([api.getDocument(id), api.listSections().catch(() => []), api.listWorkItems().catch(() => [])]);
        if (cancelled) return;
        setDoc(d);
        versionRef.current = d.version ?? 0;
        const q = normalizeQuote(d.config?.quote);
        // First open of a blank quote: pre-fill from the document's customer (if any).
        if (!d.config?.quote && d.config?.customer?.name) q.header.clientName = d.config.customer.name;
        setQuote(q);
        setActiveSectionId(q.sections[0]?.id || null);
        setPresets(secs);
        setLibrary(items);
      } catch (e: any) {
        if (!cancelled) setLoadError(e.message || "Failed to load quotation");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, api]);

  // ── signature + project status (refreshed on load and when the tab regains focus,
  //    so a client signing on their phone shows up without a manual reload) ───────
  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.signLinkStatus(id);
      setSignedBy(s.signed ? { name: s.signed.signerName, signedAt: s.signed.signedAt } : null);
      if (s.signed) {
        // Signing confirms + links a project server-side — pull the fresh document.
        const d = await api.getDocument(id);
        setDoc((prev) => (prev && prev.status !== d.status ? { ...prev, status: d.status, name: d.name, projectId: d.projectId, config: d.config } : prev ? { ...prev, name: d.name, projectId: d.projectId } : d));
        versionRef.current = d.version ?? versionRef.current;
        if (d.projectId) {
          const p = await api.getProject(d.projectId).catch(() => null);
          if (p) setProject({ id: d.projectId, name: p.name || p.project?.name || "Project" });
        }
      }
    } catch {
      /* status is best-effort */
    }
  }, [api, id]);

  useEffect(() => {
    if (!doc) return;
    refreshStatus();
    if (doc.projectId && !project) {
      api
        .getProject(doc.projectId)
        .then((p) => p && setProject({ id: doc.projectId!, name: p.name || p.project?.name || "Project" }))
        .catch(() => {});
    }
    const onFocus = () => refreshStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, doc?.projectId]);

  // ── save (debounced autosave + explicit) ──────────────────────────────
  const buildConfig = useCallback(
    (q: IdQuote) => {
      const base = doc?.config || {};
      const totals = quoteTotals(q);
      return {
        ...base,
        templateVariant: "ID",
        quote: q,
        items: flattenItems(q),
        customer: { ...(base.customer || {}), ...(customer ? { id: customer.id, customerCode: customer.customerCode } : {}), name: q.header.clientName, address: q.header.address, phone: q.header.contact },
        customerId: customer?.id ?? base.customerId ?? null,
        customerName: q.header.clientName,
        documentInfo: {
          ...(base.documentInfo || {}),
          // An edited Contract Number wins over the stored name: updateDocument()
          // copies documentInfo.documentNumber into Document.name, so sourcing
          // doc?.name first would clobber the user's input on the next autosave.
          documentNumber: q.header.contractNo?.trim() || doc?.name || base.documentInfo?.documentNumber,
          date: q.header.agreementDate,
          subject: q.header.title,
          paymentTerms: q.header.paymentTerms,
          currency: "SGD",
          taxApplicable: false,
          discountAmount: totals.discountTotal,
          grandTotal: totals.grand,
        },
        designer: q.header.designer,
      };
    },
    [doc, customer],
  );

  const save = useCallback(
    async (opts: { status?: string } = {}) => {
      if (!doc || savingRef.current) return false;
      savingRef.current = true;
      setSaveState("saving");
      const q = quoteRef.current;
      try {
        const payload: any = { id: doc.id, type: doc.type, version: versionRef.current };
        if (opts.status) payload.status = opts.status;
        else payload.config = buildConfig(q);
        const res = await api.saveDocument(payload);
        versionRef.current = typeof res?.version === "number" ? res.version : versionRef.current + 1;
        dirtyRef.current = false;
        setSaveState("saved");
        setPreviewRev((r) => r + 1);
        if (opts.status) setDoc((d) => (d ? { ...d, status: opts.status! } : d));
        // Margin guardrail → notify management once per distinct breach.
        const t = quoteTotals(q);
        if (t.breach) {
          const sig = `${t.marginPct?.toFixed(1)}|${t.lowLines.map((l) => l.itemId).join(",")}`;
          if (alertedRef.current !== sig) {
            alertedRef.current = sig;
            api.marginAlert(doc.id, { marginPct: t.marginPct, floorPct: q.settings.marginFloorPct, lines: t.lowLines.map((l) => `${l.sectionLetter}${l.no} ${l.marginPct.toFixed(1)}%`) }).catch(() => {});
          }
        }
        return true;
      } catch (e: any) {
        if (e instanceof ApiError && e.status === 409) setSaveState("conflict");
        else {
          setSaveState("error");
          toast.error(e.message || "Save failed");
        }
        return false;
      } finally {
        savingRef.current = false;
      }
    },
    [api, doc, buildConfig],
  );

  const update = useCallback(
    (next: IdQuote | ((q: IdQuote) => IdQuote)) => {
      if (readOnly) return;
      const cur = quoteRef.current;
      const val = typeof next === "function" ? (next as (q: IdQuote) => IdQuote)(cur) : next;
      if (val === cur) return;
      // Undo history (CIEL 09-01): every edit pushes the previous tree.
      undoRef.current.push(cur);
      if (undoRef.current.length > 60) undoRef.current.shift();
      setUndoLen(undoRef.current.length);
      setQuote(val);
      dirtyRef.current = true;
      setSaveState((s) => (s === "conflict" ? s : "dirty"));
    },
    [readOnly],
  );

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    setUndoLen(undoRef.current.length);
    setQuote(prev);
    dirtyRef.current = true;
    setSaveState((s) => (s === "conflict" ? s : "dirty"));
  }, []);

  // ⌘Z / Ctrl+Z outside text fields → editor-level undo (inside a field the
  // browser's own text undo must keep working).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [undo]);

  useEffect(() => {
    if (!dirtyRef.current || saveState === "conflict") return;
    const t = setTimeout(() => {
      if (dirtyRef.current) save();
    }, 1200);
    return () => clearTimeout(t);
  }, [quote, save, saveState]);

  // Save on tab close / navigation away.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // ⌘K / Ctrl+K → library palette on the active section's first area.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (readOnly) return;
        const s = quoteRef.current.sections.find((x) => x.id === activeSectionId) || quoteRef.current.sections[0];
        if (s) setPalette({ sectionId: s.id, areaId: s.areas[0]?.id });
        else toast.info("Add a section first (left rail)");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [activeSectionId, readOnly]);

  // ── section helpers ───────────────────────────────────────────────────
  const setSection = (next: QuoteSection) => update((q) => ({ ...q, sections: q.sections.map((s) => (s.id === next.id ? next : s)) }));
  const removeSection = (sid: string) => update((q) => ({ ...q, sections: q.sections.filter((s) => s.id !== sid) }));
  const reorderSections = (orderedIds: string[]) =>
    update((q) => {
      const byId = new Map(q.sections.map((s) => [s.id, s]));
      const next = orderedIds.map((id) => byId.get(id)).filter(Boolean) as QuoteSection[];
      // Keep any section the id list somehow missed (defensive).
      for (const s of q.sections) if (!next.includes(s)) next.push(s);
      return { ...q, sections: next };
    });
  const nextLetter = (q: IdQuote) => String.fromCharCode(65 + Math.min(q.sections.length, 25));
  const addPreset = (ws: WorkSection) => {
    const s = sectionFromPreset(ws);
    update((q) => ({ ...q, sections: [...q.sections, { ...s, letter: s.letter || nextLetter(q) }] }));
    setActiveSectionId(s.id);
    setTimeout(() => jump(s.id), 50);
  };
  const addCustom = () => {
    const s = emptySection(nextLetter(quoteRef.current));
    update((q) => ({ ...q, sections: [...q.sections, s] }));
    setActiveSectionId(s.id);
    setTimeout(() => jump(s.id), 50);
  };
  const jump = (sid: string) => {
    setActiveSectionId(sid);
    setRailOpen(false);
    document.getElementById(`idq-section-${sid}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const jumpToItem = (itemId: string) => {
    const s = quote.sections.find((x) => x.areas.some((a) => a.items.some((it) => it.id === itemId)));
    if (s) jump(s.id);
  };
  const addItemToArea = (sectionId: string, areaId: string, item: QuoteItem) =>
    update((q) => ({
      ...q,
      sections: q.sections.map((s) => (s.id !== sectionId ? s : { ...s, areas: s.areas.map((a) => (a.id !== areaId ? a : { ...a, items: [...a.items, item] })) })),
    }));

  // ── line selection (checkboxes; shift-click extends the range) ────────
  const allItemIds = useMemo(() => quote.sections.flatMap((s) => s.areas.flatMap((a) => a.items.map((it) => it.id))), [quote]);
  useEffect(() => {
    // Drop ids that no longer exist (deleted / unbundled elsewhere).
    setSelected((prev) => {
      const live = new Set(allItemIds);
      const next = new Set(Array.from(prev).filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [allItemIds]);
  const toggleSelect = useCallback(
    (itemId: string, shift: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const anchor = lastPickRef.current;
        if (shift && anchor && anchor !== itemId) {
          const a = allItemIds.indexOf(anchor);
          const b = allItemIds.indexOf(itemId);
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            const turnOn = !prev.has(itemId);
            for (let i = lo; i <= hi; i++) {
              if (turnOn) next.add(allItemIds[i]);
              else next.delete(allItemIds[i]);
            }
            lastPickRef.current = itemId;
            return next;
          }
        }
        if (next.has(itemId)) next.delete(itemId);
        else next.add(itemId);
        lastPickRef.current = itemId;
        return next;
      });
    },
    [allItemIds],
  );
  const deleteSelected = () => {
    update((q) => ({
      ...q,
      sections: q.sections.map((s) => ({ ...s, areas: s.areas.map((a) => ({ ...a, items: a.items.filter((it) => !selected.has(it.id)) })) })),
    }));
    setSelected(new Set());
  };
  // Lump sum (CIEL 09-01): combine ticked lines in ONE area into a single
  // client-facing line; the originals ride along as `components` (internal).
  const lumpTarget = useMemo(() => {
    if (selected.size < 2) return null;
    for (const s of quote.sections)
      for (const a of s.areas) {
        const inArea = a.items.filter((it) => selected.has(it.id));
        if (inArea.length === selected.size) return { sectionId: s.id, areaId: a.id };
        if (inArea.length > 0) return null; // spread across areas
      }
    return null;
  }, [selected, quote]);
  const combineSelected = () => {
    if (!lumpTarget) return;
    update((q) => ({
      ...q,
      sections: q.sections.map((s) => {
        if (s.id !== lumpTarget.sectionId) return s;
        return {
          ...s,
          areas: s.areas.map((a) => {
            if (a.id !== lumpTarget.areaId) return a;
            const picked = a.items.filter((it) => selected.has(it.id));
            const sumAmount = picked.reduce((x, it) => x + itemAmount(it), 0);
            const sumCost = picked.reduce((x, it) => x + itemCost(it), 0);
            const lump = emptyItem({
              description: `Supply & install works package (${picked.length} items)`,
              qty: 1,
              uom: "lot",
              pricingMode: "priced",
              amount: Math.round(sumAmount * 100) / 100,
              cost: picked.some((it) => it.cost != null || it.includes.some((i) => i.cost != null)) ? Math.round(sumCost * 100) / 100 : null,
              includes: [],
              components: picked,
            });
            const firstIdx = a.items.findIndex((it) => selected.has(it.id));
            const items = a.items.filter((it) => !selected.has(it.id));
            items.splice(firstIdx, 0, lump);
            return { ...a, items };
          }),
        };
      }),
    }));
    setSelected(new Set());
    toast.success("Combined into one lump-sum line — the client sees a single amount; open the chip to see or unbundle the lines inside");
  };

  const onConfirm = async () => {
    setConfirmOpen(false);
    const ok = dirtyRef.current ? await save() : true;
    if (!ok) return;
    const done = await save({ status: "confirmed" });
    if (!done) return;
    // Every accepted quotation lands on a project (created from client + site).
    try {
      const p = await api.ensureProject(doc!.id);
      setProject({ id: p.projectId, name: p.name });
      setDoc((d) => (d ? { ...d, projectId: p.projectId } : d));
      toast.success(p.created ? `Quotation confirmed — project "${p.name}" created` : "Quotation confirmed");
    } catch (e: any) {
      toast.warn(`Confirmed, but the project could not be created: ${e.message || "unknown error"}`);
    }
    // Confirm allocates the contract number server-side — pull it in.
    try {
      const fresh = await api.getDocument(doc!.id);
      setDoc((d) => (d ? { ...d, name: fresh.name, status: fresh.status, projectId: fresh.projectId ?? d.projectId, config: fresh.config } : fresh));
      versionRef.current = fresh.version ?? versionRef.current;
    } catch {
      /* display-only refresh */
    }
  };

  const totals = useMemo(() => quoteTotals(quote), [quote]);
  const paletteSection = palette ? quote.sections.find((s) => s.id === palette.sectionId) : null;

  // ── render ────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">{loadError}</Alert>
      </Box>
    );
  }
  if (!doc) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  const rail = (
    <OutlineRail
      sections={quote.sections}
      presets={presets}
      activeId={activeSectionId}
      internalView={internalView}
      readOnly={readOnly}
      onJump={jump}
      onReorder={reorderSections}
      onAddPreset={addPreset}
      onAddCustom={addCustom}
    />
  );

  return (
    <Box sx={{ minHeight: "100%", width: "100%", maxWidth: "100%", overflowX: "hidden", bgcolor: "background.default" }}>
      <HeaderBar
        number={doc.name}
        clientName={quote.header.clientName}
        status={doc.status}
        saveState={saveState}
        internalView={internalView}
        onInternalView={(v) => {
          setInternalView(v);
          try {
            window.localStorage.setItem(INTERNAL_KEY, v ? "1" : "0");
          } catch {
            /* ignore */
          }
        }}
        readOnly={readOnly}
        onBack={async () => {
          if (dirtyRef.current) await save();
          router.push("/portal/sales/quotations");
        }}
        onPreview={async () => {
          if (dirtyRef.current) await save();
          setPreviewOpen(true);
        }}
        onConfirm={() => setConfirmOpen(true)}
        onSaveNow={() => save()}
        onToggleRail={() => setRailOpen(true)}
        onSendForSignature={async () => {
          if (dirtyRef.current) await save();
          setSignOpen(true);
        }}
        canUndo={undoLen > 0}
        onUndo={undo}
        designerSigned={designerSigned}
        onDesignerSign={signedBy && !designerSigned ? () => setDesignerSignOpen(true) : undefined}
        signedBy={signedBy}
        project={project}
        onOpenProject={() => project && router.push(`/portal/projects/${project.id}`)}
      />

      {saveState === "conflict" && (
        <Alert severity="error" sx={{ borderRadius: 0 }} action={<Button color="inherit" size="small" onClick={() => window.location.reload()}>Reload</Button>}>
          This quotation was updated by someone else. Reload to get the latest version — your unsaved edits here will be lost.
        </Alert>
      )}

      <Box sx={{ display: "flex", alignItems: "flex-start" }}>
        {compact ? (
          <Drawer open={railOpen} onClose={() => setRailOpen(false)} PaperProps={{ sx: { width: RAIL_W } }}>
            {rail}
          </Drawer>
        ) : (
          <Box sx={{ width: RAIL_W, flexShrink: 0, position: "sticky", top: 64, height: "calc(100vh - 64px)", borderRight: 1, borderColor: "divider", bgcolor: "background.paper" }}>{rail}</Box>
        )}

        <Box sx={{ flex: 1, minWidth: 0, maxWidth: "100%", p: { xs: 1.5, md: 3 }, display: "grid", gridTemplateColumns: { xs: "minmax(0,1fr)", xl: "minmax(0,1fr) 300px" }, gap: 2.5, alignItems: "start" }}>
          <Stack spacing={2} sx={{ minWidth: 0 }}>
            <DetailsCard header={quote.header} contractNo={doc.name} readOnly={readOnly} onChange={(patch) => update((q) => ({ ...q, header: { ...q.header, ...patch } }))} onCustomerPicked={setCustomer} />

            {quote.sections.length === 0 && (
              <Paper variant="outlined" sx={{ p: 4, textAlign: "center", borderStyle: "dashed", borderRadius: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Start with a section
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
                  Quotations are organised by trade — Hacking &amp; Dismantling, Masonry, Ceiling, Carpentry… Pick one from the left rail, then add rooms and lines.
                </Typography>
                <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
                  {presets.slice(0, 6).map((p) => (
                    <Button key={p.id} size="small" variant="outlined" onClick={() => addPreset(p)} sx={{ textTransform: "none" }}>
                      {p.letter} · {p.title}
                    </Button>
                  ))}
                </Stack>
              </Paper>
            )}

            {quote.sections.map((s) => (
              <SectionCard
                key={s.id}
                section={s}
                internalView={internalView}
                readOnly={readOnly}
                guidelinePct={quote.settings.marginGuidelinePct}
                floorPct={quote.settings.marginFloorPct}
                active={s.id === activeSectionId}
                selectedIds={selected}
                onToggleSelect={toggleSelect}
                onChange={setSection}
                onRemove={() => removeSection(s.id)}
                onOpenLibrary={(areaId) => setPalette({ sectionId: s.id, areaId })}
                onFocus={() => setActiveSectionId(s.id)}
              />
            ))}

            {quote.sections.length > 0 && (
              <Typography variant="caption" sx={{ color: "text.disabled", textAlign: "center" }}>
                Tip: press ⌘K / Ctrl+K anywhere to add from the work library · tick lines to delete or combine them · shift-click ticks a range
              </Typography>
            )}
          </Stack>

          <SummaryPanel quote={quote} internalView={internalView} readOnly={readOnly} onChange={(n) => update(n)} onEditTerms={() => setTermsOpen(true)} onJumpToItem={jumpToItem} />
        </Box>
      </Box>

      {selected.size > 0 && !readOnly && (
        <Paper elevation={8} sx={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 30, px: 2, py: 1, borderRadius: 3, display: "flex", gap: 1.5, alignItems: "center" }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {selected.size} selected
          </Typography>
          <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={deleteSelected} sx={{ textTransform: "none" }}>
            Delete
          </Button>
          <Tooltip title={lumpTarget ? "Combine into ONE client-facing line — the client sees a single amount, the lines stay inside for tracking" : "Tick 2 or more lines in the SAME area to combine them"}>
            <span>
              <Button size="small" startIcon={<MergeIcon />} disabled={!lumpTarget} onClick={combineSelected} sx={{ textTransform: "none" }}>
                Lump sum
              </Button>
            </span>
          </Tooltip>
          <Button size="small" onClick={() => setSelected(new Set())} sx={{ textTransform: "none", color: "text.secondary" }}>
            Clear
          </Button>
        </Paper>
      )}

      <LibraryPalette
        open={!!palette}
        items={library}
        sections={presets}
        targetSectionTitle={paletteSection?.title || null}
        guidelinePct={quote.settings.marginGuidelinePct}
        onClose={() => setPalette(null)}
        onPick={(item) => {
          if (palette) addItemToArea(palette.sectionId, palette.areaId, item);
          setPalette(null);
        }}
        onCustom={() => {
          if (palette) addItemToArea(palette.sectionId, palette.areaId, emptyItemSafe());
          setPalette(null);
        }}
      />

      <DesignerSignDialog
        open={designerSignOpen}
        docId={doc.id}
        defaultName={quote.header.designer || ""}
        onClose={() => setDesignerSignOpen(false)}
        onSigned={async () => {
          try {
            const fresh = await api.getDocument(doc.id);
            setDoc(fresh);
            versionRef.current = fresh.version ?? versionRef.current;
            setPreviewRev((r) => r + 1);
          } catch {
            /* display refresh only */
          }
        }}
      />

      <TermsDialog
        open={termsOpen}
        paymentTerms={quote.terms.paymentTerms}
        clauses={quote.terms.clauses}
        readOnly={readOnly}
        onClose={() => setTermsOpen(false)}
        onSave={(paymentTerms, clauses) => {
          update((q) => ({ ...q, terms: { paymentTerms, clauses } }));
          setTermsOpen(false);
        }}
      />

      <PreviewDialog open={previewOpen} documentId={doc.id} revision={previewRev} onClose={() => setPreviewOpen(false)} />

      <SignLinkDialog
        open={signOpen}
        documentId={doc.id}
        documentNumber={doc.name}
        clientName={quote.header.clientName}
        clientPhone={quote.header.contact}
        grandTotal={totals.grand}
        onClose={() => {
          setSignOpen(false);
          refreshStatus();
        }}
      />

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>Confirm this quotation?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Grand total <b>S$ {totals.grand.toLocaleString("en-SG", { minimumFractionDigits: 2 })}</b>
            {totals.marginPct != null && (
              <>
                {" "}· margin <b>{totals.marginPct.toFixed(1)}%</b>
              </>
            )}
          </Typography>
          {totals.breach && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              This quotation is below the {quote.settings.marginFloorPct}% margin floor. Management has been notified.
            </Alert>
          )}
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Use this when the client signed on paper. Once confirmed the quotation is locked (changes go through a Variation Order) and a project is created for this client and site. To collect an electronic signature instead, use "Send for signature".
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={onConfirm}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// A fresh blank line (kept here so the palette's "custom" path doesn't need
// the defaults module's emptyItem import at call time).
function emptyItemSafe(): QuoteItem {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()),
    workItemId: null,
    code: null,
    description: "",
    qty: 1,
    uom: "nos",
    amount: null,
    pricingMode: "priced",
    cost: null,
    includes: [],
  };
}
