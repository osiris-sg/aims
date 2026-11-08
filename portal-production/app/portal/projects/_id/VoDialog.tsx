"use client";

// Variation Order editor (CIEL 09-01): one main quotation per project — every
// change after signing is a VO. Mirrors their VO sheet: Additional Items and
// Removal of Items (amount or Complimentary), a live consolidation panel
// (latest quantum + additions − removals = new quantum, collected, balance),
// Print in the sheet layout, and Confirm which locks the VO and adds its net
// to the contract sum as a `vo` milestone.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, IconButton, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import StrikethroughSIcon from "@mui/icons-material/StrikethroughS";
import PrintIcon from "@mui/icons-material/PrintOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutline";
import DrawIcon from "@mui/icons-material/DrawOutlined";
import { toast } from "react-toastify";
import { money, useIdProjectApi, type Summary } from "./api";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import SignLinkDialog from "@/app/portal/sales/quotations/id/_components/SignLinkDialog";

// kind "area" = a general-area header row like the main quote's sections
// (LIVING ROOM, KITCHEN…): no number, no amount, prints as a bold band.
// struck = a proposed addition the client decided against (guru 2026-11-08):
// stays on the sheet struck through under "Removal of Proposed Items", counts
// in no total.
type VoLine = { id: string; description: string; amount: number | null; complimentary: boolean; kind?: "line" | "area"; includes?: string[]; struck?: boolean };
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const sum = (list: VoLine[]) => list.reduce((s, l) => s + (l.kind === "area" || l.complimentary || l.struck ? 0 : Number(l.amount) || 0), 0);

/** Lets decimals be typed freely: string draft while focused, number committed live. */
function VoAmountField({ value, disabled, onCommit, placeholder }: { value: number | null; disabled?: boolean; onCommit: (n: number | null) => void; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextField
      size="small"
      placeholder={placeholder}
      value={draft ?? (value ?? "")}
      disabled={disabled}
      onFocus={() => setDraft(value == null ? "" : String(value))}
      onChange={(e) => {
        const v = e.target.value;
        if (!/^-?[0-9]*\.?[0-9]*$/.test(v)) return;
        setDraft(v);
        onCommit(v === "" || v === "-" ? null : Number(v) || 0);
      }}
      onBlur={() => setDraft(null)}
      inputProps={{ inputMode: "decimal", style: { textAlign: "right", width: 84 } }}
    />
  );
}

