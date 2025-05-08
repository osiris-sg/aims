/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useRef, useState } from "react";
import Dialog from "@mui/material/Dialog";
import ReactCrop, { centerCrop, makeAspectCrop, Crop, PixelCrop } from "react-image-crop";
import CloseIcon from "@mui/icons-material/Close";
import { Box, Button, DialogActions, DialogTitle, IconButton, useTheme } from "@mui/material";
import "react-image-crop/dist/ReactCrop.css";
import Image from "next/image";

interface Props {
  onComplete: (croppedImageBlob: Blob) => void;
  onCancel: () => void;
  imageFile: string; // Assuming this is the URL of the uploaded image
  aspectRatio?: number;
}

export default function ImageResizer(props: Props) {
  const theme = useTheme();
  const { onComplete, onCancel, imageFile, aspectRatio = 1 } = props;
  const [crop, setCrop] = useState<Crop | undefined>(undefined);
  const imageRef = useRef<HTMLImageElement>(null);

  function centerAspectCrop(mediaWidth: number, mediaHeight: number, aspect: number) {
    return centerCrop(
      makeAspectCrop(
        {
          unit: "px",
          width: mediaWidth * 0.9,
        },

        aspect,
        mediaWidth,
        mediaHeight
      ),
      mediaWidth,
      mediaHeight
    );
  }

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    if (aspectRatio) {
      const { width, height } = e.currentTarget;
      setCrop(centerAspectCrop(width, height, aspectRatio));
    }
  }

  async function getCroppedImage(): Promise<Blob | null> {
    if (!crop || !imageRef.current) {
      return null;
    }

    const image = imageRef.current;
    const canvas = document.createElement("canvas");
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    canvas.width = crop.width! * scaleX;
    canvas.height = crop.height! * scaleY;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.drawImage(image, crop.x! * scaleX, crop.y! * scaleY, crop.width! * scaleX, crop.height! * scaleY, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          resolve(blob || null);
        },
        "image/png",
        1
      );
    });
  }

  async function handleSave() {
    const croppedImageBlob = await getCroppedImage();
    if (croppedImageBlob) {
      onComplete(croppedImageBlob); // Pass the cropped image blob to the parent
    }
  }

  return (
    <Dialog
      open={true}
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
        variant="body2"
        color={theme.palette.text.secondary}
        sx={{
          borderBottom: `1px solid ${theme.palette.secondary.light}`,
        }}
      >
        Image Cropper
      </DialogTitle>
      <IconButton
        aria-label="close"
        onClick={onCancel}
        sx={(theme) => ({
          position: "absolute",
          right: 8,
          top: 8,
          color: theme.palette.grey[500],
        })}
      >
        <CloseIcon />
      </IconButton>

      <Box sx={{ textAlign: "center", padding: "var(--default-gap)" }}>
        <ReactCrop
          crop={crop}
          onChange={(newCrop: PixelCrop) => setCrop(newCrop)}
          aspect={aspectRatio}
          style={{
            display: "inline-block",
            maxWidth: "100%",
          }}
        >
          <Image ref={imageRef} src={imageFile} alt="Crop" width={600} height={550} onLoad={onImageLoad} style={{ position: "relative", width: "auto", height: "50vh" }} />
        </ReactCrop>
      </Box>
      <DialogActions sx={{ borderTop: `1px solid ${theme.palette.secondary.light}` }}>
        <Button variant="outlined" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => handleSave()}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
