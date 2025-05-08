/* eslint-disable react/display-name */
"use client";

import { memo, useEffect, useState } from "react";
import Image from "next/image";
import { IconButton, Skeleton, Box, useTheme } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";

interface Props {
  src: string;
  deleteImage?: () => void;
  onClick?: () => void;
  zoomOnHover?: boolean;
  viewMode?: boolean;
  width?: number;
  height?: number;
}

const ImageRenderer = memo(({ src, deleteImage, onClick, zoomOnHover = false, viewMode, width, height }: Props) => {
  const [imageAvailable, setImageAvailable] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const theme = useTheme();

  useEffect(() => {
    if (!src) return;

    const img = new window.Image();
    img.src = src;
    img.onload = () => setImageAvailable(true);
    img.onerror = () => {
      setTimeout(() => setRetryCount((prev) => prev + 1), 2000);
    };
  }, [src, retryCount]);

  return (
    <Box
      onClick={onClick}
      sx={{
        position: "relative",
        width: width || "10rem",
        height: height || "10rem",
        overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
        "&:hover img": zoomOnHover ? { transform: "scale(1.1)", transition: "0.3s" } : {},
      }}
    >
      {imageAvailable ? (
        <>
          {deleteImage && !viewMode && (
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                deleteImage();
              }}
              sx={{
                position: "absolute",
                top: 5,
                right: 5,
                zIndex: 2,
                backgroundColor: theme.palette.secondary.light,
              }}
            >
              <DeleteIcon color="primary" />
            </IconButton>
          )}
          <Image
            src={src}
            alt="image-preview"
            layout="fill"
            objectFit="cover"
            onError={() => {
              setImageAvailable(false);
              setRetryCount((prev) => prev + 1);
            }}
            priority
          />
        </>
      ) : (
        <Skeleton variant="rectangular" width="100%" height="100%" />
      )}
    </Box>
  );
});

export default ImageRenderer;
