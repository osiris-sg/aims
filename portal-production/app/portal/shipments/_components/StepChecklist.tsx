/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Step checklist for a contract or shipment. Steps run in any order and can't
// be skipped; a step can be completed once every required document type is
// covered on this record by a linked file or a linked CONFIRMED in-app
// invoice. Documents ADH makes itself (Customer PL / COA, the ADH 請求書 for
// Invoice #1 / #2, SG→JP invoice & packing list, shipping instructions) offer
// "Create" first: a draft typed in-app, finalized to a PDF that ticks the step.
// Ongoing steps (recurring work) sit in their own section and don't count
// towards progress.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, LinearProgress, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Stack, Tooltip, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import LinkIcon from "@mui/icons-material/Link";
import PostAddIcon from "@mui/icons-material/PostAdd";
import DownloadIcon from "@mui/icons-material/Download";
import { toast } from "../_lib/toast";
import { useShipmentsApi, type BlCheckSummary, type GeneratedDoc, type GenSource, type RecordDocLink, type RecordFileLink, type TradeStep } from "../_lib/api";
import { useDocTypeLabels, useTradeMutation } from "../_lib/hooks";
import { documentHref, fmtDate, fmtDateTime, GENERATED_DOC_TYPES, INVOICE_DOC_TYPES, STEP_STATUS, stepLabel } from "../_lib/format";
import { ConfirmDialog, EmptyState } from "./bits";
import BlCheckPanel, { BlCheckChip } from "./BlCheckPanel";
import FileUploadDialog, { type LinkTarget } from "./FileUploadDialog";
import LinkInvoiceDialog from "./LinkInvoiceDialog";
import { DocLinkChip } from "./LinkedDocuments";

type Action = "start" | "complete" | "reopen";

