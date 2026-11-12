"use client";

// Manual order flow (2026-11-13): a service report names its customer AND one
// of that customer's DOs (the order and quotation follow from the DO). Shared
// by "+ New Report", the upload dialog and the order page.
import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Box, MenuItem, Stack, TextField, Typography } from "@mui/material";
import moment from "moment";
import CustomerPicker from "@/components/CustomerPicker";
import { request } from "@/helpers/request";

export interface DoOption {
  id: string;
  name: string | null;
  status: string;
  date: string | null;
  site: string | null;
  orderId: string | null;
  orderNo: string | null;
  jobId: string | null;
}

export default function CustomerDoPicker({
  customer,
  doId,
  onCustomer,
  onDo,
  disabled,
}: {
  customer: { id: string; name: string } | null;
  doId: string | null;
  onCustomer: (c: { id: string; name: string } | null) => void;
  onDo: (d: DoOption | null) => void;
  disabled?: boolean;
}) {
  const { getToken } = useAuth();
  const [options, setOptions] = useState<DoOption[] | null>(null);

  useEffect(() => {
    if (!customer?.id) {
      setOptions(null);
      return;
    }
    let gone = false;
    (async () => {
      setOptions(null);
      try {
        const token = await getToken();
        const res: any = await request({ path: `/maintenance-reports/do-options?customerId=${encodeURIComponent(customer.id)}`, method: "GET" }, {}, token ?? undefined);
        const list: DoOption[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        if (!gone) setOptions(list);
      } catch {
        if (!gone) setOptions([]);
      }
    })();
    return () => {
      gone = true;
    };
  }, [customer?.id, getToken]);

  const line = (d: DoOption) => [d.name || "DO", d.date ? moment(d.date).format("DD/MM/YYYY") : null, d.site, d.orderNo].filter(Boolean).join(" · ");

  return (
    <Stack spacing={2}>
      <CustomerPicker
        value={customer?.id ?? null}
        initialCustomer={customer as any}
        onChange={(c: any) => {
          onCustomer(c ? { id: c.id, name: c.name } : null);
          onDo(null);
        }}
        label="Customer"
        required
        disabled={disabled}
      />
      <TextField
        select
        label="DO"
        required
        value={doId ?? ""}
        onChange={(e) => onDo((options ?? []).find((o) => o.id === e.target.value) ?? null)}
        disabled={disabled || !customer || options === null}
        helperText={!customer ? "Pick the customer first" : options === null ? "Loading the customer's DOs" : options.length ? "The order and quotation follow from the DO" : "This customer has no DO"}
        fullWidth
        size="small"
      >
        {(options ?? []).map((d) => (
          <MenuItem key={d.id} value={d.id}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {line(d)}
              </Typography>
            </Box>
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}
