/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo } from "react";

import DeleteIcon from "@mui/icons-material/Delete";
import { IconButton } from "@mui/material";
import FormInputBox from "@/form-components/FormInputBox";
import FormTextArea from "@/form-components/FormTextArea";
import { Control, FieldValues } from "react-hook-form";

interface Props {
  viewMode: boolean;
  remove: (index: number) => void;
  control: Control<FieldValues, object> | undefined | any;
  setValue: any;
}

export default function useQO2TemplateTableHeader(props: Props) {
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
          <FormTextArea control={control} name={`items.${row.index}.item`} placeHolder="Enter item description" rows={1} size="small" labelArriangment={viewMode ? "horizontal" : "vertical"} viewMode={viewMode} key={`item-textarea-${row.id}-${control._formValues?.items?.[row.index]?.item || ""}`} />
        ),
      },
      {
        header: "Unit Rate / Month (SGD)",
        columns: [
          {
            accessorKey: "unitRate1YearOrLess",
            header: "1 Year or less",
            cell: ({ row }: { row: any }) => (
              <FormInputBox
                control={control}
                name={`items.${row.index}.unitRate1YearOrLess`}
                placeHolder="Enter unit rate (1 Year or less)"
                size="small"
                labelArriangment={viewMode ? "horizontal" : "vertical"}
                viewMode={viewMode}
                key={`unitRate1YearOrLess-input-${row.id}-${control._formValues?.items?.[row.index]?.unitRate1YearOrLess || ""}`}
              />
            ),
          },
          {
            accessorKey: "unitRateMoreThan1Year",
            header: "More than 1 Year",
            cell: ({ row }: { row: any }) => (
              <FormInputBox
                control={control}
                name={`items.${row.index}.unitRateMoreThan1Year`}
                placeHolder="Enter unit rate (More than 1 Year)"
                size="small"
                labelArriangment={viewMode ? "horizontal" : "vertical"}
                viewMode={viewMode}
                key={`unitRateMoreThan1Year-input-${row.id}-${control._formValues?.items?.[row.index]?.unitRateMoreThan1Year || ""}`}
              />
            ),
          },
        ],
      },
      {
        accessorKey: "salesPrice",
        header: "Sales Price (SGD)",
        cell: ({ row }: { row: any }) => (
          <FormInputBox control={control} name={`items.${row.index}.salesPrice`} placeHolder="Enter sales price" size="small" labelArriangment={viewMode ? "horizontal" : "vertical"} viewMode={viewMode} key={`salesPrice-input-${row.id}-${control._formValues?.items?.[row.index]?.salesPrice || ""}`} />
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
