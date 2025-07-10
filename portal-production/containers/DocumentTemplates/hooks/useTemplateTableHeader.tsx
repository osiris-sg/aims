/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo } from "react";

import DeleteIcon from "@mui/icons-material/Delete";
import { IconButton } from "@mui/material";
import FormInputBox from "@/form-components/FormInputBox";
import { Control, FieldValues } from "react-hook-form";
import FormSelect from "@/form-components/FormSelect";
import DescriptionCell from "./useDescriptionCell";
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
