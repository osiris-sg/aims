"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { request } from "@/helpers/request";
import {
  QuotationTemplate,
  TemplateLine,
  editorItemsToTemplateLines,
  lineAmount,
  money,
  templateHeaderFrom,
  templateTotals,
} from "@/helpers/quotationTemplates";

/**
 * Quotation templates (features.enableQuotationTemplates, WCT group): the
 * "Create from template" list (Preview / Use / New template, row ⋮ Edit /
 * Rename / Delete), the template editor, the PDF-style preview and "Save as
 * template". Templates are the org's own sets of quotation lines, not the PDF
 * layouts. Every call goes to /quotation-templates (org-scoped on the API).
 */

type Draft = {
  id?: string;
  name: string;
  subject: string;
  category: string;
  termsAndConditions: string;
  lines: TemplateLine[];
};

const blankLine = (): TemplateLine => ({ itemCode: "", description: "", quantity: 1, unitPrice: 0, lineType: "SERVICE" });
const failed = (res: any) => !res || res.success === false;

export interface QuotationTemplatesHostProps {
  listOpen: boolean;
  onCloseList: () => void;
  saveAsOpen: boolean;
  onCloseSaveAs: () => void;
  /** The editor's current lines and form data (Save as template). */
  editorItems: any[];
  formData: any;
  /** The quotation layout (DocumentTemplate) and type the new quotation uses. */
  layoutId?: string | null;
  docType: string;
  onUsed: (doc: { id: string; type?: string; documentTemplateId?: string }) => void;
}

