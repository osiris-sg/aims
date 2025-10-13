"use client";

import React, { useState, useEffect } from "react";
import {
  Box,
  Tabs,
  Tab,
  Typography,
  Paper,
  Button,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Switch,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Alert,
  Grid,
  Card,
  CardContent,
  CardActions,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  FormControlLabel,
  Checkbox,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Autocomplete,
} from "@mui/material";
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  DragIndicator as DragIcon,
  Settings as SettingsIcon,
  ViewModule as ModuleIcon,
  TextFields as FieldsIcon,
  Palette as ThemeIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  Dashboard,
  Inventory,
  AnalyticsRounded,
  PeopleRounded,
  Description,
  AssignmentRounded,
  AccountTree,
  AdminPanelSettings,
  Business,
  Receipt,
  Assessment,
  TrendingUp,
  BarChart,
  Timeline,
  Store,
  ShoppingCart,
  Category,
  Folder,
  FileCopy,
  AttachFile,
  Cloud,
  CloudUpload,
  CloudDownload,
  Email,
  Phone,
  ContactPhone,
  LocationOn,
  Map,
  Place,
  Public,
} from "@mui/icons-material";
import { useAuth } from "@clerk/nextjs";
import { useConfiguration } from "../../context/ConfigurationContext";
import { useOrganization } from "../../hooks/useOrganization";
import { toast } from "react-toastify";
// Import for drag and drop functionality (if needed in future)
// import { DragDropContext, Droppable, Draggable } from "@dnd-kit/core";
// import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

// Icon mapping for Material-UI icons
const iconMap: Record<string, React.ComponentType> = {
  Dashboard,
  Inventory,
  AnalyticsRounded,
  PeopleRounded,
  Description,
  AssignmentRounded,
  AccountTree,
  AdminPanelSettings,
  Business,
  Receipt,
  Assessment,
  TrendingUp,
  BarChart,
  Timeline,
  Store,
  ShoppingCart,
  Category,
  Folder,
  FileCopy,
  AttachFile,
  Cloud,
  CloudUpload,
  CloudDownload,
  Email,
  Phone,
  ContactPhone,
  LocationOn,
  Map,
  Place,
  Public,
};

// Get list of available icon names for the autocomplete
const availableIcons = Object.keys(iconMap).sort();

