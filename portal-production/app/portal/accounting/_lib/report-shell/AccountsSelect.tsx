"use client";

// Xero-style "Accounts" multi-select: shows "N accounts selected", opens a
// searchable checklist of the chart of accounts. Empty selection = all.

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => `${a.code} ${a.name}`.toLowerCase().includes(q));
  }, [accounts, search]);

  const display = selected.length === 0
    ? `All accounts (${accounts.length})`
    : `${selected.length} account${selected.length > 1 ? "s" : ""} selected`;

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

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
        anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { width: 360, maxHeight: 440 } } }}
      >
        <Box sx={{ px: 1.5, py: 1 }} onKeyDown={(e) => e.stopPropagation()}>
          <TextField
            size="small" fullWidth placeholder="Search accounts" value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />
          <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
            <Button size="small" onClick={() => onChange([])}>All</Button>
            <Button size="small" onClick={() => onChange(filtered.map((a) => a.id))}>Select shown</Button>
          </Box>
        </Box>
        <Divider />
        {filtered.slice(0, 400).map((a) => (
          <MenuItem key={a.id} dense onClick={() => toggle(a.id)}>
            <Checkbox size="small" checked={selected.length === 0 || selected.includes(a.id)} sx={{ p: 0.5, mr: 1 }} />
            <Typography variant="body2" noWrap>{a.code} — {a.name}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
