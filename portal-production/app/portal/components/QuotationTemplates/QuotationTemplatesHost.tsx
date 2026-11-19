"use client";

import React, { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { request } from "@/helpers/request";
import {
  QuotationTemplate,
  clashFrom,
  money,
  nameTaken,
  readReply,
  saveAsBody,
  saveAsSummary,
  savedFrom,
  templatesFrom,
  usedDocFrom,
  withSaved,
} from "@/helpers/quotationTemplates";

/**
 * Quotation templates (features.enableQuotationTemplates, WCT group). Reworked 2026-11-19: a template is made ONLY
 * from a real quotation (editor ⋮ Save as template; a name in use offers Replace or Save as new), its lines kept
 * exactly as in the editor. "Create from template" (the quotations list's Create Quotation arrow, or the editor's
 * "+ Add" arrow) lists them: name, line count, total, Preview, Use, ⋮ Delete (hides). Use opens a new draft
 * quotation in the normal editor with the same lines. There is no template editor: to change one, Use it, edit the
 * quotation, then Save as template > Replace. Every call goes to /quotation-templates (org-scoped on the API).
 *
 * 2026-11-19 fix: replies are read through readReply / templatesFrom / savedFrom / usedDocFrom (the API wraps every
 * reply in { success, data }; the list used to read as empty). request() never shows its own error notice, so each
 * failure here says so with a toast and leaves its dialog open. A save puts the template straight into the shared
 * list cache (the quotations list and the editor's "+ Add" arrow read the same key) and then refetches it.
 */

const QT_KEY = ["quotation-templates"];

type SaveResult = "saved" | "failed" | { clash: { id: string; name: string } };

export interface QuotationTemplatesHostProps {
  listOpen: boolean;
  onCloseList: () => void;
  /** Editor only: Save as template (the quotation's current lines and form data). */
  saveAsOpen?: boolean;
  onCloseSaveAs?: () => void;
  editorItems?: any[];
  formData?: any;
  /** The quotation layout (DocumentTemplate) and type a new quotation uses. */
  layoutId?: string | null;
  docType: string;
  /** Quotations list: no layout yet, so pick it (and the number format) the way Create Quotation does. */
  resolveLayout?: () => Promise<{ templateId: string; numberFormatId?: string } | null>;
  onUsed: (doc: { id: string; type?: string; documentTemplateId?: string }) => void;
}

export default function QuotationTemplatesHost(p: QuotationTemplatesHostProps) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const call = async (path: string, method: string, body: any = {}) => {
    const token = await getToken();
    return request({ path, method }, body, token || undefined);
  };

  const { data: templates, isLoading, isError, refetch } = useQuery<QuotationTemplate[]>({
    queryKey: QT_KEY,
    queryFn: async () => {
      const res: any = await call("/quotation-templates", "GET");
      const list = templatesFrom(res);
      if (!list) throw new Error(readReply(res).message || "Could not load the templates");
      return list;
    },
    enabled: p.listOpen || !!p.saveAsOpen,
    retry: false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: QT_KEY });

  const [preview, setPreview] = useState<QuotationTemplate | null>(null);
  const [confirmHide, setConfirmHide] = useState<QuotationTemplate | null>(null);
  const [rowMenu, setRowMenu] = useState<{ pos: { left: number; top: number }; row: QuotationTemplate } | null>(null);
  const [busy, setBusy] = useState(false);

  const use = async (t: QuotationTemplate) => {
    setBusy(true);
    try {
      let layoutId = p.layoutId || null;
      let numberFormatId: string | undefined;
      if (!layoutId && p.resolveLayout) {
        const target = await p.resolveLayout();
        if (!target) return;
        layoutId = target.templateId;
        numberFormatId = target.numberFormatId;
      }
      if (!layoutId) {
        toast.error("Could not find the quotation layout");
        return;
      }
      const res: any = await call(`/quotation-templates/${t.id}/use`, "POST", { documentTemplateId: layoutId, type: p.docType, ...(numberFormatId ? { numberFormatId } : {}) });
      const doc = usedDocFrom(res);
      if (!doc) {
        toast.error(readReply(res).message || "Could not create the quotation");
        return;
      }
      toast.success(`Quotation created from ${t.name}`);
      setPreview(null);
      p.onCloseList();
      p.onUsed(doc);
    } finally {
      setBusy(false);
    }
  };

  const doHide = async () => {
    if (!confirmHide) return;
    setBusy(true);
    try {
      const res: any = await call(`/quotation-templates/${confirmHide.id}`, "DELETE");
      const r = readReply(res);
      if (!r.ok) {
        toast.error(r.message || "Could not delete the template");
        return;
      }
      const goneId = confirmHide.id;
      qc.setQueryData<QuotationTemplate[]>(QT_KEY, (old) => (old || []).filter((x) => x.id !== goneId));
      toast.success("Template deleted");
      setConfirmHide(null);
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const save = async (name: string, onExisting?: "replace" | "new"): Promise<SaveResult> => {
    setBusy(true);
    try {
      const res: any = await call("/quotation-templates", "POST", saveAsBody(name, p.editorItems, p.formData, onExisting));
      const saved = savedFrom(res);
      if (!saved) {
        void refresh();
        // The name was taken after the list loaded (someone else saved it): ask Replace or Save as new.
        const clash = clashFrom(res);
        if (clash && !onExisting) return { clash: { id: clash.id, name: clash.name || name.trim() } };
        toast.error(readReply(res).message || "Could not save the template");
        return "failed";
      }
      qc.setQueryData<QuotationTemplate[]>(QT_KEY, (old) => withSaved(old, saved));
      void refresh();
      toast.success(saved.replaced ? `Template ${saved.name} replaced` : `Saved as template ${saved.name}`);
      return "saved";
    } finally {
      setBusy(false);
    }
  };

  const rows = templates || [];

  return (
    <>
      {/* Create from template */}
      <Dialog open={p.listOpen} onClose={p.onCloseList} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ flex: 1 }}>Templates</Box>
          <IconButton size="small" onClick={p.onCloseList} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : isError ? (
            <Box sx={{ py: 3, textAlign: "center" }}>
              <Typography color="error">Could not load the templates</Typography>
              <Button size="small" onClick={() => void refetch()} sx={{ mt: 1 }}>
                Try again
              </Button>
            </Box>
          ) : rows.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
              No templates yet
            </Typography>
          ) : (
            <Table size="small" data-tour="quotation-template-list">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell align="right">Lines</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell />
                  <TableCell padding="checkbox" />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id} hover sx={{ cursor: "pointer" }} onClick={() => setPreview(t)}>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {t.name}
                      {t.unlinked > 0 && <Chip size="small" color="warning" variant="outlined" label={`${t.unlinked} not linked`} sx={{ ml: 1, height: 20 }} />}
                    </TableCell>
                    <TableCell align="right">{t.lineCount}</TableCell>
                    <TableCell align="right">{money(t.total)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      <Button size="small" onClick={(e) => { e.stopPropagation(); setPreview(t); }}>
                        Preview
                      </Button>
                      <Button size="small" variant="contained" disabled={busy} onClick={(e) => { e.stopPropagation(); void use(t); }} sx={{ ml: 1 }}>
                        Use
                      </Button>
                    </TableCell>
                    <TableCell padding="checkbox">
                      <IconButton
                        size="small"
                        aria-label="Template actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRowMenu({ pos: { left: e.clientX, top: e.clientY }, row: t });
                        }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      <Menu open={!!rowMenu} onClose={() => setRowMenu(null)} anchorReference="anchorPosition" anchorPosition={rowMenu?.pos}>
        <MenuItem sx={{ color: "error.main" }} onClick={(e) => { e.stopPropagation(); const r = rowMenu!.row; setRowMenu(null); setConfirmHide(r); }}>
          Delete
        </MenuItem>
      </Menu>

      {preview && <TemplatePreviewDialog template={preview} busy={busy} onClose={() => setPreview(null)} onUse={() => void use(preview)} />}

      <Dialog open={!!confirmHide} onClose={() => setConfirmHide(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete template {confirmHide?.name}?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setConfirmHide(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => void doHide()}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {p.saveAsOpen && (
        <SaveAsTemplateDialog
          editorItems={p.editorItems || []}
          formData={p.formData}
          templates={templates}
          loading={isLoading}
          busy={busy}
          onClose={() => p.onCloseSaveAs?.()}
          onSave={async (name, onExisting) => {
            const result = await save(name, onExisting);
            if (result === "saved") p.onCloseSaveAs?.();
            return result;
          }}
        />
      )}
    </>
  );
}

/** The template's lines on a white A4-style sheet, like the printed quotation. Lines with no code are marked. */
function TemplatePreviewDialog({ template, busy, onClose, onUse }: { template: QuotationTemplate; busy: boolean; onClose: () => void; onUse: () => void }) {
  const lines = template.lines || [];
  let no = 0;
  // White cells: the dark theme's table header / row hover colours must not show on the paper sheet.
  const cell = { borderBottom: "1px solid #d0d0d0", color: "#111", bgcolor: "#fff", py: 0.75, px: 1, fontSize: 12 } as const;
  const head = { ...cell, fontWeight: 700, borderBottom: "1.5px solid #111", borderTop: "1.5px solid #111" } as const;
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center" }}>
        <Box sx={{ flex: 1 }}>{template.name}</Box>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ bgcolor: "action.hover", py: 3 }}>
        <Box
          data-tour="quotation-template-preview"
          sx={{ bgcolor: "#fff", color: "#111", mx: "auto", maxWidth: 760, minHeight: 480, p: { xs: 2, sm: 4 }, boxShadow: 3, fontFamily: "Arial, Helvetica, sans-serif" }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: 18, letterSpacing: 1, textAlign: "center", color: "#111", mb: 2 }}>QUOTATION</Typography>
          {template.category && (
            <Box sx={{ mb: 2, fontSize: 12, display: "flex", gap: 1 }}>
              <Box sx={{ fontWeight: 700, minWidth: 70 }}>Category</Box>
              <Box>{template.category}</Box>
            </Box>
          )}
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 560 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={head}>No.</TableCell>
                  <TableCell sx={head}>Item</TableCell>
                  <TableCell sx={head}>Description</TableCell>
                  <TableCell sx={head} align="right">Qty</TableCell>
                  <TableCell sx={head} align="right">Unit Price</TableCell>
                  <TableCell sx={head} align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((l, i) =>
                  l.isGroupHeader ? (
                    <TableRow key={i}>
                      <TableCell sx={{ ...cell, fontWeight: 700 }} colSpan={6}>{l.description}</TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={i}>
                      <TableCell sx={cell}>{++no}</TableCell>
                      <TableCell sx={cell}>
                        {l.itemCode}
                        {!l.linked && <Chip size="small" color="warning" variant="outlined" label="Not linked" sx={{ height: 18, fontSize: 10 }} />}
                      </TableCell>
                      <TableCell sx={{ ...cell, whiteSpace: "pre-wrap" }}>{l.description}</TableCell>
                      <TableCell sx={cell} align="right">{l.quantity}{l.uom ? ` ${l.uom}` : ""}</TableCell>
                      <TableCell sx={cell} align="right">{money(Number(l.unitPrice) || 0)}</TableCell>
                      <TableCell sx={cell} align="right">{money(l.amount)}</TableCell>
                    </TableRow>
                  ),
                )}
                <TableRow>
                  <TableCell sx={{ ...cell, borderBottom: "3px double #111", fontWeight: 700 }} colSpan={5} align="right">TOTAL</TableCell>
                  <TableCell sx={{ ...cell, borderBottom: "3px double #111", fontWeight: 700 }} align="right">{money(template.total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={busy} onClick={onUse}>
          Use
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** ⋮ Save as template: a name for a copy of the quotation's lines; a name in use asks Replace or Save as new. */
function SaveAsTemplateDialog({
  editorItems,
  formData,
  templates,
  loading,
  busy,
  onClose,
  onSave,
}: {
  editorItems: any[];
  formData: any;
  templates: QuotationTemplate[] | undefined;
  loading: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, onExisting?: "replace" | "new") => Promise<SaveResult>;
}) {
  const [name, setName] = useState(() => String(formData?.documentInfo?.subject || "").trim().slice(0, 120));
  const [clash, setClash] = useState<{ id: string; name: string } | null>(null);
  const totals = saveAsSummary(editorItems);
  // Waits for the list (the name check) unless it failed to load; the API still refuses a taken name.
  const ready = !!name.trim() && totals.lineCount > 0 && !busy && !loading;
  const send = async (onExisting?: "replace" | "new") => {
    const result = await onSave(name, onExisting);
    if (typeof result === "object") setClash(result.clash);
  };
  const submit = () => {
    if (!ready) return;
    const taken = nameTaken(name, templates);
    if (taken) return setClash(taken);
    void send();
  };
  return (
    <>
      <Dialog open={!clash} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle>Save as template</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            sx={{ mt: 1 }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {totals.lineCount} {totals.lineCount === 1 ? "line" : "lines"}, total {money(totals.total)}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" disabled={!ready} onClick={submit}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!clash} onClose={() => setClash(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{clash ? `${clash.name} already exists` : ""}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setClash(null)}>Cancel</Button>
          <Button disabled={busy} onClick={() => void send("new")}>
            Save as new
          </Button>
          <Button variant="contained" disabled={busy} onClick={() => void send("replace")}>
            Replace
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
