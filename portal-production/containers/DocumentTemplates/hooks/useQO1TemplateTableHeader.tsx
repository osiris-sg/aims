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
  tableHeadersConfig?: {
    [key: string]: boolean;
  };
  columnOrder?: string[];
  columnLabels?: { [key: string]: string };
}

export default function useQO1TemplateTableHeader(props: Props) {
  const { viewMode, remove, control, setValue, tableHeadersConfig, columnOrder, columnLabels } = props;

  const columns = useMemo(() => {
    // console.log("🔄 TABLE HEADERS: Regenerating columns with config:", tableHeadersConfig);
    // console.log("🔄 TABLE HEADERS: Column order:", columnOrder);
    // console.log("🔄 TABLE HEADERS: Column labels:", columnLabels);

    const baseColumns = [];
    const order = columnOrder || ["no", "item", "unitRate"];

    // Calculate dynamic column widths using percentages for better responsiveness
    const visibleColumns = order.filter((key) => tableHeadersConfig?.[key] !== false);
    const totalColumns = visibleColumns.length;
    const hasActions = !viewMode;

    // Define relative weights for different column types (not fixed pixels)
    const columnWeights = {
      no: 1, // Smallest - just numbers
      item: 3, // Largest - item descriptions need more space
      unitRate: 2, // Medium - unit rates
      default: 2, // Medium - default for custom fields
    };

    // Calculate total weight
    const totalWeight = visibleColumns.reduce((sum, key) => {
      return sum + (columnWeights[key as keyof typeof columnWeights] || columnWeights.default);
    }, 0);

    // Reserve space for actions column (10% of total width)
    const actionsPercentage = hasActions ? 10 : 0;
    const contentPercentage = 100 - actionsPercentage;

    // Function to get percentage width for each column
    const getColumnWidth = (columnKey: string) => {
      const weight = columnWeights[columnKey as keyof typeof columnWeights] || columnWeights.default;
      const percentage = (weight / totalWeight) * contentPercentage;
      return Math.max(8, Math.floor(percentage)); // Minimum 8% width
    };

    // Define column generator function
    const getColumnDefinition = (columnKey: string) => {
      // Default labels for fallback
      const defaultLabels: { [key: string]: string } = {
        no: "No.",
        item: "Item",
        unitRate: "Unit Rate/Month",
      };

      const label = columnLabels?.[columnKey] || defaultLabels[columnKey] || columnKey;
      // console.log(`🏷️ TABLE HEADERS: Column ${columnKey} -> Label: "${label}" (from columnLabels: ${columnLabels?.[columnKey]}, default: ${defaultLabels[columnKey]})`);

      // Default column definitions with percentage-based responsive sizing
      const defaultDefinitions: { [key: string]: any } = {
        no: {
          accessorKey: "no",
          header: label,
          size: getColumnWidth("no"),
          cell: ({ row }: { row: any }) => row.index + 1,
        },
        item: {
          accessorKey: "item",
          header: label,
          size: getColumnWidth("item"),
          cell: ({ row }: { row: any }) => (
            <FormInputBox control={control} name={`items.${row.index}.item`} placeHolder="Enter item description" size="small" labelArriangment={viewMode ? "horizontal" : "vertical"} viewMode={viewMode} key={`item-input-${row.id}-${control._formValues?.items?.[row.index]?.item || ""}`} />
          ),
        },
        unitRate: {
          accessorKey: "unitRate",
          header: label,
          size: getColumnWidth("unitRate"),
          cell: ({ row }: { row: any }) => (
            <FormInputBox control={control} name={`items.${row.index}.unitRate`} placeHolder="Enter unit rate" size="small" labelArriangment={viewMode ? "horizontal" : "vertical"} viewMode={viewMode} key={`unitRate-input-${row.id}-${control._formValues?.items?.[row.index]?.unitRate || ""}`} />
          ),
        },
      };

      // Return existing definition or create a generic one for custom fields
      return (
        defaultDefinitions[columnKey] || {
          accessorKey: columnKey,
          header: label,
          size: getColumnWidth(columnKey), // Percentage-based size for custom fields
          cell: ({ row }: { row: any }) => (
            <FormInputBox
              control={control}
              name={`items.${row.index}.${columnKey}`}
              placeHolder={`Enter ${label.toLowerCase()}`}
              size="small"
              labelArriangment={viewMode ? "horizontal" : "vertical"}
              viewMode={viewMode}
              key={`${columnKey}-input-${row.id}-${control._formValues?.items?.[row.index]?.[columnKey] || ""}`}
            />
          ),
        }
      );
    };

    // Add columns in the specified order, only if they're visible
    order.forEach((columnKey) => {
      if (tableHeadersConfig?.[columnKey] !== false) {
        // console.log(`✅ TABLE HEADERS: Adding ${columnKey} column`);
        baseColumns.push(getColumnDefinition(columnKey));
      }
    });

    // Add actions column for edit mode (always last)
    if (!viewMode) {
      baseColumns.push({
        accessorKey: "actions",
        header: "Actions",
        size: actionsPercentage, // Use the reserved percentage for actions
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
      });
    }

    // console.log("📋 TABLE HEADERS: Final columns count:", baseColumns.length);
    return baseColumns;
  }, [viewMode, remove, tableHeadersConfig, columnOrder?.join("-"), columnLabels, JSON.stringify(columnLabels)]);

  return { columns };
}
