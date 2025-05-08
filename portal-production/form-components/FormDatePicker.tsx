/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, InputLabel, Stack } from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import React from "react";
import { Control, Controller, FieldValues } from "react-hook-form";
import dayjs from "dayjs";

interface Props {
  control: Control<FieldValues, object> | undefined | any;
  name: string;
  label?: string;
  defaultValue?: dayjs.Dayjs | null;
  size?: "small" | "medium";
  disabled?: boolean;
  required?: boolean;
  minDate?: dayjs.Dayjs;
  maxDate?: dayjs.Dayjs;
  disableBefore?: dayjs.Dayjs; // For disabling dates before a specific date
  labelArrangement?: "vertical" | "horizontal";
}

export default function FormDatePicker(props: Props) {
  const { control, name, label, defaultValue, size = "medium", disabled = false, required = false, minDate, maxDate, disableBefore, labelArrangement = "vertical" } = props;

  return (
    <Box sx={{ display: "flex", flexDirection: labelArrangement === "vertical" ? "column" : "row", gap: "var(--quarter-gap)" }}>
      {label && (
        <InputLabel
          required={required}
          sx={{
            color: "text.secondary",
          }}
        >
          {label}
        </InputLabel>
      )}

      <Controller
        control={control}
        name={name}
        defaultValue={defaultValue ?? null}
        render={({ field: { onChange, value }, fieldState: { error } }) => (
          <Stack direction="column" width="100%">
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DatePicker
                value={value}
                onChange={onChange}
                disabled={disabled}
                minDate={minDate}
                maxDate={maxDate}
                shouldDisableDate={(date) => {
                  if (disableBefore) {
                    return date.isBefore(disableBefore, "day");
                  }
                  return false;
                }}
                slotProps={{
                  textField: {
                    size: size,
                    fullWidth: true,
                    error: !!error,
                    helperText: error ? error.message : null,
                    sx: {
                      borderRadius: 4,
                      "& .MuiOutlinedInput-notchedOutline": {
                        borderRadius: 4,
                        borderColor: error ? "error.main" : undefined,
                      },
                      "& .Mui-error .MuiOutlinedInput-notchedOutline": {
                        borderColor: "error.main",
                      },
                    },
                  },
                }}
              />
            </LocalizationProvider>
          </Stack>
        )}
      />
    </Box>
  );
}
