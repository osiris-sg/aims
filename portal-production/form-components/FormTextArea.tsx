/* eslint-disable @typescript-eslint/no-explicit-any */
import markdownToHtml from "@/helpers/markdownToHtml";
import { Box, InputLabel, TextField, Typography } from "@mui/material";
import React from "react";
import { Control, Controller, FieldValues } from "react-hook-form";

interface Props {
  control: Control<FieldValues, object> | undefined | any;
  name: string;
  label?: string;
  placeHolder?: string;
  bottomText?: string;
  labelArriangment?: "vertical" | "horizontal";
  rules?: any;
  defaultValue?: string;
  description?: string;
  disabled?: boolean;
  rows?: number;
  maxRows?: number;
  maxLength?: number;
  required?: boolean;
  fullWidth?: boolean;
  viewMode?: boolean;
}

export default function FormTextarea(props: Props) {
  const { fullWidth = true, control, name, label, placeHolder, bottomText, defaultValue = "", description, disabled, rows = 4, maxRows, maxLength, required, rules = {}, labelArriangment = "vertical", viewMode = false } = props;

  return (
    <Controller
      control={control}
      name={name}
      rules={rules}
      defaultValue={defaultValue}
      render={({ field: { onChange, value, ref }, fieldState: { error } }) => (
        <Box
          sx={{
            display: "flex",
            flexDirection: labelArriangment === "vertical" ? "column" : "row",
            gap: "var(--quarter-gap)",
          }}
        >
          {label && (
            <InputLabel
              required={required}
              sx={{
                color: viewMode ? "text.primary" : "text.secondary",
              }}
            >
              {label}
            </InputLabel>
          )}
          {description && <Typography variant="caption">{description}</Typography>}
          {!viewMode ? (
            <TextField
              disabled={disabled}
              placeholder={placeHolder}
              fullWidth={fullWidth}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              ref={ref}
              multiline
              rows={rows}
              maxRows={maxRows}
              inputProps={{ maxLength: maxLength }}
              error={!!error}
              helperText={error ? error.message : bottomText}
            />
          ) : (
            <Typography
              variant="body1"
              sx={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              dangerouslySetInnerHTML={{ __html: markdownToHtml(value || "") }}
            />
          )}
        </Box>
      )}
    />
  );
}
