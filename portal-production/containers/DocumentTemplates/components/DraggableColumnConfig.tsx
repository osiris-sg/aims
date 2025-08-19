import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Box,
  Typography,
  IconButton,
  Paper,
  Switch,
  FormControlLabel,
} from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';

interface ColumnItem {
  id: string;
  label: string;
  visible: boolean;
}

interface SortableItemProps {
  id: string;
  label: string;
  visible: boolean;
  onToggleVisibility: (id: string) => void;
}

function SortableItem({ id, label, visible, onToggleVisibility }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Paper
      ref={setNodeRef}
      style={style}
      sx={{
        p: 2,
        mb: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        border: isDragging ? '2px dashed #1976d2' : '1px solid #e0e0e0',
      }}
    >
      <IconButton
        {...attributes}
        {...listeners}
        size="small"
        sx={{ cursor: 'grab' }}
      >
        <DragIndicatorIcon />
      </IconButton>
      
      <Typography variant="body2" sx={{ flex: 1 }}>
        {label}
      </Typography>
      
      <IconButton
        size="small"
        onClick={() => onToggleVisibility(id)}
        sx={{ color: visible ? 'primary.main' : 'grey.400' }}
      >
        {visible ? <VisibilityIcon /> : <VisibilityOffIcon />}
      </IconButton>
    </Paper>
  );
}

interface DraggableColumnConfigProps {
  columns: ColumnItem[];
  onReorder: (newOrder: string[]) => void;
  onToggleVisibility: (columnId: string) => void;
}

export default function DraggableColumnConfig({
  columns,
  onReorder,
  onToggleVisibility,
}: DraggableColumnConfigProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = columns.findIndex((item) => item.id === active.id);
      const newIndex = columns.findIndex((item) => item.id === over.id);
      
      const newOrder = arrayMove(columns, oldIndex, newIndex);
      onReorder(newOrder.map(item => item.id));
    }
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 'bold' }}>
        Table Column Order
      </Typography>
      <Typography variant="caption" sx={{ mb: 2, display: 'block', color: 'text.secondary' }}>
        Drag to reorder columns, click eye to show/hide
      </Typography>
      
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={columns.map(col => col.id)} strategy={verticalListSortingStrategy}>
          {columns.map((column) => (
            <SortableItem
              key={column.id}
              id={column.id}
              label={column.label}
              visible={column.visible}
              onToggleVisibility={onToggleVisibility}
            />
          ))}
        </SortableContext>
      </DndContext>
    </Box>
  );
}
