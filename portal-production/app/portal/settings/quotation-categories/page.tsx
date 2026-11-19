"use client";

// Quotation categories (WCT group, 2026-11-18; enableQuotationCategory): the org's list for the quotation
// "Category" field and the sales report. Nothing seeded; blank on a quotation reads "Uncategorised".
// A name removed here stays on the quotations that already use it.

import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, IconButton, Stack, TextField, Tooltip, Typography } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import MainCard from "@/components/MainCard";
import { request } from "@/helpers/request";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { moveCategory } from "@/helpers/jobCategory";
import { cleanQuotationCategoryList } from "@/helpers/salesReport";

export default function QuotationCategoriesPage() {
  const { getToken } = useAuth();
  const { isQuotationCategoryEnabled, isLoading } = useOrganizationFeatures();
  const [saved, setSaved] = useState<string[] | null>(null);
  const [list, setList] = useState<string[]>([]);
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res: any = await request({ path: "/quotation-categories", method: "GET" }, {}, token ?? undefined);
      const body = res?.data ?? res;
      const options = Array.isArray(body?.options) ? body.options : [];
      setSaved(options);
      setList(options);
    } catch (e: any) {
      setError(e?.message || "Could not load the categories");
      setSaved([]);
    }
  }, [getToken]);

  useEffect(() => {
    if (isQuotationCategoryEnabled) void load();
  }, [isQuotationCategoryEnabled, load]);

  const clean = cleanQuotationCategoryList(list);
  const dirty = saved !== null && (JSON.stringify(clean) !== JSON.stringify(saved) || clean.length !== list.length);

  const add = () => {
    const v = adding.trim();
    if (!v) return;
    setList(cleanQuotationCategoryList([...list, v]));
    setAdding("");
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const res: any = await request({ path: "/quotation-categories", method: "PUT", ownError: true }, { options: clean }, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not save");
      await load();
    } catch (e: any) {
      const m = e?.message;
      setError((Array.isArray(m) ? m.join(". ") : m) || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return null;
  if (!isQuotationCategoryEnabled) {
    return (
      <MainCard>
        <Alert severity="info">Quotation categories are not enabled for this organisation.</Alert>
      </MainCard>
    );
  }

  return (
    <MainCard>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>
          Quotation categories
        </Typography>
        <Tooltip
          title="Picked on each quotation as Category and used by the sales report. A quotation without one is Uncategorised. Removing a name here keeps it on quotations that already use it."
          enterTouchDelay={0}
        >
          <InfoOutlinedIcon fontSize="small" sx={{ color: "text.secondary", cursor: "help" }} aria-label="About quotation categories" />
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" disableElevation disabled={!dirty || saving} onClick={() => void save()} data-tour="quotation-categories-save">
          {saving ? <CircularProgress size={16} /> : "Save"}
        </Button>
      </Stack>
      {error && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {saved === null ? (
        <CircularProgress />
      ) : (
        <Stack spacing={1} sx={{ maxWidth: 520 }} data-tour="quotation-categories-list">
          {list.map((name, i) => (
            <Stack key={i} direction="row" spacing={0.5} alignItems="center">
              <TextField
                size="small"
                fullWidth
                value={name}
                onChange={(e) => setList(list.map((x, j) => (j === i ? e.target.value : x)))}
                inputProps={{ maxLength: 60, "aria-label": `Category ${i + 1}` }}
              />
              <IconButton size="small" aria-label="Move up" disabled={i === 0} onClick={() => setList(moveCategory(list, i, -1))}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" aria-label="Move down" disabled={i === list.length - 1} onClick={() => setList(moveCategory(list, i, 1))}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" aria-label="Remove" onClick={() => setList(list.filter((_, j) => j !== i))} sx={{ color: "error.main" }}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              fullWidth
              label="New category"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              inputProps={{ maxLength: 60 }}
              data-tour="quotation-categories-add"
            />
            <Button size="small" startIcon={<AddIcon />} onClick={add} disabled={!adding.trim()}>
              Add
            </Button>
          </Stack>
        </Stack>
      )}
    </MainCard>
  );
}
