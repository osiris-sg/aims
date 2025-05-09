import { Dialog, DialogActions, DialogTitle, Button, useTheme } from "@mui/material";
import React from "react";

interface Props {
  onCancel: () => void;
  open: boolean;
  onConfirm: () => void;
  loading?: boolean;
}

export default function DeleteItemDialoNoConfirm(props: Props) {
  const { open, onCancel, onConfirm, loading } = props;
  const theme = useTheme();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="md"
      fullWidth
      sx={{
        "& .MuiDialog-paper": {
          backgroundColor: theme.palette.primary.contrastText,
          borderRadius: 2,
          boxShadow: 3,
        },
      }}
    >
      <DialogTitle
        variant="body1"
        sx={{
          borderBottom: `1px solid ${theme.palette.secondary.light}`,
        }}
      >
        Are you sure you want to delete the item?
      </DialogTitle>

      <DialogActions sx={{ borderTop: `1px solid ${theme.palette.secondary.light}` }}>
        <Button disabled={loading} variant="outlined" onClick={onCancel}>
          No
        </Button>
        <Button disabled={loading} variant="contained" onClick={onConfirm} color="error" loading={loading}>
          Yes
        </Button>
      </DialogActions>
    </Dialog>
  );
}
