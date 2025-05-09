import React, { useState } from "react";
import { Dialog, DialogActions, DialogTitle, Button, DialogContent, DialogContentText, useTheme } from "@mui/material";

interface DeleteItemDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  dialogTitle: string;
  dialogDescription?: string;
  confirmButton: {
    action?: () => Promise<void>;
    children: string;
    buttonProps?: React.ComponentProps<typeof Button>;
  };
  cancelButton?: {
    action?: () => Promise<void>;
    children: React.ReactNode;
    buttonProps?: React.ComponentProps<typeof Button>;
  };
  challengeText?: string;
}

export default function DeleteItemDialog({ open, onOpenChange, dialogTitle, dialogDescription, confirmButton, cancelButton, challengeText }: DeleteItemDialogProps) {
  const theme = useTheme();
  const [challengeInput, setChallengeInput] = useState("");

  const handleClose = () => {
    if (onOpenChange) {
      onOpenChange(false);
    }
    setChallengeInput("");
  };

  const handleConfirm = async () => {
    try {
      if (confirmButton.action) {
        await confirmButton.action();
      }
    } finally {
      if (onOpenChange) {
        onOpenChange(false); // ✅ always close, even on error
      }
      setChallengeInput("");
    }
  };

  return (
    <Dialog
      open={!!open}
      onClose={handleClose}
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
      <DialogTitle>{dialogTitle}</DialogTitle>
      {dialogDescription && (
        <DialogContent>
          <DialogContentText>{dialogDescription}</DialogContentText>
          {challengeText && (
            <>
              <label htmlFor="challengeInput">Please type &apos;{challengeText}&apos; to confirm.</label>
              <input id="challengeInput" value={challengeInput} onChange={(e) => setChallengeInput(e.target.value)} style={{ width: "100%", padding: "8px", marginTop: "8px" }} />
            </>
          )}
        </DialogContent>
      )}
      <DialogActions>
        {cancelButton ? (
          <Button
            {...cancelButton.buttonProps}
            onClick={async () => {
              if (cancelButton.action) {
                await cancelButton.action();
              }
              handleClose();
            }}
          >
            {cancelButton.children}
          </Button>
        ) : (
          <Button onClick={handleClose}>Cancel</Button>
        )}
        <Button {...confirmButton.buttonProps} onClick={handleConfirm} disabled={!!challengeText && challengeInput !== challengeText}>
          {confirmButton.children}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
