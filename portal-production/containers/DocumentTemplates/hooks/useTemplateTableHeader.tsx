/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo } from "react";

import DeleteIcon from "@mui/icons-material/Delete";
import { IconButton } from "@mui/material";
import FormInputBox from "@/form-components/FormInputBox";
import { Control, FieldValues } from "react-hook-form";
import FormSelect from "@/form-components/FormSelect";
import DescriptionCell from "./useDescriptionCell";
import PriceCell from "./usePriceCell";
import { useGetInventoriesForItemTable } from "./useGetInventoriesForItemTable";
import { useSearchParams } from "next/navigation";

interface Props {
  viewMode: boolean;
  remove: (index: number) => void;
  control: Control<FieldValues, object> | undefined | any;
  setValue: any;
}

export default function useTemplateTableHeader(props: Props) {
  const { viewMode, remove, control, setValue } = props;
  const { inventoriesForDocument } = useGetInventoriesForItemTable();
  const searchParams = useSearchParams();
  const scannedInventoryId = searchParams.get("scannedInventoryId");
  console.log("inventoriesForDocument", inventoriesForDocument);
  const columns = useMemo(
    () => [
      {
        accessorKey: "item",
        header: "Item",
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
        cell: ({ row }: { row: any }) => <DescriptionCell rowIndex={row.index} control={control} setValue={setValue} viewMode={viewMode} rentedInventories={inventoriesForDocument} disabled />,
      },
      {
        accessorKey: "quantity",
        header: "Quantity",
        cell: ({ row }: { row: any }) => (
          <FormInputBox disabled control={control} name={`items.${row.index}.quantity`} placeHolder="Choose item" size="small" labelArriangment={viewMode ? "horizontal" : "vertical"} viewMode={viewMode} key={`quantity-input-${row.id}-${control._formValues?.items?.[row.index]?.quantity ?? ""}`} />
        ),
      },
      {
        accessorKey: "unitPrice",
        header: "Unit Price",
        cell: ({ row }: { row: any }) => <PriceCell rowIndex={row.index} control={control} setValue={setValue} viewMode={viewMode} rentedInventories={inventoriesForDocument} />,
      },
      {
        accessorKey: "tax",
        header: "Tax",
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
        accessorKey: "amount",
        header: "Amount",
        cell: ({ row }: { row: any }) => (
          <FormInputBox disabled control={control} name={`items.${row.index}.amount`} placeHolder="Enter amount" size="small" labelArriangment={viewMode ? "horizontal" : "vertical"} viewMode={viewMode} key={`amount-input-${row.id}-${control._formValues?.items?.[row.index]?.amount ?? ""}`} />
        ),
      },
      ...(!viewMode
        ? [
            {
              accessorKey: "actions",
              header: "Actions",
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
    [inventoriesForDocument, viewMode, control, remove, scannedInventoryId]
  );

  return { columns };
}
