import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FormInputBox from "@/form-components/FormInputBox";
import FormImage from "@/form-components/FormImage";
import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import ParentAssetSelector from "./ParentAssetSelector";
import { useSearchParams } from "next/navigation";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useAuth } from "@clerk/nextjs";

export default function AdditionalDetails() {
  const { control, setValue, watch } = useFormContext();
  const searchParams = useSearchParams();
  const editingAssetId = searchParams.get("id");
  const parentAssetId = watch("parentAssetId");

  // Get organization's tracking mode - ON = Assets, OFF = Products
  const { isAssetTrackingModeEnabled, isAssetPointsEnabled } = useOrganizationFeatures();
  const itemType = isAssetTrackingModeEnabled ? "Asset" : "Product";

  // Custom price rows — [{ label, value }] e.g. Listing Price, Dealer Price.
  const { fields, append, remove } = useFieldArray({ control, name: "customPrices" });

  // Revenue accounts for the sales/rental GL mapping (drives the Stock Card tabs).
  const { getToken } = useAuth();
  const [revenueAccounts, setRevenueAccounts] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        if (typeof window !== "undefined") {
          const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
          if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
        }
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/accounting/accounts`, { headers });
        const json = await res.json();
        const list = json?.data ?? json;
        setRevenueAccounts((Array.isArray(list) ? list : []).filter((a: any) => ["SALES", "INCOME"].includes(a.accountType)).sort((a: any, b: any) => String(a.code).localeCompare(String(b.code))));
      } catch {
        /* leave empty */
      }
    })();
  }, [getToken]);

  return (
    <Stack spacing="var(--default-gap)">
      <FormInputBox control={control} name="description" label="Description" placeHolder={`Enter ${itemType} Description`} />

      {/* Pricing block — cost + selling are fixed defaults; users can add named
          custom prices (e.g. Listing Price, Dealer Price) below. */}
      <Box>
        <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
          Pricing
        </Typography>
        <Stack spacing="var(--default-gap)">
          <FormInputBox
            control={control}
            name="costPrice"
            label="Cost Price"
            placeHolder="Enter cost price"
            type="number"
            min={0}
            bottomText="What you pay per unit (for margin tracking)"
          />
          <FormInputBox
            control={control}
            name="price"
            label="Selling Price"
            placeHolder="Enter selling price"
            type="number"
            min={0}
            bottomText={`Default unit price when this ${itemType.toLowerCase()} appears on a document`}
          />

          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>GL revenue accounts</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
              Set a sales and/or rental account — this {itemType.toLowerCase()} then shows in the Stock Card's Sales / Rental tabs and its invoice lines post to that account automatically.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing="var(--default-gap)">
              <Controller
                control={control}
                name="salesAccountCode"
                render={({ field }) => (
                  <TextField select fullWidth size="small" label="Sales account" value={field.value || ""} onChange={field.onChange}>
                    <MenuItem value="">— none —</MenuItem>
                    {revenueAccounts.map((a) => (<MenuItem key={a.code} value={a.code}>{a.code} — {a.name}</MenuItem>))}
                  </TextField>
                )}
              />
              <Controller
                control={control}
                name="rentalAccountCode"
                render={({ field }) => (
                  <TextField select fullWidth size="small" label="Rental account" value={field.value || ""} onChange={field.onChange}>
                    <MenuItem value="">— none —</MenuItem>
                    {revenueAccounts.map((a) => (<MenuItem key={a.code} value={a.code}>{a.code} — {a.name}</MenuItem>))}
                  </TextField>
                )}
              />
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
              Custom Prices
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
              Optional named price tiers — e.g. Listing Price, Dealer Price.
            </Typography>

            {fields.length === 0 && (
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", mb: 1 }}>
                No custom prices yet.
              </Typography>
            )}

            <Stack spacing={1}>
              {fields.map((row, index) => (
                <Stack key={row.id} direction="row" spacing={1} alignItems="flex-start">
                  <Controller
                    control={control}
                    name={`customPrices.${index}.label`}
                    render={({ field, fieldState }) => (
                      <TextField
                        {...field}
                        size="small"
                        label="Label"
                        placeholder="e.g. Listing Price"
                        error={!!fieldState.error}
                        helperText={fieldState.error?.message}
                        sx={{ flex: 1 }}
                      />
                    )}
                  />
                  <Controller
                    control={control}
                    name={`customPrices.${index}.value`}
                    render={({ field, fieldState }) => (
                      <TextField
                        {...field}
                        value={field.value ?? ""}
                        size="small"
                        type="number"
                        inputProps={{ min: 0, step: "0.01" }}
                        label="Amount"
                        placeholder="0.00"
                        error={!!fieldState.error}
                        helperText={fieldState.error?.message}
                        sx={{ width: 160 }}
                      />
                    )}
                  />
                  <IconButton
                    size="small"
                    onClick={() => remove(index)}
                    aria-label="Remove price"
                    sx={{ mt: 0.5 }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Stack>

            <Button
              size="small"
              variant="text"
              startIcon={<AddIcon />}
              onClick={() => append({ label: "", value: 0 })}
              sx={{ mt: 1, textTransform: "none" }}
            >
              Add price field
            </Button>
          </Box>

          {isAssetPointsEnabled && (
            <>
              <Divider />
              <FormInputBox
                control={control}
                name="points"
                label="Points"
                placeHolder="Enter points"
                type="number"
                min={0}
                bottomText="Discount points associated with this item (1 point = $1)"
              />
            </>
          )}
        </Stack>
      </Box>

      <FormInputBox
        control={control}
        name="minQuantity"
        label="Minimum Quantity"
        placeHolder="Enter minimum quantity"
        type="number"
        min={0}
        bottomText="Low stock alert threshold"
      />

      {/* Field manual entry: expose this asset's units to keyed-in serial
          lookup on the scan home (untaggable assets — e.g. submerged pumps). */}
      <Box>
        <Controller
          control={control}
          name="allowManualEntry"
          render={({ field }) => (
            <FormControlLabel
              control={<Switch checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />}
              label={
                <Box>
                  <Typography variant="body2">Allow manual serial entry (field)</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Field techs can reach this {itemType.toLowerCase()}&apos;s units by typing the serial — for assets that can&apos;t carry an NFC tag.
                  </Typography>
                </Box>
              }
            />
          )}
        />
      </Box>

      {/* Parent selector only shown for tracked assets - products don't have hierarchy */}
      {isAssetTrackingModeEnabled && (
        <ParentAssetSelector
          value={parentAssetId}
          onChange={(newParentId) => setValue("parentAssetId", newParentId)}
          excludeAssetId={editingAssetId || undefined}
        />
      )}

      <FormImage control={control} name="image" label="Image" />
    </Stack>
  );
}
 