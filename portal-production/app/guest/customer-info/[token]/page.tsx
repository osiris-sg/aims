"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Container,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { request } from "@/helpers/request";

type State = "ok" | "expired" | "revoked" | "notfound";

interface ContactRow {
  name: string;
  email: string;
  phone: string;
}

interface GuestView {
  state: State;
  customerName: string | null;
  projectName: string | null;
  submittedAt: string | null;
  doContacts: Array<{ name: string; email: string | null; phone: string | null }>;
  invoiceContacts: Array<{ name: string; email: string | null; phone: string | null }>;
}

const STATE_MSG: Record<Exclude<State, "ok">, { title: string; body: string }> = {
  expired: { title: "Link expired", body: "This link has expired. Please ask the sender for a new one." },
  revoked: { title: "Link no longer active", body: "This link is no longer active." },
  notfound: { title: "Link not found", body: "This link was not found." },
};

const emptyRow = (): ContactRow => ({ name: "", email: "", phone: "" });

function StateScreen({ title, body }: { title: string; body: string }) {
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Card sx={{ p: 4, textAlign: "center" }}>
        <InfoOutlinedIcon sx={{ fontSize: 48, color: "text.secondary", mb: 1 }} />
        <Typography variant="h6" fontWeight={700} gutterBottom>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {body}
        </Typography>
      </Card>
    </Container>
  );
}

// One editable group of contacts (DO or Invoice).
function ContactGroup({
  title,
  hint,
  rows,
  setRows,
  disabled,
}: {
  title: string;
  hint: string;
  rows: ContactRow[];
  setRows: (rows: ContactRow[]) => void;
  disabled: boolean;
}) {
  const update = (i: number, field: keyof ContactRow, value: string) => {
    const next = rows.slice();
    next[i] = { ...next[i], [field]: value };
    setRows(next);
  };
  const remove = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const add = () => setRows([...rows, emptyRow()]);

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700}>
        {title}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
        {hint}
      </Typography>
      <Stack spacing={2}>
        {rows.map((row, i) => (
          <Box key={i} sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 56 }}>
                Person {i + 1}
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              <IconButton size="small" onClick={() => remove(i)} disabled={disabled} aria-label="Remove">
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Stack spacing={1.25} sx={{ mt: 1 }}>
              <TextField
                label="Name"
                value={row.name}
                onChange={(e) => update(i, "name", e.target.value)}
                fullWidth
                size="small"
                disabled={disabled}
              />
              <TextField
                label="Email"
                value={row.email}
                onChange={(e) => update(i, "email", e.target.value)}
                fullWidth
                size="small"
                type="email"
                disabled={disabled}
              />
              <TextField
                label="Phone"
                value={row.phone}
                onChange={(e) => update(i, "phone", e.target.value)}
                fullWidth
                size="small"
                disabled={disabled}
              />
            </Stack>
          </Box>
        ))}
      </Stack>
      <Button startIcon={<AddIcon />} onClick={add} disabled={disabled} sx={{ mt: 1.5, textTransform: "none" }}>
        Add person
      </Button>
    </Box>
  );
}

export default function CustomerInfoCollectPage() {
  const params = useParams();
  const token = params?.token as string;

  const [view, setView] = useState<GuestView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [doRows, setDoRows] = useState<ContactRow[]>([emptyRow()]);
  const [invoiceRows, setInvoiceRows] = useState<ContactRow[]>([emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const toRows = (list: GuestView["doContacts"]): ContactRow[] =>
    list.length
      ? list.map((c) => ({ name: c.name ?? "", email: c.email ?? "", phone: c.phone ?? "" }))
      : [emptyRow()];

  const load = useCallback(async () => {
    try {
      const res: any = await request({ path: `/public/customer-info/${token}`, method: "GET" }, {});
      const v = (res?.data ?? res) as GuestView;
      setView(v);
      if (v.state === "ok") {
        setDoRows(toRows(v.doContacts));
        setInvoiceRows(toRows(v.invoiceContacts));
      }
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.response?.data?.message || e?.message || "Could not load this page.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const clean = (rows: ContactRow[]) =>
    rows
      .map((r) => ({ name: r.name.trim(), email: r.email.trim(), phone: r.phone.trim() }))
      .filter((r) => r.name.length > 0);

  const submit = async () => {
    const doContacts = clean(doRows);
    const invoiceContacts = clean(invoiceRows);
    if (doContacts.length === 0 && invoiceContacts.length === 0) {
      setSubmitError("Add at least one contact person before submitting.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res: any = await request(
        { path: `/public/customer-info/${token}/submit`, method: "POST" },
        { doContacts, invoiceContacts },
      );
      if (res?.success === false) throw new Error(res?.message ?? "Could not submit.");
      setDone(true);
    } catch (e: any) {
      setSubmitError(e?.response?.data?.message || e?.message || "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!view) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Alert severity="error">{loadError || "Could not load this page."}</Alert>
      </Container>
    );
  }

  if (view.state !== "ok") {
    const m = STATE_MSG[view.state];
    return <StateScreen title={m.title} body={m.body} />;
  }

  if (done) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Card sx={{ p: 4, textAlign: "center" }}>
          <CheckCircleIcon color="success" sx={{ fontSize: 48, mb: 1 }} />
          <Typography variant="h6" fontWeight={700} gutterBottom>
            Thank you
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Your contact details were received. You can update them any time from this same link while it is active.
          </Typography>
          <Button
            variant="outlined"
            onClick={() => {
              setDone(false);
              load();
            }}
          >
            Edit my answers
          </Button>
        </Card>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" fontWeight={700}>
          Customer contact details
        </Typography>
        {/* Read-only customer + project */}
        <Box sx={{ mt: 1, p: 1.5, bgcolor: "action.hover", borderRadius: 1.5 }}>
          <Typography variant="body2" fontWeight={600}>
            {view.projectName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {view.customerName}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Please add the people we should contact for Delivery Orders and for Invoices. Name is required for each
          person; email and phone are optional.
        </Typography>
        {view.submittedAt && (
          <Alert severity="info" sx={{ mt: 2 }}>
            You already submitted on {new Date(view.submittedAt).toLocaleString()}. You can update and resubmit.
          </Alert>
        )}

        <Divider sx={{ my: 3 }} />
        <ContactGroup
          title="Delivery Order (DO) contacts"
          hint="People who receive and sign for deliveries."
          rows={doRows}
          setRows={setDoRows}
          disabled={submitting}
        />

        <Divider sx={{ my: 3 }} />
        <ContactGroup
          title="Invoice contacts"
          hint="People who handle billing and invoices."
          rows={invoiceRows}
          setRows={setInvoiceRows}
          disabled={submitting}
        />

        {submitError && (
          <Alert severity="error" sx={{ mt: 3 }}>
            {submitError}
          </Alert>
        )}

        <Button
          variant="contained"
          onClick={submit}
          disabled={submitting}
          fullWidth
          sx={{ mt: 3, py: 1.5, minHeight: 48 }}
        >
          {submitting ? <CircularProgress size={20} color="inherit" /> : "Submit"}
        </Button>
      </Card>
    </Container>
  );
}
