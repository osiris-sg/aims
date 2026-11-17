"use client";

// The toolbar "Send" button + its dropdown (features.enableWctDocNav). The
// options come from helpers/sendMenu.ts; the caller wires each key to the
// document's existing flow. A stable toolbar button, so the menu anchors to it.
import React, { useState } from "react";
import { Button, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import DrawIcon from "@mui/icons-material/DrawOutlined";
import EmailIcon from "@mui/icons-material/Email";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import type { SendKey, SendOption } from "@/helpers/sendMenu";

const ICONS: Record<SendKey, React.ReactNode> = {
  sign: <DrawIcon fontSize="small" />,
  email: <EmailIcon fontSize="small" />,
  whatsapp: <WhatsAppIcon fontSize="small" />,
};

export default function SendMenuButton({
  options,
  onSelect,
  dataTour,
  size = "small",
  disabled = false,
}: {
  options: SendOption[];
  onSelect: (key: SendKey) => void;
  dataTour?: string;
  size?: "small" | "medium";
  disabled?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!options.length) return null;
  return (
    <>
      <Button
        size={size}
        variant="contained"
        disableElevation
        startIcon={<SendIcon />}
        endIcon={<ArrowDropDownIcon />}
        disabled={disabled}
        onClick={(e) => setAnchor(e.currentTarget)}
        data-tour={dataTour}
      >
        Send
      </Button>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        {options.map((o) => (
          <MenuItem
            key={o.key}
            disabled={o.disabled}
            data-tour={dataTour ? `${dataTour}-${o.key}` : undefined}
            onClick={() => {
              setAnchor(null);
              onSelect(o.key);
            }}
          >
            <ListItemIcon>{ICONS[o.key]}</ListItemIcon>
            <ListItemText>{o.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
