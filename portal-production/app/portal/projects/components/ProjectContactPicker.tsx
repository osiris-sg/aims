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
 * OSI-84 contact-people picker, now ROLE-AWARE. Multi-select DROPDOWN of the
 * chosen customer's existing CustomerContact list. Contact DETAILS are visible
 * and enterable: a new contact is added with editable name, mobile and email
 * (all three POSTed to /customers/:id/contacts so they persist on the
 * CustomerContact); a selected existing contact shows the same fields READ ONLY.
 * Typing a name that isn't on file surfaces an inline "Add '<name>'" row that
 * opens the new-contact form prefilled. Gated on a customer: with no customerId
 * it renders disabled with a hint.
 *
 * ROLES. Each selected person carries two independent checkboxes, DO and Invoice,
 * because a person can be BOTH on the same project — the widened unique index is
 * (projectId, customerContactId, group), so each role is its own link row. A
 * person with neither ticked is attached ungrouped, exactly as every link
 * attached before roles existed. Two people can both be DO contacts; the office
 * chooses between them, and the DO's Attention takes the earliest-attached.
 *
 * `value` is therefore a list of ASSIGNMENTS, not ids — one entry per
 * (person, role) pair, which is the shape PUT /projects/:id/contacts now takes.
 */

export interface ContactLite {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
  isPrimary?: boolean;
}

/** One (person, role) link. group null = attached with no role. */
export interface ContactAssignment {
  contactId: string;
  group: "DO" | "INVOICE" | null;
}

interface Props {
  customerId: string | null;
  // Controlled by the selected assignments. The picker resolves contactIds to
  // display objects from its own fetch.
  value: ContactAssignment[];
  onChange: (next: ContactAssignment[]) => void;
  disabled?: boolean;
  label?: string;
  // Show the read-only "Selected contact details" panel (name / mobile / email).
  // OFF for the schedule-delivery dialog: contacts there come from the customer
  // information form and the office is only CHOOSING between them, not reading
  // or editing their details. The New Project wizard keeps it — it has no
  // submission to draw from, so the details are the only way to tell two
  // similarly-named people apart.
  //
  // (This replaces the old `showRoles`, which gated per-contact DO/Invoice
  // checkboxes. Those are gone: the wizard already had them off because its
  // save path posts a plain id list, and the dialog now shows roles as chips
  // rather than editing them here. Roles are assigned by the customer on the
  // information form.)
  showDetails?: boolean;
  // Offer the "add a new contact" affordance (the inline Add "<name>" option and
  // the new-contact form). OFF for the schedule-delivery dialog: contacts there
  // must arrive through the customer information form so the customer states who
  // their DO and Invoice people are, rather than the office typing a name in.
  // The picker itself stays — choosing between two submitted DO contacts, and
  // correcting a bad submission, are exactly what it is for.
  allowAddContact?: boolean;
  // Which links to DISPLAY. "ALL" shows every link on the project. "DELIVERY"
  // shows the people a delivery is actually about, using the SAME fallback the
  // DO's Attention resolver uses: the DO contacts where any exists, otherwise
  // everything ungrouped.
  //
  // DISPLAY ONLY. It never changes what is saved. The save path replaces the
  // whole PICKER-owned set for the project, so anything filtered out of view
  // MUST still travel in `value` and back out through `onChange` — see
  // `hiddenAssignments` below. Filtering the payload instead would delete the
  // hidden links the moment the office pressed save.
  roleView?: "ALL" | "DELIVERY";
}

// An in-dropdown "Add '<name>'" row — a synthetic option that is not a real
// contact until picked. `__isAdd` distinguishes it in onChange/getOptionLabel.
type Option = ContactLite & { __isAdd?: boolean };
const filter = createFilterOptions<Option>();

