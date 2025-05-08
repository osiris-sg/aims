/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef } from "react";
import { Box, Button, InputLabel, Paper, Stack, Typography, useTheme } from "@mui/material";
import { Controller, Control, FieldValues, useFieldArray } from "react-hook-form";
import ImageRenderer from "./ImageRenderer";
import FileUploader, { FileUploaderRef } from "./FileUploader";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";

type FieldItem = {
  data: File | string | null;
};
interface Props {
  label?: string;
  control: Control<FieldValues, object> | undefined | any;
  name: string;
  numberOfUploaders?: number;
  defaultValue?: File[] | string[];
  aspectRatio?: number;
  disabled?: boolean;
  viewMode?: boolean;
}

export default function FormImage(props: Props) {
  const { label, control, name, numberOfUploaders = 1, aspectRatio = 1, disabled, viewMode = false } = props;
  const { fields, replace, update } = useFieldArray<FieldValues, string>({
    control,
    name,
  });
  const theme = useTheme();
  const fileUploaderRef = useRef<FileUploaderRef>(null);
  const typedFields = fields as unknown as FieldItem[];

  const srcUrls = React.useMemo(
    () =>
      typedFields.map((field) => {
        if (typeof field.data === "string") {
          return `${process.env.NEXT_PUBLIC_RESOURCE_URL}${field.data}`;
        } else if (field.data) {
          return URL.createObjectURL(field.data);
        }
        return "";
      }),
    [typedFields]
  );

  useEffect(() => {
    const remaining = numberOfUploaders - typedFields.length;
    if (remaining > 0) {
      replace([...typedFields, ...Array.from({ length: remaining }).map(() => ({ data: null }))]);
    }
  }, [typedFields.length, numberOfUploaders, replace, typedFields]);

  const handleFileUploaded = (file: File | Blob) => {
    const emptyIndex = typedFields.findIndex((field) => !field.data);
    if (emptyIndex !== -1) {
      update(emptyIndex, { data: file });
    }
  };

  const handleDeleteImage = (index: number) => {
    update(index, { data: null });
    // Reset the file uploader to allow re-triggering the upload process
    fileUploaderRef.current?.reset();
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--quarter-gap)",
      }}
    >
      {!viewMode && <InputLabel>{label}</InputLabel>}
      <Stack direction="row" gap="var(--default-gap)">
        <Box>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            {typedFields.map((field, index) => (
              <Paper
                elevation={0}
                key={`file-uploader-wrapper-${index}`}
                sx={{
                  padding: viewMode ? 0 : 2,
                  width: "100%",
                  sm: "30%",
                  backgroundColor: theme.palette.secondary.light,
                }}
              >
                <Controller
                  control={control}
                  name={`${name}[${index}].data`}
                  defaultValue={field.data}
                  render={() =>
                    srcUrls[index] ? (
                      <ImageRenderer src={srcUrls[index]} deleteImage={() => handleDeleteImage(index)} viewMode={viewMode} />
                    ) : (
                      <Box
                        sx={{
                          p: "var(--default-padding)",
                          width: "10rem",
                          height: "10rem",
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                          cursor: "pointer",
                        }}
                        onClick={() => fileUploaderRef.current?.triggerFileUpload()}
                      >
                        <ImageOutlinedIcon
                          sx={{
                            fontSize: 60,
                            color: theme.palette.secondary.contrastText,
                          }}
                        />
                      </Box>
                    )
                  }
                />
              </Paper>
            ))}
          </Stack>
        </Box>
        {!viewMode && label && (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--default-gap)",
            }}
          >
            <Typography variant="body2" sx={{ fontStyle: "italic" }}>
              Please upload an image, size less than 100KB
            </Typography>
            <Stack direction="row" gap="var(--default-gap)" alignItems="center">
              <Button variant="outlined" onClick={() => fileUploaderRef.current?.triggerFileUpload()} disabled={(numberOfUploaders === 1 && !!typedFields[0]?.data) || disabled}>
                Choose File
              </Button>
            </Stack>
          </Box>
        )}
      </Stack>
      {/* Hidden FileUploader that will trigger file selection */}
      <Box sx={{ display: "none" }}>
        <FileUploader ref={fileUploaderRef} onChange={handleFileUploaded} aspectRatio={aspectRatio} />
      </Box>
    </Box>
  );
}
