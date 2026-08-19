"use client";

import React, { useEffect, useState } from "react";
import { Autocomplete, Chip, CircularProgress, TextField, createFilterOptions } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

/**
 * OSI-84 contact-people picker. Multi-select DROPDOWN of the chosen customer's
 * existing CustomerContact list. Typing a name that isn't on file surfaces an
 * inline "Add '<name>'" option in the same dropdown (no type-then-Enter): picking
 * it saves the contact back to that customer (POST /customers/:id/contacts) and
 * selects it. Controlled by the parent via `value` (ids) / `onChange`. Gated on a
 * customer: with no customerId it renders disabled with a hint.
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

// An in-dropdown "Add '<name>'" row — a synthetic option that is not a real
// contact until picked. `__isAdd` distinguishes it in onChange/getOptionLabel.
type Option = ContactLite & { __isAdd?: boolean };
const filter = createFilterOptions<Option>();

export default function ProjectContactPicker({ customerId, value, onChange, disabled, label }: Props) {
  const { getToken } = useAuth();
  const [options, setOptions] = useState<ContactLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected objects for the Autocomplete, resolved from ids against the loaded
  // customer contact list.
  const selected: Option[] = options.filter((o) => value.includes(o.id));

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
    <Autocomplete<Option, true, false, false>
      multiple
      disabled={disabled || !customerId}
      loading={loading}
      options={options as Option[]}
      value={selected}
      getOptionLabel={(o) => (o.__isAdd ? `Add "${o.name}"` : `${o.name}${o.designation ? ` (${o.designation})` : ""}`)}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterSelectedOptions
      // Surface an inline "Add '<name>'" row when the typed text matches no
      // existing contact — the clean-dropdown replacement for type-then-Enter.
      filterOptions={(opts, params) => {
        const filtered = filter(opts, params);
        const input = params.inputValue.trim();
        if (input && !opts.some((o) => o.name.toLowerCase() === input.toLowerCase())) {
          filtered.push({ id: `__add__:${input}`, name: input, __isAdd: true });
        }
        return filtered;
      }}
      onChange={(_, newValue) => {
        // Picking the synthetic "Add" row creates the contact (which appends the
        // real id via onChange); it never enters the selection itself.
        const add = newValue.find((v) => v.__isAdd);
        if (add) {
          void createContact(add.name);
          return;
        }
        onChange(newValue.map((c) => c.id));
      }}
      renderTags={(vals, getTagProps) =>
        vals.map((v, i) => {
          const { key, ...chipProps } = getTagProps({ index: i });
          return <Chip key={v.id} label={v.name} {...chipProps} />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? "Contact people"}
          placeholder={customerId ? "Pick a contact, or type to add" : "Choose a customer first"}
          error={!!error}
          helperText={
            error ??
            (customerId
              ? "Pick from the list, or type a new name and choose Add."
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
