"use client";
import React, { useState } from "react";
import {
  Box,
  Typography,
  Button,
  ButtonGroup,
  TextField,
  Paper,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import EditIcon from "@mui/icons-material/Edit";
import { useAdjustQuantity } from "../hooks/useQuantityAdjustment";
import { toast } from "react-toastify";

interface ProductQuantityAdjusterProps {
  assetId: string;
  currentQuantity: number;
  onUpdate?: () => void;
}

export default function ProductQuantityAdjuster({
  assetId,
  currentQuantity,
  onUpdate,
}: ProductQuantityAdjusterProps) {
  const [setDialogOpen, setSetDialogOpen] = useState(false);
  const [newQuantity, setNewQuantity] = useState<number>(currentQuantity);
  const [reason, setReason] = useState("");

  const adjustMutation = useAdjustQuantity();

  const handleQuickAdjust = async (amount: number, type: "ADD" | "SUBTRACT") => {
    try {
      await adjustMutation.mutateAsync({
        assetId,
        amount,
        type,
      });
      toast.success(`Quantity ${type === "ADD" ? "increased" : "decreased"} by ${amount}`);
      onUpdate?.();
    } catch (error: any) {
      toast.error(error.message || "Failed to adjust quantity");
    }
  };

  const handleSetQuantity = async () => {
    try {
      await adjustMutation.mutateAsync({
        assetId,
        amount: newQuantity,
        type: "SET",
        reason: reason || undefined,
      });
      toast.success(`Quantity set to ${newQuantity}`);
      setSetDialogOpen(false);
      setReason("");
      onUpdate?.();
    } catch (error: any) {
      toast.error(error.message || "Failed to set quantity");
    }
  };

  const isLoading = adjustMutation.isPending;

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Product Quantity
      </Typography>

      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", mb: 3 }}>
        <Typography variant="h1" fontWeight={300} color="primary">
          {currentQuantity}
        </Typography>
        <Typography variant="h5" color="text.secondary" sx={{ ml: 1 }}>
          units
        </Typography>
      </Box>

      <Stack spacing={2}>
        {/* Quick Adjust Buttons */}
        <Box sx={{ display: "flex", justifyContent: "center", gap: 2 }}>
          <ButtonGroup variant="outlined" disabled={isLoading}>
            <Button
              onClick={() => handleQuickAdjust(10, "SUBTRACT")}
              disabled={currentQuantity < 10}
              startIcon={<RemoveIcon />}
            >
              10
            </Button>
            <Button
              onClick={() => handleQuickAdjust(1, "SUBTRACT")}
              disabled={currentQuantity < 1}
              startIcon={<RemoveIcon />}
            >
              1
            </Button>
          </ButtonGroup>

          <ButtonGroup variant="contained" disabled={isLoading}>
            <Button onClick={() => handleQuickAdjust(1, "ADD")} startIcon={<AddIcon />}>
              1
            </Button>
            <Button onClick={() => handleQuickAdjust(10, "ADD")} startIcon={<AddIcon />}>
              10
            </Button>
          </ButtonGroup>
        </Box>

        {/* Set Specific Quantity Button */}
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <Button
            variant="outlined"
            color="secondary"
            startIcon={<EditIcon />}
            onClick={() => {
              setNewQuantity(currentQuantity);
              setSetDialogOpen(true);
            }}
            disabled={isLoading}
          >
            Set Specific Quantity
          </Button>
        </Box>

        {isLoading && (
          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <CircularProgress size={24} />
          </Box>
        )}
      </Stack>

      {/* Set Quantity Dialog */}
      <Dialog open={setDialogOpen} onClose={() => setSetDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Set Quantity</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="New Quantity"
              type="number"
              fullWidth
              value={newQuantity}
              onChange={(e) => setNewQuantity(Math.max(0, Number(e.target.value)))}
              inputProps={{ min: 0 }}
            />
            <TextField
              label="Reason (optional)"
              fullWidth
              multiline
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Stock count correction, Received shipment..."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSetDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSetQuantity}
            disabled={adjustMutation.isPending}
          >
            {adjustMutation.isPending ? "Updating..." : "Set Quantity"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
