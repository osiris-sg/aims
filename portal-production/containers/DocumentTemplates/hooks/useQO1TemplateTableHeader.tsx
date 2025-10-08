/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo } from "react";

import DeleteIcon from "@mui/icons-material/Delete";
import { IconButton } from "@mui/material";
import FormInputBox from "@/form-components/FormInputBox";
import FormAutocomplete from "@/form-components/FormAutocomplete";
import { Control, FieldValues } from "react-hook-form";
import { usePastDescriptions } from "./usePastDescriptions";

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
  columnGroups?: Array<{ id: string; label: string; columns: string[] }>;
}

export default function useQO1TemplateTableHeader(props: Props) {
  const { viewMode, remove, control, tableHeadersConfig, columnOrder, columnLabels, columnGroups } = props;
  const { pastDescriptions, isLoading: isLoadingDescriptions } = usePastDescriptions();

  const columns = useMemo(() => {
    // console.log("🔄 TABLE HEADERS: Regenerating columns with config:", tableHeadersConfig);
    // console.log("🔄 TABLE HEADERS: Column order:", columnOrder);
    // console.log("🔄 TABLE HEADERS: Column labels:", columnLabels);

    const baseColumns: any[] = [];
    const order = columnOrder || ["no", "item", "unitRate"];

    // Calculate dynamic column widths using percentages for better responsiveness
    const visibleColumns = order.filter((key) => tableHeadersConfig?.[key] !== false);
    // const totalColumns = visibleColumns.length; // reserved for future use
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
            <FormAutocomplete
              control={control}
              name={`items.${row.index}.item`}
              placeHolder="Enter or select item description"
              rows={1}
              size="small"
              labelArriangment={viewMode ? "horizontal" : "vertical"}
              viewMode={viewMode}
              options={pastDescriptions}
              loading={isLoadingDescriptions}
              key={`item-autocomplete-${row.id}-${control._formValues?.items?.[row.index]?.item || ""}`}
            />
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

    // Build a map of individual column defs for grouping
    const columnDefByKey: Record<string, any> = {};
    order.forEach((columnKey) => {
      if (tableHeadersConfig?.[columnKey] !== false) {
        columnDefByKey[columnKey] = getColumnDefinition(columnKey);
      }
    });

    // Create grouped headers if configured
    const visibleOrder = order.filter((key) => tableHeadersConfig?.[key] !== false);
    const groups = (columnGroups || []).filter((g) => Array.isArray(g.columns) && g.columns.length > 0);
    const childToGroup: Record<string, { id: string; label: string; columns: string[] }> = {};
    const groupFirstChild: Record<string, string> = {};
    groups.forEach((g) => {
      const children = g.columns.filter((k) => visibleOrder.includes(k));
      if (children.length === 0) return;
      const first = children.reduce((best, key) => {
        const idx = visibleOrder.indexOf(key);
        const bestIdx = best ? visibleOrder.indexOf(best) : Infinity;
        return idx < bestIdx ? key : best;
      }, "" as string);
      groupFirstChild[g.id] = first;
      children.forEach((k) => (childToGroup[k] = { id: g.id, label: g.label, columns: children }));
    });

    // Assemble final columns with groups inserted at the first child position
    const addedGroupIds = new Set<string>();
    visibleOrder.forEach((columnKey) => {
      const group = childToGroup[columnKey];
      if (group && groupFirstChild[group.id] === columnKey) {
        if (!addedGroupIds.has(group.id)) {
          baseColumns.push({
            header: group.label,
            columns: group.columns.map((k) => columnDefByKey[k]).filter(Boolean),
          });
          addedGroupIds.add(group.id);
        }
      } else if (!group) {
        baseColumns.push(columnDefByKey[columnKey]);
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
  }, [viewMode, remove, tableHeadersConfig, columnOrder, columnLabels, columnGroups, control, pastDescriptions, isLoadingDescriptions]);

  return { columns };
}
