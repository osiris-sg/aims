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
  size?: string;
}

export default function FormTextArea(props: Props) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { fullWidth = true, control, name, label, placeHolder, bottomText, defaultValue = "", description, disabled, rows = 4, maxRows, maxLength, required, rules = {}, labelArriangment = "vertical", viewMode = false, size } = props;

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
              minRows={rows || 1}
              inputProps={{
                maxLength: maxLength,
                style: {
                  resize: "none",
                  overflow: "hidden",
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  lineHeight: "1.4375em",
                },
              }}
              sx={{
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                flex: "1 1 auto",
                "& .MuiInputBase-root": {
                  alignItems: "flex-start",
                  padding: "8px 12px",
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                  boxSizing: "border-box",
                },
                "& .MuiInputBase-input": {
                  resize: "none",
                  lineHeight: "1.4375em",
                  overflow: "hidden",
                  padding: "0",
                  minHeight: "1.4375em",
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                  boxSizing: "border-box",
                },
                "& .MuiOutlinedInput-root": {
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                  "& fieldset": {
                    borderColor: "rgba(0, 0, 0, 0.23)",
                  },
                  "&:hover fieldset": {
                    borderColor: "rgba(0, 0, 0, 0.87)",
                  },
                  "&.Mui-focused fieldset": {
                    borderColor: "#1976d2",
                  },
                },
              }}
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