// Component to render an icon
const IconRenderer: React.FC<{ iconName?: string }> = ({ iconName }) => {
  console.log('Rendering icon:', iconName, 'Available in map:', iconName ? iconMap[iconName] !== undefined : false);
  if (!iconName) return null;
  const IconComponent = iconMap[iconName];
  if (!IconComponent) {
    console.warn(`Icon "${iconName}" not found in iconMap. Available icons:`, Object.keys(iconMap));
    return null;
  }
  return <IconComponent sx={{ fontSize: 20 }} />;
};

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export default function ConfigurationAdminPage() {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { modules, uiConfig, customFields, refreshConfiguration } = useConfiguration();
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(false);

  // Module management state
  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<any>(null);
  const [moduleForm, setModuleForm] = useState({
    moduleCode: "",
    displayName: "",
    icon: "",
    enabled: true,
    sortOrder: 0,
    config: {},
  });

  // Custom field management state
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<any>(null);
  const [selectedEntityType, setSelectedEntityType] = useState("Asset");
  const [fieldForm, setFieldForm] = useState({
    entityType: "Asset",
    fieldName: "",
    displayLabel: "",
    fieldType: "text",
    required: false,
    showInList: false,
    showInForm: true,
    groupName: "Additional Information",
    options: [],
    validation: {},
  });

  // UI Config state
  const [uiConfigForm, setUIConfigForm] = useState<any>({
    theme: {
      primaryColor: "#1976d2",
      secondaryColor: "#dc004e",
      mode: "light",
    },
    terminology: {},
    features: {},
    dateFormat: "MM/dd/yyyy",
    timeFormat: "12h",
    currency: "USD",
    language: "en",
  });

  useEffect(() => {
    if (uiConfig) {
      setUIConfigForm(uiConfig);
    }
  }, [uiConfig]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  // ===== MODULE MANAGEMENT =====

  const handleModuleToggle = async (moduleCode: string, enabled: boolean) => {
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/configuration/modules/${moduleCode}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "x-organization-id": organization?.id || "",
          },
          body: JSON.stringify({ enabled }),
        }
      );

      if (response.ok) {
        toast.success(`Module ${enabled ? "enabled" : "disabled"} successfully`);
        refreshConfiguration();
      } else {
        toast.error("Failed to update module");
      }
    } catch (error) {
      toast.error("Error updating module");
    }
  };

  const handleSaveModule = async () => {
    try {
      const token = await getToken();
      const url = editingModule
        ? `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/configuration/modules/${editingModule.moduleCode}`
        : `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/configuration/modules`;

      const response = await fetch(url, {
        method: editingModule ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-organization-id": organization?.id || "",
        },
        body: JSON.stringify(moduleForm),
      });

      if (response.ok) {
        toast.success(`Module ${editingModule ? "updated" : "created"} successfully`);
        setModuleDialogOpen(false);
        setEditingModule(null);
        refreshConfiguration();
      } else {
        toast.error(`Failed to ${editingModule ? "update" : "create"} module`);
      }
    } catch (error) {
      toast.error("Error saving module");
    }
  };

  const handleInitializeModules = async () => {
    try {
      setLoading(true);
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/configuration/modules/initialize`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "x-organization-id": organization?.id || "",
          },
        }
      );

      if (response.ok) {
        toast.success("Default modules initialized successfully");
        refreshConfiguration();
      } else {
        toast.error("Failed to initialize modules");
      }
    } catch (error) {
      toast.error("Error initializing modules");
    } finally {
      setLoading(false);
    }
  };

  // ===== CUSTOM FIELDS MANAGEMENT =====

  const handleSaveCustomField = async () => {
    try {
      const token = await getToken();
      const url = editingField
        ? `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/configuration/custom-fields/${editingField.id}`
        : `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/configuration/custom-fields`;

      const response = await fetch(url, {
        method: editingField ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-organization-id": organization?.id || "",
        },
        body: JSON.stringify(fieldForm),
      });

      if (response.ok) {
        toast.success(`Custom field ${editingField ? "updated" : "created"} successfully`);
        setFieldDialogOpen(false);
        setEditingField(null);
        refreshConfiguration();
      } else {
        toast.error(`Failed to ${editingField ? "update" : "create"} custom field`);
      }
    } catch (error) {
      toast.error("Error saving custom field");
    }
  };

  const handleDeleteCustomField = async (fieldId: string) => {
    if (!window.confirm("Are you sure you want to delete this custom field?")) return;

    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/configuration/custom-fields/${fieldId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            "x-organization-id": organization?.id || "",
          },
        }
      );

      if (response.ok) {
        toast.success("Custom field deleted successfully");
        refreshConfiguration();
      } else {
        toast.error("Failed to delete custom field");
      }
    } catch (error) {
      toast.error("Error deleting custom field");
    }
  };

  // ===== UI CONFIGURATION =====

  const handleSaveUIConfig = async () => {
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/configuration/ui`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "x-organization-id": organization?.id || "",
          },
          body: JSON.stringify(uiConfigForm),
        }
      );

      if (response.ok) {
        toast.success("UI configuration updated successfully");
        refreshConfiguration();
      } else {
        toast.error("Failed to update UI configuration");
      }
    } catch (error) {
      toast.error("Error saving UI configuration");
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
        Organization Configuration
      </Typography>

      <Paper sx={{ width: "100%" }}>
        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Tabs value={tabValue} onChange={handleTabChange}>
            <Tab icon={<ModuleIcon />} label="Modules" />
            <Tab icon={<FieldsIcon />} label="Custom Fields" />
            <Tab icon={<ThemeIcon />} label="UI Configuration" />
            <Tab icon={<SettingsIcon />} label="Advanced" />
          </Tabs>
        </Box>

        {/* MODULES TAB */}
        <TabPanel value={tabValue} index={0}>
          <Box sx={{ mb: 2, display: "flex", justifyContent: "space-between" }}>
            <Typography variant="h6">Module Management</Typography>
            <Box>
              {modules.length === 0 && (
                <Button
                  variant="contained"
                  onClick={handleInitializeModules}
                  disabled={loading}
                  sx={{ mr: 2 }}
                >
                  Initialize Default Modules
                </Button>
              )}
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={refreshConfiguration}
              >
                Refresh
              </Button>
            </Box>
          </Box>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Module Code</TableCell>
                  <TableCell>Display Name</TableCell>
                  <TableCell>Icon</TableCell>
                  <TableCell>Sort Order</TableCell>
                  <TableCell>Route</TableCell>
                  <TableCell>Enabled</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {modules.map((module) => (
                  <TableRow key={module.id}>
                    <TableCell>{module.moduleCode}</TableCell>
                    <TableCell>{module.displayName || "-"}</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <IconRenderer iconName={module.icon} />
                        <Typography variant="caption" color="text.secondary">
                          {module.icon || "-"}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>{module.sortOrder || 0}</TableCell>
                    <TableCell>{module.config?.route || "-"}</TableCell>
                    <TableCell>
                      <Switch
                        checked={module.enabled}
                        onChange={(e) => handleModuleToggle(module.moduleCode, e.target.checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditingModule(module);
                          setModuleForm(module);
                          setModuleDialogOpen(true);
                        }}
                      >
                        <EditIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        {/* CUSTOM FIELDS TAB */}
        <TabPanel value={tabValue} index={1}>
          <Box sx={{ mb: 2, display: "flex", justifyContent: "space-between" }}>
            <FormControl sx={{ minWidth: 200 }}>
              <InputLabel>Entity Type</InputLabel>
              <Select
                value={selectedEntityType}
                onChange={(e) => setSelectedEntityType(e.target.value)}
                label="Entity Type"
              >
                <MenuItem value="Asset">Asset</MenuItem>
                <MenuItem value="Customer">Customer</MenuItem>
                <MenuItem value="Document">Document</MenuItem>
                <MenuItem value="Inventory">Inventory</MenuItem>
                <MenuItem value="Project">Project</MenuItem>
              </Select>
            </FormControl>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditingField(null);
                setFieldForm({
                  entityType: selectedEntityType,
                  fieldName: "",
                  displayLabel: "",
                  fieldType: "text",
                  required: false,
                  showInList: false,
                  showInForm: true,
                  groupName: "Additional Information",
                  options: [],
                  validation: {},
                });
                setFieldDialogOpen(true);
              }}
            >
              Add Custom Field
            </Button>
          </Box>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Field Name</TableCell>
                  <TableCell>Display Label</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Required</TableCell>
                  <TableCell>Group</TableCell>
                  <TableCell>Show in List</TableCell>
                  <TableCell>Show in Form</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(customFields[selectedEntityType] || []).map((field) => (
                  <TableRow key={field.id}>
                    <TableCell>{field.fieldName}</TableCell>
                    <TableCell>{field.displayLabel}</TableCell>
                    <TableCell>
                      <Chip label={field.fieldType} size="small" />
                    </TableCell>
                    <TableCell>{field.required ? "Yes" : "No"}</TableCell>
                    <TableCell>{field.groupName || "-"}</TableCell>
                    <TableCell>{field.showInList ? "Yes" : "No"}</TableCell>
                    <TableCell>{field.showInForm ? "Yes" : "No"}</TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditingField(field);
                          setFieldForm(field);
                          setFieldDialogOpen(true);
                        }}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteCustomField(field.id)}
                        color="error"
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        {/* UI CONFIGURATION TAB */}
        <TabPanel value={tabValue} index={2}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Theme Settings
                  </Typography>
                  <TextField
                    fullWidth
                    label="Primary Color"
                    type="color"
                    value={uiConfigForm.theme?.primaryColor || "#1976d2"}
                    onChange={(e) =>
                      setUIConfigForm({
                        ...uiConfigForm,
                        theme: { ...uiConfigForm.theme, primaryColor: e.target.value },
                      })
                    }
                    sx={{ mb: 2 }}
                  />
                  <TextField
                    fullWidth
                    label="Secondary Color"
                    type="color"
                    value={uiConfigForm.theme?.secondaryColor || "#dc004e"}
                    onChange={(e) =>
                      setUIConfigForm({
                        ...uiConfigForm,
                        theme: { ...uiConfigForm.theme, secondaryColor: e.target.value },
                      })
                    }
                    sx={{ mb: 2 }}
                  />
                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Theme Mode</InputLabel>
                    <Select
                      value={uiConfigForm.theme?.mode || "light"}
                      onChange={(e) =>
                        setUIConfigForm({
                          ...uiConfigForm,
                          theme: { ...uiConfigForm.theme, mode: e.target.value },
                        })
                      }
                      label="Theme Mode"
                    >
                      <MenuItem value="light">Light</MenuItem>
                      <MenuItem value="dark">Dark</MenuItem>
                    </Select>
                  </FormControl>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Localization
                  </Typography>
                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Date Format</InputLabel>
                    <Select
                      value={uiConfigForm.dateFormat || "MM/dd/yyyy"}
                      onChange={(e) =>
                        setUIConfigForm({ ...uiConfigForm, dateFormat: e.target.value })
                      }
                      label="Date Format"
                    >
                      <MenuItem value="MM/dd/yyyy">MM/dd/yyyy</MenuItem>
                      <MenuItem value="dd/MM/yyyy">dd/MM/yyyy</MenuItem>
                      <MenuItem value="yyyy-MM-dd">yyyy-MM-dd</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Time Format</InputLabel>
                    <Select
                      value={uiConfigForm.timeFormat || "12h"}
                      onChange={(e) =>
                        setUIConfigForm({ ...uiConfigForm, timeFormat: e.target.value })
                      }
                      label="Time Format"
                    >
                      <MenuItem value="12h">12 Hour</MenuItem>
                      <MenuItem value="24h">24 Hour</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    fullWidth
                    label="Currency"
                    value={uiConfigForm.currency || "USD"}
                    onChange={(e) =>
                      setUIConfigForm({ ...uiConfigForm, currency: e.target.value })
                    }
                    sx={{ mb: 2 }}
                  />
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Custom Terminology
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Customize how entities are labeled in your organization
                  </Typography>
                  <Grid container spacing={2}>
                    {["asset", "inventory", "customer", "document", "project", "invoice"].map(
                      (term) => (
                        <Grid item xs={12} sm={6} md={4} key={term}>
                          <TextField
                            fullWidth
                            label={term.charAt(0).toUpperCase() + term.slice(1)}
                            value={uiConfigForm.terminology?.[term] || ""}
                            onChange={(e) =>
                              setUIConfigForm({
                                ...uiConfigForm,
                                terminology: {
                                  ...uiConfigForm.terminology,
                                  [term]: e.target.value,
                                },
                              })
                            }
                            placeholder={term.charAt(0).toUpperCase() + term.slice(1)}
                          />
                        </Grid>
                      )
                    )}
                  </Grid>
                </CardContent>
                <CardActions>
                  <Button
                    variant="contained"
                    startIcon={<SaveIcon />}
                    onClick={handleSaveUIConfig}
                  >
                    Save UI Configuration
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          </Grid>
        </TabPanel>

        {/* ADVANCED TAB */}
        <TabPanel value={tabValue} index={3}>
          <Alert severity="info" sx={{ mb: 3 }}>
            Advanced configuration options for power users and system administrators.
          </Alert>

          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography>Feature Flags</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <List>
                {Object.entries(uiConfigForm.features || {}).map(([key, value]) => (
                  <ListItem key={key}>
                    <ListItemText primary={key} />
                    <ListItemSecondaryAction>
                      <Switch
                        checked={value as boolean}
                        onChange={(e) =>
                          setUIConfigForm({
                            ...uiConfigForm,
                            features: {
                              ...uiConfigForm.features,
                              [key]: e.target.checked,
                            },
                          })
                        }
                      />
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
              <Button onClick={handleSaveUIConfig}>Save Feature Flags</Button>
            </AccordionDetails>
          </Accordion>

          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography>Export/Import Configuration</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box>
                <Button variant="outlined" sx={{ mr: 2 }}>
                  Export Configuration
                </Button>
                <Button variant="outlined">Import Configuration</Button>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  Export your organization's complete configuration for backup or migration
                  purposes.
                </Typography>
              </Box>
            </AccordionDetails>
          </Accordion>
        </TabPanel>
      </Paper>

      {/* MODULE DIALOG */}
      <Dialog open={moduleDialogOpen} onClose={() => setModuleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingModule ? "Edit Module" : "Create Module"}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Module Code"
            value={moduleForm.moduleCode}
            onChange={(e) => setModuleForm({ ...moduleForm, moduleCode: e.target.value })}
            disabled={!!editingModule}
            sx={{ mb: 2, mt: 1 }}
          />
          <TextField
            fullWidth
            label="Display Name"
            value={moduleForm.displayName}
            onChange={(e) => setModuleForm({ ...moduleForm, displayName: e.target.value })}
            sx={{ mb: 2 }}
          />
          <Autocomplete
            fullWidth
            options={availableIcons}
            value={moduleForm.icon || null}
            onChange={(event, newValue) => setModuleForm({ ...moduleForm, icon: newValue || '' })}
            renderInput={(params) => <TextField {...params} label="Icon" />}
            renderOption={(props, option) => (
              <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {renderIcon(option)}
                <Typography>{option}</Typography>
              </Box>
            )}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            type="number"
            label="Sort Order"
            value={moduleForm.sortOrder}
            onChange={(e) => setModuleForm({ ...moduleForm, sortOrder: parseInt(e.target.value) })}
            sx={{ mb: 2 }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={moduleForm.enabled}
                onChange={(e) => setModuleForm({ ...moduleForm, enabled: e.target.checked })}
              />
            }
            label="Enabled"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModuleDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveModule} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* CUSTOM FIELD DIALOG */}
      <Dialog open={fieldDialogOpen} onClose={() => setFieldDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingField ? "Edit Custom Field" : "Create Custom Field"}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Field Name (Technical)"
                value={fieldForm.fieldName}
                onChange={(e) => setFieldForm({ ...fieldForm, fieldName: e.target.value })}
                disabled={!!editingField}
                helperText="Use snake_case, no spaces"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Display Label"
                value={fieldForm.displayLabel}
                onChange={(e) => setFieldForm({ ...fieldForm, displayLabel: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Entity Type</InputLabel>
                <Select
                  value={fieldForm.entityType}
                  onChange={(e) => setFieldForm({ ...fieldForm, entityType: e.target.value })}
                  label="Entity Type"
                  disabled={!!editingField}
                >
                  <MenuItem value="Asset">Asset</MenuItem>
                  <MenuItem value="Customer">Customer</MenuItem>
                  <MenuItem value="Document">Document</MenuItem>
                  <MenuItem value="Inventory">Inventory</MenuItem>
                  <MenuItem value="Project">Project</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Field Type</InputLabel>
                <Select
                  value={fieldForm.fieldType}
                  onChange={(e) => setFieldForm({ ...fieldForm, fieldType: e.target.value })}
                  label="Field Type"
                >
                  <MenuItem value="text">Text</MenuItem>
                  <MenuItem value="number">Number</MenuItem>
                  <MenuItem value="date">Date</MenuItem>
                  <MenuItem value="boolean">Boolean</MenuItem>
                  <MenuItem value="select">Select</MenuItem>
                  <MenuItem value="multiselect">Multi-Select</MenuItem>
                  <MenuItem value="email">Email</MenuItem>
                  <MenuItem value="phone">Phone</MenuItem>
                  <MenuItem value="url">URL</MenuItem>
                  <MenuItem value="richtext">Rich Text</MenuItem>
                  <MenuItem value="file">File</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Group Name"
                value={fieldForm.groupName}
                onChange={(e) => setFieldForm({ ...fieldForm, groupName: e.target.value })}
                helperText="Fields with same group name will be displayed together"
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={fieldForm.required}
                    onChange={(e) => setFieldForm({ ...fieldForm, required: e.target.checked })}
                  />
                }
                label="Required"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={fieldForm.showInList}
                    onChange={(e) => setFieldForm({ ...fieldForm, showInList: e.target.checked })}
                  />
                }
                label="Show in List/Table"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={fieldForm.showInForm}
                    onChange={(e) => setFieldForm({ ...fieldForm, showInForm: e.target.checked })}
                  />
                }
                label="Show in Form"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFieldDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveCustomField} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}