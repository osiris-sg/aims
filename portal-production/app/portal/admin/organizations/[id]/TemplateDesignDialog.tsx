"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { DEFAULT_DESIGN, DESIGN_FONT_LABELS, DESIGN_FONTS, DOCUMENT_LAYOUT_LABELS, DOCUMENT_LAYOUTS, isDefaultDesign, resolveDesign, type DocumentDesign } from "@/app/portal/documents/design";

interface Props {
  open: boolean;
  templateId: string | null;
  templateName?: string;
  shared?: boolean;
  organizationId: string;
  onClose: () => void;
  onSaved?: (design: DocumentDesign) => void;
}

/**
 * Admin → org → Manage Templates → Design. The knobs on the left, and on the
 * right the SAME server renderer that makes every PDF, drawing a sample
 * document with the knobs applied. What is shown here is what prints.
 */
export default function TemplateDesignDialog({ open, templateId, templateName, shared, organizationId, onClose, onSaved }: Props) {
  const { getToken } = useAuth();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down("md"));
  const [design, setDesign] = useState<DocumentDesign>({ ...DEFAULT_DESIGN });
  const [saved, setSaved] = useState<DocumentDesign>({ ...DEFAULT_DESIGN });
  const [html, setHtml] = useState<string>("");
  const [ported, setPorted] = useState(true);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const previewSeq = useRef(0);
  const [hexText, setHexText] = useState(DEFAULT_DESIGN.accentColor);
  useEffect(() => setHexText(design.accentColor), [design.accentColor]);
  const headers = useMemo(() => ({ "x-organization-id": organizationId }), [organizationId]);

  // Load the saved design when the dialog opens.
  useEffect(() => {
    if (!open || !templateId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const res = await request({ path: `/documentTemplates/variants/${templateId}/design`, method: "GET" }, {}, token!, headers);
        const d = resolveDesign(res?.data?.design ?? res?.design);
        if (!cancelled) {
          setDesign(d);
          setSaved(d);
        }
      } catch {
        if (!cancelled) toast.error("Could not load the template design.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, templateId, getToken, headers]);

  // Re-render the sample a moment after the last change.
  useEffect(() => {
    if (!open || !templateId || loading) return;
    const seq = ++previewSeq.current;
    const t = setTimeout(async () => {
      setRendering(true);
      try {
        const token = await getToken();
        const res = await request({ path: `/documentTemplates/variants/${templateId}/design-preview`, method: "POST" }, { design }, token!, headers);
        if (seq !== previewSeq.current) return;
        const body = res?.data ?? res;
        setHtml(String(body?.html || ""));
        setPorted(body?.ported !== false);
      } catch {
        if (seq === previewSeq.current) setHtml("");
      } finally {
        if (seq === previewSeq.current) setRendering(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [open, templateId, design, loading, getToken, headers]);

  const set = <K extends keyof DocumentDesign>(k: K, v: DocumentDesign[K]) => setDesign((d) => ({ ...d, [k]: v }));
  const dirty = JSON.stringify(design) !== JSON.stringify(saved);

  const save = async () => {
    if (!templateId) return;
    setSaving(true);
    try {
      const token = await getToken();
      const res = await request({ path: `/documentTemplates/variants/${templateId}/design`, method: "POST" }, { design }, token!, headers);
      const d = resolveDesign(res?.data?.design ?? res?.design ?? design);
      setSaved(d);
      setDesign(d);
      toast.success("Design saved");
      onSaved?.(d);
      onClose();
    } catch {
      toast.error("Could not save the design.");
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, control: React.ReactNode) => (
    <Box>
      <Typography sx={{ fontSize: "0.72rem", fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.05em", mb: 0.5 }}>{label}</Typography>
      {control}
    </Box>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth fullScreen={phone} PaperProps={{ sx: { height: phone ? "100%" : "90vh" } }}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h6" noWrap>
            Design: {templateName || "Template"}
          </Typography>
          <Typography sx={{ fontSize: "0.8rem", color: "text.secondary" }}>
            {shared ? "Shared template. Changes show for every organisation that uses it." : "What you see on the right is what prints."}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: "flex", flexDirection: phone ? "column" : "row", minHeight: 0 }}>
        <Box sx={{ width: phone ? "100%" : 340, flexShrink: 0, p: 2, overflowY: "auto", borderRight: phone ? 0 : "1px solid", borderBottom: phone ? "1px solid" : 0, borderColor: "divider" }} data-tour="template-design-knobs">
          {loading ? (
            <Stack alignItems="center" sx={{ py: 6 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : (
            <Stack gap={2}>
              {field(
                "Layout",
                <Box>
                  <TextField select size="small" fullWidth value={design.layout} onChange={(e) => set("layout", e.target.value as DocumentDesign["layout"])}>
                    {DOCUMENT_LAYOUTS.map((k) => (
                      <MenuItem key={k} value={k}>
                        {DOCUMENT_LAYOUT_LABELS[k]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Typography sx={{ fontSize: "0.72rem", color: "text.secondary", mt: 0.5 }}>
                    {design.layout === "wct"
                      ? "Client page shape: letterhead on every page, Job Location and Subject boxes, S/No column, GST line, signature block. Quotations, tax invoices and delivery orders."
                      : "The standard page shape for the document type."}
                  </Typography>
                </Box>,
              )}
              {field(
                "Accent colour",
                <Stack direction="row" gap={1} alignItems="center">
                  <Box
                    component="input"
                    type="color"
                    value={design.accentColor}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("accentColor", e.target.value)}
                    aria-label="Accent colour"
                    sx={{ width: 44, height: 36, p: 0, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "transparent", cursor: "pointer" }}
                  />
                  <TextField
                    size="small"
                    value={hexText}
                    onChange={(e) => {
                      // Typed freely; applied once it is a full hex colour.
                      const v = e.target.value.trim();
                      setHexText(v);
                      if (/^#[0-9a-f]{6}$/i.test(v)) set("accentColor", v.toLowerCase());
                    }}
                    onBlur={() => setHexText(design.accentColor)}
                    inputProps={{ maxLength: 7, style: { fontFamily: "monospace" } }}
                    sx={{ width: 120 }}
                  />
                  <Typography sx={{ fontSize: "0.75rem", color: "text.secondary" }}>Title and rules</Typography>
                </Stack>,
              )}
              {field(
                "Font",
                <TextField select size="small" fullWidth value={design.fontFamily} onChange={(e) => set("fontFamily", e.target.value as DocumentDesign["fontFamily"])}>
                  {(Object.keys(DESIGN_FONTS) as Array<keyof typeof DESIGN_FONTS>).map((k) => (
                    <MenuItem key={k} value={k} sx={{ fontFamily: DESIGN_FONTS[k] }}>
                      {DESIGN_FONT_LABELS[k]}
                    </MenuItem>
                  ))}
                </TextField>,
              )}
              {field(
                "Logo",
                <ToggleButtonGroup exclusive size="small" fullWidth value={design.logoPosition} onChange={(_, v) => v && set("logoPosition", v)}>
                  <ToggleButton value="none">Off</ToggleButton>
                  <ToggleButton value="left">Left</ToggleButton>
                  <ToggleButton value="center">Centre</ToggleButton>
                  <ToggleButton value="right">Right</ToggleButton>
                </ToggleButtonGroup>,
              )}
              {field(
                "Company block",
                <ToggleButtonGroup exclusive size="small" fullWidth value={design.headerAlign} onChange={(_, v) => v && set("headerAlign", v)}>
                  <ToggleButton value="center">Centred</ToggleButton>
                  <ToggleButton value="left">Left</ToggleButton>
                </ToggleButtonGroup>,
              )}
              {field(
                "Title",
                <TextField size="small" fullWidth placeholder="Leave blank for the standard title" value={design.titleText} onChange={(e) => set("titleText", e.target.value.slice(0, 40))} />,
              )}
              {field(
                "Blocks",
                <Stack>
                  <FormControlLabel control={<Switch size="small" checked={design.showDueDate} onChange={(e) => set("showDueDate", e.target.checked)} />} label="Due date" />
                  <FormControlLabel control={<Switch size="small" checked={design.showBankDetails} onChange={(e) => set("showBankDetails", e.target.checked)} />} label="Bank details" />
                  <FormControlLabel control={<Switch size="small" checked={design.showAmountInWords} onChange={(e) => set("showAmountInWords", e.target.checked)} />} label="Amount in words" />
                  <FormControlLabel control={<Switch size="small" checked={design.showGeneratedNote} onChange={(e) => set("showGeneratedNote", e.target.checked)} />} label="Computer generated note" />
                  <FormControlLabel control={<Switch size="small" checked={design.tableHeaderFill} onChange={(e) => set("tableHeaderFill", e.target.checked)} />} label="Shaded table header" />
                </Stack>,
              )}
              {field(
                "Footer line",
                <TextField size="small" fullWidth placeholder="e.g. Thank you for your business" value={design.footerText} onChange={(e) => set("footerText", e.target.value.slice(0, 200))} />,
              )}
              <Button size="small" startIcon={<RestartAltIcon />} onClick={() => setDesign({ ...DEFAULT_DESIGN })} disabled={isDefaultDesign(design)} sx={{ alignSelf: "flex-start", textTransform: "none" }}>
                Reset to standard look
              </Button>
            </Stack>
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: phone ? 480 : 0, position: "relative", bgcolor: "var(--surface-container-low)" }}>
          {rendering && (
            <Box sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}>
              <Tooltip title="Rendering">
                <CircularProgress size={18} />
              </Tooltip>
            </Box>
          )}
          {!ported && !rendering && (
            <Typography sx={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 1, fontSize: "0.8rem", color: "text.secondary" }}>
              Design options apply to quotations, invoices, credit notes and debit notes.
            </Typography>
          )}
          {html ? (
            <Box component="iframe" title="Design preview" srcDoc={html} sx={{ width: "100%", height: "100%", border: 0, bgcolor: "#fff" }} />
          ) : (
            <Stack alignItems="center" justifyContent="center" sx={{ height: "100%" }}>
              <CircularProgress size={28} />
            </Stack>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={!dirty || saving || loading} sx={{ textTransform: "none", backgroundImage: "none" }} data-tour="template-design-save">
          {saving ? "Saving…" : "Save design"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
