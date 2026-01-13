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
  Divider,
  InputAdornment,
  IconButton,
} from "@mui/material";
import {
  Folder as FolderIcon,
  Search as SearchIcon,
} from "@mui/icons-material";

interface AccountEntry {
  label: string;
  code: string;
  type: "DR" | "CR";
  amount: number;
  currency: string;
}

interface ConfirmPODialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: ConfirmPOData) => void;
  poNumber: string;
  documentType?: string; // "PO" or "PR"
}

export interface ConfirmPOData {
  supplierDONo: string;
  supplierDODate: string;
  rate: number;
  linkToAccounts: boolean;
  accountEntries?: AccountEntry[];
}

export default function ConfirmPODialog({
  open,
  onClose,
  onConfirm,
  poNumber,
  documentType = "PO",
}: ConfirmPODialogProps) {
  const [supplierDONo, setSupplierDONo] = useState("");
  const [supplierDODate, setSupplierDODate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [rate, setRate] = useState("1.000000");
  const [linkToAccounts, setLinkToAccounts] = useState(false);

  // Determine labels based on document type
  const isPurchaseReturn = documentType === "PR" || documentType === "PURCHASE_RETURN";
  const documentLabel = isPurchaseReturn ? "Purchase Return" : "Purchase Order";

  // Placeholder account entries (UI only for now)
  const accountEntries: AccountEntry[] = [
    { label: "Purchases", code: "CS001", type: "DR", amount: 0.00, currency: "SGD" },
    { label: "Tax (GST)", code: "CL900", type: "DR", amount: 0.00, currency: "SGD" },
    { label: "Freight Charges", code: "", type: "DR", amount: 0.00, currency: "SGD" },
    { label: "Insurance", code: "", type: "DR", amount: 0.00, currency: "SGD" },
    { label: "Creditor / Bank", code: "CL001", type: "CR", amount: 0.00, currency: "SGD" },
  ];

  const handleConfirm = () => {
    onConfirm({
      supplierDONo,
      supplierDODate,
      rate: parseFloat(rate) || 1,
      linkToAccounts,
      accountEntries: linkToAccounts ? accountEntries : undefined,
    });
  };

  const handleClose = () => {
    // Reset form
    setSupplierDONo("");
    setSupplierDODate(new Date().toISOString().split("T")[0]);
    setRate("1.000000");
    setLinkToAccounts(false);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
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
          bgcolor: "#f5f5f5",
          borderBottom: "1px solid #ddd",
          py: 1,
          px: 2,
        }}
      >
        <Typography variant="subtitle1" fontWeight={500}>
          Update Stock / Accounts
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
          {/* Document Number */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <Typography sx={{ width: 160, fontWeight: 500 }}>
              {documentLabel} No.
            </Typography>
            <TextField
              value={poNumber}
              disabled
              size="small"
              sx={{ flex: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
                sx: { bgcolor: "#f9f9f9" },
              }}
            />
          </Box>

          {/* Link to Accounts Checkbox */}
          <Box sx={{ display: "flex", justifyContent: "center", mb: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={linkToAccounts}
                  onChange={(e) => setLinkToAccounts(e.target.checked)}
                  size="small"
                />
              }
              label="Link to Accounts"
              sx={{ "& .MuiTypography-root": { fontSize: "0.9rem" } }}
            />
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Supplier D/O No */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
            <Typography sx={{ width: 160, fontWeight: 500 }}>
              Supplier D/O No.
            </Typography>
            <TextField
              value={supplierDONo}
              onChange={(e) => setSupplierDONo(e.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
          </Box>

          {/* Supplier D/O Date */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
            <Typography sx={{ width: 160, fontWeight: 500 }}>
              Supplier D/O Date
            </Typography>
            <TextField
              type="date"
              value={supplierDODate}
              onChange={(e) => setSupplierDODate(e.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
          </Box>

          {/* Rate */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <Typography sx={{ width: 160, fontWeight: 500 }}>
              Rate
            </Typography>
            <TextField
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              size="small"
              sx={{ flex: 1 }}
              inputProps={{ style: { textAlign: "right" } }}
            />
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Account Entries Section */}
          <Box sx={{ opacity: linkToAccounts ? 1 : 0.5 }}>
            {accountEntries.map((entry, index) => (
              <Box
                key={index}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  mb: 1,
                  gap: 1,
                }}
              >
                <Typography sx={{ width: 130, fontWeight: 500, fontSize: "0.85rem" }}>
                  {entry.label}
                </Typography>
                <IconButton size="small" disabled={!linkToAccounts}>
                  <SearchIcon fontSize="small" />
                </IconButton>
                <TextField
                  value={entry.code}
                  disabled
                  size="small"
                  sx={{ width: 80 }}
                  inputProps={{ style: { fontSize: "0.85rem" } }}
                />
                <Typography
                  sx={{
                    width: 40,
                    textAlign: "center",
                    fontWeight: 600,
                    color: entry.type === "DR" ? "error.main" : "success.main",
                    fontSize: "0.85rem",
                  }}
                >
                  ({entry.type})
                </Typography>
                <TextField
                  value={entry.amount.toFixed(2)}
                  disabled
                  size="small"
                  sx={{ width: 80 }}
                  inputProps={{ style: { textAlign: "right", fontSize: "0.85rem" } }}
                />
                <Typography sx={{ fontSize: "0.85rem", color: "text.secondary" }}>
                  {entry.currency}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: "#f5f5f5" }}>
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