function LineList({ title, lines, readOnly, onChange, allowStrike }: { title: string; lines: VoLine[]; readOnly: boolean; onChange: (next: VoLine[]) => void; allowStrike?: boolean }) {
  // Reorder by dragging the six-dot handle onto another row (drops ABOVE it),
  // same gesture as the quotation editor (guru 2026-10-10).
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const from = lines.findIndex((x) => x.id === dragId);
    const to = lines.findIndex((x) => x.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...lines];
    const [moved] = next.splice(from, 1);
    next.splice(next.findIndex((x) => x.id === targetId), 0, moved);
    onChange(next);
  };
  let itemNo = 0;
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {money(sum(lines))}
        </Typography>
      </Stack>
      <Stack spacing={0.75}>
        {lines.map((l) => {
          const isArea = l.kind === "area";
          if (!isArea) itemNo += 1;
          return (
            <Stack
              key={l.id}
              direction="row"
              spacing={1}
              alignItems="flex-start"
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverId(l.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(l.id);
                setDragId(null);
                setOverId(null);
              }}
              sx={{
                borderTop: 2,
                borderColor: overId === l.id && dragId && dragId !== l.id ? "primary.main" : "transparent",
                opacity: dragId === l.id ? 0.45 : 1,
                ...(isArea ? { bgcolor: "action.hover", borderRadius: 1, py: 0.25, pr: 0.5 } : {}),
              }}
            >
              {!readOnly ? (
                <Box
                  draggable
                  onDragStart={(e) => {
                    setDragId(l.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  sx={{ cursor: "grab", color: "text.disabled", pt: 1, px: 0.25, "&:active": { cursor: "grabbing" } }}
                >
                  <DragIndicatorIcon fontSize="small" />
                </Box>
              ) : (
                <Box sx={{ width: 28 }} />
              )}
              <Typography variant="body2" sx={{ width: 20, textAlign: "right", pt: 1, color: "text.secondary" }}>
                {isArea ? "" : itemNo}
              </Typography>
              {isArea ? (
                <TextField
                  size="small"
                  fullWidth
                  placeholder="AREA (e.g. LIVING ROOM)"
                  value={l.description}
                  disabled={readOnly}
                  onChange={(e) => onChange(lines.map((x) => (x.id === l.id ? { ...x, description: e.target.value } : x)))}
                  inputProps={{ style: { fontWeight: 700, textTransform: "uppercase" } }}
                />
              ) : (
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <TextField
                    size="small"
                    fullWidth
                    multiline
                    minRows={1}
                    placeholder="Describe the change…"
                    value={l.description}
                    disabled={readOnly}
                    onChange={(e) => onChange(lines.map((x) => (x.id === l.id ? { ...x, description: e.target.value } : x)))}
                    inputProps={l.struck ? { style: { textDecoration: "line-through" } } : undefined}
                    sx={l.struck ? { "& .MuiInputBase-input": { color: "text.disabled" } } : undefined}
                  />
                  {/* "Includes …" sub-lines, like the main quotation's items
                      (Mike 2026-11-07: e.g. "* Includes 25ft cove light"). */}
                  {(l.includes || []).map((inc, ii) => (
                    <Stack key={ii} direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5, pl: 1.5 }}>
                      <Typography variant="caption" sx={{ color: "text.disabled" }}>*</Typography>
                      <TextField
                        size="small"
                        variant="standard"
                        fullWidth
                        placeholder="Includes …"
                        value={inc}
                        disabled={readOnly}
                        onChange={(e) => onChange(lines.map((x) => (x.id === l.id ? { ...x, includes: (x.includes || []).map((y, j) => (j === ii ? e.target.value : y)) } : x)))}
                        InputProps={{ disableUnderline: true, sx: { fontSize: 12.5, color: "text.secondary" } }}
                      />
                      {!readOnly && (
                        <IconButton size="small" onClick={() => onChange(lines.map((x) => (x.id === l.id ? { ...x, includes: (x.includes || []).filter((_, j) => j !== ii) } : x)))} sx={{ color: "text.disabled", p: 0.25 }}>
                          <DeleteIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      )}
                    </Stack>
                  ))}
                  {!readOnly && (
                    <Button size="small" onClick={() => onChange(lines.map((x) => (x.id === l.id ? { ...x, includes: [...(x.includes || []), ""] } : x)))} sx={{ textTransform: "none", color: "text.disabled", fontSize: 11, mt: 0.25, py: 0, minWidth: 0, pl: 1.5 }}>
                      + sub-line
                    </Button>
                  )}
                </Box>
              )}
              {!isArea && <VoAmountField placeholder="0.00" value={l.complimentary ? null : l.amount ?? null} disabled={readOnly || l.complimentary || l.struck} onCommit={(n) => onChange(lines.map((x) => (x.id === l.id ? { ...x, amount: n } : x)))} />}
              {!isArea && (
                <Tooltip title="Complimentary (no charge)">
                  <Checkbox size="small" checked={l.complimentary} disabled={readOnly || l.struck} onChange={(e) => onChange(lines.map((x) => (x.id === l.id ? { ...x, complimentary: e.target.checked, amount: e.target.checked ? null : x.amount } : x)))} sx={{ mt: 0.25 }} />
                </Tooltip>
              )}
              {!isArea && allowStrike && (
                <Tooltip title={l.struck ? "Restore this proposed item" : "Strike through — client dropped this proposed item (prints under Removal of Proposed Items, charges nothing)"}>
                  <IconButton
                    size="small"
                    disabled={readOnly}
                    onClick={() => onChange(lines.map((x) => (x.id === l.id ? { ...x, struck: !x.struck } : x)))}
                    sx={{ mt: 0.25, color: l.struck ? "warning.main" : "text.disabled" }}
                  >
                    <StrikethroughSIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {!readOnly && (
                <IconButton size="small" onClick={() => onChange(lines.filter((x) => x.id !== l.id))} sx={{ color: "text.disabled", "&:hover": { color: "error.main" }, mt: 0.25 }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>
          );
        })}
      </Stack>
      {!readOnly && (
        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
          <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...lines, { id: newId(), description: "", amount: null, complimentary: false }])} sx={{ textTransform: "none", color: "text.secondary" }}>
            Add line
          </Button>
          <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...lines, { id: newId(), description: "", amount: null, complimentary: false, kind: "area" }])} sx={{ textTransform: "none", color: "text.secondary" }}>
            Add area
          </Button>
        </Stack>
      )}
    </Box>
  );
}

