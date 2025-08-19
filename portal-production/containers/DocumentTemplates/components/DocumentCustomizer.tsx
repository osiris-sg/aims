/* eslint-disable @typescript-eslint/no-explicit-any */
import { IconButton, List, ListItem, ListItemText, Stack, Typography } from "@mui/material";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import React from "react";
import { Control, Controller, FieldValues } from "react-hook-form";
import DraggableTableHeaders from "./DraggableTableHeaders";

interface Props {
  isNoSelectionColumn?: boolean;
  fields: { title: string; items: { label: string; name: string }[] }[];
  control: Control<FieldValues, object> | undefined | any;
  // New props for draggable table headers
  tableHeaders?: { [key: string]: boolean };
  columnOrder?: string[];
  columnLabels?: { [key: string]: string };
  onColumnReorder?: (newOrder: string[]) => void;
  onToggleColumnVisibility?: (columnId: string, visible: boolean) => void;
  onEditLabel?: (columnId: string, newLabel: string) => void;
  onAddField?: (fieldId: string, label: string) => void;
}
export default function DocumentCustomizer(props: Props) {
  const { fields, control, tableHeaders, columnOrder, columnLabels, onColumnReorder, onToggleColumnVisibility, onEditLabel, onAddField } = props;

  return (
    <Stack
      sx={{
        gap: "var(--half-gap)",
        minHeight: 0, // Allow shrinking
        flex: 1, // Take up full height
        overflow: "auto", // Make scrollable
        pr: 1, // Add padding to prevent scrollbar overlap
        "&::-webkit-scrollbar": {
          width: "6px",
        },
        "&::-webkit-scrollbar-track": {
          background: "transparent",
        },
        "&::-webkit-scrollbar-thumb": {
          background: "rgba(0,0,0,0.2)",
          borderRadius: "3px",
        },
        "&::-webkit-scrollbar-thumb:hover": {
          background: "rgba(0,0,0,0.3)",
        },
      }}
    >
      {fields.map((fieldItem, index) => {
        // Replace "Table Headers" section with draggable component
        if (fieldItem.title === "Table Headers" && tableHeaders && columnOrder && columnLabels && onColumnReorder && onToggleColumnVisibility && onEditLabel && onAddField) {
          return (
            <Stack key={`fields=item-${index}`}>
              <DraggableTableHeaders control={control} tableHeaders={tableHeaders} columnOrder={columnOrder} columnLabels={columnLabels} onReorder={onColumnReorder} onToggleVisibility={onToggleColumnVisibility} onEditLabel={onEditLabel} onAddField={onAddField} />
            </Stack>
          );
        }

        // Render normal fields for other sections
        return (
          <Stack key={`fields=item-${index}`} sx={{ minHeight: 0 }}>
            <Typography variant="body1" sx={{ p: "var(--half-padding)", backgroundColor: "tertiary.main", borderRadius: "var(--default-border-radius)" }}>
              {fieldItem.title}
            </Typography>
            <List dense sx={{ py: 0 }}>
              {fieldItem.items.map((_item, _index) => (
                <ListItem key={_index} sx={{ py: 0.5 }}>
                  <ListItemText
                    primary={_item.label}
                    sx={{
                      "& .MuiListItemText-primary": {
                        fontSize: "0.875rem",
                        lineHeight: 1.2,
                      },
                    }}
                  />
                  <Controller control={control} name={_item.name} render={({ field: { onChange, value } }) => <IconWrapper onClick={() => onChange(!value)}>{value === true ? <IconEye /> : <IconEyeOff />}</IconWrapper>} />
                </ListItem>
              ))}
            </List>
          </Stack>
        );
      })}
    </Stack>
  );
}

const IconWrapper = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <IconButton
    onClick={onClick}
    sx={{
      color: "customYellow.contrastText",
      bgcolor: "customYellow.main",
      "&:hover": {
        bgcolor: "customYellow.dark",
      },
      borderRadius: "8px",
    }}
  >
    {children}
  </IconButton>
);
