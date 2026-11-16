"use client";

// Xero-style "Accounts" multi-select: shows "N accounts selected", opens a
// searchable checklist of the chart of accounts. Empty selection = all.
//
// Picking a few (guru 2026-11-16): "None" clears every tick so the user can
// tick just the accounts wanted; unticking one while on "All" keeps the rest
// (it does not flip to only that one). Ticking every account collapses back
// to "All". While nothing is ticked the report still shows all accounts —
// the selection takes effect from the first tick.

import React, { useMemo, useState } from "react";
import {
  Box, Button, Checkbox, Divider, InputAdornment, Menu, MenuItem, TextField, Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";

export interface CoaOption {
  id: string;
  code: string;
  name: string;
  accountType?: string;
}

export default function AccountsSelect({
  accounts, selected, onChange, label = "Accounts",
}: {
  accounts: CoaOption[];
  selected: string[]; // account ids; [] = all
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [search, setSearch] = useState("");
  // "None" pressed: selected is [] (= all for the report) but the list shows
  // every box unticked until the user ticks one. Reset when the menu closes.
  const [cleared, setCleared] = useState(false);
  const allIds = useMemo(() => accounts.map((a) => a.id), [accounts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => `${a.code} ${a.name}`.toLowerCase().includes(q));
  }, [accounts, search]);

  const display = selected.length === 0
    ? (cleared ? "No accounts selected" : `All accounts (${accounts.length})`)
    : `${selected.length} account${selected.length > 1 ? "s" : ""} selected`;

  const isChecked = (id: string) => (selected.length === 0 ? !cleared : selected.includes(id));

  const commit = (ids: string[]) => {
    if (ids.length === 0) { setCleared(true); onChange([]); return; }
    // Every account ticked = "All" again.
    if (ids.length === allIds.length) { setCleared(false); onChange([]); return; }
    setCleared(false);
    onChange(ids);
  };

  const toggle = (id: string) => {
    const current = selected.length === 0 && !cleared ? allIds : selected;
    commit(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };

  const close = () => { setAnchor(null); setCleared(false); };

  return (
    <Box>
      <Typography variant="caption" sx={{ fontWeight: 700, color: "text.primary" }}>{label}</Typography>
      <TextField
        size="small" value={display} onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ display: "block", mt: 0.25, width: 210, "& input": { cursor: "pointer" } }}
        InputProps={{ readOnly: true }}
        fullWidth
      />
      <Menu
        anchorEl={anchor} open={Boolean(anchor)} onClose={close}
        slotProps={{ paper: { sx: { width: 360, maxWidth: "calc(100vw - 32px)", maxHeight: 440 } } }}
      >
        <Box sx={{ px: 1.5, py: 1 }} onKeyDown={(e) => e.stopPropagation()}>
          <TextField
            size="small" fullWidth placeholder="Search accounts" value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />
          <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
            <Box>
              <Button size="small" onClick={() => { setCleared(false); onChange([]); }}>All</Button>
              <Button size="small" onClick={() => commit([])}>None</Button>
            </Box>
            <Button size="small" onClick={() => commit(filtered.map((a) => a.id))}>Select shown</Button>
          </Box>
        </Box>
        <Divider />
        {filtered.slice(0, 400).map((a) => (
          <MenuItem key={a.id} dense onClick={() => toggle(a.id)}>
            <Checkbox size="small" checked={isChecked(a.id)} sx={{ p: 0.5, mr: 1 }} />
            <Typography variant="body2" noWrap>{a.code} — {a.name}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
