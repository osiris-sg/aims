/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo } from "react";

import DeleteIcon from "@mui/icons-material/Delete";
import { IconButton } from "@mui/material";
import FormInputBox from "@/form-components/FormInputBox";
import { Control, FieldValues, useWatch } from "react-hook-form";
import FormSelect from "@/form-components/FormSelect";
import DescriptionCell from "./useDescriptionCell";
import PriceCell from "./usePriceCell";
import { useGetInventoriesForItemTable } from "./useGetInventoriesForItemTable";
import useGetXeroAccounts from "./useGetXeroAccounts";
import { useSearchParams } from "next/navigation";

interface Props {
  viewMode: boolean;
  remove: (index: number) => void;
  control: Control<FieldValues, object> | undefined | any;
  setValue: any;
}

const AmountCell = ({ rowIndex, control }: { rowIndex: number; control: Control<FieldValues, object> }) => {
  const item = useWatch({ control, name: `items.${rowIndex}` });

  const unitPrice = parseFloat(item?.price ?? "0");
  const quantity = parseFloat(item?.quantity ?? "0");
  const tax = item?.tax === "custom" ? parseFloat(item?.customTax ?? "0") : parseFloat(item?.tax ?? "0");

  const amount = (unitPrice * quantity * (1 + tax / 100)).toFixed(2);

  return <div style={{ padding: "10px", fontSize: "14px", minHeight: "40px" }}>${amount}</div>;
};

export default function useTemplateTableHeader(props: Props) {
  const { viewMode, remove, control, setValue } = props;
  const { inventoriesForDocument } = useGetInventoriesForItemTable();
  const { accounts: xeroAccounts, loading: xeroLoading, error: xeroError, isXeroConnected } = useGetXeroAccounts();
  const searchParams = useSearchParams();
  const scannedInventoryId = searchParams.get("scannedInventoryId");

  console.log("inventoriesForDocument", inventoriesForDocument);
  const columns = useMemo(
    () => [
      {
        accessorKey: "item",
        header: "Item",
        size: 120,
        minSize: 100,
        cell: ({ row }: { row: any }) => {
          console.log("Frfrfrfr", inventoriesForDocument);
          const selectedIds = [...(control._formValues.items?.map((item: any) => item.inventoryItemId).filter((id: string | undefined) => !!id && id !== row.original?.inventoryItemId) ?? [])];

          if (scannedInventoryId && !selectedIds.includes(scannedInventoryId)) {
            selectedIds.push(scannedInventoryId);
          }
          const menuItems = inventoriesForDocument.map((inventory) => ({
            label: inventory.sku || "Unknown Asset",
            value: inventory.id,
            disabled: selectedIds.includes(inventory.id), // Disable if selected elsewhere
          }));
          console.log("Menu Items:", menuItems);
          return <FormSelect control={control} name={`items.${row.index}.inventoryItemId`} menuTitle="Choose item" size="small" viewMode={viewMode} menuItems={menuItems} key={`item-select-${row.id}-${control._formValues?.items?.[row.index]?.inventoryItemId || ""}`} />;
        },
      },
      {
        accessorKey: "description",
        header: "Description",
        size: 240,
        minSize: 200,
        cell: ({ row }: { row: any }) => <DescriptionCell rowIndex={row.index} control={control} setValue={setValue} viewMode={viewMode} rentedInventories={inventoriesForDocument} />,
      },
      {
        accessorKey: "quantity",
        header: "Quantity",
        size: 80,
        minSize: 60,
        maxSize: 100,
        cell: ({ row }: { row: any }) => <FormInputBox control={control} name={`items.${row.index}.quantity`} placeHolder="Enter quantity" size="small" labelArriangment={viewMode ? "horizontal" : "vertical"} viewMode={viewMode} />,
      },
      {
        accessorKey: "unitPrice",
        header: "Unit Price",
        size: 90,
        minSize: 80,
        cell: ({ row }: { row: any }) => <PriceCell rowIndex={row.index} control={control} setValue={setValue} viewMode={viewMode} rentedInventories={inventoriesForDocument} />,
      },
      {
        accessorKey: "tax",
        header: "Tax",
        size: 70,
        minSize: 60,
        maxSize: 90,
        cell: ({ row }: { row: any }) => {
          const item = control._formValues?.items?.[row.index];
          if (!item?.tax) {
            setValue(`items.${row.index}.tax`, "0");
          }
          const taxValue = item?.tax;
          const isCustom = taxValue === "custom";

          const menuItems = [
            { label: "No tax", value: "0" },
            { label: "GST (9%)", value: "9" },
            { label: "GST (10%)", value: "10" },
            { label: "Custom", value: "custom" },
          ];

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <FormSelect
                control={control}
                name={`items.${row.index}.tax`}
                placeHolder="Select tax"
                size="small"
                labelArriangment={viewMode ? "horizontal" : "vertical"}
                viewMode={viewMode}
                menuTitle="Choose tax rate"
                menuItems={menuItems}
                key={`tax-select-${row.id}-${control._formValues?.items?.[row.index]?.tax ?? ""}`}
              />
              {isCustom && <FormInputBox control={control} name={`items.${row.index}.customTax`} placeHolder="Enter custom tax %" size="small" labelArriangment="vertical" viewMode={viewMode} />}
            </div>
          );
        },
      },
      {
        accessorKey: "account",
        header: "Account",
        size: 120,
        minSize: 100,
        cell: ({ row }: { row: any }) => {
          if (xeroLoading) {
            return <div style={{ padding: "10px", fontSize: "12px", color: "#666" }}>Loading accounts...</div>;
          }

          if (xeroError || !isXeroConnected) {
            return <div style={{ padding: "10px", fontSize: "12px", color: "#d32f2f" }}>Xero not connected</div>;
          }

          const accountMenuItems = Array.isArray(xeroAccounts)
            ? xeroAccounts.map((account) => ({
                label: account.displayName,
                value: account.code,
              }))
            : [];

          if (accountMenuItems.length === 0) {
            return <div style={{ padding: "10px", fontSize: "12px", color: "#666" }}>No accounts available</div>;
          }

          return (
            <FormSelect
              control={control}
              name={`items.${row.index}.accountCode`}
              placeHolder="Select account"
              size="small"
              labelArriangment={viewMode ? "horizontal" : "vertical"}
              viewMode={viewMode}
              menuTitle="Choose account"
              menuItems={accountMenuItems}
              key={`account-select-${row.id}-${control._formValues?.items?.[row.index]?.accountCode ?? ""}`}
            />
          );
        },
      },
      {
        accessorKey: "amount",
        header: "Amount",
        size: 80,
        minSize: 70,
        cell: ({ row }: { row: any }) => <AmountCell rowIndex={row.index} control={control} />,
      },
      ...(!viewMode
        ? [
            {
              accessorKey: "actions",
              header: "Actions",
              size: 80,
              minSize: 60,
              maxSize: 100,
              cell: ({ row }: { row: any }) => (
                <IconButton
                  onClick={() => remove(row.index)}
                  sx={{
                    color: "customRed.contrastText",
                    bgcolor: "customRed.main",
                    "&:hover": {
                      bgcolor: "customRed.dark",
                    },
                    borderRadius: "8px",
                  }}
                >
                  <DeleteIcon />
                </IconButton>
              ),
            },
          ]
        : []),
    ],
    [inventoriesForDocument, xeroAccounts, xeroLoading, xeroError, isXeroConnected, viewMode, remove, scannedInventoryId, control, setValue]
  );

  return { columns };
}
