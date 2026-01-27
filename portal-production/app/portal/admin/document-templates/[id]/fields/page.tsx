"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Box,
  Paper,
  Typography,
  Button,
  Chip,
  Grid,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  CircularProgress,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormControlLabel,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Alert,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SaveIcon from "@mui/icons-material/Save";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import RestoreIcon from "@mui/icons-material/Restore";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "react-toastify";
import {
  useGetDocumentTemplate,
  useGetTemplateFieldDefinitions,
  useUpdateTemplateFieldDefinitions,
} from "../../hooks/useGetDocumentTemplates";
import { getDefaultFieldDefinitions } from "@/containers/DocumentTemplates/utils/templateFieldSync";

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Select" },
  { value: "autocomplete", label: "Autocomplete" },
  { value: "textarea", label: "Text Area" },
  { value: "customer", label: "Customer" },
  { value: "salesman", label: "Salesman" },
  { value: "supplier", label: "Supplier" },
];

const DATA_SOURCES = [
  { value: "", label: "None" },
  { value: "customers", label: "Customers" },
  { value: "salesmen", label: "Salesmen" },
  { value: "projects", label: "Projects" },
  { value: "deliveryOrders", label: "Delivery Orders" },
  { value: "currencies", label: "Currencies" },
  { value: "yesNo", label: "Yes/No" },
];

interface FieldDefinition {
  fieldName: string;
  displayLabel: string;
  fieldType: string;
  required: boolean;
  gridSize?: 6 | 12;
  dataSource?: string;
  placeholder?: string;
  defaultValue?: any;
  filterBy?: string;
  storagePath?: string;
}

interface TabDefinition {
  tabId: string;
  tabLabel: string;
  fields: FieldDefinition[];
}

// Sortable field item component
function SortableFieldItem({
  field,
  onEdit,
  onDelete,
}: {
  field: FieldDefinition;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.fieldName });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      sx={{
        bgcolor: isDragging ? "action.hover" : "transparent",
        borderRadius: 1,
        mb: 0.5,
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <IconButton {...attributes} {...listeners} sx={{ cursor: "grab", mr: 1 }}>
        <DragIndicatorIcon fontSize="small" />
      </IconButton>
      <ListItemText
        primary={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" fontWeight="medium">
              {field.displayLabel}
            </Typography>
            {field.required && (
              <Chip label="Required" size="small" color="error" variant="outlined" />
            )}
            <Chip label={field.fieldType} size="small" variant="outlined" />
          </Box>
        }
        secondary={field.fieldName}
      />
      <ListItemSecondaryAction>
        <IconButton size="small" onClick={onEdit}>
          <EditIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={onDelete} color="error">
          <DeleteIcon fontSize="small" />
        </IconButton>
      </ListItemSecondaryAction>
    </ListItem>
  );
}

