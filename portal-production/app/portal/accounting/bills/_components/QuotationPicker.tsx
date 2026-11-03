"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useMemo, useState } from "react";
import { Autocomplete, CircularProgress, TextField } from "@mui/material";
import { useAccountingApi } from "../../_lib/api";
import { quotationOptionLabel, quotationTotal, type QuotationTag } from "@/helpers/sinQuotation";

/**
 * WCT (enableWctOrders, 2026-11-03): the "Quotation No." a supplier invoice's
 * cost belongs to. Searches WCT's own quotations by QO number, customer or
 * reference (POST /documents/paginated); shows "QO202611-0020 · Customer · S$1,234.00".
 */
export default function QuotationPicker({
  value,
  onChange,
  disabled,
  helperText,
}: {
  value: QuotationTag | null;
  onChange: (next: QuotationTag | null) => void;
  disabled?: boolean;
  helperText?: string;
}) {
  const { request } = useAccountingApi();
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<Array<QuotationTag & { label: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res: any = await request<any>("/documents/paginated", {
          method: "POST",
          body: JSON.stringify({ documentTypes: ["QUOTATION"], search: input.trim(), limit: 20, page: 1 }),
        });
        const docs: any[] = res?.docs ?? [];
        if (live)
          setOptions(
            docs.map((d) => {
              const tag = { id: d.id, number: d.name || "" };
              return { ...tag, label: quotationOptionLabel(tag.number, d.associated_customer, quotationTotal(d.config)) };
            }),
          );
      } catch {
        if (live) setOptions([]);
      } finally {
        if (live) setLoading(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [input, request]);

  // Keep the chosen one selectable even when it is not in the latest search.
  const all = useMemo(() => (value && !options.some((o) => o.id === value.id) ? [{ ...value, label: value.number }, ...options] : options), [options, value]);

  return (
    <Autocomplete
      size="small"
      options={all}
      value={value ? all.find((o) => o.id === value.id) ?? null : null}
      onChange={(_, v) => onChange(v ? { id: v.id, number: v.number } : null)}
      onInputChange={(_, v, reason) => {
        if (reason === "input") setInput(v);
      }}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      getOptionLabel={(o) => o.label || o.number}
      filterOptions={(x) => x}
      loading={loading}
      disabled={disabled}
      noOptionsText={input ? "No quotation matches" : "Type a QO number, customer or reference"}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Quotation No."
          placeholder="Search QO number, customer, reference"
          helperText={helperText}
          InputProps={{ ...params.InputProps, endAdornment: <>{loading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</> }}
        />
      )}
      data-tour="sin-quotation-no"
    />
  );
}
