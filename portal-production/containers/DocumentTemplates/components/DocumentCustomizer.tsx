/* eslint-disable @typescript-eslint/no-explicit-any */
import { IconButton, List, ListItem, ListItemText, Stack, Typography, TextField } from "@mui/material";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import React from "react";
import { Control, Controller, FieldValues } from "react-hook-form";
import DraggableTableHeaders from "./DraggableTableHeaders";

interface Props {
  isNoSelectionColumn?: boolean;
  fields: { title: string; items: { label: string; name: string; type?: string }[] }[];
  control: Control<FieldValues, object> | undefined | any;
  // New props for draggable table headers
  tableHeaders?: { [key: string]: boolean };
  columnOrder?: string[];
  columnLabels?: { [key: string]: string };
  onColumnReorder?: (newOrder: string[]) => void;
  onToggleColumnVisibility?: (columnId: string, visible: boolean) => void;
  onEditLabel?: (columnId: string, newLabel: string) => void;
  onAddField?: (fieldId: string, label: string) => void;
  // Grouped header controls
  columnGroups?: Array<{ id: string; label: string; columns: string[] }>;
  onAddGroup?: (label: string, columns: string[]) => void;
  onRemoveGroup?: (groupId: string) => void;
}
export default function DocumentCustomizer(props: Props) {
  const { fields, control, tableHeaders, columnOrder, columnLabels, onColumnReorder, onToggleColumnVisibility, onEditLabel, onAddField, columnGroups, onAddGroup, onRemoveGroup } = props;

  return (
    <Stack
      sx={{
        gap: "var(--default-gap)",
        height: "100%", // Fixed height
        overflow: "auto", // Make scrollable
        pr: 1, // Add padding to prevent scrollbar overlap
        py: 1, // Add vertical padding
        // Prevent flex compression of children
        "& > *": {
          flexShrink: 0, // Don't allow children to shrink
        },
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
            <Stack key={`fields=item-${index}`} sx={{ minHeight: 0, mb: 2 }}>
              <Typography
                variant="body1"
                sx={{
                  p: "var(--half-padding)",
                  mb: 1,
                  backgroundColor: "tertiary.main",
                  borderRadius: "var(--default-border-radius)",
                }}
              >
                {fieldItem.title}
              </Typography>
              <DraggableTableHeaders tableHeaders={tableHeaders} columnOrder={columnOrder} columnLabels={columnLabels} onReorder={onColumnReorder} onToggleVisibility={onToggleColumnVisibility} onEditLabel={onEditLabel} onAddField={onAddField} />
              {onAddGroup && onRemoveGroup && (
                <Stack sx={{ mt: 1, gap: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Header Groups
                  </Typography>
                  {(columnGroups || []).map((g) => (
                    <Stack key={g.id} direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="body2">
                        {g.label} ({g.columns.join(", ")})
                      </Typography>
                      <IconWrapper onClick={() => onRemoveGroup(g.id)}>
                        <span style={{ fontSize: 12 }}>Remove</span>
                      </IconWrapper>
                    </Stack>
                  ))}
                  <AddGroupForm availableColumns={columnOrder} onAddGroup={onAddGroup} />
                </Stack>
              )}
            </Stack>
          );
        }

        // Render normal fields for other sections
        return (
          <Stack key={`fields=item-${index}`} sx={{ minHeight: 0, mb: 2 }}>
            <Typography
              variant="body1"
              sx={{
                p: "var(--half-padding)",
                mb: 1,
                backgroundColor: "tertiary.main",
                borderRadius: "var(--default-border-radius)",
              }}
            >
              {fieldItem.title}
            </Typography>
            <List dense sx={{ py: 0, mt: 1.25 }}>
              {fieldItem.items.map((_item, _index) => (
                <ListItem key={_index} sx={{ py: 1, flexDirection: _item.type === "textarea" ? "column" : "row", alignItems: _item.type === "textarea" ? "stretch" : "center" }}>
                  <ListItemText
                    primary={_item.label}
                    sx={{
                      "& .MuiListItemText-primary": {
                        fontSize: "0.875rem",
                        lineHeight: 1.2,
                      },
                      mb: _item.type === "textarea" ? 1 : 0,
                    }}
                  />
                  {_item.type === "textarea" ? (
                    <Controller
                      control={control}
                      name={_item.name}
                      render={({ field: { onChange, value } }) => (
                        <TextField
                          multiline
                          rows={3}
                          value={value || ""}
                          onChange={onChange}
                          placeholder={`Enter ${_item.label.toLowerCase()}`}
                          variant="outlined"
                          size="small"
                          fullWidth
                          sx={{
                            "& .MuiOutlinedInput-root": {
                              fontSize: "0.875rem",
                            },
                          }}
                        />
                      )}
                    />
                  ) : (
                    <Controller control={control} name={_item.name} render={({ field: { onChange, value } }) => <IconWrapper onClick={() => onChange(!value)}>{value === true ? <IconEye /> : <IconEyeOff />}</IconWrapper>} />
                  )}
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

function AddGroupForm({ availableColumns, onAddGroup }: { availableColumns?: string[]; onAddGroup: (label: string, cols: string[]) => void }) {
  const [label, setLabel] = React.useState("");
  const [cols, setCols] = React.useState<string>("");

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <TextField size="small" label="Group label" value={label} onChange={(e) => setLabel(e.target.value)} fullWidth />
      <TextField size="small" label="Columns (comma)" value={cols} onChange={(e) => setCols(e.target.value)} placeholder={(availableColumns || []).join(", ")} fullWidth />
      <IconWrapper
        onClick={() => {
          const selected = cols
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (label && selected.length > 0) onAddGroup(label, selected);
          setLabel("");
          setCols("");
        }}
      >
        <span style={{ fontSize: 12 }}>Add</span>
      </IconWrapper>
    </Stack>
  );
}
