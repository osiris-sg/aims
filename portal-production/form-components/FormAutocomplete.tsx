/* eslint-disable @typescript-eslint/no-explicit-any */
import markdownToHtml from "@/helpers/markdownToHtml";
import { Autocomplete, Box, CircularProgress, InputLabel, TextField, Typography } from "@mui/material";
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
  maxLength?: number;
  required?: boolean;
  fullWidth?: boolean;
  viewMode?: boolean;
  size?: "small" | "medium";
  options: string[];
  loading?: boolean;
}

export default function FormAutocomplete(props: Props) {
  const {
    fullWidth = true,
    control,
    name,
    label,
    placeHolder,
    bottomText,
    defaultValue = "",
    description,
    disabled,
    rows = 1,
    maxLength,
    required,
    rules = {},
    labelArriangment = "vertical",
    viewMode = false,
    size = "small",
    options = [],
    loading = false,
  } = props;

  const [open, setOpen] = React.useState(false);

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
            <Autocomplete
              value={value || ""}
              onChange={(_, newValue) => {
                onChange(newValue || "");
              }}
              inputValue={value || ""}
              onInputChange={(_, newInputValue) => {
                onChange(newInputValue);
                // Open dropdown when user types
                if (newInputValue && options.length > 0) {
                  setOpen(true);
                }
              }}
              options={options}
              freeSolo
              disabled={disabled}
              loading={loading}
              fullWidth={fullWidth}
              size={size}
              open={open}
              onOpen={() => setOpen(true)}
              onClose={() => setOpen(false)}
              autoHighlight
              selectOnFocus
              clearOnBlur={false}
              handleHomeEndKeys
              filterOptions={(options, state) => {
                const inputValue = state.inputValue.toLowerCase();
                if (!inputValue) {
                  return options;
                }
                return options.filter((option) =>
                  option.toLowerCase().includes(inputValue)
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder={placeHolder}
                  multiline
                  minRows={rows}
                  inputRef={ref}
                  onFocus={() => {
                    // Open dropdown on focus if there are options
                    if (options.length > 0) {
                      setOpen(true);
                    }
                  }}
                  inputProps={{
                    ...params.inputProps,
                    maxLength: maxLength,
                    style: {
                      resize: "none",
                      overflow: "hidden",
                      fontFamily: "inherit",
                      fontSize: "inherit",
                      lineHeight: "1.4375em",
                    },
                  }}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loading ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                  error={!!error}
                  helperText={error ? error.message : bottomText}
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
                />
              )}
              sx={{
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
              }}
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
