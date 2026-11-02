"use client";

// Round BA — New order: "Pick from the customer's products" (Clients › a customer › Products). Picking one fills
// product, grade and size; the supplier products that fit it are listed with the supplier's name, and clicking
// one sets the supplier when none is chosen yet. Renders nothing when the customer has no products.

import React, { useMemo, useState } from "react";
import { Autocomplete, Box, Chip, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { useProductCatalog } from "../_lib/hooks";
import type { ProductBrief, ProductCatalog } from "../_lib/api";

type Pick = ProductCatalog["customers"][number]["products"][number];

// The order's product line wording (OrderFormDialog's default is "Aluminium Billet").
const PRODUCT_NAME: Record<string, string> = { BILLET: "Aluminium Billet", INGOT: "Aluminium Ingot", REMELT_INGOT: "Aluminium Remelt Ingot", SCRAP: "Aluminium Scrap" };

/** "152 × 5800" → "152 MM X 5800 MM" (the order's size wording); other sizes as written. */
export const orderSize = (size: string) => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*$/i.exec(size);
  return m ? `${m[1]} MM X ${m[2]} MM` : size;
};

/** What a picked product fills on the order form (product only when the form is known). */
export const orderFieldsFrom = (p: ProductBrief) => ({ grade: p.grade ?? "", size: p.size ? orderSize(p.size) : "", product: p.form ? PRODUCT_NAME[p.form] : undefined });

export default function AddFlowProductPicker({ open, customerId, supplierId, suppliers, onPick, onSupplier }: { open: boolean; customerId: string; supplierId: string; suppliers: Array<{ id: string; name: string }>; onPick: (p: Pick) => void; onSupplier: (id: string) => void }) {
  const t = useTranslations("addflow.picker");
  const catalog = useProductCatalog(open && !!customerId);
  const [picked, setPicked] = useState<Pick | null>(null);
  const products = useMemo(() => catalog.data?.customers.find((c) => c.customerId === customerId)?.products ?? [], [catalog.data, customerId]);
  const current = picked && products.some((p) => p.id === picked.id) ? picked : null;
  if (!customerId || !products.length) return null;
  const name = (id: string) => suppliers.find((s) => s.id === id)?.name ?? id;
  return (
    <Box data-tour="order-product-picker">
      <Autocomplete
        size="small"
        options={products}
        value={current}
        onChange={(_, p) => {
          setPicked(p);
          if (p) onPick(p);
        }}
        getOptionLabel={(p) => p.label}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        renderOption={(props, p) => (
          <li {...props} key={p.id}>
            <Box>
              <Typography variant="body2">{p.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                {[p.monthlyQtyMt != null ? t("monthly", { n: p.monthlyQtyMt }) : null, p.priceBasis].filter(Boolean).join(" · ")}
              </Typography>
            </Box>
          </li>
        )}
        renderInput={(p) => <TextField {...p} label={t("label")} helperText={t("hint")} />}
      />
      {current && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            {t("suppliers")}
          </Typography>
          {current.matches.length ? (
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {current.matches.map((m) => {
                const on = supplierId === m.supplierId;
                return (
                  <Tooltip key={`${m.supplierId}-${m.productId}`} title={`${m.fit === "exact" ? t("exact") : t("grade")} · ${supplierId ? (on ? "" : t("supplierSet")) : t("setSupplier")}`.replace(/ · $/, "")}>
                    <Chip
                      size="small"
                      color={on ? "primary" : m.fit === "exact" ? "success" : "default"}
                      variant={on ? "filled" : "outlined"}
                      label={`${name(m.supplierId)} · ${m.label}`}
                      onClick={supplierId ? undefined : () => onSupplier(m.supplierId)}
                    />
                  </Tooltip>
                );
              })}
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {t("noSupplier")}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
