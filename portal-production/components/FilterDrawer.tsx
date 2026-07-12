/* eslint-disable @typescript-eslint/no-explicit-any */
import { Autocomplete, Box, Button, Drawer, InputLabel, Stack, TextField } from "@mui/material";
import React, { useEffect, useState } from "react";

import { Controller, useForm } from "react-hook-form";

import DateRangePicker from "@/form-components/FormDateRangePicker";

// Schema-driven filter config. Each page declares the filters it wants and
// supplies the options. The drawer just renders.
export type FilterOption = { label: string; value: string | number };

export type FilterField =
  | { type: "dateRange"; key: string; label: string }
  | { type: "select"; key: string; label: string; options: FilterOption[] };

interface FilterDrawerProps {
  openFilterDrawerStatus: boolean;
  defaultFilters: any;
  filterConfig: FilterField[];
  onClose: () => void;
  onSetFilters: (filters: any) => void;
}

const emptyDateRange = { startDate: null, endDate: null };

export default function FilterDrawer(props: FilterDrawerProps) {
  const { openFilterDrawerStatus = false, onClose, onSetFilters, defaultFilters, filterConfig = [] } = props;

  const [disableSubmit] = useState(false);
  const { watch, control, setValue } = useForm({
    defaultValues: filterConfig.reduce((acc: any, f) => {
      if (f.type === "select") acc[f.key] = defaultFilters?.[f.key] ?? "";
      return acc;
    }, {}),
  });

  const [filters, setFilters] = useState<any>(() => ({ ...defaultFilters }));

  // Seed react-hook-form when the drawer opens with new defaults (e.g. user
  // applied filters elsewhere or navigated back).
  useEffect(() => {
    if (!openFilterDrawerStatus) return;
    filterConfig.forEach((f) => {
      if (f.type === "select") {
        setValue(f.key, defaultFilters?.[f.key] ?? "");
      }
    });
    setFilters({ ...defaultFilters });
  }, [openFilterDrawerStatus]);

  // Watch all select fields and sync into local filters state.
  const watchedSelects: Record<string, any> = filterConfig.reduce((acc: any, f) => {
    if (f.type === "select") acc[f.key] = watch(f.key);
    return acc;
  }, {});

  useEffect(() => {
    setFilters((prev: any) => {
      const next = { ...prev };
      filterConfig.forEach((f) => {
        if (f.type === "select") {
          next[f.key] = watchedSelects[f.key] ?? "";
        }
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(watchedSelects)]);

  const handleApplyFilters = () => {
    onSetFilters(filters);
    onClose();
  };

  const [datePickerKey, setDatePickerKey] = useState(0);

  const handleResetAllFilters = () => {
    const reset: any = { ...defaultFilters };
    filterConfig.forEach((f) => {
      if (f.type === "select") {
        setValue(f.key, "");
        reset[f.key] = "";
      }
      if (f.type === "dateRange") {
        reset[f.key] = { ...emptyDateRange };
      }
    });
    setFilters(reset);
    setDatePickerKey((prev) => prev + 1);
  };

  return (
    <Drawer
      anchor="right"
      open={openFilterDrawerStatus}
      onClose={onClose}
      sx={{
        "& .MuiDrawer-paper": {
          width: "450px",
          backgroundColor: "background.paper",
          backgroundImage: "none",
          borderLeft: 1,
          borderColor: "divider",
        },
      }}
    >
      <Stack
        direction="column"
        gap="var(--default-gap)"
        padding="var(--default-padding)"
        width="100%"
        display="flex"
        alignItems="stretch"
        justifyContent="flex-start"
        sx={{ pt: 4 }}
      >
        <Box sx={{ width: "100%", color: "text.primary", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 600 }}>
          Filter data by:
          {filterConfig.length > 1 ? (
            <Button variant="text" onClick={handleResetAllFilters} sx={{ p: 0, color: "text.secondary", textTransform: "none", fontSize: "0.8rem", "&:hover": { color: "text.primary", backgroundColor: "transparent" } }}>
              Reset all
            </Button>
          ) : null}
        </Box>

        {filterConfig.map((field) => {
          if (field.type === "dateRange") {
            const current = filters?.[field.key] ?? emptyDateRange;
            return (
              <DateRangePicker
                key={`${field.key}-${datePickerKey}`}
                label={field.label}
                onConfirm={(value) =>
                  setFilters({
                    ...filters,
                    [field.key]: { startDate: value.startDate, endDate: value.endDate },
                  })
                }
                value={{ startDate: current.startDate, endDate: current.endDate }}
              />
            );
          }

          if (field.type === "select") {
            return (
              <Box key={field.key} width="100%" sx={{ position: "relative" }}>
                <InputLabel sx={{ color: "text.secondary", fontSize: "0.875rem", mb: 0.5 }}>{field.label}</InputLabel>
                {/* Searchable dropdown — large option sets (e.g. hundreds of
                    assets) are type-to-filter instead of one endless menu, and
                    the popup height is capped so it never overlaps the drawer
                    controls. */}
                <Controller
                  control={control}
                  name={field.key}
                  render={({ field: { onChange, value } }) => (
                    <Autocomplete
                      size="small"
                      options={field.options}
                      getOptionLabel={(o) => (typeof o === "object" ? String(o.label ?? "") : String(o ?? ""))}
                      isOptionEqualToValue={(o, v) => String(o.value) === String((v as FilterOption)?.value ?? v)}
                      value={field.options.find((o) => String(o.value) === String(value ?? "")) ?? null}
                      onChange={(_, option) => onChange(option ? option.value : "")}
                      renderInput={(params) => (
                        <TextField {...params} placeholder={`Search ${field.label.toLowerCase()}...`} />
                      )}
                      // Key by value, not label — Autocomplete's default keys
                      // options by label, and duplicate labels (e.g. many assets
                      // named "Submersible Pump") give React duplicate keys and
                      // a stale, unfiltered listbox.
                      renderOption={(optionProps, option) => (
                        <li {...optionProps} key={String(option.value)}>
                          {option.label}
                        </li>
                      )}
                      ListboxProps={{ sx: { maxHeight: 320 } }}
                      slotProps={{ paper: { sx: { boxShadow: 3 } } }}
                      noOptionsText="No matches"
                      clearOnEscape
                      autoHighlight
                    />
                  )}
                />
                <Button
                  sx={{ position: "absolute", top: 0, right: 0, p: 0, color: "text.secondary", textTransform: "none", fontSize: "0.8rem", "&:hover": { color: "text.primary", backgroundColor: "transparent" } }}
                  onClick={() => setValue(field.key, "")}
                >
                  Reset filter
                </Button>
              </Box>
            );
          }

          return null;
        })}

        <Stack direction="row" width="100%" spacing={1} sx={{ mt: 2 }}>
          <Button
            variant="outlined"
            type="button"
            onClick={() => {
              setFilters(defaultFilters);
              onClose();
            }}
            sx={{
              flex: 1,
              borderColor: "divider",
              color: "text.primary",
              "&:hover": { borderColor: "text.primary", backgroundColor: "action.hover" },
            }}
          >
            Cancel
          </Button>

          <Button variant="contained" type="button" onClick={handleApplyFilters} disabled={disableSubmit} sx={{ flex: 1 }}>
            Apply filters
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  );
}
