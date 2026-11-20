"use client";

// Reference = order link (round 39, WCT group; rules in helpers/orderRef.ts). The invoice / DO editor's Reference
// field as a combobox: typing searches this customer's quotations / orders; picking one links the document to that
// quotation's order (made when missing) and the Reference shows "ORD… · QO…" as a chip (× unlinks); typed text that
// is not picked stays a plain reference. A confirmed document can be linked or unlinked; its text is not changed.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Autocomplete, Box, Button, Chip, CircularProgress, TextField, Typography } from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { requestFailed } from "@/helpers/requestOutcome";
import { refOptionRow, refOptionsPath, type RefLink, type RefOption } from "@/helpers/orderRef";

type Toggle = { __toggle: true };
type Opt = RefOption | Toggle;
const isToggle = (o: any): o is Toggle => !!o && o.__toggle === true;

export interface OrderRefLinked {
  link: RefLink;
  /** The Reference text the server wrote (drafts), else null. */
  reference: string | null;
  /** The customer the server set on a draft that had none. */
  customer: { id: string; name: string; address?: string | null; email?: string | null; customerCode?: string | null; gstRegNo?: string | null } | null;
}

export default function OrderRefField({
  documentId,
  customerId,
  value,
  readOnly,
  offerFill,
  onText,
  onLinked,
  onUnlinked,
  onFill,
  sx,
}: {
  documentId: string | null;
  customerId: string | null;
  /** The Reference text as the editor holds it. */
  value: string;
  /** A confirmed document: link / unlink only, the text stays. */
  readOnly: boolean;
  /** An invoice draft with no line yet: offer "Fill remaining lines" once linked. */
  offerFill: boolean;
  onText: (text: string) => void;
  onLinked: (r: OrderRefLinked) => void;
  onUnlinked: (r: { label: string; clearedReference: boolean }) => void;
  onFill?: (lines: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>) => void;
  sx?: any;
}) {
  const { getToken } = useAuth();
  const [link, setLink] = useState<RefLink | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [options, setOptions] = useState<RefOption[]>([]);
  const [loading, setLoading] = useState(false);
  // Typing on a confirmed document only searches (its text is not changed).
  const [search, setSearch] = useState("");
  const text = readOnly ? search : value;

  const call = async (method: "GET" | "POST", path: string, body?: any) => {
    const token = await getToken();
    const res: any = await request({ path, method, ownError: true }, body ?? (method === "POST" ? {} : undefined), token ?? undefined);
    if (requestFailed(res) || res?.success === false) throw new Error(res?.message || "Couldn't do that");
    return res?.data ?? res;
  };

  // The link the document is on (the chip).
  useEffect(() => {
    let live = true;
    setLink(null);
    setChecked(false);
    if (!documentId) return void setChecked(true);
    void (async () => {
      try {
        const out = await call("GET", `/order-refs/doc/${documentId}`);
        if (live) setLink(out?.link ?? null);
      } catch {
        // No chip; the field still works as plain text.
      } finally {
        if (live) setChecked(true);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Search while the list is open (a short pause after typing).
  const seq = useRef(0);
  useEffect(() => {
    if (!open || link) return;
    const n = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const out = await call("GET", refOptionsPath(text, customerId, all));
        if (n === seq.current) setOptions(Array.isArray(out) ? out : []);
      } catch {
        if (n === seq.current) setOptions([]);
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, text, customerId, all, link]);

  const pick = async (o: RefOption) => {
    if (!documentId) return void toast.info("Save the document first");
    setBusy(true);
    try {
      const out = await call("POST", "/order-refs/link", { documentId, quotationId: o.quotationId });
      const l: RefLink = { orderId: out.orderId, orderNumber: out.orderNumber, quotationId: out.quotationId ?? o.quotationId, quotationName: out.quotationName ?? o.quotationName, label: out.label, unlinkable: out.unlinkable !== false };
      setLink(l);
      setOpen(false);
      setSearch("");
      onLinked({ link: l, reference: out.reference ?? null, customer: out.customer ?? null });
      toast.success(out.createdOrder ? `Linked to ${l.orderNumber} (new order)` : `Linked to ${l.orderNumber}`);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't link it");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!documentId || !link) return;
    setBusy(true);
    try {
      const out = await call("POST", "/order-refs/unlink", { documentId });
      onUnlinked({ label: link.label, clearedReference: !!out?.clearedReference });
      toast.success(`Unlinked from ${link.orderNumber}`);
      setLink(null);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't unlink it");
    } finally {
      setBusy(false);
    }
  };

  const fill = async () => {
    if (!link || !onFill) return;
    setBusy(true);
    try {
      const out = await call("GET", `/order-refs/remaining-lines/${link.orderId}`);
      const lines = Array.isArray(out?.lines) ? out.lines : [];
      if (!lines.length) return void toast.info(`Nothing left to bill on ${link.orderNumber}`);
      onFill(lines);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't read the lines");
    } finally {
      setBusy(false);
    }
  };

  const list: Opt[] = useMemo(() => [...options, { __toggle: true } as Toggle], [options]);

  if (link) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", flex: 1, minWidth: 0, ...sx }} data-tour="doc-order-ref">
        <Chip
          icon={<LinkIcon fontSize="small" />}
          label={link.label}
          size="small"
          color="primary"
          variant="outlined"
          onDelete={link.unlinkable && !busy ? () => void unlink() : undefined}
          sx={{ maxWidth: "100%", fontWeight: 600 }}
        />
        {offerFill && onFill && (
          <Button size="small" onClick={() => void fill()} disabled={busy} sx={{ textTransform: "none" }} data-tour="doc-order-ref-fill">
            Fill remaining lines
          </Button>
        )}
        {busy && <CircularProgress size={14} />}
      </Box>
    );
  }

  return (
    <Autocomplete<Opt, false, false, true>
      freeSolo
      size="small"
      open={open}
      onOpen={() => setOpen(true)}
      onClose={(_, reason) => {
        if (reason !== "selectOption") setOpen(false);
      }}
      options={list}
      loading={loading}
      disabled={busy || !checked}
      filterOptions={(x) => x}
      value={null}
      inputValue={text}
      onInputChange={(_, v, reason) => {
        if (reason === "reset") return;
        if (readOnly) setSearch(v);
        else onText(v);
      }}
      onChange={(_, v) => {
        if (!v || typeof v === "string") return;
        if (isToggle(v)) {
          setAll((a) => !a);
          setOpen(true);
          return;
        }
        void pick(v);
      }}
      getOptionLabel={(o) => (typeof o === "string" ? o : isToggle(o) ? "" : o.quotationName || "")}
      getOptionDisabled={(o) => !isToggle(o) && !(o as RefOption).linkable}
      isOptionEqualToValue={() => false}
      renderOption={(props, o) => {
        const { key, ...rest } = props as any;
        if (isToggle(o))
          return (
            <li key="__toggle" {...rest}>
              <Typography variant="body2" color="primary" sx={{ fontWeight: 600 }}>
                {all ? "Show open only" : "Show all"}
              </Typography>
            </li>
          );
        const row = refOptionRow(o);
        return (
          <li key={o.quotationId} {...rest}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {row.title}
              </Typography>
              {row.detail && (
                <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: "break-word" }}>
                  {row.detail}
                </Typography>
              )}
            </Box>
          </li>
        );
      }}
      noOptionsText="No quotations"
      sx={{ flex: 1, minWidth: 200, ...sx }}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          placeholder={readOnly ? value : undefined}
          inputProps={{ ...params.inputProps, "aria-label": "Reference", "data-tour": "doc-order-ref" }}
        />
      )}
    />
  );
}
