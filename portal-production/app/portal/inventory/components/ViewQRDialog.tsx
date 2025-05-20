import { Box, Button, Dialog, DialogActions, DialogTitle, Skeleton, Typography, useTheme } from "@mui/material";
import Image from "next/image";
import React from "react";

interface Props {
  onClose: () => void;
  open: boolean;
  isQRLoading: boolean;
  qrCode: string | null;
}

export default function ViewQRDialog(props: Props) {
  const { open, onClose, isQRLoading, qrCode } = props;
  const theme = useTheme();

  return (
    <Dialog
      open={open}
      onClose={onClose}
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
        QR Code
      </DialogTitle>

      <Box display="flex" justifyContent="center" alignItems="center" minHeight="320px" width="100%">
        <Box width={300} height={300} display="flex" justifyContent="center" alignItems="center">
          {isQRLoading ? (
            <Skeleton variant="rectangular" width="90%" height="90%" sx={{ borderRadius: 2 }} animation="wave" />
          ) : qrCode ? (
            <Image src={qrCode} alt="QR Code" width={300} height={300} style={{ objectFit: "contain", display: "block" }} />
          ) : (
            <Typography variant="body2" color="error">
              Failed to load QR code.
            </Typography>
          )}
        </Box>
      </Box>

      <DialogActions sx={{ borderTop: `1px solid ${theme.palette.secondary.light}` }}>
        <Button variant="outlined" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
