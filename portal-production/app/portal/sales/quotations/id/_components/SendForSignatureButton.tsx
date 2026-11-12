"use client";

// The quotation toolbar's "Send for signature" button (CIEL's ID quotation
// editor; also WCT-group quotations in the document editor, 2026-11-13).
import React from "react";
import { Button } from "@mui/material";
import DrawIcon from "@mui/icons-material/DrawOutlined";

export default function SendForSignatureButton({ onClick, compact = false, dataTour = "idq-send-signature" }: { onClick: () => void; compact?: boolean; dataTour?: string }) {
  return (
    <Button size="small" variant="outlined" startIcon={<DrawIcon />} onClick={onClick} data-tour={dataTour}>
      {compact ? "Sign" : "Send for signature"}
    </Button>
  );
}
