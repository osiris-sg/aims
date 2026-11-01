"use client";

// One customer picker for the whole portal (2026-11-02). Searches the server
// as you type (code, name, email, phone, address, UEN, old code) and always
// fetches the selected customer by id, so it shows even when the org has
// thousands of customers. Pass `initialCustomer` when the caller already has
// the customer (e.g. Record Payment from an invoice) to skip the lookup.
import React, { useEffect, useMemo, useState } from "react";
import { Autocomplete, Box, CircularProgress, TextField, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { useOrganization } from "@hooks/useOrganization";
import { PickerCustomer, rememberCustomers, useCustomerById, useCustomerSearch } from "@/app/portal/hooks/api/useCustomerPicker";
import { customerIdsLine, customerLabel, rankCustomers } from "@/helpers/customerIds";

export interface CustomerPickerProps {
  /** Selected customer id ("" / null = none). */
  value: string | null | undefined;
  onChange: (customer: PickerCustomer | null) => void;
  /** The selected customer when the caller already has it (no lookup needed). */
  initialCustomer?: PickerCustomer | null;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  size?: "small" | "medium";
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
  /** Hide the field label (e.g. inside a labelled filter row). */
  hideLabel?: boolean;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function CustomerPicker({
  value,
  onChange,
  initialCustomer,
  label = "Customer",
  placeholder = "Type a name, code or UEN…",
  disabled,
  required,
  error,
  helperText,
  size = "small",
  fullWidth = true,
  sx,
  hideLabel,
}: CustomerPickerProps) {
  const { organization } = useOrganization();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const term = useDebounced(input, 250);

  useEffect(() => {
    if (initialCustomer?.id) rememberCustomers(organization?.id, [initialCustomer]);
  }, [initialCustomer, organization?.id]);

  const id = value || null;
  const { customer: fetched, isLoading: loadingSelected } = useCustomerById(initialCustomer?.id === id ? null : id);
  const selected = id ? (initialCustomer?.id === id ? initialCustomer : fetched) ?? null : null;

  // While the box shows the selected customer's label, an open popup lists the
  // newest customers rather than searching for that label.
  const searching = selected && input === customerLabel(selected) ? "" : term;
  const { customers, isLoading } = useCustomerSearch(searching, { enabled: open && !disabled });
  const options = useMemo(() => {
    const ranked = rankCustomers(customers, searching);
    return selected && !ranked.some((c) => c.id === selected.id) ? [selected, ...ranked] : ranked;
  }, [customers, searching, selected]);

  return (
    <Autocomplete<PickerCustomer, false, false, false>
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      options={options}
      value={selected}
      onChange={(_, c) => {
        if (c) rememberCustomers(organization?.id, [c]);
        onChange(c ?? null);
      }}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      filterOptions={(x) => x}
      getOptionLabel={(c) => customerLabel(c)}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      loading={isLoading || loadingSelected}
      disabled={disabled}
      size={size}
      fullWidth={fullWidth}
      // Explicit width: inside a flex row `fullWidth` alone collapses to the label.
      sx={[{ minWidth: 220, ...(fullWidth ? { width: "100%" } : {}) }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      autoHighlight
      clearOnEscape
      noOptionsText={searching ? "No customers match" : "Type to search customers"}
      ListboxProps={{ sx: { maxHeight: 320 } }}
      renderOption={(props, c) => (
        <li {...props} key={c.id}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {customerLabel(c)}
            </Typography>
            {(customerIdsLine(c) || c.email || c.phone) && (
              <Typography variant="caption" color="text.secondary" noWrap display="block">
                {[customerIdsLine(c), c.email, c.phone].filter(Boolean).join(" · ")}
              </Typography>
            )}
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={hideLabel ? undefined : label}
          placeholder={selected ? undefined : placeholder}
          required={required}
          error={error}
          helperText={helperText}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {isLoading || loadingSelected ? <CircularProgress size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
