"use client";

import React, { useCallback, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  RadioGroup,
  FormControlLabel,
  Radio,
  Chip,
  Box,
  Button,
  Typography,
} from "@mui/material";

interface ActiveTemplate {
  id: string;
  name?: string;
  designName?: string;
  isPrimary?: boolean;
  isDefault?: boolean;
}

/**
 * Shared template resolver for document creation. Self-gating by the count of
 * templates ACTIVE for the org+type:
 *   - 1 active  → resolves immediately, no dialog.
 *   - >1 active → opens the picker dialog and resolves with the user's choice
 *                 (or null if cancelled — the caller should abort creation).
 *   - 0 active  → falls back to the single-resolve endpoint (/type/:type).
 *
 * Usage:
 *   const { resolveTemplate, dialog } = useTemplatePicker();
 *   // ...render {dialog} somewhere in the component tree...
 *   const templateId = await resolveTemplate(documentType);
 *   if (!templateId) return; // 0 templates OR user cancelled
 */
export function useTemplatePicker() {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<ActiveTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  // Holds the pending promise resolver while the dialog is open.
  const resolverRef = useRef<((id: string | null) => void) | null>(null);

  const closeWith = useCallback((id: string | null) => {
    setOpen(false);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    if (resolve) resolve(id);
  }, []);

  const resolveTemplate = useCallback(
    async (documentType: string): Promise<string | null> => {
      const token = (await getToken()) ?? "";

      // 1. Fetch the active set for this org+type.
      let active: ActiveTemplate[] = [];
      try {
        const res = await request(
          { path: `/documentTemplates/active/${documentType}`, method: "GET" },
          {},
          token
        );
        const list = res?.success !== false ? res?.data || res || [] : [];
        active = Array.isArray(list) ? list : [];
      } catch {
        active = [];
      }

      // 2. Exactly one → straight through, no dialog.
      if (active.length === 1) return active[0].id;

      // 3. More than one → open the picker and await the choice.
      if (active.length > 1) {
        setTemplates(active);
        setSelectedId(active.find((t) => t.isPrimary)?.id || active[0].id);
        setOpen(true);
        return new Promise<string | null>((resolve) => {
          resolverRef.current = resolve;
        });
      }

      // 4. None active → single-resolve fallback.
      try {
        const res = await request(
          { path: `/documentTemplates/type/${documentType}`, method: "GET" },
          {},
          token
        );
        return res?.success && res?.data?.id ? res.data.id : null;
      } catch {
        return null;
      }
    },
    [getToken]
  );

  const dialog = (
    <Dialog open={open} onClose={() => closeWith(null)} maxWidth="sm" fullWidth>
      <DialogTitle>Choose a template</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          More than one template is available for this document. Pick which one to use.
        </Typography>
        <RadioGroup value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {templates.map((t) => (
            <FormControlLabel
              key={t.id}
              value={t.id}
              control={<Radio />}
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body1">{t.name || t.designName || "Untitled template"}</Typography>
                  {t.isPrimary && <Chip label="Default" color="success" size="small" />}
                  {t.isDefault && <Chip label="Standard" color="info" size="small" variant="outlined" />}
                </Box>
              }
            />
          ))}
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => closeWith(null)}>Cancel</Button>
        <Button variant="contained" onClick={() => closeWith(selectedId || null)} disabled={!selectedId}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );

  return { resolveTemplate, dialog };
}
