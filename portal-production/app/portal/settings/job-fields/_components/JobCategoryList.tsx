"use client";

// Job category (WCT group, 2026-11-17; helpers/jobCategory.ts): the org's editable list on Settings > Job fields.
// Shown only when GET /job-fields returns a category (orgs with the job_category field). The first entry is the
// default (blank jobs read as it).

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Chip, CircularProgress, IconButton, Stack, TextField, Tooltip, Typography } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { request } from "@/helpers/request";
import { cleanCategoryList, moveCategory, type JobCategoryDef } from "@/helpers/jobCategory";

export default function JobCategoryList({ category, onSaved }: { category: JobCategoryDef; onSaved: () => void }) {
  const { getToken } = useAuth();
  const [list, setList] = useState<string[]>(category.options);
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setList(category.options), [category.options]);
  const clean = cleanCategoryList(list);
  const dirty = JSON.stringify(clean) !== JSON.stringify(category.options) || clean.length !== list.length;

  const add = () => {
    const v = adding.trim();
    if (!v) return;
    setList(cleanCategoryList([...list, v]));
    setAdding("");
  };

  const save = async () => {
    if (!clean.length) return setError("Keep at least one category");
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const res: any = await request({ path: "/job-fields/category", method: "PUT", ownError: true }, { options: clean }, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not save");
      onSaved();
    } catch (e: any) {
      const m = e?.message;
      setError((Array.isArray(m) ? m.join(". ") : m) || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, mb: 2 }} data-tour="job-category-list">
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          Job category
        </Typography>
        <Tooltip title="Required on every job. The first is the default, and jobs without a category show it." enterTouchDelay={0}>
          <InfoOutlinedIcon fontSize="small" sx={{ color: "text.secondary", cursor: "help" }} aria-label="About job category" />
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" disableElevation disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <CircularProgress size={16} /> : "Save"}
        </Button>
      </Stack>
      {error && (
        <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Stack spacing={1} sx={{ maxWidth: 480 }}>
        {list.map((name, i) => (
          <Stack key={i} direction="row" spacing={0.5} alignItems="center">
            <TextField size="small" fullWidth value={name} onChange={(e) => setList(list.map((x, j) => (j === i ? e.target.value : x)))} inputProps={{ maxLength: 60, "aria-label": `Category ${i + 1}` }} />
            {i === 0 && <Chip size="small" label="Default" />}
            <IconButton size="small" aria-label="Move up" disabled={i === 0} onClick={() => setList(moveCategory(list, i, -1))}>
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" aria-label="Move down" disabled={i === list.length - 1} onClick={() => setList(moveCategory(list, i, 1))}>
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" aria-label="Remove" disabled={list.length <= 1} onClick={() => setList(list.filter((_, j) => j !== i))} sx={{ color: "error.main" }}>
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
          />
          <Button size="small" startIcon={<AddIcon />} onClick={add} disabled={!adding.trim()}>
            Add
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
