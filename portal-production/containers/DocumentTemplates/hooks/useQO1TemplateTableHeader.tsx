/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo } from "react";

import DeleteIcon from "@mui/icons-material/Delete";
import { IconButton } from "@mui/material";
import FormInputBox from "@/form-components/FormInputBox";
import { Control, FieldValues } from "react-hook-form";

interface Props {
  viewMode: boolean;
  remove: (index: number) => void;
  control: Control<FieldValues, object> | undefined | any;
  setValue: any;
}

export default function useQO1TemplateTableHeader(props: Props) {
  const { viewMode, remove, control, setValue } = props;

  const columns = useMemo(
    () => [
      {
        accessorKey: "no",
        header: "No.",
        cell: ({ row }: { row: any }) => row.index + 1,
      },
      {
        accessorKey: "item",
        header: "Item",
        cell: ({ row }: { row: any }) => (
          <FormInputBox control={control} name={`items.${row.index}.item`} placeHolder="Enter item description" size="small" labelArriangment={viewMode ? "horizontal" : "vertical"} viewMode={viewMode} key={`item-input-${row.id}-${control._formValues?.items?.[row.index]?.item || ""}`} />
        ),
      },
      {
        accessorKey: "unitRate",
        header: "Unit Rate/Month",
        cell: ({ row }: { row: any }) => (
          <FormInputBox control={control} name={`items.${row.index}.unitRate`} placeHolder="Enter unit rate" size="small" labelArriangment={viewMode ? "horizontal" : "vertical"} viewMode={viewMode} key={`unitRate-input-${row.id}-${control._formValues?.items?.[row.index]?.unitRate || ""}`} />
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
    [viewMode, control, remove]
  );

  return { columns };
}
