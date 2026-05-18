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
} from "@mui/material";
import {
  Folder as FolderIcon,
} from "@mui/icons-material";

interface ConfirmPRDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: ConfirmPRData) => void;
  documentNumber: string;
}

export interface ConfirmPRData {
  purchaseReturnNo: string;
  linkToAccounts: boolean;
  supplierDONo: string;
  supplierDODate: string;
  supplierInvoiceNo: string;
  supplierInvoiceDate: string;
  rate: number;
  purchases: string;
  purchasesAmount: number;
  taxGST: string;
  taxGSTAmount: number;
  freightCharges: string;
  freightChargesAmount: number;
  insurance: string;
  insuranceAmount: number;
  creditorBank: string;
  creditorBankAmount: number;
}

export default function ConfirmPRDialog({
  open,
  onClose,
  onConfirm,
  documentNumber,
}: ConfirmPRDialogProps) {
  const [linkToAccounts, setLinkToAccounts] = useState(false);
  const [supplierDONo, setSupplierDONo] = useState("");
  const [supplierDODate, setSupplierDODate] = useState(new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }));
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState(new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }));
  const [rate, setRate] = useState(1.0);
  const [purchases, setPurchases] = useState("CS001");
  const [purchasesAmount, setPurchasesAmount] = useState(0);
  const [taxGST, setTaxGST] = useState("CL900");
  const [taxGSTAmount, setTaxGSTAmount] = useState(0);
  const [freightCharges, setFreightCharges] = useState("");
  const [freightChargesAmount, setFreightChargesAmount] = useState(0);
  const [insurance, setInsurance] = useState("");
  const [insuranceAmount, setInsuranceAmount] = useState(0);
  const [creditorBank, setCreditorBank] = useState("CL001");
  const [creditorBankAmount, setCreditorBankAmount] = useState(0);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setLinkToAccounts(false);
      setSupplierDONo("");
      setSupplierDODate(new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }));
      setSupplierInvoiceNo("");
      setSupplierInvoiceDate(new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }));
      setRate(1.0);
    }
  }, [open]);

  const handleConfirm = () => {
    onConfirm({
      purchaseReturnNo: documentNumber,
      linkToAccounts,
      supplierDONo,
      supplierDODate,
      supplierInvoiceNo,
      supplierInvoiceDate,
      rate,
      purchases,
      purchasesAmount,
      taxGST,
      taxGSTAmount,
      freightCharges,
      freightChargesAmount,
      insurance,
      insuranceAmount,
      creditorBank,
      creditorBankAmount,
    });
  };

  const handleClose = () => {
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
          bgcolor: "#0a0a0a",
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
          {/* Purchase Return No */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <Typography sx={{ width: 160, fontWeight: 500 }}>
              Purchase Return No.
            </Typography>
            <TextField
              value={documentNumber}
              size="small"
              sx={{ flex: 1 }}
              InputProps={{
                readOnly: true,
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
                />
              }
              label="Link to Accounts"
            />
          </Box>

          {/* Conditional Fields based on Link to Accounts */}
          {!linkToAccounts ? (
            <>
              {/* Supplier D/O No */}
              <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
                <Typography sx={{ width: 160 }}>Supplier D/O No.</Typography>
                <TextField
                  value={supplierDONo}
                  onChange={(e) => setSupplierDONo(e.target.value)}
                  size="small"
                  sx={{ flex: 1 }}
                />
              </Box>

              {/* Supplier D/O Date */}
              <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
                <Typography sx={{ width: 160 }}>Supplier D/O Date</Typography>
                <TextField
                  value={supplierDODate}
                  onChange={(e) => setSupplierDODate(e.target.value)}
                  size="small"
                  sx={{ flex: 1 }}
                />
              </Box>
            </>
          ) : (
            <>
              {/* Supplier Invoice No */}
              <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
                <Typography sx={{ width: 160 }}>Supplier Invoice No.</Typography>
                <TextField
                  value={supplierInvoiceNo}
                  onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                  size="small"
                  sx={{ flex: 1 }}
                />
              </Box>

              {/* Supplier Invoice Date */}
              <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
                <Typography sx={{ width: 160 }}>Supplier Invoice Date</Typography>
                <TextField
                  value={supplierInvoiceDate}
                  onChange={(e) => setSupplierInvoiceDate(e.target.value)}
                  size="small"
                  sx={{ flex: 1 }}
                />
              </Box>
            </>
          )}

          {/* Rate */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <Typography sx={{ width: 160 }}>Rate</Typography>
            <TextField
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
              size="small"
              type="number"
              sx={{ flex: 1 }}
            />
          </Box>

          {/* Account Linking Fields */}
          <Box sx={{ mt: 2 }}>
            {/* Purchases */}
            <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
              <Typography sx={{ width: 120 }}>Purchases</Typography>
              <TextField
                value={purchases}
                onChange={(e) => setPurchases(e.target.value)}
                size="small"
                sx={{ width: 100 }}
              />
              <Typography sx={{ mx: 1 }}>(CR)</Typography>
              <TextField
                value={purchasesAmount}
                onChange={(e) => setPurchasesAmount(parseFloat(e.target.value) || 0)}
                size="small"
                type="number"
                sx={{ width: 100 }}
              />
              <Typography sx={{ ml: 1 }}>SGD</Typography>
            </Box>

            {/* Tax (GST) */}
            <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
              <Typography sx={{ width: 120 }}>Tax (GST)</Typography>
              <TextField
                value={taxGST}
                onChange={(e) => setTaxGST(e.target.value)}
                size="small"
                sx={{ width: 100 }}
              />
              <Typography sx={{ mx: 1 }}>(CR)</Typography>
              <TextField
                value={taxGSTAmount}
                onChange={(e) => setTaxGSTAmount(parseFloat(e.target.value) || 0)}
                size="small"
                type="number"
                sx={{ width: 100 }}
              />
              <Typography sx={{ ml: 1 }}>SGD</Typography>
            </Box>

            {/* Freight Charges */}
            <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
              <Typography sx={{ width: 120 }}>Freight Charges</Typography>
              <TextField
                value={freightCharges}
                onChange={(e) => setFreightCharges(e.target.value)}
                size="small"
                sx={{ width: 100 }}
              />
              <Typography sx={{ mx: 1 }}>(CR)</Typography>
              <TextField
                value={freightChargesAmount}
                onChange={(e) => setFreightChargesAmount(parseFloat(e.target.value) || 0)}
                size="small"
                type="number"
                sx={{ width: 100 }}
              />
              <Typography sx={{ ml: 1 }}>SGD</Typography>
            </Box>

            {/* Insurance */}
            <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
              <Typography sx={{ width: 120 }}>Insurance</Typography>
              <TextField
                value={insurance}
                onChange={(e) => setInsurance(e.target.value)}
                size="small"
                sx={{ width: 100 }}
              />
              <Typography sx={{ mx: 1 }}>(CR)</Typography>
              <TextField
                value={insuranceAmount}
                onChange={(e) => setInsuranceAmount(parseFloat(e.target.value) || 0)}
                size="small"
                type="number"
                sx={{ width: 100 }}
              />
              <Typography sx={{ ml: 1 }}>SGD</Typography>
            </Box>

            {/* Creditor / Bank */}
            <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
              <Typography sx={{ width: 120 }}>Creditor / Bank</Typography>
              <TextField
                value={creditorBank}
                onChange={(e) => setCreditorBank(e.target.value)}
                size="small"
                sx={{ width: 100 }}
              />
              <Typography sx={{ mx: 1 }}>(DR)</Typography>
              <TextField
                value={creditorBankAmount}
                onChange={(e) => setCreditorBankAmount(parseFloat(e.target.value) || 0)}
                size="small"
                type="number"
                sx={{ width: 100 }}
              />
              <Typography sx={{ ml: 1 }}>SGD</Typography>
            </Box>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: "surfaceTones.low", justifyContent: "center" }}>
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
