/**
 * Dynamic Form Fields Component
 *
 * Renders form fields dynamically based on template field definitions.
 * Uses a table-like layout with labels on the left and inputs on the right.
 */

import React from 'react';
import {
  Autocomplete,
  Box,
  TextField,
  Select,
  MenuItem,
  FormControl,
  Typography,
  InputAdornment,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { useAuth } from '@clerk/nextjs';
import { request } from '@/helpers/request';
import { toast } from 'react-toastify';
import { FieldDefinition } from '../types/templateFieldTypes';

// Salesman interface
interface Salesman {
  id: string;
  salesmanCode: string;
  name: string;
  email?: string;
}

// ---- GST tax codes (master file) ----
// Legacy-style document-level tax code: ONE code per document (next to Absorb
// Tax), which sets the GST % for the whole doc — unlike account mapping which
// is per-line. Fetched once per page load and shared.
type TaxCode = { id: string; code: string; name: string; rate: number; direction: string; isActive: boolean };
let taxCodesCache: TaxCode[] | null = null;
let taxCodesPromise: Promise<TaxCode[]> | null = null;

function useTaxCodes(): TaxCode[] {
  const { getToken } = useAuth();
  const [codes, setCodes] = React.useState<TaxCode[]>(taxCodesCache ?? []);
  React.useEffect(() => {
    if (taxCodesCache) return;
    taxCodesPromise =
      taxCodesPromise ||
      (async () => {
        try {
          const token = await getToken();
          if (!token) return [];
          const res = await request({ path: '/accounting/tax-rates', method: 'GET' }, {}, token);
          const list = (res?.data ?? res) as TaxCode[];
          taxCodesCache = (Array.isArray(list) ? list : []).filter((t) => t.isActive);
          return taxCodesCache;
        } catch {
          return [];
        }
      })();
    taxCodesPromise.then((v) => setCodes(v));
  }, [getToken]);
  return codes;
}

// ── Customer points-of-contact (shared) ──────────────────────────────────
// The "Attn To" picker + inline "+ Add contact" that fill the Attention
// fields FROM A CUSTOMER CONTACT. The Attention row uses these when the
// header has a Contact row — Attention is then fill-only (guru 2026-10-27:
// an attention that is not one of the customer's contacts must not exist).
// CustomerCodeField keeps its own in-cell copy for headers with no Contact row.
const contactLabelOf = (c: any) => [c?.name, c?.phone].filter((v) => v && String(v).trim() !== '').join(' - ');

function useCustomerContacts(selectedCustomer: any, formData: any, setFormData: (d: any) => void) {
  const { getToken } = useAuth();
  // Optimistically-added contacts, keyed by customer id, merged with the
  // server list so a freshly created contact shows without a refetch.
  const [localContacts, setLocalContacts] = React.useState<Record<string, any[]>>({});
  const contacts: any[] = [
    ...(Array.isArray(selectedCustomer?.contacts) ? selectedCustomer.contacts : []),
    ...((selectedCustomer && localContacts[selectedCustomer.id]) || []),
  ];
  // Model field is `phone`; form field is `attention.phoneNumber`.
  const fill = (poc: any) => {
    let next = setNestedVal(formData, 'documentInfo.contact', contactLabelOf(poc));
    next = setNestedVal(next, 'attention.name', poc?.name ?? '');
    next = setNestedVal(next, 'attention.phoneNumber', poc?.phone ?? '');
    next = setNestedVal(next, 'attention.email', poc?.email ?? '');
    // DO templates store/print contactName + contactNumber ("Attn: Name
    // (number)") — keep them in step so every printout stays exact.
    next = setNestedVal(next, 'documentInfo.contactName', poc?.name ?? '');
    next = setNestedVal(next, 'documentInfo.contactNumber', poc?.phone ?? '');
    setFormData(next);
  };
  const empty = { name: '', phone: '', email: '', designation: '' };
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [draft, setDraft] = React.useState(empty);
  const save = async () => {
    if (!selectedCustomer?.id) {
      toast.error('Select a customer first');
      return;
    }
    if (!draft.name.trim()) {
      toast.error('Contact name is required');
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      const res = await request(
        { path: `/customers/${selectedCustomer.id}/contacts`, method: 'POST' },
        { name: draft.name.trim(), phone: draft.phone.trim() || null, email: draft.email.trim() || null, designation: draft.designation.trim() || null },
        token || undefined,
      );
      if (res?.success === false) throw new Error(res.message || 'Failed to add contact');
      const created = res?.id ? res : res?.data;
      if (!created?.id) throw new Error('Failed to add contact');
      setLocalContacts((p) => ({ ...p, [selectedCustomer.id]: [...(p[selectedCustomer.id] || []), created] }));
      fill(created);
      toast.success('Contact added');
      setOpen(false);
      setDraft(empty);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add contact');
    } finally {
      setSaving(false);
    }
  };
  const selectedId = contacts.find((c) => contactLabelOf(c) === getNestedVal(formData, 'documentInfo.contact'))?.id || '';
  return { contacts, fill, selectedId, open, setOpen, saving, draft, setDraft, save };
}

function ContactPicker({ cc, inputSx, disabled }: { cc: ReturnType<typeof useCustomerContacts>; inputSx: any; disabled?: boolean }) {
  return (
    <>
      {cc.contacts.length > 0 && (
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <Select
            displayEmpty
            value={cc.selectedId}
            disabled={disabled}
            onChange={(e) => {
              const poc = cc.contacts.find((c: any) => c.id === e.target.value);
              if (poc) cc.fill(poc);
            }}
            sx={{ ...inputSx, fontSize: '13px' }}
            renderValue={(val) => {
              const poc = cc.contacts.find((c: any) => c.id === val);
              return poc ? poc.name : <span style={{ color: '#9e9e9e' }}>Attn To…</span>;
            }}
          >
            {cc.contacts.map((c: any) => (
              <MenuItem key={c.id} value={c.id} sx={{ fontSize: '13px' }}>
                {c.name}
                {c.designation ? ` — ${c.designation}` : ''}
                {c.phone ? ` (${c.phone})` : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
      <Button
        size="small"
        disabled={disabled}
        onClick={() => cc.setOpen(true)}
        sx={{ fontSize: '0.7rem', textTransform: 'none', minWidth: 'auto', px: 0.75, whiteSpace: 'nowrap' }}
      >
        + Add contact
      </Button>
    </>
  );
}

function AddContactDialog({ cc, customerName }: { cc: ReturnType<typeof useCustomerContacts>; customerName?: string }) {
  const labels = { name: 'Name', phone: 'Phone', email: 'Email', designation: 'Designation' } as const;
  return (
    <Dialog open={cc.open} onClose={() => !cc.saving && cc.setOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem' }}>Add contact{customerName ? ` — ${customerName}` : ''}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {(Object.keys(labels) as Array<keyof typeof labels>).map((k) => (
            <TextField
              key={k}
              label={labels[k]}
              required={k === 'name'}
              autoFocus={k === 'name'}
              size="small"
              fullWidth
              value={cc.draft[k]}
              onChange={(e) => cc.setDraft({ ...cc.draft, [k]: e.target.value })}
            />
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => cc.setOpen(false)} disabled={cc.saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={cc.save} disabled={cc.saving || !cc.draft.name.trim()}>
          {cc.saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Job Location (fieldType 'siteLocation', WCT 2026-10-27) ──────────────────
// A dropdown of the customer's SAVED sites (SiteOffice rows: name + address)
// with "+ Add location" — guru: "we presave certain locations and they can add
// as well". The chosen site's text lands in the field (documentInfo.location)
// and prints in the paper's "Job Location:" box. Same shape as the contact
// picker above: fill-only, disabled until a customer is chosen.
const siteLabelOf = (site: any) => {
  const name = String(site?.name ?? '').trim();
  const address = String(site?.address ?? '').trim();
  if (name && address && name !== address) return `${name}, ${address}`;
  return address || name;
};

function useCustomerSites(selectedCustomer: any, formData: any, setFormData: (d: any) => void, fieldName: string) {
  const { getToken } = useAuth();
  const customerId: string | undefined = selectedCustomer?.id;
  // Saved sites per customer id (fetched once per customer, plus optimistic adds).
  const [sitesById, setSitesById] = React.useState<Record<string, any[]>>({});
  React.useEffect(() => {
    if (!customerId || sitesById[customerId]) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await request({ path: `/customers/${customerId}/site-offices`, method: 'GET' }, {}, token || undefined);
        const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        if (!cancelled) setSitesById((p) => ({ ...p, [customerId]: list }));
      } catch {
        if (!cancelled) setSitesById((p) => ({ ...p, [customerId]: [] }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);
  const sites: any[] = (customerId && sitesById[customerId]) || [];
  const value: string = getNestedVal(formData, fieldName) || '';
  const fill = (site: any | null) => setFormData(setNestedVal(formData, fieldName, site ? siteLabelOf(site) : ''));
  const selectedId = sites.find((st) => siteLabelOf(st) === value)?.id || '';
  const empty = { name: '', address: '' };
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [draft, setDraft] = React.useState(empty);
  const save = async () => {
    if (!customerId) {
      toast.error('Select a customer first');
      return;
    }
    if (!draft.address.trim()) {
      toast.error('The location address is required');
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      const res = await request(
        { path: `/customers/${customerId}/site-offices`, method: 'POST' },
        { name: draft.name.trim() || draft.address.trim(), address: draft.address.trim(), contactDetails: [] },
        token || undefined,
      );
      if (res?.success === false) throw new Error(res.message || 'Failed to add location');
      const created = res?.id ? res : res?.data;
      if (!created?.id) throw new Error('Failed to add location');
      setSitesById((p) => ({ ...p, [customerId]: [...(p[customerId] || []), created] }));
      fill(created);
      setOpen(false);
      setDraft(empty);
      toast.success('Location saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add location');
    } finally {
      setSaving(false);
    }
  };
  return { sites, value, fill, selectedId, open, setOpen, saving, draft, setDraft, save };
}

function LocationPicker({ sl, inputSx, disabled }: { sl: ReturnType<typeof useCustomerSites>; inputSx: any; disabled?: boolean }) {
  // A value typed before this became a dropdown (or carried from an older
  // document) is still shown, so nothing on an existing quotation goes blank.
  const legacy = sl.value && !sl.selectedId ? sl.value : '';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', minWidth: 0 }}>
      <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
        <Select
          displayEmpty
          value={sl.selectedId || (legacy ? '__legacy__' : '')}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__legacy__') return;
            sl.fill(v ? sl.sites.find((st: any) => st.id === v) ?? null : null);
          }}
          sx={{ ...inputSx, fontSize: '13px' }}
          renderValue={(val) => {
            if (val === '__legacy__') return legacy;
            const site = sl.sites.find((st: any) => st.id === val);
            return site ? siteLabelOf(site) : <span style={{ color: '#9e9e9e' }}>{disabled ? 'Select a customer first' : 'Job location…'}</span>;
          }}
        >
          <MenuItem value="" sx={{ fontSize: '13px', color: 'text.secondary' }}>
            — none —
          </MenuItem>
          {legacy && (
            <MenuItem value="__legacy__" sx={{ fontSize: '13px' }}>
              {legacy}
            </MenuItem>
          )}
          {sl.sites.map((st: any) => (
            <MenuItem key={st.id} value={st.id} sx={{ fontSize: '13px' }}>
              {siteLabelOf(st)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Button
        size="small"
        disabled={disabled}
        onClick={() => sl.setOpen(true)}
        sx={{ fontSize: '0.7rem', textTransform: 'none', minWidth: 'auto', px: 0.75, whiteSpace: 'nowrap' }}
      >
        + Add location
      </Button>
    </Box>
  );
}

function AddLocationDialog({ sl, customerName }: { sl: ReturnType<typeof useCustomerSites>; customerName?: string }) {
  return (
    <Dialog open={sl.open} onClose={() => !sl.saving && sl.setOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem' }}>Add location{customerName ? ` — ${customerName}` : ''}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Site name (optional)"
            placeholder="e.g. Suntec City outlet"
            size="small"
            fullWidth
            autoFocus
            value={sl.draft.name}
            onChange={(e) => sl.setDraft({ ...sl.draft, name: e.target.value })}
          />
          <TextField
            label="Address"
            required
            size="small"
            fullWidth
            multiline
            minRows={2}
            value={sl.draft.address}
            onChange={(e) => sl.setDraft({ ...sl.draft, address: e.target.value })}
          />
          <Typography variant="caption" color="text.secondary">
            Saved to the customer, so it can be picked again on the next document.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => sl.setOpen(false)} disabled={sl.saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={sl.save} disabled={sl.saving || !sl.draft.address.trim()}>
          {sl.saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Separate component for customer/supplier field to properly use hooks
interface CustomerCodeFieldProps {
  customers: any[];
  formData: any;
  setFormData: (data: any) => void;
  onOpenDialog?: (fieldName?: string) => void;
  inputSx: any;
  fieldName?: string; // e.g., "customer" or "documentInfo.supplierCode" - defaults to "customer"
  storeMode?: 'object' | 'code'; // 'object' stores full customer object, 'code' stores just the code string
  // Attention (Contact Person / No. / Email) trio: rendered here only when the
  // header has no Contact row to host it (e.g. quotations filter out
  // documentInfo.contact); invoices render the trio in the Contact row instead.
  showAttentionFields?: boolean;
  // True when the header's Contact row hosts the contact picker / "+ Add
  // contact" / Attention readout instead (see useCustomerContacts), so this
  // cell renders only the code box and the name echo.
  hideContactControls?: boolean;
}

function CustomerCodeField({
  customers,
  formData,
  setFormData,
  onOpenDialog,
  inputSx,
  fieldName = 'customer',
  storeMode = 'object',
  showAttentionFields = true,
  hideContactControls = false,
}: CustomerCodeFieldProps) {
  // Helper to get nested value
  const getNestedVal = (obj: any, path: string) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  };

  // Helper to set nested value
  const setNestedVal = (obj: any, path: string, value: any) => {
    const newObj = JSON.parse(JSON.stringify(obj));
    const parts = path.split('.');
    let current = newObj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    return newObj;
  };

  // "Attn To" Contact field value for a POC: name + phone.
  const contactLabel = (c: any) =>
    [c?.name, c?.phone].filter((v) => v && String(v).trim() !== '').join(' - ');

  // For object mode, find customer by ID; for code mode, find by code
  const currentValue = getNestedVal(formData, fieldName);
  const selectedCustomer = storeMode === 'object'
    ? customers.find((c: any) => c.id === currentValue?.id)
    : customers.find((c: any) => c.customerCode === currentValue);

  const [customerCodeInput, setCustomerCodeInput] = React.useState(
    selectedCustomer?.customerCode || (storeMode === 'code' ? currentValue : '') || ''
  );

  // Update input when selected customer changes
  React.useEffect(() => {
    if (selectedCustomer?.customerCode) {
      setCustomerCodeInput(selectedCustomer.customerCode);
    } else if (storeMode === 'code') {
      const val = getNestedVal(formData, fieldName) || '';
      setCustomerCodeInput(val);
    }
  }, [selectedCustomer?.customerCode, formData, fieldName, storeMode]);

  // ── Points-of-Contact (POC): auto-fill + inline create ──────────────────
  const { getToken } = useAuth();

  // Optimistically-added contacts (post-save), keyed by customer id, merged
  // with the server-provided list so a freshly created POC shows immediately
  // in the dropdown without a full customer refetch.
  const [localContacts, setLocalContacts] = React.useState<Record<string, any[]>>({});
  const effectiveContacts: any[] = [
    ...(Array.isArray(selectedCustomer?.contacts) ? selectedCustomer.contacts : []),
    ...((selectedCustomer && localContacts[selectedCustomer.id]) || []),
  ];

  // Picking (or creating) a POC fills documentInfo.contact (name - phone) AND
  // the header/footer attention fields. ⚠️ The model field is `phone`; the
  // form field is `attention.phoneNumber` — map across the name mismatch here.
  const fillAttentionFromPoc = (poc: any) => {
    let next = setNestedVal(formData, 'documentInfo.contact', contactLabel(poc));
    next = setNestedVal(next, 'attention.name', poc?.name ?? '');
    next = setNestedVal(next, 'attention.phoneNumber', poc?.phone ?? '');
    next = setNestedVal(next, 'attention.email', poc?.email ?? '');
    setFormData(next);
  };

  // Inline "+ Add contact" dialog state.
  const emptyContact = { name: '', phone: '', email: '', designation: '' };
  const [contactDialogOpen, setContactDialogOpen] = React.useState(false);
  const [savingContact, setSavingContact] = React.useState(false);
  const [newContact, setNewContact] = React.useState(emptyContact);

  const handleSaveContact = async () => {
    if (!selectedCustomer?.id) {
      toast.error('Select a customer first');
      return;
    }
    if (!newContact.name.trim()) {
      toast.error('Contact name is required');
      return;
    }
    setSavingContact(true);
    try {
      const token = await getToken();
      const res = await request(
        { path: `/customers/${selectedCustomer.id}/contacts`, method: 'POST' },
        {
          name: newContact.name.trim(),
          phone: newContact.phone.trim() || null,
          email: newContact.email.trim() || null,
          designation: newContact.designation.trim() || null,
        },
        token || undefined,
      );
      if (res?.success === false) {
        throw new Error(res.message || 'Failed to add contact');
      }
      // Endpoint returns the created CustomerContact directly (with id).
      const created = res?.id ? res : res?.data;
      if (!created?.id) {
        throw new Error('Failed to add contact');
      }
      // Persisted → show in dropdown (optimistic) + auto-fill immediately.
      setLocalContacts((prev) => ({
        ...prev,
        [selectedCustomer.id]: [...(prev[selectedCustomer.id] || []), created],
      }));
      fillAttentionFromPoc(created);
      toast.success('Contact added');
      setContactDialogOpen(false);
      setNewContact(emptyContact);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add contact');
    } finally {
      setSavingContact(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const foundCustomer = customers.find(
        (c: any) => c.customerCode?.toLowerCase() === customerCodeInput.toLowerCase()
      );
      if (foundCustomer) {
        if (storeMode === 'object') {
          setFormData({
            ...formData,
            customer: {
              id: foundCustomer.id || '',
              name: foundCustomer.name || '',
              address: foundCustomer.address || '',
              email: foundCustomer.email || '',
            },
          });
        } else {
          setFormData(setNestedVal(formData, fieldName, foundCustomer.customerCode));
        }
      }
    }
  };

  return (
    // data-tour: anchor for AIMS Guide walkthroughs (customer step)
    <Box data-tour="editor-customer" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', flex: 1, gap: 1 }}>
      <TextField
        value={selectedCustomer ? (selectedCustomer.customerCode || '') : customerCodeInput}
        onChange={(e) => {
          const newVal = e.target.value.toUpperCase();
          if (storeMode === 'object') {
            if (selectedCustomer) {
              setFormData({
                ...formData,
                customer: { id: '', name: '', address: '', email: '' },
              });
            }
            setCustomerCodeInput(newVal);
          } else {
            setCustomerCodeInput(newVal);
            setFormData(setNestedVal(formData, fieldName, newVal));
          }
        }}
        onKeyDown={handleKeyDown}
        size="small"
        // Compact code box + bold name echo beside it (guru 2026-07-17,
        // adopted from the Official Receipt field) — the code identifies,
        // the echoed company name confirms.
        sx={{ ...inputSx, width: 180, flexShrink: 0 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 0 }}>
              <IconButton
                size="small"
                onClick={() => onOpenDialog?.(fieldName)}
                sx={{ p: 0.25, ml: -0.5 }}
                title="Search"
              >
                <SearchIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
      {(() => {
        // Object mode keeps the stored name even before the master list loads;
        // code mode (suppliers) resolves the name from the looked-up record.
        const echoName =
          selectedCustomer?.name ||
          (storeMode === 'object' ? currentValue?.name : '') ||
          '';
        return echoName ? (
          <Typography
            sx={{ fontSize: '13px', fontWeight: 700, fontFamily: fieldFontFamily, whiteSpace: 'nowrap' }}
          >
            {echoName}
          </Typography>
        ) : null;
      })()}
      {/* Points-of-Contact ("Attn To") dropdown + inline "+ Add contact".
          Picking or creating a POC fills documentInfo.contact (name - phone)
          AND the attention.{name,phoneNumber,email} header/footer fields. The
          dropdown only renders when the customer has POCs; the typed attention
          fields remain the fallback (and manual override) for the no-contact
          case. The "+ Add contact" button shows whenever a customer is
          selected so the first POC can be created inline. */}
      {storeMode === 'object' && selectedCustomer && !hideContactControls && (
        <>
          {effectiveContacts.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <Select
                displayEmpty
                value={
                  effectiveContacts.find(
                    (c: any) => contactLabel(c) === getNestedVal(formData, 'documentInfo.contact'),
                  )?.id || ''
                }
                onChange={(e) => {
                  const poc = effectiveContacts.find((c: any) => c.id === e.target.value);
                  if (!poc) return;
                  fillAttentionFromPoc(poc);
                }}
                sx={{ ...inputSx, fontSize: '13px' }}
                renderValue={(val) => {
                  const poc = effectiveContacts.find((c: any) => c.id === val);
                  return poc ? poc.name : <span style={{ color: '#9e9e9e' }}>Attn To…</span>;
                }}
              >
                {effectiveContacts.map((c: any) => (
                  <MenuItem key={c.id} value={c.id} sx={{ fontSize: '13px' }}>
                    {c.name}
                    {c.designation ? ` — ${c.designation}` : ''}
                    {c.phone ? ` (${c.phone})` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <Button
            size="small"
            onClick={() => setContactDialogOpen(true)}
            sx={{ fontSize: '0.7rem', textTransform: 'none', minWidth: 'auto', px: 0.75, whiteSpace: 'nowrap' }}
          >
            + Add contact
          </Button>

          {/* Editable contact (Attention) — populated once by the POC dropdown /
              inline-create above (fillAttentionFromPoc), then freely editable
              per-quote. Bound to formData.attention.*; saved to doc.config.attention
              only — editing here never writes back to the CustomerContact/customer
              record (setFormData only mutates form/document state). */}
          {showAttentionFields && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, width: '100%', mt: 0.25 }}>
            <TextField
              label="Contact Person"
              size="small"
              value={getNestedVal(formData, 'attention.name') || ''}
              onChange={(e) => setFormData(setNestedVal(formData, 'attention.name', e.target.value))}
              sx={{ ...inputSx, flex: 1, minWidth: 140 }}
            />
            <TextField
              label="Contact No."
              size="small"
              value={getNestedVal(formData, 'attention.phoneNumber') || ''}
              onChange={(e) => setFormData(setNestedVal(formData, 'attention.phoneNumber', e.target.value))}
              sx={{ ...inputSx, flex: 1, minWidth: 120 }}
            />
            <TextField
              label="Email"
              size="small"
              value={getNestedVal(formData, 'attention.email') || ''}
              onChange={(e) => setFormData(setNestedVal(formData, 'attention.email', e.target.value))}
              sx={{ ...inputSx, flex: 1, minWidth: 160 }}
            />
          </Box>
          )}

          <Dialog
            open={contactDialogOpen}
            onClose={() => !savingContact && setContactDialogOpen(false)}
            maxWidth="xs"
            fullWidth
          >
            <DialogTitle sx={{ fontSize: '1rem' }}>
              Add contact{selectedCustomer?.name ? ` — ${selectedCustomer.name}` : ''}
            </DialogTitle>
            <DialogContent>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                <TextField
                  label="Name"
                  required
                  size="small"
                  value={newContact.name}
                  onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                  autoFocus
                  fullWidth
                />
                <TextField
                  label="Phone"
                  size="small"
                  value={newContact.phone}
                  onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                  fullWidth
                />
                <TextField
                  label="Email"
                  size="small"
                  value={newContact.email}
                  onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                  fullWidth
                />
                <TextField
                  label="Designation"
                  size="small"
                  value={newContact.designation}
                  onChange={(e) => setNewContact({ ...newContact, designation: e.target.value })}
                  fullWidth
                />
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setContactDialogOpen(false)} disabled={savingContact}>
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={handleSaveContact}
                disabled={savingContact || !newContact.name.trim()}
              >
                {savingContact ? 'Saving…' : 'Save'}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
}

// Separate component for salesman/purchaser field to properly use hooks
interface SalesmanCodeFieldProps {
  salesmen: Salesman[];
  formData: any;
  setFormData: (data: any) => void;
  onOpenDialog?: (fieldName?: string) => void;
  inputSx: any;
  fieldName: string; // e.g., "documentInfo.salesPerson" or "documentInfo.purchaserCode"
}

// Helper to get nested value from object path
const getNestedVal = (obj: any, path: string) => {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

// Helper to set nested value in object
const setNestedVal = (obj: any, path: string, value: any) => {
  const newObj = JSON.parse(JSON.stringify(obj)); // Deep clone
  const parts = path.split('.');
  let current = newObj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
  return newObj;
};

function SalesmanCodeField({ salesmen, formData, setFormData, onOpenDialog, inputSx, fieldName }: SalesmanCodeFieldProps) {
  // Extract salesmen array - handle both direct array and response object with data property
  const salesmenArray = React.useMemo(() => {
    if (Array.isArray(salesmen)) {
      return salesmen;
    }
    // Handle case where full API response is passed: {success, message, data: [...]}
    if (salesmen && typeof salesmen === 'object' && 'data' in salesmen && Array.isArray((salesmen as any).data)) {
      return (salesmen as any).data;
    }
    return [];
  }, [salesmen]);

  const currentValue = getNestedVal(formData, fieldName) || '';
  // The stored value is the salesman's CODE, or their id when they have no
  // code (a user without a code is still selectable — guru 2026-10-27), so
  // match on either. No pick = no match: a blank code must never match an
  // empty value (that echoed a phantom selection).
  const selectedSalesman = currentValue
    ? salesmenArray.find((s: Salesman) => (s.salesmanCode && s.salesmanCode === currentValue) || s.id === currentValue)
    : undefined;
  const [codeInput, setCodeInput] = React.useState(currentValue);

  // Update input when value changes
  React.useEffect(() => {
    const val = getNestedVal(formData, fieldName) || '';
    setCodeInput(val);
  }, [formData, fieldName]);

  // Store the resolved name alongside the code (e.g. documentInfo.salesPersonName)
  // so printouts show the salesman's name, not the code. Additive and guarded
  // against re-render loops.
  React.useEffect(() => {
    if (!currentValue) return;
    const s = salesmenArray.find((x: Salesman) => (x.salesmanCode && x.salesmanCode === currentValue) || x.id === currentValue);
    if (!s) return;
    const nameKey = `${fieldName}Name`;
    if (getNestedVal(formData, nameKey) !== s.name) {
      setFormData(setNestedVal(formData, nameKey, s.name));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentValue, salesmenArray]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const found = salesmenArray.find(
        (s: Salesman) => s.salesmanCode?.toLowerCase() === codeInput.toLowerCase()
      );
      if (found) {
        setFormData(setNestedVal(formData, fieldName, found.salesmanCode));
      }
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, gap: 1 }}>
      <TextField
        // A matched salesman shows their code (blank when they have none,
        // the name echo beside identifies them); otherwise the typed text.
        value={selectedSalesman ? selectedSalesman.salesmanCode || '' : codeInput}
        onChange={(e) => {
          const newVal = e.target.value.toUpperCase();
          setCodeInput(newVal);
          setFormData(setNestedVal(formData, fieldName, newVal));
        }}
        onKeyDown={handleKeyDown}
        size="small"
        // Compact code box + bold name echo (same pattern as Customer code).
        sx={{ ...inputSx, width: 180, flexShrink: 0 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 0 }}>
              <IconButton
                size="small"
                onClick={() => onOpenDialog?.(fieldName)}
                sx={{ p: 0.25, ml: -0.5 }}
                title="Search"
              >
                <SearchIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
      {selectedSalesman?.name && (
        <Typography sx={{ fontSize: '13px', fontWeight: 700, fontFamily: fieldFontFamily, whiteSpace: 'nowrap' }}>
          {selectedSalesman.name}
        </Typography>
      )}
    </Box>
  );
}

interface DynamicFormFieldsProps {
  fields: FieldDefinition[];
  formData: any;
  setFormData: (data: any) => void;
  hideDiscount?: boolean; // Route Order PO: hide the document-level Disc field
  hiddenFields?: string[]; // fieldNames to omit entirely (e.g. billTo/deliveryTo on invoices)
  // Extra row rendered LAST inside the left field column, styled like the
  // other rows (label cell + content) — e.g. the quotation Project picker.
  appendRow?: { label: string; content: React.ReactNode };
  // Replace a field's input with custom content (label cell + row position
  // kept) — e.g. Biofuel's DO Reference No quotation selector.
  customInputs?: Record<string, React.ReactNode>;
  // Extra row rendered FIRST inside the RIGHT (summary) column, above Rate /
  // Gross Total / Disc / Sub-total / GST / Nett Total. The right column is
  // built by filtering field definitions, so a control with no field
  // definition — the quotation totals switch — has no other way in.
  prependRightRow?: React.ReactNode;
  customers?: any[];
  suppliers?: any[];
  projects?: any[];
  deliveryOrders?: any[];
  siteOffices?: any[];
  salesmen?: Salesman[];
  onOpenCustomerDialog?: (fieldName?: string) => void;
  onOpenSupplierDialog?: (fieldName?: string) => void;
  onOpenSalesmanDialog?: (fieldName?: string) => void;
}

// Currency options
const CURRENCIES = [
  { value: 'SGD', label: 'SGD' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'MYR', label: 'MYR' },
  { value: 'RP', label: 'RP' },
  { value: 'IDR', label: 'IDR' },
];

// Yes/No options
const YES_NO = [
  { value: 'Y', label: 'Y' },
  { value: 'N', label: 'N' },
];

// Compact input styles - blend into the row, subtle focus state
const fieldFontFamily = "'Helvetica Neue', Arial, sans-serif";

// Xero-style field border: 1px medium grey at rest (not near-black),
// slightly darker on hover. Focus still snaps to primary. CSS vars so the
// values flip for dark mode (defined in app/globals.css under [data-theme]).
const fieldBorderColor = 'var(--field-border)';
const fieldBorderHoverColor = 'var(--field-border-hover)';

// Legacy AIMS invoice-screen arrangement: header fields stack in ONE column in
// this exact order; anything not listed follows in template order, and
// Contact + Terms share the last row (see renderContactTermsRow).
const HEADER_FIELD_ORDER = [
  'documentInfo.documentNumber',
  'documentInfo.date',
  'customer',
  'documentInfo.salesPerson',
  'salesMobile',
  'documentInfo.poNo',
  'documentInfo.doNo',
  'documentInfo.issueBy',
  'documentInfo.referenceNo',
];

// Per-field input width caps so inputs match the legacy screen's proportions
// instead of stretching to the full row. Unlisted fields keep full width.
const HEADER_INPUT_MAX_WIDTH: Record<string, number> = {
  'documentInfo.documentNumber': 300,
  'documentInfo.date': 180,
  // documentInfo.salesPerson deliberately uncapped: the code box is fixed at
  // 180px and the salesman's name echoes beside it (needs the row width).
  'salesMobile': 300,
  'documentInfo.poNo': 420,
  'documentInfo.doNo': 420,
  'documentInfo.currency': 180,
  // Official Receipt rows (legacy proportions)
  'orData.date': 180,
  'orData.chequeNo': 300,
  'orData.remarks': 620,
  // Payment Voucher rows (AP twin of the receipt)
  'pvData.date': 180,
  'pvData.chequeNo': 300,
  'pvData.remarks': 620,
};

// Exported so sibling components (e.g. the quotation Project picker row in
// TabbedDocumentCreator) can render inputs that blend with the header fields.
export const headerInputSx = {
  '& .MuiInputBase-root': {
    height: 28,
    fontSize: '13px',
    fontFamily: fieldFontFamily,
    backgroundColor: 'background.paper',
    borderRadius: '4px',
    border: '1px solid',
    borderColor: fieldBorderColor,
    transition: 'border-color 140ms ease',
  },
  '& .MuiInputBase-root:hover': {
    borderColor: fieldBorderHoverColor,
  },
  '& .MuiInputBase-root.Mui-focused': {
    borderColor: 'primary.main',
  },
  '& .MuiInputBase-input': {
    fontSize: '13px',
    fontFamily: fieldFontFamily,
    padding: '4px 8px',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    border: 'none',
  },
  // Hide browser-default number spinner arrows so they don't overlap the value at narrow widths
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input[type=number]::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
  '& input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
};
const inputSx = headerInputSx;

const selectSx = {
  height: 28,
  fontSize: '13px',
  fontFamily: fieldFontFamily,
  backgroundColor: 'background.paper',
  borderRadius: '4px',
  border: '1px solid',
  borderColor: fieldBorderColor,
  transition: 'border-color 140ms ease',
  '&:hover': { borderColor: fieldBorderHoverColor },
  '&.Mui-focused': { borderColor: 'primary.main' },
  '& .MuiSelect-select': {
    py: 0.25,
    pl: 1,
    // Leave just enough room for the icon — MUI's default 32px right padding
    // truncates single-char values ("%", "Y") in the 56px-wide summary selects.
    pr: '20px !important',
    fontSize: '13px',
    fontFamily: fieldFontFamily,
  },
  '& .MuiSelect-icon': {
    right: 2,
    fontSize: 18,
  },
  '& .MuiInputBase-input': {
    fontSize: '13px',
    fontFamily: fieldFontFamily,
  },
  '& .MuiOutlinedInput-notchedOutline': {
    border: 'none',
  },
};

export default function DynamicFormFields({
  fields,
  formData,
  setFormData,
  hideDiscount = false,
  hiddenFields = [],
  appendRow,
  customInputs,
  prependRightRow,
  customers = [],
  suppliers = [],
  projects = [],
  deliveryOrders = [],
  siteOffices = [],
  salesmen = [],
  onOpenCustomerDialog,
  onOpenSupplierDialog,
  onOpenSalesmanDialog,
}: DynamicFormFieldsProps) {
  const taxCodes = useTaxCodes();

  // Helper to get nested value from object path
  const getNestedValue = (obj: any, path: string) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  };

  // Helper to set nested value in object
  const setNestedValue = (obj: any, path: string, value: any) => {
    const parts = path.split('.');
    const last = parts.pop()!;
    const target = parts.reduce((acc, part) => {
      if (!acc[part]) acc[part] = {};
      return acc[part];
    }, obj);
    target[last] = value;
    return { ...obj };
  };

  // Separate fields into left column and right column (summary fields)
  const leftFields = fields.filter(f => !f.fieldName.includes('gross') && !f.fieldName.includes('disc') &&
    !f.fieldName.includes('subTotal') && !f.fieldName.includes('nett') && !f.fieldName.includes('gst') &&
    !f.fieldName.includes('rate') && !f.fieldName.includes('absorbTax') && !f.fieldName.includes('taxApplicable'));

  const rightFields = fields.filter(f => f.fieldName.includes('gross') || f.fieldName.includes('disc') ||
    f.fieldName.includes('subTotal') || f.fieldName.includes('nett') || f.fieldName.includes('gst') ||
    f.fieldName.includes('rate') || f.fieldName.includes('absorbTax') || f.fieldName.includes('taxApplicable') ||
    f.fieldName.includes('currency'));

  // Render input based on field type
  const renderInput = (field: FieldDefinition) => {
    const value = getNestedValue(formData, field.fieldName) ?? field.defaultValue ?? '';

    // Terms: dropdown of common credit terms, still free-typeable (freeSolo) so
    // any custom wording ("50% upfront", "COD") remains possible.
    if (field.fieldName === 'documentInfo.paymentTerms' || field.fieldName === 'paymentTerms') {
      return (
        <Autocomplete
          freeSolo
          size="small"
          fullWidth
          options={['CASH', '14 Days', '30 Days', '60 Days']}
          // Always offer every preset — this is a pick-or-type field, not a
          // search box; filtering by the current value would hide the presets.
          filterOptions={(opts) => opts}
          inputValue={String(value ?? '')}
          onInputChange={(_, v) => setFormData(setNestedValue(formData, field.fieldName, v))}
          renderInput={(params) => (
            <TextField {...params} size="small" placeholder="Terms" sx={inputSx} />
          )}
        />
      );
    }

    switch (field.fieldType) {
      case 'siteLocation':
        // Job Location: the customer's saved sites + "+ Add location".
        return <LocationPicker sl={sites} inputSx={inputSx} disabled={!mainCustomer} />;

      case 'customer':
        return (
          <CustomerCodeField
            customers={customers}
            formData={formData}
            setFormData={setFormData}
            onOpenDialog={onOpenCustomerDialog}
            inputSx={inputSx}
            showAttentionFields={!pairContactTerms}
            hideContactControls={pairContactTerms}
          />
        );

      case 'supplier':
        // Supplier uses supplier data and stores just the code
        return (
          <CustomerCodeField
            customers={suppliers}
            formData={formData}
            setFormData={setFormData}
            onOpenDialog={onOpenSupplierDialog}
            inputSx={inputSx}
            fieldName={field.fieldName}
            storeMode="code"
          />
        );

      case 'salesman':
        return (
          <SalesmanCodeField
            salesmen={salesmen}
            formData={formData}
            setFormData={setFormData}
            onOpenDialog={onOpenSalesmanDialog}
            inputSx={inputSx}
            fieldName={field.fieldName}
          />
        );

      case 'select':
        let options: any[] = [];
        // Static {value,label} options declared on the field (e.g. QF "Type":
        // Project / Route Order) take precedence over a dynamic dataSource.
        const staticOptions = Array.isArray((field as any).options) ? (field as any).options : null;
        if (staticOptions) {
          options = staticOptions;
        } else if (field.dataSource === 'deliveryOrders') {
          options = deliveryOrders;
        } else if (field.dataSource === 'projects') {
          options = projects;
        } else if (field.dataSource === 'currencies') {
          options = CURRENCIES;
        } else if (field.dataSource === 'yesNo') {
          options = YES_NO;
        }

        return (
          <FormControl size="small" sx={{ flex: 1, minWidth: field.dataSource === 'yesNo' ? 50 : 150 }}>
            <Select
              value={value}
              onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))}
              sx={selectSx}
              displayEmpty
            >
              {staticOptions || field.dataSource === 'currencies' || field.dataSource === 'yesNo' ? (
                options.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: '13px' }}>
                    {opt.label}
                  </MenuItem>
                ))
              ) : field.dataSource === 'deliveryOrders' ? (
                options.map((order) => (
                  <MenuItem key={order.id} value={order.doNo} sx={{ fontSize: '13px' }}>
                    {order.doNo}
                  </MenuItem>
                ))
              ) : (
                options.map((option) => (
                  <MenuItem key={option.id} value={option.id} sx={{ fontSize: '13px' }}>
                    {option.name}
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>
        );

      case 'textarea':
        return (
          <TextField
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))}
            size="small"
            multiline
            // One line at rest, grows as the user types (capped so a long
            // address can't blow the header card open).
            minRows={1}
            maxRows={6}
            sx={{
              ...inputSx,
              flex: 1,
              width: '100%',
              minWidth: 200,
              '& .MuiInputBase-root': {
                // Auto height so the field grows with content, but padded so
                // ONE line matches the 28px single-line fields exactly.
                // (Multiline MUI roots carry their own padding — zero the inner
                // textarea's below or the two stack up into a tall box.)
                height: 'auto',
                minHeight: 28,
                padding: '4px 8px',
                fontSize: '13px',
                lineHeight: 1.5,
                fontFamily: fieldFontFamily,
                backgroundColor: 'background.paper',
                borderRadius: '4px',
                border: '1px solid',
                borderColor: fieldBorderColor,
              },
              '& .MuiInputBase-input': {
                padding: 0,
              },
            }}
          />
        );

      case 'date':
        return (
          <TextField
            type="date"
            value={value ? new Date(value).toISOString().split('T')[0] : ''}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))}
            size="small"
            sx={{
              ...inputSx,
              flex: 1,
              minWidth: 130,
              // Calendar icon on the LEFT (matching the search adornments):
              // absolute-position the native webkit picker indicator and pad
              // the date text past it. (Separate selector from inputSx's
              // .MuiInputBase-root key so we don't clobber its styles.)
              '& .MuiOutlinedInput-root': { position: 'relative' },
              '& input[type=date]': { paddingLeft: '30px' },
              '& input[type=date]::-webkit-calendar-picker-indicator': {
                position: 'absolute',
                left: '6px',
                padding: 0,
              },
            }}
          />
        );

      case 'number':
        return (
          <TextField
            type="number"
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, parseFloat(e.target.value) || 0))}
            size="small"
            sx={{ ...inputSx, flex: 1, minWidth: 100 }}
          />
        );

      case 'text':
      default:
        return (
          <TextField
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))}
            size="small"
            sx={{ ...inputSx, flex: 1, minWidth: 150 }}
          />
        );
    }
  };

  const leftLabelSx = {
    width: 150,
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
    fontSize: '13px',
    fontWeight: 700,
    fontFamily: fieldFontFamily,
    letterSpacing: 0,
    textTransform: 'none' as const,
    color: 'text.primary',
    py: 0.75,
    px: 1.25,
    bgcolor: 'surfaceTones.low',
    borderRight: 1,
    borderColor: 'divider',
    alignSelf: 'stretch',
    display: 'flex',
    alignItems: 'center',
  };

  // Render a single row with label on left
  const renderRow = (field: FieldDefinition) => (
    <Box
      key={field.fieldName}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Typography sx={leftLabelSx}>{field.displayLabel}</Typography>
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', maxWidth: HEADER_INPUT_MAX_WIDTH[field.fieldName] }}>
        {customInputs?.[field.fieldName] ?? renderInput(field)}
      </Box>
    </Box>
  );

  // Common row style for right column
  const rightRowSx = {
    display: 'flex',
    alignItems: 'center',
    gap: 0.75,
    borderBottom: 1,
    borderColor: 'divider',
    '&:last-child': {
      borderBottom: 'none',
    },
  };

  const rightLabelSx = {
    width: 110,
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
    fontSize: '13px',
    fontWeight: 700,
    fontFamily: fieldFontFamily,
    letterSpacing: 0,
    textTransform: 'none' as const,
    color: 'text.primary',
    textAlign: 'left' as const,
    py: 0.75,
    px: 1.25,
    bgcolor: 'surfaceTones.low',
  };

  // Render right column row (summary fields)
  const renderRightRow = (field: FieldDefinition) => {
    const value = getNestedValue(formData, field.fieldName) ?? field.defaultValue ?? '';
    const currency = getNestedValue(formData, 'documentInfo.currency') || 'USD';

    // Special handling for Tax row (Tax Y/N + Absorb Tax Y/N + tax code).
    // The tax code (GST master file, legacy 1-7) applies to the WHOLE document:
    // picking one sets documentInfo.taxCode and drives gstPercent, so totals
    // and the GL posting follow — unlike account mapping, which is per-line.
    if (field.fieldName === 'documentInfo.taxApplicable') {
      const absorbTaxValue = getNestedValue(formData, 'documentInfo.absorbTax') ?? 'N';
      // Default = code 1 (Output Tax, standard-rated) — matches the org-rate
      // 9% that gstPercent already defaults to, and the legacy default.
      const taxCodeValue = getNestedValue(formData, 'documentInfo.taxCode') ?? '1';
      return (
        <Box key={field.fieldName} sx={rightRowSx}>
          <Typography sx={rightLabelSx}>Tax</Typography>
          <FormControl size="small" sx={{ width: 56 }}>
            <Select value={value} onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))} sx={selectSx}>
              <MenuItem value="Y" sx={{ fontSize: '13px' }}>Y</MenuItem>
              <MenuItem value="N" sx={{ fontSize: '13px' }}>N</MenuItem>
            </Select>
          </FormControl>
          <Typography sx={{ fontSize: '13px', fontWeight: 500, px: 0.5 }}>Tax Inclusive</Typography>
          <FormControl size="small" sx={{ width: 56 }}>
            <Select value={absorbTaxValue} onChange={(e) => setFormData(setNestedValue(formData, 'documentInfo.absorbTax', e.target.value))} sx={selectSx}>
              <MenuItem value="Y" sx={{ fontSize: '13px' }}>Y</MenuItem>
              <MenuItem value="N" sx={{ fontSize: '13px' }}>N</MenuItem>
            </Select>
          </FormControl>
          {taxCodes.length > 0 && (
            <FormControl size="small" sx={{ width: 64, ml: 0.5 }}>
              <Select
                value={taxCodeValue}
                renderValue={(v) => String(v)}
                onChange={(e) => {
                  const code = e.target.value as string;
                  const tc = taxCodes.find((t) => t.code === code);
                  let next = setNestedValue(formData, 'documentInfo.taxCode', code);
                  if (tc) next = setNestedValue(next, 'documentInfo.gstPercent', tc.rate);
                  setFormData(next);
                }}
                sx={selectSx}
              >
                {taxCodes.map((t) => (
                  <MenuItem key={t.code} value={t.code} sx={{ fontSize: '13px' }}>
                    {t.code} - {t.name}{t.rate > 0 ? `  ${t.rate.toFixed(2)} %` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>
      );
    }

    // Skip absorbTax as it's rendered with taxApplicable
    if (field.fieldName === 'documentInfo.absorbTax') return null;

    // Skip currency in right column (it's part of Rate row display)
    if (field.fieldName === 'documentInfo.currency') return null;

    // Disc row: % or $ (per-document discount) + calculated amount.
    if (field.fieldName === 'documentInfo.discountPercent') {
      if (hideDiscount) return null; // Route Order PO: no document-level discount
      const discAmount = getNestedValue(formData, 'documentInfo.discountAmount') ?? 0;
      const discType = getNestedValue(formData, 'documentInfo.discountType') || 'percent';
      return (
        <Box key={field.fieldName} sx={rightRowSx}>
          <Typography sx={rightLabelSx}>Disc</Typography>
          <FormControl size="small" sx={{ width: 56 }}>
            <Select
              value={discType}
              onChange={(e) => setFormData(setNestedValue(formData, 'documentInfo.discountType', e.target.value))}
              sx={selectSx}
            >
              <MenuItem value="percent" sx={{ fontSize: '13px' }}>%</MenuItem>
              <MenuItem value="amount" sx={{ fontSize: '13px' }}>$</MenuItem>
            </Select>
          </FormControl>
          <TextField
            type="number"
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, parseFloat(e.target.value) || 0))}
            size="small"
            sx={{ ...inputSx, width: 64 }}
          />
          <Typography sx={{ flex: 1, textAlign: 'right', fontSize: '13px', px: 1 }}>
            {Number(discAmount).toFixed(2)}
          </Typography>
          <Typography sx={{ fontSize: '13px', color: 'text.secondary', pr: 1 }}>{currency}</Typography>
        </Box>
      );
    }

    // Skip discountAmount as it's rendered with discountPercent
    if (field.fieldName === 'documentInfo.discountAmount') return null;

    // GST row with percentage and amount
    if (field.fieldName === 'documentInfo.gstPercent') {
      const gstAmount = getNestedValue(formData, 'documentInfo.gstAmount') ?? 0;
      return (
        <Box key={field.fieldName} sx={rightRowSx}>
          <Typography sx={rightLabelSx}>GST</Typography>
          <TextField
            type="number"
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, parseFloat(e.target.value) || 0))}
            size="small"
            sx={{ ...inputSx, width: 64 }}
          />
          <Typography sx={{ flex: 1, textAlign: 'right', fontSize: '13px', px: 1 }}>
            {Number(gstAmount).toFixed(2)}
          </Typography>
          <Typography sx={{ fontSize: '13px', color: 'text.secondary', pr: 1 }}>{currency}</Typography>
        </Box>
      );
    }

    // Skip gstAmount as it's rendered with gstPercent
    if (field.fieldName === 'documentInfo.gstAmount') return null;

    // Regular summary row (Rate, Gross Total, Sub-total, Nett Total)
    return (
      <Box key={field.fieldName} sx={rightRowSx}>
        <Typography sx={rightLabelSx}>{field.displayLabel}</Typography>
        {field.fieldName === 'documentInfo.rate' ? (
          <>
            <TextField
              type="number"
              value={value}
              onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, parseFloat(e.target.value) || 0))}
              size="small"
              sx={{ ...inputSx, width: 80 }}
            />
            {/* Push the currency code to the right edge, in line with the other rows */}
            <Box sx={{ flex: 1 }} />
          </>
        ) : (
          <Typography sx={{ flex: 1, textAlign: 'right', fontSize: '13px', px: 1 }}>
            {Number(value).toFixed(2)}
          </Typography>
        )}
        <Typography sx={{ fontSize: '13px', color: 'text.secondary', pr: 1 }}>{currency}</Typography>
      </Box>
    );
  };

  // Single-column legacy arrangement: listed fields first in their fixed
  // order, everything else after in template order (stable sort).
  const visibleLeftFields = leftFields.filter((f) => !hiddenFields.includes(f.fieldName));
  const orderOf = (f: FieldDefinition) => {
    // An explicit displayOrder on the field wins, so a template can lay out its
    // own sensible order (WCT does); otherwise fall back to the global
    // HEADER_FIELD_ORDER, unchanged for every other org.
    const explicit = (f as any).displayOrder;
    if (typeof explicit === 'number') return explicit;
    const i = HEADER_FIELD_ORDER.indexOf(f.fieldName);
    return i === -1 ? 1000 : i;
  };
  const orderedFields = [...visibleLeftFields].sort((a, b) => orderOf(a) - orderOf(b));

  // Contact hosts the attention trio on its own row (legacy layout); Terms
  // shares that row when present (DOs hide Terms — the trio still renders).
  const contactField = orderedFields.find((f) => f.fieldName === 'documentInfo.contact' || f.fieldName === 'contact');
  const termsField = orderedFields.find((f) => f.fieldName === 'documentInfo.paymentTerms' || f.fieldName === 'paymentTerms');
  const pairContactTerms = Boolean(contactField);

  // When the header has a Contact row, THAT row hosts the customer-contact
  // picker and "+ Add contact", and the Attention readout is fill-only.
  const mainCustomer = (customers || []).find((c: any) => c.id === formData?.customer?.id);
  const cc = useCustomerContacts(mainCustomer, formData, setFormData);
  // Job Location dropdown (fieldType 'siteLocation'): the customer's saved sites.
  const siteField = orderedFields.find((f) => f.fieldType === 'siteLocation');
  const sites = useCustomerSites(mainCustomer, formData, setFormData, siteField?.fieldName || 'documentInfo.location');

  // The Contact row's Attention is fill-only — written by useCustomerContacts
  // (pick / add a customer contact), never typed. See renderContactTermsRow.

  const attnName = getNestedValue(formData, 'attention.name') || '';
  const attnPhone = getNestedValue(formData, 'attention.phoneNumber') || '';
  const attnEmail = getNestedValue(formData, 'attention.email') || '';
  // Legacy fallbacks until the user types over them: DOs stored the pair in
  // documentInfo.contactName/contactNumber; other docs the combined
  // "Name - Phone" (or a bare phone) in documentInfo.contact — split it so the
  // name/phone land in their own boxes instead of the whole string in Phone.
  const legacyContact =
    !attnName && !attnPhone && !attnEmail ? getNestedValue(formData, 'documentInfo.contact') || '' : '';
  const legacyMatch = /^(.+?)\s*-\s*(.+)$/.exec(legacyContact);
  const attnNameDisplay =
    attnName || getNestedValue(formData, 'documentInfo.contactName') || legacyMatch?.[1] || '';
  const attnPhoneDisplay =
    attnPhone ||
    getNestedValue(formData, 'documentInfo.contactNumber') ||
    (legacyMatch ? legacyMatch[2] : legacyContact);

  // Attention is FILL-ONLY: it comes from one of the customer's contacts
  // (picked from "Attn To" or just added with "+ Add contact") and is shown as
  // a readout — nothing here can be typed, so an attention that is not a
  // contact of the customer cannot exist. Disabled until a customer is chosen.
  const attnReadout = attnNameDisplay
    ? [attnNameDisplay, attnPhoneDisplay, attnEmail].filter((v) => v && String(v).trim() !== '').join('  ·  ')
    : mainCustomer
    ? 'No contact chosen'
    : 'Select a customer first';
  const renderContactTermsRow = () => (
    <Box
      key="contact-terms"
      sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider' }}
    >
      <Typography sx={leftLabelSx}>{contactField!.displayLabel}</Typography>
      {/* Phone: picker + readout + Terms wrap instead of clipping. */}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1, flexWrap: { xs: 'wrap', md: 'nowrap' }, py: 0.25 }}>
        <ContactPicker cc={cc} inputSx={inputSx} disabled={!mainCustomer} />
        <Typography
          sx={{
            fontSize: '13px',
            fontFamily: fieldFontFamily,
            color: attnNameDisplay ? 'text.primary' : 'text.disabled',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
          title={attnReadout}
        >
          {attnReadout}
        </Typography>
        {termsField && (
          <>
            <Typography sx={{ ...leftLabelSx, width: 90, ml: 'auto', borderLeft: 1 }}>
              {termsField.displayLabel}
            </Typography>
            <Box sx={{ width: 240, display: 'flex', alignItems: 'center' }}>
              {renderInput(termsField)}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );

  // Left column as rows that pack half-width (gridSize 6) fields two per line
  // (guru 2026-10-27: like the Biofuel editor, so the top section never
  // scrolls). Fields with no gridSize stay full-width — every other org is
  // unchanged. Textareas are always full-width; the Attention trio keeps its
  // own full row.
  const isHalf = (f: FieldDefinition) => f.gridSize === 6 && f.fieldType !== 'textarea';
  // Same label width as the full rows, so the first column's inputs line up
  // across paired and full rows (the lines were jagged at 118).
  const pairLabelSx = { ...leftLabelSx };
  const renderCell = (field: FieldDefinition, withRightBorder: boolean) => (
    <Box
      key={field.fieldName}
      sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, ...(withRightBorder ? { borderRight: { md: 1 }, borderColor: 'divider' } : {}) }}
    >
      <Typography sx={pairLabelSx}>{field.displayLabel}</Typography>
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0 }}>
        {customInputs?.[field.fieldName] ?? renderInput(field)}
      </Box>
    </Box>
  );
  const renderPairRow = (a: FieldDefinition, b: FieldDefinition) => (
    <Box
      key={`${a.fieldName}|${b.fieldName}`}
      sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, borderBottom: 1, borderColor: 'divider' }}
    >
      {renderCell(a, true)}
      {renderCell(b, false)}
    </Box>
  );
  const skipUnit = (f: FieldDefinition) => pairContactTerms && (f === contactField || (termsField && f === termsField));
  const leftRows: React.ReactNode[] = [];
  for (let k = 0; k < orderedFields.length; ) {
    const f = orderedFields[k];
    if (pairContactTerms && f === contactField) { leftRows.push(renderContactTermsRow()); k += 1; continue; }
    if (pairContactTerms && termsField && f === termsField) { k += 1; continue; } // drawn inside the contact row
    const next = orderedFields[k + 1];
    if (isHalf(f) && next && !skipUnit(next) && isHalf(next)) { leftRows.push(renderPairRow(f, next)); k += 2; }
    else { leftRows.push(renderRow(f)); k += 1; }
  }

  return (
    // Phone: the fields column and the totals column stack instead of
    // squeezing side-by-side (the 300px totals panel pushed fields off-screen).
    <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
      {/* Left Column - Form Fields */}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.25,
          overflow: 'hidden',
          bgcolor: 'background.paper',
          '& > div:last-of-type': { borderBottom: 'none' },
        }}
      >
        {leftRows}
        {appendRow && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={leftLabelSx}>{appendRow.label}</Typography>
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
              {appendRow.content}
            </Box>
          </Box>
        )}
      </Box>

      {/* Right Column - Summary/Totals. Skipped entirely when the template
          defines no summary fields (plain TI invoices, DOs) — an empty bordered
          box used to sit there (guru 2026-10-24). */}
      {(prependRightRow || rightFields.length > 0) && (
      <Box
        sx={{
          minWidth: { xs: 0, md: 300 },
          width: { xs: '100%', md: 'auto' },
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.25,
          overflow: 'hidden',
          bgcolor: 'background.paper',
        }}
      >
        {/* Rendered inside the same row chrome as the field-driven rows below,
            so a control with no field definition still looks native here. */}
        {prependRightRow && <Box sx={rightRowSx}>{prependRightRow}</Box>}
        {rightFields.map((field) => renderRightRow(field))}
      </Box>
      )}
      {/* The Attention row's "+ Add contact" dialog (only when that row hosts
          the picker — otherwise CustomerCodeField renders its own). */}
      {pairContactTerms && <AddContactDialog cc={cc} customerName={mainCustomer?.name} />}
      {siteField && <AddLocationDialog sl={sites} customerName={mainCustomer?.name} />}
    </Box>
  );
}
