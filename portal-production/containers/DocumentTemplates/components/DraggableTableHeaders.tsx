import React, { useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, Typography, IconButton, TextField, Button } from "@mui/material";
import { Visibility, VisibilityOff, DragIndicator, Edit, Check, Close, Add } from "@mui/icons-material";
import { Control, FieldValues } from "react-hook-form";

interface TableHeaderItem {
  id: string;
  label: string;
  visible: boolean;
}

interface Props {
  control: Control<FieldValues, object> | undefined | any;
  tableHeaders: { [key: string]: boolean };
  columnOrder: string[];
  columnLabels: { [key: string]: string };
  onReorder: (newOrder: string[]) => void;
  onToggleVisibility: (columnId: string, visible: boolean) => void;
  onEditLabel: (columnId: string, newLabel: string) => void;
  onAddField: (fieldId: string, label: string) => void;
}

// Individual draggable item component
function SortableItem({ id, label, visible, onToggleVisibility, onEditLabel }: { id: string; label: string; visible: boolean; onToggleVisibility: (id: string, visible: boolean) => void; onEditLabel: (id: string, newLabel: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(label);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSaveEdit = () => {
    if (editValue.trim() && editValue !== label) {
      onEditLabel(id, editValue.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditValue(label);
    setIsEditing(false);
  };

  const handleStartEdit = () => {
    setIsEditing(true);
    setEditValue(label);
  };

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 8px", // Reduced padding
        backgroundColor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "6px", // Smaller border radius
        marginBottom: "6px", // Reduced margin
        cursor: isDragging ? "grabbing" : "grab",
        minHeight: "36px", // Set minimum height
        width: "100%", // Ensure full width
        maxWidth: "100%", // Prevent overflow
        overflow: "hidden", // Hide any overflow
        boxSizing: "border-box", // Include padding in width calculation
        "&:hover": {
          backgroundColor: "action.hover",
        },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0 }}>
        <DragIndicator
          {...attributes}
          {...listeners}
          sx={{
            color: "text.secondary",
            cursor: "grab",
            "&:active": { cursor: "grabbing" },
            flexShrink: 0, // Don't shrink the drag handle
          }}
        />
        {isEditing ? (
          <TextField
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveEdit();
              if (e.key === "Escape") handleCancelEdit();
            }}
            size="small"
            variant="outlined"
            sx={{
              flex: 1,
              minWidth: 0, // Allow shrinking
              "& .MuiInputBase-root": {
                fontSize: "0.875rem", // Smaller font
              },
            }}
            autoFocus
          />
        ) : (
          <Typography
            variant="body2"
            sx={{
              color: visible ? "text.primary" : "text.disabled",
              flex: 1,
              cursor: "pointer",
              minWidth: 0, // Allow shrinking
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "0.875rem", // Smaller font
            }}
            onClick={handleStartEdit}
          >
            {label}
          </Typography>
        )}
      </Box>

      <Box sx={{ display: "flex", gap: 0.25, flexShrink: 0 }}>
        {isEditing ? (
          <>
            <IconButton onClick={handleSaveEdit} size="small" sx={{ padding: "3px", minWidth: "24px", width: "24px", height: "24px" }}>
              <Check fontSize="small" />
            </IconButton>
            <IconButton onClick={handleCancelEdit} size="small" sx={{ padding: "3px", minWidth: "24px", width: "24px", height: "24px" }}>
              <Close fontSize="small" />
            </IconButton>
          </>
        ) : (
          <IconButton onClick={handleStartEdit} size="small" sx={{ padding: "3px", minWidth: "24px", width: "24px", height: "24px" }}>
            <Edit fontSize="small" />
          </IconButton>
        )}

        <IconButton
          onClick={() => onToggleVisibility(id, !visible)}
          sx={{
            padding: "3px",
            minWidth: "24px",
            width: "24px",
            height: "24px",
            backgroundColor: visible ? "warning.main" : "action.disabled",
            color: visible ? "warning.contrastText" : "text.disabled",
            "&:hover": {
              backgroundColor: visible ? "warning.dark" : "action.hover",
            },
          }}
          size="small"
        >
          {visible ? <Visibility fontSize="small" /> : <VisibilityOff fontSize="small" />}
        </IconButton>
      </Box>
    </Box>
  );
}

export default function DraggableTableHeaders({ control, tableHeaders, columnOrder, columnLabels, onReorder, onToggleVisibility, onEditLabel, onAddField }: Props) {
  const [isAddingField, setIsAddingField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleAddField = () => {
    if (newFieldLabel.trim()) {
      // Generate a unique field ID
      const fieldId = newFieldLabel.toLowerCase().replace(/[^a-z0-9]/g, "");
      onAddField(fieldId, newFieldLabel.trim());
      setNewFieldLabel("");
      setIsAddingField(false);
    }
  };

  const handleCancelAdd = () => {
    setNewFieldLabel("");
    setIsAddingField(false);
  };

  // Create items array from column order
  const items: TableHeaderItem[] = columnOrder.map((id) => ({
    id,
    label: columnLabels[id] || id,
    visible: tableHeaders[id] !== false,
  }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = columnOrder.indexOf(active.id as string);
      const newIndex = columnOrder.indexOf(over.id as string);

      const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
      onReorder(newOrder);
    }
  }

  return (
    <Box
      sx={{
        width: "100%",
        maxWidth: "100%",
      }}
    >
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, fontSize: "0.875rem" }}>
        Table Headers
      </Typography>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={columnOrder} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <SortableItem key={item.id} id={item.id} label={item.label} visible={item.visible} onToggleVisibility={onToggleVisibility} onEditLabel={onEditLabel} />
          ))}
        </SortableContext>
      </DndContext>

      {/* Add New Field Section */}
      <Box sx={{ mt: 1.5, pt: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
        {isAddingField ? (
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <TextField
              value={newFieldLabel}
              onChange={(e) => setNewFieldLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddField();
                if (e.key === "Escape") handleCancelAdd();
              }}
              placeholder="Enter field name"
              size="small"
              variant="outlined"
              sx={{ flex: 1 }}
              autoFocus
            />
            <IconButton onClick={handleAddField} size="small" color="primary">
              <Check fontSize="small" />
            </IconButton>
            <IconButton onClick={handleCancelAdd} size="small">
              <Close fontSize="small" />
            </IconButton>
          </Box>
        ) : (
          <Button
            startIcon={<Add />}
            onClick={() => setIsAddingField(true)}
            variant="outlined"
            size="small"
            fullWidth
            sx={{
              justifyContent: "flex-start",
              minWidth: 0, // Allow button to shrink
              maxWidth: "100%", // Prevent overflow
              overflow: "hidden", // Hide overflow text
              textOverflow: "ellipsis", // Add ellipsis for long text
              whiteSpace: "nowrap", // Prevent text wrapping
            }}
          >
            Add New Field
          </Button>
        )}
      </Box>
    </Box>
  );
}