export default function ProjectContactPicker({ customerId, value, onChange, disabled, label, showDetails = true, allowAddContact = true, roleView = "ALL" }: Props) {
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

  // ── WHAT IS DISPLAYED vs WHAT IS SAVED ──────────────────────────────────────
  // The rule mirrors projectFirstContactAttention exactly: prefer group 'DO',
  // and fall through to the ungrouped links when the project has no DO at all.
  // Deliberately a fallback and not a DO-only filter: six of the seven projects
  // with contacts carry no role whatsoever, so a strict filter would show them
  // as having nobody — and, because the save replaces the picker-owned set,
  // pressing save would then DELETE every one of those links.
  const hasDoLink = value.some((a) => a.group === "DO");
  const isDisplayed = React.useCallback(
    (a: ContactAssignment) => {
      if (roleView !== "DELIVERY") return true;
      return hasDoLink ? a.group === "DO" : a.group === null;
    },
    [roleView, hasDoLink],
  );

  // Everything the filter hides. These are carried through UNCHANGED on every
  // onChange, so the payload the dialog PUTs still contains them and the
  // replace-the-set save leaves them standing. This is the whole safety
  // mechanism: the picker narrows the VIEW, never the value.
  const hiddenAssignments = React.useMemo(() => value.filter((a) => !isDisplayed(a)), [value, isDisplayed]);
  const visibleAssignments = React.useMemo(() => value.filter((a) => isDisplayed(a)), [value, isDisplayed]);

  // Distinct PEOPLE among the VISIBLE links, in the order they first appear.
  const selectedIds = React.useMemo(() => {
    const seen: string[] = [];
    for (const a of visibleAssignments) if (!seen.includes(a.contactId)) seen.push(a.contactId);
    return seen;
  }, [visibleAssignments]);
  const selected: Option[] = options.filter((o) => selectedIds.includes(o.id));

  // The roles this person holds ON THIS PROJECT, read off `value` (the project
  // links). The Autocomplete's own options come from GET /customers/:id, which
  // carries no role information — so the chips must be derived here, not from
  // the option. A person can legitimately hold BOTH (the unique index is
  // (projectId, customerContactId, group)), so this returns a list.
  const rolesFor = (contactId: string): Array<"DO" | "INVOICE"> => {
    const out: Array<"DO" | "INVOICE"> = [];
    for (const a of value) {
      if (a.contactId !== contactId) continue;
      if ((a.group === "DO" || a.group === "INVOICE") && !out.includes(a.group)) out.push(a.group);
    }
    return out;
  };

  // One chip per role, plus "Main" when the person is the customer's primary.
  // NOTHING is rendered for a contact with no role: eleven of the thirteen
  // project links in production are role-less, so a "No role" chip would fire on
  // nearly every row and read as an error rather than information. What the
  // office needs to know when a project has no roles at all — that it has none —
  // is already said once, plainly, by the coverage chips above the picker.
  // "Main" matters because it is what the DO's Attention falls back to.
  const roleChips = (c: ContactLite) => {
    const roles = rolesFor(c.id);
    if (!roles.length && !c.isPrimary) return null;
    return (
      <>
        {roles.map((r) => (
          <Chip
            key={r}
            size="small"
            label={r === "DO" ? "DO" : "Invoice"}
            color={r === "DO" ? "primary" : "default"}
            variant="outlined"
            sx={{ height: 20, fontSize: "0.7rem" }}
          />
        ))}
        {c.isPrimary && (
          <Chip key="main" size="small" label="Main" variant="outlined" sx={{ height: 20, fontSize: "0.7rem" }} />
        )}
      </>
    );
  };

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
        onChange(
          value.some((a) => a.contactId === created.id)
            ? value
            : [...value, { contactId: created.id, group: roleView === "DELIVERY" && hasDoLink ? "DO" : null }],
        );
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
        // Name + role chips on each row, so DO and Invoice are distinguishable
        // without opening anything. getOptionLabel stays plain text — it feeds
        // the search filter and the input value, which must not contain markup.
        renderOption={(props, o) => {
          const { key, ...liProps } = props as React.HTMLAttributes<HTMLLIElement> & { key?: string };
          return (
            <li key={key ?? o.id} {...liProps}>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ width: "100%" }}>
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {o.__isAdd ? `Add "${o.name}"` : o.name}
                  {!o.__isAdd && o.designation ? (
                    <Typography component="span" variant="caption" color="text.secondary">
                      {` (${o.designation})`}
                    </Typography>
                  ) : null}
                </Typography>
                {!o.__isAdd && roleChips(o)}
              </Stack>
            </li>
          );
        }}
        // Surface an inline "Add '<name>'" row when the typed text matches no
        // existing contact — picking it OPENS the new-contact form prefilled so
        // mobile and email can be entered before saving.
        filterOptions={(opts, params) => {
          const filtered = filter(opts, params);
          if (!allowAddContact) return filtered;
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
          // The Autocomplete only ever knows about the VISIBLE links, so this
          // reconciles the visible set and then puts the hidden ones back
          // untouched. Without that re-emit, the dialog would PUT a payload
          // missing them and the replace-the-set save would delete them — e.g.
          // 18 Holland Drive's Invoice contact, which a delivery never shows.
          const nextIds = newValue.map((c) => c.id);
          const keptVisible = visibleAssignments.filter((a) => nextIds.includes(a.contactId));
          // A person added on a DELIVERY view lands as a DO contact when the
          // project is already DO-organised — otherwise the fallback would hide
          // them the instant they were added. On a project with no roles they
          // land ungrouped, matching everyone else there.
          const addGroup: "DO" | null = roleView === "DELIVERY" && hasDoLink ? "DO" : null;
          const added = nextIds
            .filter((id) => !visibleAssignments.some((a) => a.contactId === id))
            .filter((id) => !hiddenAssignments.some((a) => a.contactId === id && a.group === addGroup))
            .map((contactId) => ({ contactId, group: addGroup }));
          onChange([...hiddenAssignments, ...keptVisible, ...added]);
        }}
        // The tag carries the role, not just the name — once a contact is
        // selected it leaves the dropdown (filterSelectedOptions), so the tag is
        // the ONLY place the office can still see whether this is the DO or the
        // Invoice person. A group header in the list would vanish at exactly the
        // moment it became useful.
        renderTags={(vals, getTagProps) =>
          vals.map((v, i) => {
            const { key, ...chipProps } = getTagProps({ index: i });
            const roles = rolesFor(v.id);
            const suffix = roles.length ? ` · ${roles.map((r) => (r === "DO" ? "DO" : "Invoice")).join(" + ")}` : "";
            return (
              <Chip
                key={v.id}
                label={`${v.name}${suffix}`}
                color={roles.includes("DO") ? "primary" : "default"}
                variant={roles.length ? "filled" : "outlined"}
                {...chipProps}
              />
            );
          })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={label ?? "Contact people"}
            placeholder={
            customerId
              ? allowAddContact
                ? "Pick a contact, or type to add"
                : "Pick a contact"
              : "Choose a customer first"
          }
            error={!!error}
            helperText={
              error ??
              (customerId
                ? allowAddContact
                  ? "Pick from the list, or type a new name and choose Add."
                  : "Pick from the customer's contacts. New people come in through the customer information form."
                : allowAddContact
                  ? "Pick a customer first, then choose or add contact people."
                  : "Pick a customer first, then choose their contact people.")
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
          CustomerContact; edit them from the customer's page). Hidden when
          showDetails is false: the scheduling dialog is a CHOOSING surface, not
          an editing one, and the role now reads off the chips in the field. */}
      {showDetails && selected.length > 0 && (
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
      {allowAddContact && customerId &&
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
