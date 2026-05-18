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
  Checkbox,
  FormControlLabel,
  InputAdornment,
} from "@mui/material";
import {
  Folder as FolderIcon,
  Search as SearchIcon,
} from "@mui/icons-material";

interface ConfirmAdjustmentDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: ConfirmAdjustmentData) => void;
  documentNumber: string;
  documentType?: string; // "SAI" or "SAO"
}

export interface ConfirmAdjustmentData {
  fromReferenceNo: string;
  toReferenceNo: string;
  deleteConfirmedReference: boolean;
}

export default function ConfirmAdjustmentDialog({
  open,
  onClose,
  onConfirm,
  documentNumber,
  documentType = "SAI",
}: ConfirmAdjustmentDialogProps) {
  const [fromReferenceNo, setFromReferenceNo] = useState(documentNumber);
  const [toReferenceNo, setToReferenceNo] = useState(documentNumber);
  const [deleteConfirmedReference, setDeleteConfirmedReference] = useState(false);

  // Update reference numbers when document number changes
  React.useEffect(() => {
    if (open) {
      setFromReferenceNo(documentNumber);
      setToReferenceNo(documentNumber);
    }
  }, [open, documentNumber]);

  const handleConfirm = () => {
    onConfirm({
      fromReferenceNo,
      toReferenceNo,
      deleteConfirmedReference,
    });
  };

  const handleClose = () => {
    // Reset form
    setFromReferenceNo(documentNumber);
    setToReferenceNo(documentNumber);
    setDeleteConfirmedReference(false);
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
          bgcolor: "surfaceTones.low",
          borderBottom: "1px solid #ddd",
          py: 1,
          px: 2,
        }}
      >
        <Typography variant="subtitle1" fontWeight={500}>
          Confirm Adjustments
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
        <Box sx={{ px: 3, py: 2 }}>
          {/* From Reference No */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <Typography sx={{ width: 140, fontWeight: 500 }}>
              From Reference No.
            </Typography>
            <TextField
              value={fromReferenceNo}
              onChange={(e) => setFromReferenceNo(e.target.value)}
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

          {/* To Reference No */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <Typography sx={{ width: 140, fontWeight: 500 }}>
              To{"    "}Reference No.
            </Typography>
            <TextField
              value={toReferenceNo}
              onChange={(e) => setToReferenceNo(e.target.value)}
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

          {/* Delete Confirmed Reference Checkbox */}
          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={deleteConfirmedReference}
                  onChange={(e) => setDeleteConfirmedReference(e.target.checked)}
                  size="small"
                />
              }
              label="Delete Confirmed Reference"
              sx={{ "& .MuiTypography-root": { fontSize: "0.9rem" } }}
            />
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: "surfaceTones.low" }}>
        <Button
          variant="contained"
          onClick={handleConfirm}
          sx={{
            minWidth: 100,
            bgcolor: "surfaceTones.high",
            color: "text.primary",
            border: "1px solid #ccc",
            "&:hover": { bgcolor: "surfaceTones.highest" },
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
            bgcolor: "surfaceTones.high",
            color: "text.primary",
            border: "1px solid #ccc",
            "&:hover": { bgcolor: "surfaceTones.highest" },
            textTransform: "none",
          }}
        >
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
