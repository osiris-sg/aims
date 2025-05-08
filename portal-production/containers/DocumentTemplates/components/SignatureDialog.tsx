"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useRef, useState } from "react";
import { Dialog, DialogActions, DialogContent, DialogTitle, Button, Box, IconButton, useTheme, Typography } from "@mui/material";
import SignatureCanvas from "react-signature-canvas";

import DeleteIcon from "@mui/icons-material/Delete";
import { Control, Controller, FieldValues } from "react-hook-form";
// import ImageRenderer from "@/form-components/FormImage/ImageRenderer";
import Image from "next/image";
import CloseIcon from "@mui/icons-material/Close";

interface SignatureProps {
  label: "company" | "customer";
  viewMode: boolean;
  name: string;
  control: Control<FieldValues, object> | undefined | any;
}

export default function SignatureDialog({ label, viewMode, control, name }: SignatureProps) {
  const [open, setOpen] = useState(false);
  const sigCanvasRef = useRef<SignatureCanvas>(null);
  const theme = useTheme();

  // 👇 Watch the current signature value from the form state
  // const signature = useWatch({ control, name: `signature.${label}` });

  const handleOpen = () => {
    if (!viewMode) {
      setOpen(true);
    }
  };
  const handleClose = () => setOpen(false);

  const isBase64 = (str: string | null): boolean => {
    return str?.startsWith("data:image/png;base64,") ?? false;
  };
  return (
    <Controller
      name={name}
      control={control}
      render={({ field: { onChange, value } }) => {
        const saveSignature = () => {
          if (sigCanvasRef.current) {
            const signedImage = sigCanvasRef.current?.getTrimmedCanvas().toDataURL("image/png");
            onChange(signedImage);
            handleClose();
          }
        };
        const clearSignature = () => {
          if (sigCanvasRef.current) {
            sigCanvasRef.current.clear();
          }
          onChange(null);
        };
        return (
          <Box sx={{ position: "relative" }}>
            <Box onClick={handleOpen} sx={{ width: 300, height: 80, border: "1px solid black", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {/* {value && <ImageRenderer src={value} width={300} height={80} />} */}
              {value ? (
                isBase64(value) ? (
                  // Render Base64 signature
                  <Image src={value} alt={`${label} Signature`} width={300} height={80} style={{ position: "relative", objectFit: "contain" }} />
                ) : (
                  // Render S3 URL signature
                  <Image src={`${process.env.NEXT_PUBLIC_RESOURCE_URL}${value}`} alt={`${label} Signature`} width={300} height={80} />
                )
              ) : !viewMode ? (
                <Typography variant="body1">Click here to sign</Typography>
              ) : (
                <Typography variant="body2" color="textSecondary">
                  No signature
                </Typography>
              )}
            </Box>

            {value && !viewMode && (
              <IconButton
                onClick={clearSignature}
                sx={{
                  position: "absolute",
                  bottom: 1,
                  left: 1,
                  zIndex: 2,
                  backgroundColor: theme.palette.secondary.light,
                }}
              >
                <DeleteIcon color="primary" />
              </IconButton>
            )}

            <Dialog
              open={open}
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
                {label.charAt(0).toUpperCase() + label.slice(1)} Signature
              </DialogTitle>
              <IconButton
                aria-label="close"
                onClick={handleClose}
                sx={(theme) => ({
                  position: "absolute",
                  right: 8,
                  top: 8,
                  color: theme.palette.grey[500],
                })}
              >
                <CloseIcon />
              </IconButton>
              <DialogContent>
                <Box sx={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", pt: 4 }}>
                  <SignatureCanvas
                    ref={sigCanvasRef}
                    canvasProps={{
                      width: 600,
                      height: 160,
                      className: "signatureCanvas",
                      style: {
                        border: "1px solid black",
                      },
                    }}
                  />
                </Box>
              </DialogContent>
              <DialogActions>
                <Button onClick={clearSignature} variant="outlined">
                  Clear
                </Button>
                <Button onClick={saveSignature} variant="contained" color="primary">
                  Save
                </Button>
              </DialogActions>
            </Dialog>
          </Box>
        );
      }}
    />
  );
}
