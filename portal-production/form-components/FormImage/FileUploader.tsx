import { useCallback, useState, useRef, forwardRef, useImperativeHandle } from "react";
import { Accept, useDropzone } from "react-dropzone";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import ImageResizer from "./ImageResizer";
import { Box, useTheme } from "@mui/material";

interface Props {
  numberOfFiles?: number;
  acceptedFileTypes?: Accept | undefined;
  onChange?: (file: File | Blob) => void;
  value?: string | File;
  aspectRatio?: number;
}

// Expose this interface so that parent components can call triggerFileUpload.
export interface FileUploaderRef {
  triggerFileUpload: () => void;
  reset: () => void;
}

const FileUploader = forwardRef<FileUploaderRef, Props>((props, ref) => {
  const theme = useTheme();
  const { acceptedFileTypes = { "image/jpeg": [], "image/png": [], "image/jpg": [] }, numberOfFiles = 1, onChange = () => {}, aspectRatio = 1 } = props;
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  // Create a ref for the hidden file input.
  const inputRef = useRef<HTMLInputElement | null>(null);

  // When files are dropped/selected, update state.
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      setUploadedImage(acceptedFiles[0]);
    }
  }, []);

  // Configure react-dropzone.
  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: acceptedFileTypes,
    maxFiles: numberOfFiles,
  });

  // Expose methods to trigger file upload and reset the component state.
  useImperativeHandle(ref, () => ({
    triggerFileUpload: () => {
      if (inputRef.current) {
        inputRef.current.click();
      }
    },
    reset: () => {
      setUploadedImage(null); // Reset the uploaded image state
      if (inputRef.current) {
        inputRef.current.value = ""; // Reset the file input
      }
    },
  }));
  return (
    <>
      <Box
        {...getRootProps()}
        sx={{
          p: "var(--default-padding)",
          width: "10rem",
          height: "10rem",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          cursor: "pointer",
        }}
      >
        {/* Attach the custom ref to the input */}
        <input {...getInputProps()} ref={inputRef} style={{ display: "none" }} />
        <ImageOutlinedIcon sx={{ fontSize: "3.75rem", color: theme.palette.secondary.contrastText }} />
      </Box>
      {uploadedImage && (
        <ImageResizer
          aspectRatio={aspectRatio}
          imageFile={URL.createObjectURL(uploadedImage)}
          onCancel={() => setUploadedImage(null)}
          onComplete={(croppedImageBlob) => {
            setUploadedImage(null);
            onChange(croppedImageBlob);
          }}
        />
      )}
    </>
  );
});

FileUploader.displayName = "FileUploader";

export default FileUploader;
