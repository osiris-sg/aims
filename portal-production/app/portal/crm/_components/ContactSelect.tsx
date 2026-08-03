"use client";

// Searchable recipient picker fed by /whatsapp/contacts — shows the best-known
// name (phone address book > WhatsApp profile > AIMS customer) next to each
// number. freeSolo, so typing a brand-new number still works.

import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useWhatsAppApi } from "../_lib/api";

export interface WhatsAppContactOption {
  waId: string;
  name: string | null;
  lastMessageAt: string | null;
}

export default function ContactSelect({
  value,
  onChange,
  label = "Recipient",
  size = "small",
  sx,
  helperText,
}: {
  value: string;
  onChange: (waId: string) => void;
  label?: string;
  size?: "small" | "medium";
  sx?: any;
  helperText?: string;
}) {
  const { request } = useWhatsAppApi();
  const [options, setOptions] = useState<WhatsAppContactOption[]>([]);

  useEffect(() => {
    let alive = true;
    request<WhatsAppContactOption[]>("/whatsapp/contacts")
      .then((list) => {
        if (alive && Array.isArray(list)) setOptions(list);
      })
      .catch(() => {}); // picker degrades to a plain text field
    return () => {
      alive = false;
    };
  }, [request]);

  return (
    <Autocomplete
      freeSolo
      options={options}
      value={value}
      onInputChange={(_, v) => onChange(v)}
      getOptionLabel={(o) => (typeof o === "string" ? o : o.waId)}
      filterOptions={(opts, state) => {
        const q = state.inputValue.toLowerCase().replace(/\s/g, "");
        if (!q) return opts.slice(0, 20);
        return opts
          .filter(
            (o) => o.waId.includes(q.replace(/\D/g, "")) || (o.name || "").toLowerCase().includes(q),
          )
          .slice(0, 20);
      }}
      renderOption={(props, o) => (
        <Box component="li" {...props} key={o.waId}>
          <Box>
            <Typography variant="body2">{o.name || o.waId}</Typography>
            {o.name && (
              <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {o.waId}
              </Typography>
            )}
          </Box>
        </Box>
      )}
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder="6591234567 or a name" helperText={helperText} />
      )}
      size={size}
      sx={sx}
    />
  );
}
