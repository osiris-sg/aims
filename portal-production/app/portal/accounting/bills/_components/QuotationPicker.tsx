"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useMemo, useState } from "react";
import { Autocomplete, CircularProgress, TextField, Tooltip } from "@mui/material";
import { useAccountingApi } from "../../_lib/api";
import { quotationOptionLabel, quotationTotal, type QuotationTag } from "@/helpers/sinQuotation";

/**
 * WCT (enableWctOrders, 2026-11-03): the "Quotation No." a supplier invoice's
 * cost belongs to. Searches WCT's own quotations by QO number, customer or
 * reference (POST /documents/paginated); shows "QO202611-0020 · Customer · S$1,234.00".
 * `compact` (2026-11-04, the SIN line column): no label, the chosen quotation shows as its number only; the
 * options still show number · customer · total.
 * 2026-11-04 (wider column): compact shows "number · customer", cut with an ellipsis, the full text on hover.
 */
export default function QuotationPicker({
  value,
  onChange,
  disabled,
  helperText,
  compact,
}: {
  value: QuotationTag | null;
  onChange: (next: QuotationTag | null) => void;
  disabled?: boolean;
  helperText?: string;
  compact?: boolean;
}) {
  const { request } = useAccountingApi();
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<Array<QuotationTag & { label: string }>>([]);
  const [loading, setLoading] = useState(false);
  // compact: quotation id -> customer name, from every search so far (a loaded line only carries id + number).
  const [customers, setCustomers] = useState<Record<string, string>>({});

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
        if (live && compact) rememberCustomers(docs);
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

  function rememberCustomers(docs: any[]) {
    const add: Record<string, string> = {};
    for (const d of docs) if (d?.id && d.associated_customer && d.associated_customer !== "N/A") add[d.id] = d.associated_customer;
    if (Object.keys(add).length) setCustomers((m) => ({ ...m, ...add }));
  }

  // compact: a chosen quotation whose customer we have not seen yet (an existing SIN's line) -> look it up once by number.
  const missing = compact && value?.number && !(value.id in customers) ? value : null;
  useEffect(() => {
    if (!missing) return;
    let live = true;
    request<any>("/documents/paginated", {
      method: "POST",
      body: JSON.stringify({ documentTypes: ["QUOTATION"], search: missing.number, limit: 5, page: 1 }),
    })
      .then((res: any) => {
        if (!live) return;
        rememberCustomers(res?.docs ?? []);
        setCustomers((m) => (missing.id in m ? m : { ...m, [missing.id]: "" }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing?.id, missing?.number, request]);

  const compactLabel = (o: QuotationTag) => [o.number, customers[o.id]].filter(Boolean).join(" · ");
  const shownValue = compact && value ? compactLabel(value) : "";

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
      getOptionLabel={(o) => (compact ? compactLabel(o) : o.label || o.number)}
      renderOption={(props, o) => (
        <li {...props} key={o.id}>
          {o.label || o.number}
        </li>
      )}
      filterOptions={(x) => x}
      loading={loading}
      disabled={disabled}
      noOptionsText={input ? "No quotation matches" : "Type a QO number, customer or reference"}
      renderInput={(params) => {
        const field = (
          <TextField
            {...params}
            label={compact ? undefined : "Quotation No."}
            placeholder={compact ? "Quotation" : "Search QO number, customer, reference"}
            helperText={helperText}
            InputProps={{ ...params.InputProps, endAdornment: <>{loading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</> }}
            inputProps={compact ? { ...params.inputProps, style: { ...(params.inputProps as any).style, textOverflow: "ellipsis" } } : params.inputProps}
          />
        );
        return compact && shownValue ? (
          <Tooltip title={shownValue} placement="top" enterDelay={400}>
            {field}
          </Tooltip>
        ) : (
          field
        );
      }}
      data-tour={compact ? "sin-line-quotation" : "sin-quotation-no"}
      sx={compact ? { minWidth: 150 } : undefined}
    />
  );
}
