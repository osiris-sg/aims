"use client";

import React, { useEffect, useState } from "react";
import { Autocomplete, Chip, CircularProgress, TextField } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

/**
 * OSI-84 contact-people picker. Multi-select of the chosen customer's existing
 * CustomerContact list, with free-typing a new name that is saved back to that
 * customer (POST /customers/:id/contacts) and then selected. Controlled by the
 * parent via `value` / `onChange` (the full contact objects, so the parent can
 * read ids for the project link and names for display). Gated on a customer:
 * with no customerId it renders disabled with a hint.
 */

export interface ContactLite {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
  isPrimary?: boolean;
}

interface Props {
  customerId: string | null;
  // Controlled by the selected contact ids (matches the project link + the RHF
  // form field). The picker resolves ids to display objects from its own fetch.
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
}

export default function ProjectContactPicker({ customerId, value, onChange, disabled, label }: Props) {
  const { getToken } = useAuth();
  const [options, setOptions] = useState<ContactLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected objects for the Autocomplete, resolved from ids against the loaded
  // customer contact list.
  const selected = options.filter((o) => value.includes(o.id));

  // Load the customer's contact list (the customer detail already includes it).
  useEffect(() => {
    if (!customerId) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/customers/${customerId}`, method: "GET" }, {}, token);
        const cust = res?.data ?? res;
        const list: ContactLite[] = Array.isArray(cust?.contacts) ? cust.contacts : [];
        if (!cancelled) setOptions(list);
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, getToken]);

  // Free-typed name becomes a real CustomerContact on this customer, then gets
  // selected so it persists and can be reused on other projects later.
  const createContact = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !customerId) return;
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/customers/${customerId}/contacts`, method: "POST" },
        { name: trimmed },
        token,
      );
      const created: ContactLite = res?.data ?? res;
      if (created?.id) {
        setOptions((prev) => [...prev, created]);
        onChange(value.includes(created.id) ? value : [...value, created.id]);
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not add contact");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Autocomplete
      multiple
      freeSolo
      disabled={disabled || !customerId}
      loading={loading}
      options={options}
      value={selected}
      getOptionLabel={(o) =>
        typeof o === "string" ? o : `${o.name}${o.designation ? ` (${o.designation})` : ""}`
      }
      isOptionEqualToValue={(a, b) => (a as ContactLite).id === (b as ContactLite).id}
      filterSelectedOptions
      onChange={(_, newValue) => {
        // freeSolo mixes picked ContactLite objects with any typed-in strings.
        const pickedIds = newValue.filter((v): v is ContactLite => typeof v !== "string").map((c) => c.id);
        const typed = newValue.filter((v): v is string => typeof v === "string");
        onChange(pickedIds);
        if (typed.length) void createContact(typed[typed.length - 1]);
      }}
      renderTags={(vals, getTagProps) =>
        vals.map((v, i) => {
          const { key, ...chipProps } = getTagProps({ index: i });
          return <Chip key={typeof v === "string" ? v : v.id} label={typeof v === "string" ? v : v.name} {...chipProps} />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? "Contact people"}
          placeholder={customerId ? "Pick or type a name" : "Choose a customer first"}
          error={!!error}
          helperText={
            error ??
            (customerId
              ? "Type a new name and press Enter to add them to this customer."
              : "Pick a customer first, then choose or add contact people.")
          }
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {(loading || creating) && <CircularProgress size={16} />}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
