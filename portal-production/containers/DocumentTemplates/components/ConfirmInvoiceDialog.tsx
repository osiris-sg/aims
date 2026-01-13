"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  TextField,
  Button,
  Typography,
  InputAdornment,
} from "@mui/material";
import {
  Folder as FolderIcon,
  Search as SearchIcon,
} from "@mui/icons-material";

interface ConfirmInvoiceDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: ConfirmInvoiceData) => void;
  documentNumber: string;
}

export interface ConfirmInvoiceData {
  fromInvoiceNo: string;
  toInvoiceNo: string;
}

export default function ConfirmInvoiceDialog({
  open,
  onClose,
  onConfirm,
  documentNumber,
}: ConfirmInvoiceDialogProps) {
  const [fromInvoiceNo, setFromInvoiceNo] = useState(documentNumber);
  const [toInvoiceNo, setToInvoiceNo] = useState(documentNumber);

  // Update reference numbers when document number changes
  React.useEffect(() => {
    if (open) {
      setFromInvoiceNo(documentNumber);
      setToInvoiceNo(documentNumber);
    }
  }, [open, documentNumber]);

  const handleConfirm = () => {
    onConfirm({
      fromInvoiceNo,
      toInvoiceNo,
    });
  };

  const handleClose = () => {
    // Reset form
    setFromInvoiceNo(documentNumber);
    setToInvoiceNo(documentNumber);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 1,
          overflow: "hidden",
        },
      }}
    >
      {/* Header */}
      <DialogTitle
        sx={{
          bgcolor: "#b3d4fc",
          borderBottom: "1px solid #ddd",
          py: 1,
          px: 2,
        }}
      >
        <Typography variant="subtitle1" fontWeight={500}>
          CONFIRMED - Invoice
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        {/* Confirmed Banner */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            bgcolor: "#8B0000",
            color: "white",
            px: 2,
            py: 1.5,
            mx: 2,
            mt: 2,
            borderRadius: 0.5,
          }}
        >
          <FolderIcon sx={{ mr: 2, fontSize: 32, color: "#FFD700" }} />
          <Typography variant="h6" fontWeight={600}>
            CONFIRMED
          </Typography>
        </Box>

        {/* Form Fields */}
        <Box sx={{ px: 3, py: 3 }}>
          {/* From Invoice No */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <Typography sx={{ width: 140, fontWeight: 500 }}>
              From Invoice No.
            </Typography>
            <TextField
              value={fromInvoiceNo}
              onChange={(e) => setFromInvoiceNo(e.target.value)}
              size="small"
              sx={{ flex: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
            />
          </Box>

          {/* To Invoice No */}
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <Typography sx={{ width: 140, fontWeight: 500 }}>
              To{"    "}Invoice No.
            </Typography>
            <TextField
              value={toInvoiceNo}
              onChange={(e) => setToInvoiceNo(e.target.value)}
              size="small"
              sx={{ flex: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: "#f5f5f5", justifyContent: "center" }}>
        <Button
          variant="contained"
          onClick={handleConfirm}
          sx={{
            minWidth: 100,
            bgcolor: "#f0f0f0",
            color: "text.primary",
            border: "1px solid #ccc",
            "&:hover": { bgcolor: "#e0e0e0" },
            textTransform: "none",
          }}
        >
          OK
        </Button>
        <Button
          variant="contained"
          onClick={handleClose}
          sx={{
            minWidth: 100,
            bgcolor: "#f0f0f0",
            color: "text.primary",
            border: "1px solid #ccc",
            "&:hover": { bgcolor: "#e0e0e0" },
            textTransform: "none",
          }}
        >
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
