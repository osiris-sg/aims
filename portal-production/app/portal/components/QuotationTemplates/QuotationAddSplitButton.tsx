"use client";

import React, { useRef, useState } from "react";
import { Button, ButtonGroup, ListItemIcon, ListItemText, Menu, MenuItem, SxProps, Theme } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ListAltIcon from "@mui/icons-material/ListAlt";

/**
 * Quotation "+ Add" as a split button (features.enableQuotationTemplates): the
 * main part runs the normal Add, the small arrow opens "Create from template".
 * A toolbar control outside any table, so the menu anchors to the arrow.
 */
export default function QuotationAddSplitButton({
  onAdd,
  onFromTemplate,
  sx,
  tour = "editor-quotation-add",
}: {
  onAdd: () => void;
  onFromTemplate: () => void;
  sx?: SxProps<Theme>;
  tour?: string;
}) {
  const arrowRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <ButtonGroup size="small" variant="contained" disableElevation sx={{ boxShadow: "none" }} data-tour={tour}>
        <Button startIcon={<AddIcon />} onClick={onAdd} sx={sx}>
          Add
        </Button>
        <Button
          ref={arrowRef}
          aria-label="More ways to add"
          aria-haspopup="menu"
          onClick={() => setOpen(true)}
          sx={[{ px: 0.25, minWidth: 0 }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])] as any}
          data-tour="quotation-add-arrow"
        >
          <ArrowDropDownIcon fontSize="small" />
        </Button>
      </ButtonGroup>
      <Menu
        anchorEl={arrowRef.current}
        open={open}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          data-tour="quotation-create-from-template"
          onClick={() => {
            setOpen(false);
            onFromTemplate();
          }}
        >
          <ListItemIcon>
            <ListAltIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Create from template</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