export default function StepChecklist({
  steps,
  fileLinks,
  docLinks,
  owner,
  recordOpen,
  returnTo,
  generatedDocs = [],
  blCheck = null,
}: {
  steps: TradeStep[];
  /** Files linked to this record (fallback for ✓/✗ when the API sends no requirements). */
  fileLinks: RecordFileLink[];
  /** In-app documents (invoices) linked to this record. */
  docLinks: RecordDocLink[];
  owner: LinkTarget;
  /** Steps can only change while the contract/shipment is OPEN. */
  recordOpen: boolean;
  /** Where the in-app editor / invoice editor's Back returns (this record's Steps tab). */
  returnTo: string;
  /** In-app generated documents on this record (shipment documents, or Invoice #1 on a contract). */
  generatedDocs?: GeneratedDoc[];
  /** Shipment only: the latest AI check of its B/L draft (shown on "Approve B/L draft"). */
  blCheck?: BlCheckSummary | null;
}) {
  const [blOpen, setBlOpen] = useState(false);
  const api = useShipmentsApi();
  // Customer PL / COA chip menu: sources are fetched when it opens (null = loading).
  const [genMenu, setGenMenu] = useState<{ pos: { left: number; top: number }; step: TradeStep; docType: string; sources: GenSource[] | null } | null>(null);
  const [pickSource, setPickSource] = useState<{ step: TradeStep; docType: string; sources: GenSource[] } | null>(null);
  const [creatingGen, setCreatingGen] = useState(false);
  const editorHref = (id: string) => `/portal/trade-documents/generated/${id}?from=${encodeURIComponent(returnTo)}`;
  const createBlank = async (docType: string) => {
    setCreatingGen(true);
    try {
      const g = await api.createBlankGenerated({ docType, ...(owner.kind === "contract" ? { contractId: owner.id } : { shipmentId: owner.id }) });
      router.push(editorHref(g.id));
    } catch (e: any) {
      toast.error(e?.message || "Could not create the document");
    } finally {
      setCreatingGen(false);
    }
  };
  const download = async (id: string) => {
    try {
      await api.downloadGeneratedPdf(id);
    } catch (e: any) {
      toast.error(e?.message || "Could not download the PDF");
    }
  };
  const createGenerated = async (docType: string, sourceFileId: string) => {
    setCreatingGen(true);
    try {
      const g = await api.createGenerated({ shipmentId: owner.id, docType, sourceFileId });
      router.push(editorHref(g.id));
    } catch (e: any) {
      toast.error(e?.message || "Could not create the document");
    } finally {
      setCreatingGen(false);
    }
  };
  const router = useRouter();
  const label = useDocTypeLabels();
  const [upload, setUpload] = useState<{ step: TradeStep; docType: string } | null>(null);
  const [linkExisting, setLinkExisting] = useState<{ step: TradeStep; docType: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Reopening a done step unlocks deleting its files: confirm first.
  const [reopenAsk, setReopenAsk] = useState<TradeStep | null>(null);

  const change = useTradeMutation((api, v: { id: string; action: Action }) =>
    v.action === "start" ? api.startStep(v.id) : v.action === "complete" ? api.completeStep(v.id) : api.reopenStep(v.id),
  );

  // ✓/✗ per required type: the API's requirement status, else files only.
  const haveFile = new Set(fileLinks.map((l) => l.file.docType));
  const reqs = (s: TradeStep) => s.requirements ?? s.requiredDocTypes.map((d) => ({ docType: d, files: haveFile.has(d) ? 1 : 0, documents: 0, satisfied: haveFile.has(d) }));
  const missingOf = (s: TradeStep) => reqs(s).filter((r) => !r.satisfied).map((r) => r.docType);
  // Invoices shown on a step: those created/linked for it, or untagged ones of a type it needs.
  const docsFor = (s: TradeStep) => docLinks.filter((l) => l.stepId === s.id || (!l.stepId && s.requiredDocTypes.includes(l.docType)));

  const sorted = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
  const main = sorted.filter((s) => !s.isOngoing);
  const ongoing = sorted.filter((s) => s.isOngoing);
  const done = main.filter((s) => s.status === "DONE").length;
  // "9. Send arrival notice …": the org's number, else the position among counted steps.
  const titleOf = (s: TradeStep) => stepLabel(s, s.isOngoing ? undefined : main.indexOf(s) + 1);
  const pct = main.length ? Math.round((done / main.length) * 100) : 0;

  const run = async (s: TradeStep, action: Action) => {
    setBusyId(s.id);
    try {
      await change.mutateAsync({ id: s.id, action });
    } catch (e: any) {
      toast.error(e?.message || "Could not update the step");
    } finally {
      setBusyId(null);
    }
  };

  const onMissingChip = (e: React.MouseEvent, s: TradeStep, docType: string) => {
    // Documents ADH makes: "Create" first (+ "Create from Vedanta file" for Customer
    // PL / COA), then upload (and link an existing invoice). Received documents upload.
    if (canCreate(docType)) {
      const pos = { left: e.clientX, top: e.clientY };
      const fromFile = !!GENERATED_DOC_TYPES[docType].source && owner.kind === "shipment";
      setGenMenu({ pos, step: s, docType, sources: fromFile ? null : [] });
      if (fromFile) {
        api
          .generatedSources(owner.id, docType)
          .then((sources) => setGenMenu((m) => (m && m.step.id === s.id && m.docType === docType ? { ...m, sources } : m)))
          .catch(() => setGenMenu((m) => (m ? { ...m, sources: [] } : m)));
      }
    } else setUpload({ step: s, docType });
  };

  const canCreate = (docType: string) => GENERATED_DOC_TYPES[docType]?.scope === owner.kind;

  const row = (s: TradeStep) => {
    const st = STEP_STATUS[s.status] ?? { label: s.status, color: "default" as const };
    const missing = missingOf(s);
    const isDone = s.status === "DONE";
    const busy = busyId === s.id;
    const lockedTip = recordOpen ? "" : "Reopen this record to change its steps";
    const linkedDocs = docsFor(s);
    const genDocs = generatedDocs.filter((g) => s.requiredDocTypes.includes(g.docType));
    const showBl = owner.kind === "shipment" && s.code === "BL_DRAFT_APPROVAL" && !!blCheck;
    return (
      <Box key={s.id} sx={{ py: 1.25, px: { xs: 1, md: 1.5 }, display: "flex", gap: 1.5, alignItems: { xs: "flex-start", md: "center" }, flexDirection: { xs: "column", md: "row" } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {titleOf(s)}
            </Typography>
            <Chip size="small" label={st.label} color={st.color} variant="outlined" />
            {showBl && <BlCheckChip check={blCheck!} onClick={() => setBlOpen((o) => !o)} />}
          </Stack>
          {s.requiredDocTypes.length > 0 && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
              {reqs(s).map((r) => {
                const ok = r.satisfied;
                const canAdd = !ok && recordOpen;
                const create = canCreate(r.docType);
                return (
                  <Chip
                    key={r.docType}
                    size="small"
                    variant="outlined"
                    color={ok ? "success" : "warning"}
                    icon={ok ? <CheckIcon /> : <CloseIcon />}
                    label={label(r.docType)}
                    {...(canAdd
                      ? {
                          clickable: true,
                          title: create ? `Create ${label(r.docType)} in-app, or upload a file` : `Upload ${label(r.docType)}`,
                          onClick: (e: React.MouseEvent) => onMissingChip(e, s, r.docType),
                          onDelete: (e: any) => onMissingChip(e, s, r.docType),
                          deleteIcon: create ? <PostAddIcon /> : <UploadFileIcon />,
                        }
                      : {})}
                  />
                );
              })}
            </Stack>
          )}
          {genDocs.length > 0 && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
              {/* Types a record can hold several of (SG→JP per arrival): create another once one exists. */}
              {recordOpen &&
                s.requiredDocTypes
                  .filter((d) => GENERATED_DOC_TYPES[d]?.multiple && canCreate(d) && genDocs.some((g) => g.docType === d))
                  .map((d) => (
                    <Chip
                      key={`more-${d}`}
                      size="small"
                      variant="outlined"
                      icon={<PostAddIcon />}
                      label={`Another ${label(d)}`}
                      title={`Create another ${label(d)} (e.g. a split arrival)`}
                      clickable
                      disabled={creatingGen}
                      onClick={() => void createBlank(d)}
                    />
                  ))}
              {genDocs.map((g) => (
                <Chip
                  key={g.id}
                  size="small"
                  variant="outlined"
                  color={g.status === "FINAL" ? "info" : "warning"}
                  label={`${g.number ?? label(g.docType)} · ${g.status === "FINAL" ? "Final" : "Draft — finalize to count"}`}
                  onClick={() => router.push(editorHref(g.id))}
                  clickable
                  title="Open the in-app document"
                  deleteIcon={
                    <Tooltip title={g.status === "FINAL" ? "Download PDF" : "Download draft PDF (watermarked)"}>
                      <DownloadIcon aria-label="Download PDF" />
                    </Tooltip>
                  }
                  onDelete={() => void download(g.id)}
                />
              ))}
            </Stack>
          )}
          {linkedDocs.length > 0 && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
              {linkedDocs.map((l) => (
                <DocLinkChip key={l.id} link={l} onClick={l.document ? () => router.push(documentHref(l.document!, returnTo)) : undefined} />
              ))}
            </Stack>
          )}
          {showBl && blOpen && (
            <Box sx={{ mt: 1 }}>
              <BlCheckPanel check={blCheck!} shipmentId={owner.id} canEdit={recordOpen} />
            </Box>
          )}
          {isDone && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
              Done{s.updatedByName ? ` by ${s.updatedByName}` : ""} · {fmtDateTime(s.completedAt ?? s.updatedAt)}
            </Typography>
          )}
          {s.status === "IN_PROGRESS" && s.updatedByName && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
              Started by {s.updatedByName} · {fmtDateTime(s.updatedAt)}
            </Typography>
          )}
        </Box>
        <Tooltip title={lockedTip}>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            {s.status === "NOT_STARTED" && (
              <Button size="small" variant="outlined" disabled={!recordOpen || busy} onClick={() => run(s, "start")}>
                Start
              </Button>
            )}
            {!isDone && (
              <Tooltip title={recordOpen && missing.length ? `Missing: ${missing.map(label).join(", ")}` : ""}>
                <span>
                  <Button size="small" variant="contained" color="success" disabled={!recordOpen || busy || missing.length > 0} onClick={() => run(s, "complete")}>
                    Complete
                  </Button>
                </span>
              </Tooltip>
            )}
            {/* A legacy SKIPPED row can still be reopened (and then completed). */}
            {(isDone || s.status === "SKIPPED") && (
              <Button size="small" disabled={!recordOpen || busy} onClick={() => setReopenAsk(s)}>
                Reopen
              </Button>
            )}
          </Stack>
        </Tooltip>
      </Box>
    );
  };

  if (!steps.length) {
    return <EmptyState title="No steps on this record" />;
  }


  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
        <LinearProgress variant="determinate" value={pct} color={main.length && done === main.length ? "success" : "primary"} sx={{ flex: 1, height: 8, borderRadius: 4 }} />
        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {done}/{main.length} steps
        </Typography>
      </Stack>

      <Paper variant="outlined">{main.map((s, i) => <React.Fragment key={s.id}>{i > 0 && <Divider />}{row(s)}</React.Fragment>)}</Paper>

      {ongoing.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
            Ongoing
          </Typography>
          <Paper variant="outlined">{ongoing.map((s, i) => <React.Fragment key={s.id}>{i > 0 && <Divider />}{row(s)}</React.Fragment>)}</Paper>
        </>
      )}

      <Menu anchorReference="anchorPosition" anchorPosition={genMenu?.pos} open={!!genMenu} onClose={() => setGenMenu(null)}>
        <MenuItem
          disabled={creatingGen}
          onClick={() => {
            const m = genMenu!;
            setGenMenu(null);
            void createBlank(m.docType);
          }}
        >
          <ListItemIcon>{creatingGen ? <CircularProgress size={16} /> : <PostAddIcon fontSize="small" />}</ListItemIcon>
          {genMenu ? GENERATED_DOC_TYPES[genMenu.docType]?.createLabel : "Create"}
        </MenuItem>
        {(() => {
          const m = genMenu;
          const src = m ? GENERATED_DOC_TYPES[m.docType] : null;
          if (!m || !src?.source || owner.kind !== "shipment") return null;
          const none = m.sources !== null && m.sources.length === 0;
          const item = (
            <MenuItem
              disabled={m.sources === null || none || creatingGen}
              onClick={() => {
                if (!m.sources) return;
                setGenMenu(null);
                if (m.sources.length === 1) void createGenerated(m.docType, m.sources[0].id);
                else setPickSource({ step: m.step, docType: m.docType, sources: m.sources });
              }}
            >
              <ListItemIcon>{m.sources === null ? <CircularProgress size={16} /> : <PostAddIcon fontSize="small" />}</ListItemIcon>
              Create from Vedanta file
            </MenuItem>
          );
          return none ? (
            <Tooltip title={`Upload the supplier's ${src.sourceLabel} ${src.sourceFiles ?? "spreadsheet"} as ${src.source} on this shipment first`} placement="right">
              <span>{item}</span>
            </Tooltip>
          ) : (
            item
          );
        })()}
        <Divider />
        <MenuItem
          onClick={() => {
            const m = genMenu!;
            setGenMenu(null);
            setUpload({ step: m.step, docType: m.docType });
          }}
        >
          <ListItemIcon>
            <UploadFileIcon fontSize="small" />
          </ListItemIcon>
          Upload file
        </MenuItem>
        {genMenu && INVOICE_DOC_TYPES.includes(genMenu.docType) && (
          <MenuItem
            onClick={() => {
              const m = genMenu!;
              setGenMenu(null);
              setLinkExisting({ step: m.step, docType: m.docType });
            }}
          >
            <ListItemIcon>
              <LinkIcon fontSize="small" />
            </ListItemIcon>
            Link existing invoice
          </MenuItem>
        )}
      </Menu>
      <Dialog open={!!pickSource} onClose={() => setPickSource(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Which {pickSource ? GENERATED_DOC_TYPES[pickSource.docType]?.sourceLabel : ""} file?</DialogTitle>
        <DialogContent dividers>
          <List dense disablePadding>
            {(pickSource?.sources ?? []).map((f) => (
              <ListItemButton
                key={f.id}
                disabled={creatingGen}
                onClick={() => {
                  const p = pickSource!;
                  setPickSource(null);
                  void createGenerated(p.docType, f.id);
                }}
              >
                <ListItemText primary={f.fileName} secondary={`${fmtDate(f.createdAt)}${f.uploadedByName ? ` · ${f.uploadedByName}` : ""}`} />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickSource(null)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      <FileUploadDialog
        open={!!upload}
        onClose={() => setUpload(null)}
        docType={upload?.docType}
        stepId={upload?.step.id}
        stepTitle={upload ? titleOf(upload.step) : undefined}
        defaultTargets={[owner]}
      />
      <ConfirmDialog
        open={!!reopenAsk}
        title={reopenAsk ? `Reopen step ${titleOf(reopenAsk)}?` : ""}
        body="Files can then be deleted."
        confirmLabel="Reopen step"
        onClose={() => setReopenAsk(null)}
        onConfirm={async () => {
          if (reopenAsk) await change.mutateAsync({ id: reopenAsk.id, action: "reopen" });
        }}
      />
      <LinkInvoiceDialog open={!!linkExisting} onClose={() => setLinkExisting(null)} docType={linkExisting?.docType ?? ""} stepId={linkExisting?.step.id} owner={owner} />
    </Box>
  );
}
