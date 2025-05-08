/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, CircularProgress, IconButton, InputAdornment, InputLabel, MenuItem, Select, SelectChangeEvent, Stack, TextField, Typography, useTheme } from "@mui/material";
import React, { useState } from "react";
import { Control, Controller, FieldValues } from "react-hook-form";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import CancelIcon from "@mui/icons-material/Cancel";

interface MenuItemType {
  label: string;
  value: string | number;
  disabled?: boolean;
}

interface Props {
  control: Control<FieldValues, object> | undefined | any;
  name: string;
  label?: string;
  placeHolder?: string;
  menuItems: MenuItemType[];
  menuTitle: string;
  defaultValue?: string;
  size?: "small" | "medium";
  disabled?: boolean;
  addItem?: boolean;
  handleAddItem?: (item: string) => void;
  handleDeleteItem?: (value: string | number) => void;
  required?: boolean;
  loading?: boolean;
  startIcon?: React.ReactNode;
  isDeleting?: boolean;
  isAdding?: boolean;
  labelArriangment?: "vertical" | "horizontal";
  viewMode?: boolean;
}

export default function FormSelect(props: Props) {
  const [newItem, setNewItem] = useState("");
  const [hoveredItem, setHoveredItem] = useState<string | number | null>(null);
  const theme = useTheme();
  const { control, name, label, placeHolder, menuItems, menuTitle, defaultValue, size, disabled, addItem, handleAddItem, handleDeleteItem, required, loading, startIcon, isDeleting, isAdding, labelArriangment = "vertical", viewMode = false } = props;

  return (
    <Box sx={{ display: "flex", flexDirection: labelArriangment === "vertical" ? "column" : "row", gap: "var(--quarter-gap)" }}>
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

      <Controller
        control={control}
        name={name}
        defaultValue={defaultValue ?? ""}
        render={({ field: { onChange, value }, fieldState: { error } }) => (
          <Stack direction="column" gap="var(--quarter-gap)">
            {!viewMode ? (
              <Select
                value={value}
                onChange={(event: SelectChangeEvent) => onChange(event.target.value)}
                fullWidth
                size={size}
                disabled={disabled}
                displayEmpty
                MenuProps={{
                  PaperProps: {
                    sx: {
                      backgroundColor: "white",
                      borderRadius: 4,
                    },
                  },
                }}
                sx={{
                  borderRadius: 4,
                  "& .MuiOutlinedInput-notchedOutline": {
                    borderRadius: 4,
                  },
                }}
                error={!!error}
              >
                <MenuItem value="" disabled>
                  <Typography variant="body1" color="textSecondary">
                    {menuTitle}
                  </Typography>
                </MenuItem>

                {menuItems.map((item) => (
                  <MenuItem
                    key={item.value}
                    value={item.value}
                    disabled={item.disabled}
                    sx={{
                      backgroundColor: theme.palette.primary.contrastText,
                      "&:hover": {
                        backgroundColor: theme.palette.primary.main,
                        color: theme.palette.primary.contrastText,
                      },
                    }}
                    onMouseEnter={() => setHoveredItem(item.value)}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    <Stack direction="row" alignItems="center" justifyContent="space-between" width="100%">
                      <Typography>{item.label}</Typography>
                      {hoveredItem === item.value && handleDeleteItem && (
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteItem(item.value);
                          }}
                          disabled={isDeleting}
                        >
                          {isDeleting ? (
                            <CircularProgress size={18} sx={{ color: theme.palette.primary.contrastText }} />
                          ) : (
                            <CancelIcon
                              sx={{
                                color: theme.palette.primary.contrastText,
                                "&:hover": {
                                  color: theme.palette.tertiary.main,
                                },
                              }}
                              fontSize="small"
                            />
                          )}
                        </IconButton>
                      )}
                    </Stack>
                  </MenuItem>
                ))}

                {addItem && (
                  <MenuItem
                    sx={{
                      backgroundColor: theme.palette.primary.contrastText,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ display: "flex", width: "100%", gap: "var(--default-gap)" }}>
                      <TextField
                        value={newItem}
                        onChange={(e) => {
                          e.stopPropagation();
                          setNewItem(e.target.value);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder={placeHolder}
                        variant="outlined"
                        fullWidth
                        InputProps={{
                          ...((startIcon || loading) && {
                            startAdornment: <InputAdornment position="start">{loading ? <CircularProgress size={24} /> : startIcon}</InputAdornment>,
                          }),
                        }}
                      />
                      <IconButton
                        onClick={(e) => {
                          e.stopPropagation();
                          if (newItem.trim()) {
                            handleAddItem?.(newItem);
                            setNewItem("");
                          }
                        }}
                        disabled={isAdding}
                      >
                        {isAdding ? <CircularProgress size={24} /> : <AddCircleOutlineIcon color="primary" />}
                      </IconButton>
                    </Stack>
                  </MenuItem>
                )}
              </Select>
            ) : (
              <Typography variant="body1">{menuItems.find((item) => item.value === value)?.label || value}</Typography>
            )}
            {error && !viewMode && (
              <Typography variant="caption" color="error" sx={{ ml: "1rem" }}>
                {error.message}
              </Typography>
            )}
          </Stack>
        )}
      />
    </Box>
  );
}
