"use client";

import React, { useEffect, useState } from "react";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Stack,
  TextField,
  Typography,
  createFilterOptions,
} from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

/**
 * OSI-84 contact-people picker. Multi-select DROPDOWN of the chosen customer's
 * existing CustomerContact list. Contact DETAILS are visible and enterable:
 * a new contact is added with editable name, mobile and email (all three POSTed
 * to /customers/:id/contacts so they persist on the CustomerContact); a selected
 * existing contact shows the same fields READ ONLY. Typing a name that isn't on
 * file surfaces an inline "Add '<name>'" row that opens the new-contact form
 * prefilled. Controlled by the parent via `value` (ids) / `onChange`. Gated on a
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

  // New-contact form (editable name/mobile/email). Opening it prefills the name
  // from the inline "Add" row when that is how the rider got here.
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

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

  const resetAddForm = () => {
    setAddOpen(false);
    setNewName("");
    setNewPhone("");
    setNewEmail("");
  };

  // The new contact (name + mobile + email) becomes a real CustomerContact on this
  // customer, then gets selected so it persists and can be reused elsewhere later.
  const createContact = async () => {
    const trimmed = newName.trim();
    if (!trimmed || !customerId) return;
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/customers/${customerId}/contacts`, method: "POST" },
        {
          name: trimmed,
          ...(newPhone.trim() ? { phone: newPhone.trim() } : {}),
          ...(newEmail.trim() ? { email: newEmail.trim() } : {}),
        },
        token,
      );
      const created: ContactLite = res?.data ?? res;
      if (created?.id) {
        setOptions((prev) => [...prev, created]);
        onChange(value.includes(created.id) ? value : [...value, created.id]);
        resetAddForm();
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not add contact");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Stack spacing={1.5}>
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
        // existing contact — picking it OPENS the new-contact form prefilled so
        // mobile and email can be entered before saving.
        filterOptions={(opts, params) => {
          const filtered = filter(opts, params);
          const input = params.inputValue.trim();
          if (input && !opts.some((o) => o.name.toLowerCase() === input.toLowerCase())) {
            filtered.push({ id: `__add__:${input}`, name: input, __isAdd: true });
          }
          return filtered;
        }}
        onChange={(_, newValue) => {
          const add = newValue.find((v) => v.__isAdd);
          if (add) {
            setNewName(add.name);
            setAddOpen(true);
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

      {/* Selected contacts — details shown READ ONLY (they persist on the
          CustomerContact; edit them from the customer's page). */}
      {selected.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            Selected contact details
          </Typography>
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            {selected.map((c) => (
              <Box key={c.id} sx={{ p: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
                <Grid container spacing={0.5}>
                  <Grid item xs={12} md={4}>
                    <TextField label="Name" value={c.name || ""} size="small" fullWidth InputProps={{ readOnly: true }} />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField label="Mobile" value={c.phone || ""} size="small" fullWidth InputProps={{ readOnly: true }} />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField label="Email" value={c.email || ""} size="small" fullWidth InputProps={{ readOnly: true }} />
                  </Grid>
                </Grid>
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      {/* Add a new contact — editable name / mobile / email, all POSTed. */}
      {customerId &&
        (addOpen ? (
          <Box sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              New contact
            </Typography>
            <Grid container spacing={0.5}>
              <Grid item xs={12} md={4}>
                <TextField label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} size="small" fullWidth />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField label="Mobile" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} size="small" fullWidth />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField label="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} size="small" fullWidth />
              </Grid>
            </Grid>
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}>
              <Button size="small" onClick={resetAddForm} disabled={creating}>
                Cancel
              </Button>
              <Button size="small" variant="contained" onClick={() => void createContact()} disabled={creating || !newName.trim()}>
                Add contact
              </Button>
            </Stack>
          </Box>
        ) : (
          <Button size="small" onClick={() => setAddOpen(true)} sx={{ alignSelf: "flex-start" }}>
            + Add a new contact
          </Button>
        ))}
    </Stack>
  );
}
