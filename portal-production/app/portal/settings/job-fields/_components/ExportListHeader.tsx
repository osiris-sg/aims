"use client";

// Jobs calendar Export list (round 36, WCT group, calendar style orgs) on Settings > Job fields: the header line under
// the date in the WhatsApp schedule. Shown only when the calendar style answers (the flag is on).

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useCalendarApi } from "@/components/Dashboard/jobs-calendar/calendarAddApi";

interface Payload {
  header: string;
  isDefault: boolean;
  defaultHeader: string;
}

export default function ExportListHeader() {
  const api = useCalendarApi();
  const [data, setData] = useState<Payload | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api<Payload>("GET", "/dashboard/calendar-style/export-header").then((res) => {
      if (!live || !res.ok || !res.data || typeof res.data.header !== "string") return;
      setData(res.data);
      setValue(res.data.header);
    });
    return () => {
      live = false;
    };
  }, [api]);

  if (!data) return null;
  const save = async (header: string) => {
    setSaving(true);
    setError(null);
    const res = await api<Payload>("PUT", "/dashboard/calendar-style/export-header", { header });
    setSaving(false);
    if (!res.ok || !res.data) return setError(res.message || "Could not save");
    setData(res.data);
    setValue(res.data.header);
  };
  const dirty = value.trim() !== data.header;

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, mb: 2 }} data-tour="export-list-header">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
          WhatsApp list header
        </Typography>
        {value.trim() !== data.defaultHeader && (
          <Button size="small" disabled={saving} onClick={() => void save(data.defaultHeader)}>
            Use default
          </Button>
        )}
        <Button variant="contained" disableElevation disabled={!dirty || saving} onClick={() => void save(value)}>
          {saving ? "Saving" : "Save"}
        </Button>
      </Stack>
      {error && (
        <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <TextField size="small" fullWidth value={value} onChange={(e) => setValue(e.target.value)} inputProps={{ maxLength: 300, "aria-label": "WhatsApp list header" }} />
    </Box>
  );
}