export default function VoDialog({ docId, summary, onClose, onChanged }: { docId: string | null; summary: Summary; onClose: () => void; onChanged: () => void }) {
  const api = useIdProjectApi();
  // Directors can revert a confirmed VO right here (Summer 2026-11-07: the
  // button only lived on the VO table row and the view page).
  const { userRoles } = useUserPermissions();
  const isDirector = userRoles.length === 0 || userRoles.some((r: any) => !["Designer", "Marketing", "Junior Manager", "Senior Manager"].includes(r?.name));
  const [doc, setDoc] = useState<any | null>(null);
  const [additions, setAdditions] = useState<VoLine[]>([]);
  const [removals, setRemovals] = useState<VoLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [voDate, setVoDate] = useState("");
  // Collect-with-this-VO (guru 2026-11-08): outstanding payment milestones
  // (e.g. the pending 45%) ride on the VO sheet as a PAYMENT REQUEST, so the
  // client signs ONE document and pays ONE combined amount instead of a VO
  // plus a separate invoice.
  const [payMilestones, setPayMilestones] = useState<Array<{ id: string; label: string; amount: number }>>([]);
  // A confirmed VO only LOCKS once it reached the client (guru 2026-11-08):
  // a sign link outstanding/signed, or the client's signature on it. Until
  // then it stays editable — saves re-sync the contract milestone.
  // "unknown" counts as locked so nothing flashes editable while we check.
  const [sendState, setSendState] = useState<"unknown" | "sent" | "unsent">("unknown");
  // "Send homeowner the link to sign" (Mike 2026-11-07): the client signs the
  // VO on the same e-sign page as the quotation; signing confirms it.
  const [signOpen, setSignOpen] = useState(false);

  useEffect(() => {
    if (!docId) return;
    setDoc(null);
    api
      .getDocument(docId)
      .then((d) => {
        setDoc(d);
        const norm = (list: any[]): VoLine[] => (Array.isArray(list) ? list : []).map((l) => ({ id: l.id || newId(), description: l.description || "", amount: l.amount ?? null, complimentary: !!l.complimentary, kind: l.kind === "area" ? "area" : "line", includes: Array.isArray(l.includes) ? l.includes.map(String) : [], struck: !!l.struck }));
        setAdditions(norm(d?.config?.vo?.additions));
        setRemovals(norm(d?.config?.vo?.removals));
        // VO date (guru 2026-11-08: "let them edit the date") — defaults to the
        // day the VO was created; printed next to the VO number on the sheet.
        setVoDate((d?.config?.vo?.date || d?.createdAt || new Date().toISOString()).slice(0, 10));
        setPayMilestones(Array.isArray(d?.config?.vo?.payMilestones) ? d.config.vo.payMilestones.map((m: any) => ({ id: String(m.id), label: String(m.label || ""), amount: Number(m.amount) || 0 })) : []);
        setDirty(false);
        if (d?.status !== "confirmed") setSendState("unsent");
        else if (d?.config?.clientSignature) setSendState("sent");
        else {
          setSendState("unknown");
          api
            .request<{ active: any; signed: any }>(`/documents/${d.id}/sign-link`)
            .then((s) => setSendState(s?.active || s?.signed ? "sent" : "unsent"))
            .catch(() => setSendState("sent")); // can't tell → stay locked
        }
      })
      .catch((e) => toast.error(e.message || "Failed to load VO"));
  }, [api, docId]);

  const confirmed = doc?.status === "confirmed";
  const readOnly = confirmed && sendState !== "unsent";
  const addTotal = sum(additions);
  const remTotal = sum(removals);
  const net = addTotal - remTotal;
  // This VO's milestone doesn't exist until Confirm, so contractTotal is the
  // "latest revised quantum" for a draft; once confirmed, use the snapshot.
  // A confirmed-but-editable VO already sits inside contractTotal, so its
  // live panel starts from the snapshot's previous quantum instead.
  const prevQuantum = confirmed ? (doc?.config?.consolidation?.previousQuantum ?? summary.totals.contractTotal) : summary.totals.contractTotal;
  const cons = readOnly && doc?.config?.consolidation ? doc.config.consolidation : {
    previousQuantum: prevQuantum,
    additions: addTotal,
    removals: remTotal,
    newQuantum: prevQuantum + net,
    collected: summary.totals.collected,
    balance: prevQuantum + net - summary.totals.collected,
  };

  const buildConfig = useCallback(() => ({
    ...(doc?.config || {}),
    vo: { ...(doc?.config?.vo || {}), additions, removals, date: voDate || undefined, payMilestones: payMilestones.length ? payMilestones : undefined },
    consolidation: cons,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [doc, additions, removals, addTotal, remTotal, voDate, payMilestones]);

  const save = async (): Promise<boolean> => {
    if (!doc) return false;
    try {
      if (confirmed) {
        // Confirmed-but-unsent VO: the dedicated endpoint re-syncs the
        // contract milestone and consolidation with the new net.
        await api.request(`/projects/vo/${doc.id}/update`, { method: "POST", body: JSON.stringify({ additions, removals, date: voDate || null, payMilestones }) });
        const d = await api.getDocument(doc.id);
        setDoc(d);
        setDirty(false);
        onChanged();
        return true;
      }
      const res = await api.saveDocument({ id: doc.id, type: doc.type, version: doc.version, config: buildConfig() });
      setDoc((d: any) => (d ? { ...d, version: typeof res?.version === "number" ? res.version : (d.version || 0) + 1, config: buildConfig() } : d));
      setDirty(false);
      return true;
    } catch (e: any) {
      toast.error(e.message || "Save failed");
      return false;
    }
  };

  const confirm = async () => {
    if (!doc) return;
    if (!additions.some((l) => l.kind !== "area" && !l.struck) && !removals.some((l) => l.kind !== "area")) {
      toast.warn("Add at least one line before confirming");
      return;
    }
    setBusy(true);
    try {
      if (dirty && !(await save())) return;
      const r = await api.confirmVo(doc.id);
      toast.success(`${doc.name || "VO"} confirmed — contract is now S$ ${money(r.newQuantum)}`);
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Confirm failed");
    } finally {
      setBusy(false);
    }
  };

  const sendForSignature = async () => {
    if (!doc) return;
    if (!additions.some((l) => l.kind !== "area" && !l.struck) && !removals.some((l) => l.kind !== "area")) {
      toast.warn("Add at least one line before sending for signature");
      return;
    }
    // The link renders the latest SAVED version — save first so the homeowner
    // sees what is on screen.
    if (dirty && !(await save())) return;
    setSignOpen(true);
  };

  const print = async () => {
    if (!doc) return;
    try {
      if (dirty && !readOnly) await save();
      const { html } = await api.getDocHtml(doc.id);
      const f = document.createElement("iframe");
      f.style.position = "fixed";
      f.style.width = "0";
      f.style.height = "0";
      f.style.border = "0";
      document.body.appendChild(f);
      f.srcdoc = html;
      f.onload = () => {
        f.contentWindow?.print();
        setTimeout(() => document.body.removeChild(f), 60000);
      };
    } catch (e: any) {
      toast.error(e.message || "Print failed");
    }
  };

  const K = ({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) => (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.25 }}>
      <Typography variant="body2" sx={{ color: strong ? "text.primary" : "text.secondary", fontWeight: strong ? 700 : 400 }}>{k}</Typography>
      <Typography variant="body2" sx={{ fontWeight: strong ? 800 : 600, fontVariantNumeric: "tabular-nums" }}>{v}</Typography>
    </Stack>
  );

  return (
    <Dialog open={!!docId} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {doc?.name || "Variation order"}
        {readOnly && <Chip size="small" color="primary" variant="outlined" label="Confirmed" />}
        {doc && (
          <TextField
            type="date"
            size="small"
            label="VO date"
            value={voDate}
            disabled={readOnly}
            onChange={(e) => {
              if (!e.target.value) return;
              setVoDate(e.target.value);
              setDirty(true);
            }}
            InputLabelProps={{ shrink: true }}
            sx={{ ml: 1, width: 160, "& input": { py: 0.6, fontSize: 13 } }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={print} sx={{ textTransform: "none" }}>
          Print / PDF
        </Button>
      </DialogTitle>
      <DialogContent dividers>
        {!doc ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0,1fr) 260px" }, gap: 2.5 }}>
            <Box sx={{ minWidth: 0 }}>
              {confirmed && !readOnly && (
                <Alert severity="success" sx={{ mb: 1.5 }}>
                  Confirmed, not yet sent to the client — still editable. Saving re-syncs the contract sum; sending the sign link locks it.
                </Alert>
              )}
              {readOnly && (
                <Alert
                  severity="info"
                  sx={{ mb: 1.5 }}
                  action={
                    isDirector ? (
                      <Button
                        color="inherit"
                        size="small"
                        disabled={busy}
                        onClick={async () => {
                          if (!window.confirm(`Revert ${doc?.name || "this VO"} to draft? Its net amount comes off the contract sum and its payment line is removed.`)) return;
                          setBusy(true);
                          try {
                            await api.request(`/projects/vo/${doc.id}/revert`, { method: "POST" });
                            toast.success(`${doc?.name || "VO"} reverted to draft — you can edit it now`);
                            const d = await api.getDocument(doc.id);
                            setDoc(d);
                            onChanged();
                          } catch (err: any) {
                            toast.error(err.message || "Could not revert the VO");
                          } finally {
                            setBusy(false);
                          }
                        }}
                        sx={{ textTransform: "none" }}
                      >
                        Revert to draft
                      </Button>
                    ) : undefined
                  }
                >
                  {sendState === "unknown"
                    ? "Checking whether this VO was sent to the client…"
                    : `This VO ${doc?.config?.clientSignature ? "is signed by the client" : "was sent to the client for signature"} — locked. ${isDirector ? "Revert to draft to edit, or" : ""} raise another VO for further changes.`}
                </Alert>
              )}
              <LineList title="Additional Items" lines={additions} readOnly={readOnly} allowStrike onChange={(n) => { setAdditions(n); setDirty(true); }} />
              <LineList title="Removal of Items" lines={removals} readOnly={readOnly} onChange={(n) => { setRemovals(n); setDirty(true); }} />
            </Box>
            <Box>
              <Typography variant="overline" sx={{ color: "text.secondary" }}>Consolidation</Typography>
              <K k="Latest quantum" v={money(cons.previousQuantum)} />
              <K k="Additional items" v={money(cons.additions)} />
              <K k="Deducted items" v={`(${money(cons.removals)})`} />
              <Divider sx={{ my: 0.5 }} />
              <K k="New quantum" v={`S$ ${money(cons.newQuantum)}`} strong />
              <K k="Collected to date" v={money(cons.collected)} />
              <K k="Balance payable" v={`S$ ${money(cons.balance)}`} strong />
              {!readOnly && (
                <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 1 }}>
                  {confirmed
                    ? `Saving keeps the contract's VO line in Payments at the net ${money(net)}.`
                    : `Confirm adds the net ${money(net)} to the contract sum as a VO line in Payments.`}
                </Typography>
              )}
              {/* Collect-with-this-VO: pending milestones ride on the sheet as a
                  PAYMENT REQUEST — one signature, one combined payment. */}
              {(() => {
                const outstanding = (summary.milestones || []).filter((m) => m.kind === "milestone" && m.amount - m.paidAmount > 0.005);
                if (!outstanding.length && !payMilestones.length) return null;
                const requested = payMilestones.reduce((s, m) => s + m.amount, 0);
                return (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="overline" sx={{ color: "text.secondary" }}>Collect with this VO</Typography>
                    {outstanding.map((m) => {
                      const due = Math.round((m.amount - m.paidAmount) * 100) / 100;
                      const picked = payMilestones.some((p) => p.id === m.id);
                      return (
                        <Stack key={m.id} direction="row" alignItems="center" spacing={0.5} sx={{ py: 0.25 }}>
                          <Checkbox
                            size="small"
                            checked={picked}
                            disabled={readOnly}
                            onChange={(e) => {
                              setPayMilestones((prev) => (e.target.checked ? [...prev, { id: m.id, label: m.label, amount: due }] : prev.filter((p) => p.id !== m.id)));
                              setDirty(true);
                            }}
                            sx={{ p: 0.25 }}
                          />
                          <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }} noWrap title={m.label}>{m.label}</Typography>
                          <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(due)}</Typography>
                        </Stack>
                      );
                    })}
                    {payMilestones.length > 0 && (
                      <>
                        <Divider sx={{ my: 0.5 }} />
                        <K k="Payable on acceptance" v={`S$ ${money(requested + net)}`} strong />
                        <Typography variant="caption" sx={{ color: "text.disabled" }}>
                          Prints as a Payment Request on the sheet — the client signs once and pays once.
                        </Typography>
                      </>
                    )}
                  </Box>
                );
              })()}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>Close</Button>
        {doc && !readOnly && (
          <>
            <Button onClick={() => save().then((ok) => ok && toast.success("Saved"))} disabled={busy || !dirty} sx={{ textTransform: "none" }}>
              {confirmed ? "Save changes" : "Save draft"}
            </Button>
            <Button variant="outlined" startIcon={<DrawIcon />} onClick={sendForSignature} disabled={busy} sx={{ textTransform: "none" }}>
              Send for signature
            </Button>
            {!confirmed && (
              <Button variant="contained" startIcon={<CheckCircleIcon />} onClick={confirm} disabled={busy} sx={{ textTransform: "none" }}>
                Confirm VO
              </Button>
            )}
          </>
        )}
      </DialogActions>
      {doc && (
        <SignLinkDialog
          open={signOpen}
          kind="vo"
          documentId={doc.id}
          documentNumber={doc.name || null}
          clientName={doc.config?.client?.name || ""}
          // The homeowner's number is on the project's customer, not in the VO config.
          clientPhone={summary.project.customer?.phone || summary.project.client?.contact || ""}
          grandTotal={net}
          onClose={async () => {
            setSignOpen(false);
            // The homeowner may have signed while the link dialog was open —
            // signing confirms the VO, so pick up the new status. A link now
            // outstanding also LOCKS a confirmed VO (sent = locked), unless it
            // was revoked inside the dialog — re-check instead of assuming.
            try {
              const d = await api.getDocument(doc.id);
              setDoc(d);
              if (d?.status === "confirmed") {
                onChanged();
                if (d?.config?.clientSignature) setSendState("sent");
                else {
                  const s = await api.request<{ active: any; signed: any }>(`/documents/${d.id}/sign-link`).catch(() => null);
                  setSendState(!s || s.active || s.signed ? "sent" : "unsent");
                }
              }
            } catch {
              /* keep what we have */
            }
          }}
        />
      )}
    </Dialog>
  );
}
