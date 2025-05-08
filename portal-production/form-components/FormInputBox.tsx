/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, CircularProgress, InputAdornment, InputLabel, TextField, Typography } from "@mui/material";
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
  defaultValue?: string | number;
  description?: string;
  disabled?: boolean;
  startIcon?: React.ReactNode;
  type?: string;
  size?: "small" | "medium";
  maxLength?: number;
  required?: boolean;
  fullWidth?: boolean;
  loading?: boolean;
  min?: number;
  integerOnly?: boolean;
  viewMode?: boolean;
}

export default function FormInputBox(props: Props) {
  const { fullWidth, control, name, label, placeHolder, bottomText, defaultValue, description, disabled, startIcon, type = "text", size, maxLength, required, loading, min, rules = {}, labelArriangment = "vertical", viewMode = false } = props;
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
              size={size}
              placeholder={placeHolder}
              fullWidth={fullWidth}
              value={value}
              onChange={(value) => onChange(value)}
              ref={ref}
              type={type}
              // onBlur={onBlur}
              inputProps={{ maxLength: maxLength, min: min }}
              InputProps={{
                ...((startIcon || loading) && {
                  startAdornment: <InputAdornment position="start">{loading ? <CircularProgress size={24} /> : startIcon}</InputAdornment>,
                }),
              }}
              error={!!error}
              helperText={error ? error.message : bottomText}
            />
          ) : (
            <Typography variant="body1"> {value}</Typography>
          )}
        </Box>
      )}
    />
  );
}