export default function QuotationTemplatesHost(p: QuotationTemplatesHostProps) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const call = async (path: string, method: string, body: any = {}) => {
    const token = await getToken();
    return request({ path, method }, body, token || undefined);
  };

  const { data: templates, isLoading } = useQuery<QuotationTemplate[]>({
    queryKey: ["quotation-templates"],
    queryFn: async () => {
      const res: any = await call("/quotation-templates", "GET");
      return Array.isArray(res) ? res : [];
    },
    enabled: p.listOpen,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["quotation-templates"] });

  const [preview, setPreview] = useState<QuotationTemplate | null>(null);
  const [editor, setEditor] = useState<Draft | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const [confirmHide, setConfirmHide] = useState<QuotationTemplate | null>(null);
  const [rowMenu, setRowMenu] = useState<{ pos: { left: number; top: number }; row: QuotationTemplate } | null>(null);
  const [busy, setBusy] = useState(false);

  const use = async (t: QuotationTemplate) => {
    if (!p.layoutId) {
      toast.error("Could not find the quotation layout");
      return;
    }
    setBusy(true);
    try {
      const res: any = await call(`/quotation-templates/${t.id}/use`, "POST", { documentTemplateId: p.layoutId, type: p.docType });
      if (failed(res) || !res?.data?.id) return;
      toast.success(`Quotation created from ${t.name}`);
      setPreview(null);
      p.onCloseList();
      p.onUsed(res.data);
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async (d: Draft) => {
    setBusy(true);
    try {
      const body = { name: d.name, subject: d.subject, category: d.category, termsAndConditions: d.termsAndConditions, lines: d.lines };
      const res: any = d.id ? await call(`/quotation-templates/${d.id}`, "PATCH", body) : await call("/quotation-templates", "POST", body);
      if (failed(res)) return false;
      toast.success(d.id ? "Template saved" : "Template created");
      refresh();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const doRename = async () => {
    if (!rename) return;
    setBusy(true);
    try {
      const res: any = await call(`/quotation-templates/${rename.id}`, "PATCH", { name: rename.name });
      if (failed(res)) return;
      toast.success("Template renamed");
      setRename(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const doHide = async () => {
    if (!confirmHide) return;
    setBusy(true);
    try {
      const res: any = await call(`/quotation-templates/${confirmHide.id}`, "DELETE");
      if (failed(res)) return;
      toast.success("Template deleted");
      setConfirmHide(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (t: QuotationTemplate) =>
    setEditor({
      id: t.id,
      name: t.name,
      subject: t.subject || "",
      category: t.category || "",
      termsAndConditions: t.termsAndConditions || "",
      lines: (t.lines || []).map((l) => ({ ...l })),
    });

  const rows = templates || [];

  return (
    <>
      {/* Create from template */}
      <Dialog open={p.listOpen} onClose={p.onCloseList} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ flex: 1 }}>Templates</Box>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            data-tour="quotation-new-template"
            onClick={() => setEditor({ name: "", subject: "", category: "", termsAndConditions: "", lines: [blankLine()] })}
          >
            New template
          </Button>
          <IconButton size="small" onClick={p.onCloseList} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : rows.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
              No templates yet
            </Typography>
          ) : (
            <Table size="small">
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
                    <TableCell sx={{ fontWeight: 600 }}>{t.name}</TableCell>
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
        <MenuItem onClick={(e) => { e.stopPropagation(); const r = rowMenu!.row; setRowMenu(null); openEdit(r); }}>Edit</MenuItem>
        <MenuItem onClick={(e) => { e.stopPropagation(); const r = rowMenu!.row; setRowMenu(null); setRename({ id: r.id, name: r.name }); }}>Rename</MenuItem>
        <MenuItem sx={{ color: "error.main" }} onClick={(e) => { e.stopPropagation(); const r = rowMenu!.row; setRowMenu(null); setConfirmHide(r); }}>
          Delete
        </MenuItem>
      </Menu>

      {preview && <TemplatePreviewDialog template={preview} busy={busy} onClose={() => setPreview(null)} onUse={() => void use(preview)} />}

      {editor && (
        <TemplateEditorDialog
          draft={editor}
          busy={busy}
          onClose={() => setEditor(null)}
          onSave={async (d) => {
            if (await saveDraft(d)) setEditor(null);
          }}
        />
      )}

      <Dialog open={!!rename} onClose={() => setRename(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename template</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Name"
            value={rename?.name || ""}
            onChange={(e) => setRename((r) => (r ? { ...r, name: e.target.value } : r))}
            onKeyDown={(e) => { if (e.key === "Enter") void doRename(); }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRename(null)}>Cancel</Button>
          <Button variant="contained" disabled={busy || !rename?.name.trim()} onClick={() => void doRename()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

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
          editorItems={p.editorItems}
          formData={p.formData}
          busy={busy}
          onClose={p.onCloseSaveAs}
          onSave={async (name) => {
            const header = templateHeaderFrom(p.formData);
            const ok = await saveDraft({ name, ...header, lines: editorItemsToTemplateLines(p.editorItems) });
            if (ok) p.onCloseSaveAs();
          }}
        />
      )}
    </>
  );
}

/** The template's lines on a white A4-style sheet, like the printed quotation. */
function TemplatePreviewDialog({ template, busy, onClose, onUse }: { template: QuotationTemplate; busy: boolean; onClose: () => void; onUse: () => void }) {
  const lines = template.lines || [];
  let no = 0;
  const cell = { borderBottom: "1px solid #d0d0d0", color: "#111", py: 0.75, px: 1, fontSize: 12 } as const;
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
          {(template.subject || template.category) && (
            <Box sx={{ mb: 2, fontSize: 12 }}>
              {template.subject && (
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Box sx={{ fontWeight: 700, minWidth: 70 }}>Subject</Box>
                  <Box sx={{ whiteSpace: "pre-wrap" }}>{template.subject}</Box>
                </Box>
              )}
              {template.category && (
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Box sx={{ fontWeight: 700, minWidth: 70 }}>Category</Box>
                  <Box>{template.category}</Box>
                </Box>
              )}
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
                      <TableCell sx={cell}>{l.itemCode}</TableCell>
                      <TableCell sx={{ ...cell, whiteSpace: "pre-wrap" }}>{l.description}</TableCell>
                      <TableCell sx={cell} align="right">{l.quantity}{l.uom ? ` ${l.uom}` : ""}</TableCell>
                      <TableCell sx={cell} align="right">{money(Number(l.unitPrice) || 0)}</TableCell>
                      <TableCell sx={cell} align="right">{money(lineAmount(l))}</TableCell>
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
          {template.termsAndConditions && (
            <Box sx={{ mt: 3, fontSize: 12 }}>
              <Box sx={{ fontWeight: 700, mb: 0.5 }}>Terms &amp; Conditions</Box>
              <Box sx={{ whiteSpace: "pre-wrap" }}>{template.termsAndConditions}</Box>
            </Box>
          )}
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

/** New template / Edit: name, Subject, Category, T&Cs and the lines. */
function TemplateEditorDialog({ draft, busy, onClose, onSave }: { draft: Draft; busy: boolean; onClose: () => void; onSave: (d: Draft) => void }) {
  const [d, setD] = useState<Draft>(draft);
  useEffect(() => setD(draft), [draft]);
  const totals = useMemo(() => templateTotals(d.lines), [d.lines]);
  const setLine = (i: number, patch: Partial<TemplateLine>) => setD((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const removeLine = (i: number) => setD((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }));
  const canSave = !!d.name.trim() && d.lines.some((l) => !l.isGroupHeader && (l.description.trim() || l.itemCode.trim()));
  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{draft.id ? "Edit template" : "New template"}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, mb: 2 }}>
          <TextField size="small" label="Name" required value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />
          <TextField size="small" label="Category" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} />
          <TextField size="small" label="Subject" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} sx={{ gridColumn: { sm: "1 / -1" } }} />
        </Box>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: 760 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 130 }}>Item</TableCell>
                <TableCell>Description</TableCell>
                <TableCell sx={{ width: 90 }} align="right">Qty</TableCell>
                <TableCell sx={{ width: 120 }} align="right">Unit Price</TableCell>
                <TableCell sx={{ width: 120 }}>Line type</TableCell>
                <TableCell sx={{ width: 110 }} align="right">Amount</TableCell>
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {d.lines.map((l, i) => (
                <TableRow key={i}>
                  {l.isGroupHeader ? (
                    <TableCell colSpan={6}>
                      <TextField size="small" fullWidth value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} inputProps={{ style: { fontWeight: 700 } }} />
                    </TableCell>
                  ) : (
                    <>
                      <TableCell>
                        <TextField size="small" fullWidth value={l.itemCode} onChange={(e) => setLine(i, { itemCode: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <TextField size="small" fullWidth multiline maxRows={4} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                      </TableCell>
                      <TableCell align="right">
                        <TextField size="small" type="number" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value === "" ? 0 : Number(e.target.value) })} inputProps={{ style: { textAlign: "right" } }} />
                      </TableCell>
                      <TableCell align="right">
                        <TextField size="small" type="number" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value === "" ? 0 : Number(e.target.value) })} inputProps={{ style: { textAlign: "right" }, step: "0.01" }} />
                      </TableCell>
                      <TableCell>
                        <Select size="small" fullWidth value={l.lineType} onChange={(e) => setLine(i, { lineType: e.target.value as TemplateLine["lineType"] })}>
                          <MenuItem value="SERVICE">Service</MenuItem>
                          <MenuItem value="PRODUCT">Product</MenuItem>
                        </Select>
                      </TableCell>
                      <TableCell align="right">{money(lineAmount(l))}</TableCell>
                    </>
                  )}
                  <TableCell padding="checkbox">
                    <Tooltip title="Remove line">
                      <IconButton size="small" onClick={() => removeLine(i)} aria-label="Remove line">
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={5} align="right" sx={{ fontWeight: 700 }}>
                  Total ({totals.lineCount} lines)
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{money(totals.total)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </Box>
        <Button size="small" startIcon={<AddIcon />} onClick={() => setD((x) => ({ ...x, lines: [...x.lines, blankLine()] }))} sx={{ mt: 1 }}>
          Add line
        </Button>
        <TextField
          size="small"
          label="Terms & Conditions"
          fullWidth
          multiline
          minRows={3}
          value={d.termsAndConditions}
          onChange={(e) => setD({ ...d, termsAndConditions: e.target.value })}
          sx={{ mt: 2 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !canSave} onClick={() => onSave(d)}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** ⋮ Save as template: a name for a copy of the quotation's current lines. */
function SaveAsTemplateDialog({ editorItems, formData, busy, onClose, onSave }: { editorItems: any[]; formData: any; busy: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(() => String(formData?.documentInfo?.subject || "").trim().slice(0, 120));
  const lines = useMemo(() => editorItemsToTemplateLines(editorItems), [editorItems]);
  const totals = templateTotals(lines);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Save as template</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && totals.lineCount) onSave(name); }}
          sx={{ mt: 1 }}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {totals.lineCount} lines, total {money(totals.total)}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !name.trim() || !totals.lineCount} onClick={() => onSave(name)}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
