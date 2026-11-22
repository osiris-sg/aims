"use client";

// The ONE Remarks memo (guru 2026-11-21: "all document editors have remarks on the
// right, that's the one that will display in the table list"): the legacy voucher
// right-hand column, now on every document. Sales documents save it as
// config.referenceNo (the canonical reference key, CLAUDE.md) mirrored to
// config.remarks; receipts / vouchers save it as their remarks. Every list's
// Remarks column reads the same chain.
import { Card, CardContent, TextField, Typography } from "@mui/material";

export default function DocRemarksMemo({ value, onChange, disabled, title = "Remarks" }: { value: string; onChange: (next: string) => void; disabled?: boolean; title?: string }) {
  return (
    <Card sx={{ width: 260, flexShrink: 0, my: 0.5, mr: 0.5, display: "flex", flexDirection: "column" }} data-tour="doc-remarks">
      <CardContent sx={{ p: 1, flex: 1, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
        <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", mb: 0.5 }}>{title}</Typography>
        <TextField
          multiline
          minRows={6}
          fullWidth
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          sx={{ flex: 1, "& .MuiInputBase-root": { alignItems: "flex-start", height: "100%" } }}
        />
      </CardContent>
    </Card>
  );
}