export default function FieldEditorPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { template, loading: templateLoading } = useGetDocumentTemplate(id);
  const { fieldDefinitions: initialFields, source, loading: fieldsLoading, refetch } = useGetTemplateFieldDefinitions(id);
  const { updateFieldDefinitions, loading: updateLoading } = useUpdateTemplateFieldDefinitions();

  const [tabs, setTabs] = useState<TabDefinition[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [hasChanges, setHasChanges] = useState(false);

  // Field editor dialog state
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<FieldDefinition | null>(null);
  const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(null);

  // Tab editor dialog state
  const [tabDialogOpen, setTabDialogOpen] = useState(false);
  const [editingTab, setEditingTab] = useState<{ tabId: string; tabLabel: string } | null>(null);
  const [editingTabIndex, setEditingTabIndex] = useState<number | null>(null);

  // Restore defaults dialog
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Initialize tabs from loaded field definitions
  useEffect(() => {
    if (initialFields?.tabs) {
      setTabs(JSON.parse(JSON.stringify(initialFields.tabs)));
    }
  }, [initialFields]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const currentTab = tabs[activeTab];
      const oldIndex = currentTab.fields.findIndex((f) => f.fieldName === active.id);
      const newIndex = currentTab.fields.findIndex((f) => f.fieldName === over.id);

      const newTabs = [...tabs];
      newTabs[activeTab] = {
        ...currentTab,
        fields: arrayMove(currentTab.fields, oldIndex, newIndex),
      };
      setTabs(newTabs);
      setHasChanges(true);
    }
  };

  const handleAddField = () => {
    setEditingField({
      fieldName: "",
      displayLabel: "",
      fieldType: "text",
      required: false,
      gridSize: 6,
      dataSource: "",
    });
    setEditingFieldIndex(null);
    setFieldDialogOpen(true);
  };

  const handleEditField = (field: FieldDefinition, index: number) => {
    setEditingField({ ...field });
    setEditingFieldIndex(index);
    setFieldDialogOpen(true);
  };

  const handleSaveField = () => {
    if (!editingField || !editingField.fieldName || !editingField.displayLabel) {
      toast.error("Field name and label are required");
      return;
    }

    const newTabs = [...tabs];
    const currentTab = newTabs[activeTab];

    if (editingFieldIndex !== null) {
      // Update existing field
      currentTab.fields[editingFieldIndex] = editingField;
    } else {
      // Add new field
      currentTab.fields.push(editingField);
    }

    setTabs(newTabs);
    setHasChanges(true);
    setFieldDialogOpen(false);
    setEditingField(null);
    setEditingFieldIndex(null);
  };

  const handleDeleteField = (fieldIndex: number) => {
    const newTabs = [...tabs];
    newTabs[activeTab].fields.splice(fieldIndex, 1);
    setTabs(newTabs);
    setHasChanges(true);
  };

  const handleAddTab = () => {
    setEditingTab({ tabId: "", tabLabel: "" });
    setEditingTabIndex(null);
    setTabDialogOpen(true);
  };

  const handleEditTab = (tabIndex: number) => {
    const tab = tabs[tabIndex];
    setEditingTab({ tabId: tab.tabId, tabLabel: tab.tabLabel });
    setEditingTabIndex(tabIndex);
    setTabDialogOpen(true);
  };

  const handleSaveTab = () => {
    if (!editingTab || !editingTab.tabId || !editingTab.tabLabel) {
      toast.error("Tab ID and label are required");
      return;
    }

    const newTabs = [...tabs];

    if (editingTabIndex !== null) {
      // Update existing tab
      newTabs[editingTabIndex] = {
        ...newTabs[editingTabIndex],
        tabId: editingTab.tabId,
        tabLabel: editingTab.tabLabel,
      };
    } else {
      // Add new tab
      newTabs.push({
        tabId: editingTab.tabId,
        tabLabel: editingTab.tabLabel,
        fields: [],
      });
    }

    setTabs(newTabs);
    setHasChanges(true);
    setTabDialogOpen(false);
    setEditingTab(null);
    setEditingTabIndex(null);
  };

  const handleDeleteTab = (tabIndex: number) => {
    if (tabs.length <= 1) {
      toast.error("Cannot delete the last tab");
      return;
    }

    const newTabs = tabs.filter((_, index) => index !== tabIndex);
    setTabs(newTabs);
    setHasChanges(true);
    if (activeTab >= newTabs.length) {
      setActiveTab(newTabs.length - 1);
    }
  };

  const handleRestoreDefaults = () => {
    const variant = template?.templateVariant || template?.designName || template?.type || "TI";
    const defaults = getDefaultFieldDefinitions(variant);
    if (defaults?.tabs) {
      setTabs(JSON.parse(JSON.stringify(defaults.tabs)));
      setHasChanges(true);
      toast.success("Restored default field definitions");
    } else {
      toast.error("No default definitions found for this template variant");
    }
    setRestoreDialogOpen(false);
  };

  const handleSave = async () => {
    try {
      await updateFieldDefinitions(id, { tabs });
      toast.success("Field definitions saved successfully");
      setHasChanges(false);
      refetch();
    } catch (error) {
      toast.error("Failed to save field definitions");
    }
  };

  if (templateLoading || fieldsLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!template) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6">Template not found</Typography>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => router.push("/portal/admin/document-templates")}
          sx={{ mt: 2 }}
        >
          Back to Templates
        </Button>
      </Box>
    );
  }

  const currentTab = tabs[activeTab];

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 3, gap: 2 }}>
        <IconButton onClick={() => router.push(`/portal/admin/document-templates/${id}`)}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">Edit Field Definitions</Typography>
          <Typography variant="body2" color="text.secondary">
            {template.name} - {template.templateVariant || template.designName || template.type}
          </Typography>
        </Box>
        <Chip
          label={source === "database" ? "Custom" : "Default"}
          color={source === "database" ? "info" : "default"}
        />
        <Button
          variant="outlined"
          startIcon={<RestoreIcon />}
          onClick={() => setRestoreDialogOpen(true)}
        >
          Restore Defaults
        </Button>
        <Button
          variant="contained"
          startIcon={updateLoading ? <CircularProgress size={16} /> : <SaveIcon />}
          onClick={handleSave}
          disabled={updateLoading || !hasChanges}
        >
          Save Changes
        </Button>
      </Box>

      {hasChanges && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You have unsaved changes. Click &quot;Save Changes&quot; to persist your modifications.
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Tabs List */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
                <Tabs value={activeTab} onChange={handleTabChange} sx={{ flex: 1 }}>
                  {tabs.map((tab, index) => (
                    <Tab
                      key={tab.tabId}
                      label={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          {tab.tabLabel}
                          <Chip label={tab.fields.length} size="small" />
                        </Box>
                      }
                      onClick={(e) => {
                        if (e.detail === 2) {
                          // Double click to edit
                          handleEditTab(index);
                        }
                      }}
                    />
                  ))}
                </Tabs>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleAddTab}
                >
                  Add Tab
                </Button>
              </Box>

              {currentTab && (
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Tab: {currentTab.tabLabel} ({currentTab.tabId})
                  </Typography>
                  <Box>
                    <Button
                      size="small"
                      startIcon={<EditIcon />}
                      onClick={() => handleEditTab(activeTab)}
                    >
                      Edit Tab
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteIcon />}
                      onClick={() => handleDeleteTab(activeTab)}
                      disabled={tabs.length <= 1}
                    >
                      Delete Tab
                    </Button>
                  </Box>
                </Box>
              )}

              <Divider sx={{ my: 2 }} />

              {/* Fields List */}
              {currentTab && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                    <Typography variant="subtitle1">
                      Fields ({currentTab.fields.length})
                    </Typography>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={handleAddField}
                    >
                      Add Field
                    </Button>
                  </Box>

                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={currentTab.fields.map((f) => f.fieldName)}
                      strategy={verticalListSortingStrategy}
                    >
                      <List>
                        {currentTab.fields.map((field, index) => (
                          <SortableFieldItem
                            key={field.fieldName}
                            field={field}
                            onEdit={() => handleEditField(field, index)}
                            onDelete={() => handleDeleteField(index)}
                          />
                        ))}
                      </List>
                    </SortableContext>
                  </DndContext>

                  {currentTab.fields.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 4 }}>
                      No fields in this tab. Click &quot;Add Field&quot; to add one.
                    </Typography>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Field Editor Dialog */}
      <Dialog open={fieldDialogOpen} onClose={() => setFieldDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingFieldIndex !== null ? "Edit Field" : "Add Field"}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                label="Field Name (Technical)"
                value={editingField?.fieldName || ""}
                onChange={(e) => setEditingField((prev) => prev ? { ...prev, fieldName: e.target.value } : null)}
                fullWidth
                placeholder="e.g., documentInfo.documentNumber"
                helperText="Path to store the value (use dots for nested objects)"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Display Label"
                value={editingField?.displayLabel || ""}
                onChange={(e) => setEditingField((prev) => prev ? { ...prev, displayLabel: e.target.value } : null)}
                fullWidth
                placeholder="e.g., Document Number"
              />
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Field Type</InputLabel>
                <Select
                  value={editingField?.fieldType || "text"}
                  onChange={(e) => setEditingField((prev) => prev ? { ...prev, fieldType: e.target.value } : null)}
                  label="Field Type"
                >
                  {FIELD_TYPES.map((type) => (
                    <MenuItem key={type.value} value={type.value}>
                      {type.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Grid Size</InputLabel>
                <Select
                  value={editingField?.gridSize || 6}
                  onChange={(e) => setEditingField((prev) => prev ? { ...prev, gridSize: e.target.value as 6 | 12 } : null)}
                  label="Grid Size"
                >
                  <MenuItem value={6}>Half Width (6)</MenuItem>
                  <MenuItem value={12}>Full Width (12)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Data Source</InputLabel>
                <Select
                  value={editingField?.dataSource || ""}
                  onChange={(e) => setEditingField((prev) => prev ? { ...prev, dataSource: e.target.value } : null)}
                  label="Data Source"
                >
                  {DATA_SOURCES.map((source) => (
                    <MenuItem key={source.value} value={source.value}>
                      {source.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Placeholder"
                value={editingField?.placeholder || ""}
                onChange={(e) => setEditingField((prev) => prev ? { ...prev, placeholder: e.target.value } : null)}
                fullWidth
                placeholder="e.g., Enter document number..."
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Default Value"
                value={editingField?.defaultValue || ""}
                onChange={(e) => setEditingField((prev) => prev ? { ...prev, defaultValue: e.target.value } : null)}
                fullWidth
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={editingField?.required || false}
                    onChange={(e) => setEditingField((prev) => prev ? { ...prev, required: e.target.checked } : null)}
                  />
                }
                label="Required Field"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFieldDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveField} variant="contained">
            {editingFieldIndex !== null ? "Update" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Tab Editor Dialog */}
      <Dialog open={tabDialogOpen} onClose={() => setTabDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editingTabIndex !== null ? "Edit Tab" : "Add Tab"}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                label="Tab ID"
                value={editingTab?.tabId || ""}
                onChange={(e) => setEditingTab((prev) => prev ? { ...prev, tabId: e.target.value } : null)}
                fullWidth
                placeholder="e.g., general"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Tab Label"
                value={editingTab?.tabLabel || ""}
                onChange={(e) => setEditingTab((prev) => prev ? { ...prev, tabLabel: e.target.value } : null)}
                fullWidth
                placeholder="e.g., General"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTabDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveTab} variant="contained">
            {editingTabIndex !== null ? "Update" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Restore Defaults Dialog */}
      <Dialog open={restoreDialogOpen} onClose={() => setRestoreDialogOpen(false)}>
        <DialogTitle>Restore Default Field Definitions</DialogTitle>
        <DialogContent>
          <Typography>
            This will replace all current field definitions with the default definitions for this template variant.
            Any custom changes will be lost (until you save, the changes are only in memory).
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleRestoreDefaults} variant="contained" color="warning">
            Restore Defaults
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
