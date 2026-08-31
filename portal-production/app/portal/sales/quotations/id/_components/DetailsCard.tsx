"use client";

// Client / contract header of the Letter of Intent — the grid printed at the
// top of every page of their contract. Client is an autocomplete over the
// org's customers (or free text for a brand-new client).

import React, { useEffect, useState } from "react";
import { Autocomplete, Box, Collapse, Grid, IconButton, Paper, Stack, TextField, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useIdQuoteApi } from "../_lib/api";
import type { QuoteHeader } from "../_lib/types";

interface Props {
  header: QuoteHeader;
  contractNo: string | null;
  readOnly: boolean;
  onChange: (patch: Partial<QuoteHeader>) => void;
  onCustomerPicked?: (customer: any | null) => void;
}

export default function DetailsCard({ header, contractNo, readOnly, onChange, onCustomerPicked }: Props) {
  const api = useIdQuoteApi();
  const [open, setOpen] = useState(true);
  const [options, setOptions] = useState<any[]>([]);
  const [input, setInput] = useState(header.clientName || "");
  const [designers, setDesigners] = useState<Array<{ id: string; name: string; email?: string; whatsappNumber?: string | null }>>([]);

  useEffect(() => {
    api.listOrgUsers().then(setDesigners).catch(() => {});
  }, [api]);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const docs = await api.searchCustomers(input.trim());
        setOptions(docs);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [input, api]);

  const field = (label: string, key: keyof QuoteHeader, extra: any = {}) => (
    <TextField
      label={label}
      size="small"
      fullWidth
      value={(header[key] as any) ?? ""}
      onChange={(e) => onChange({ [key]: e.target.value } as any)}
      disabled={readOnly}
      {...extra}
    />
  );

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Client & contract details
          </Typography>
          {!open && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {header.clientName || "No client"} · {header.address || "no address"} · {header.designer || "no designer"}
            </Typography>
          )}
        </Box>
        <IconButton size="small" sx={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}>
          <ExpandMoreIcon />
        </IconButton>
      </Stack>
      <Collapse in={open}>
        <Box sx={{ px: 2, pb: 2 }}>
          <TextField
            label="Title"
            size="small"
            fullWidth
            value={header.title}
            onChange={(e) => onChange({ title: e.target.value })}
            disabled={readOnly}
            sx={{ mb: 1.5 }}
          />
          <Grid container spacing={1.5}>
            <Grid item xs={12} md={6}>
              <Autocomplete
                freeSolo
                disabled={readOnly}
                options={options}
                getOptionLabel={(o: any) => (typeof o === "string" ? o : o?.name || "")}
                inputValue={input}
                onInputChange={(_, v) => {
                  setInput(v);
                  onChange({ clientName: v });
                }}
                onChange={(_, v: any) => {
                  if (v && typeof v === "object") {
                    onChange({
                      clientName: v.name || "",
                      address: header.address || v.address || "",
                      contact: header.contact || v.phone || "",
                    });
                    onCustomerPicked?.(v);
                  }
                }}
                renderOption={(props, o: any) => (
                  <li {...props} key={o.id}>
                    <Box>
                      <Typography variant="body2">{o.name}</Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {[o.customerCode, o.phone, o.address].filter(Boolean).join(" · ")}
                      </Typography>
                    </Box>
                  </li>
                )}
                renderInput={(params) => <TextField {...params} label="Client" size="small" placeholder="Search customers or type a name" />}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField label="Contract Number" size="small" fullWidth value={contractNo || ""} disabled helperText="Assigned automatically" />
            </Grid>
            <Grid item xs={12} md={6}>
              {field("NRIC No", "nric")}
            </Grid>
            <Grid item xs={12} md={6}>
              {field("Agreement Date", "agreementDate", { type: "date", InputLabelProps: { shrink: true } })}
            </Grid>
            <Grid item xs={12} md={6}>
              {field("Address", "address", { multiline: true, minRows: 2 })}
            </Grid>
            <Grid item xs={12} md={6}>
              {field("Remarks", "remarks", { multiline: true, minRows: 2 })}
            </Grid>
            <Grid item xs={12} md={6}>
              {field("Contact", "contact")}
            </Grid>
            <Grid item xs={12} md={3}>
              <Autocomplete
                size="small"
                disabled={readOnly}
                options={designers}
                getOptionLabel={(o: any) => (typeof o === "string" ? o : o?.name || "")}
                value={designers.find((d) => d.name === header.designer) || (header.designer ? ({ id: "", name: header.designer } as any) : null)}
                isOptionEqualToValue={(a: any, b: any) => a?.id === b?.id || a?.name === b?.name}
                onChange={(_, v: any) => onChange({ designer: v?.name || "", designerPhone: header.designerPhone || v?.whatsappNumber || "" })}
                renderOption={(props, o: any) => (
                  <li {...props} key={o.id || o.name}>
                    <Box>
                      <Typography variant="body2">{o.name}</Typography>
                      {o.email && (
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                          {o.email}
                        </Typography>
                      )}
                    </Box>
                  </li>
                )}
                renderInput={(params) => <TextField {...params} label="Designer" placeholder="Pick a user" />}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              {field("Designer Phone", "designerPhone")}
            </Grid>
            <Grid item xs={12} md={6}>
              {field("Payment Terms", "paymentTerms")}
            </Grid>
          </Grid>
        </Box>
      </Collapse>
    </Paper>
  );
}
