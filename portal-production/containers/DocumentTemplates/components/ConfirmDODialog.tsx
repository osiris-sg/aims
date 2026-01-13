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

interface ConfirmDODialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: ConfirmDOData) => void;
  documentNumber: string;
}

export interface ConfirmDOData {
  fromDONo: string;
  toDONo: string;
}

export default function ConfirmDODialog({
  open,
  onClose,
  onConfirm,
  documentNumber,
}: ConfirmDODialogProps) {
  const [fromDONo, setFromDONo] = useState(documentNumber);
  const [toDONo, setToDONo] = useState(documentNumber);

  // Update reference numbers when document number changes
  React.useEffect(() => {
    if (open) {
      setFromDONo(documentNumber);
      setToDONo(documentNumber);
    }
  }, [open, documentNumber]);

  const handleConfirm = () => {
    onConfirm({
      fromDONo,
      toDONo,
    });
  };

  const handleClose = () => {
    // Reset form
    setFromDONo(documentNumber);
    setToDONo(documentNumber);
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
          CONFIRMED - Delivery Order
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
          {/* From Delivery Order No */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <Typography sx={{ width: 160, fontWeight: 500 }}>
              From Delivery Order No.
            </Typography>
            <TextField
              value={fromDONo}
              onChange={(e) => setFromDONo(e.target.value)}
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

          {/* To Delivery Order No */}
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <Typography sx={{ width: 160, fontWeight: 500 }}>
              To{"    "}Delivery Order No.
            </Typography>
            <TextField
              value={toDONo}
              onChange={(e) => setToDONo(e.target.value)}
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
