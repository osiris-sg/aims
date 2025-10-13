"use client";

import React, { useState, useEffect } from "react";
import {
  Box,
  Grid,
  Card,
  CardContent,
  CardActions,
  Typography,
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
  Tabs,
  Tab,
  Paper,
  Divider,
  CircularProgress,
  Autocomplete,
  FormControlLabel,
  Checkbox,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Add as AddIcon,
  ViewModule as ModuleIcon,
  Settings as SettingsIcon,
  TextFields as FieldsIcon,
  Palette as ThemeIcon,
  ArrowBack as ArrowBackIcon,
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
  DescriptionOutlined,
} from "@mui/icons-material";
import { useRouter, useParams } from "next/navigation";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";

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
  if (!iconName) return null;
  const IconComponent = iconMap[iconName];
  if (!IconComponent) {
    return null;
  }
  return <IconComponent sx={{ fontSize: 20 }} />;
};

interface OrganizationModule {
  id: string;
  organizationId: string;
  moduleCode: string;
  enabled: boolean;
  displayName?: string;
  icon?: string;
  sortOrder?: number;
  config?: any;
  createdAt: string;
  updatedAt: string;
}

interface Organization {
  id: string;
  name: string;
  createdAt: string;
  _count: {
    assets: number;
    inventories: number;
    customers: number;
    documents: number;
    projects: number;
    userOrganizations: number;
  };
  modules?: OrganizationModule[];
}

const DEFAULT_MODULES = [
  { code: "DASHBOARD", name: "Dashboard", icon: "Dashboard", route: "/portal" },
  { code: "ASSETS", name: "Assets", icon: "AnalyticsRounded", route: "/portal/assets" },
  { code: "INVENTORY", name: "Inventory", icon: "Inventory", route: "/portal/inventory" },
  { code: "CUSTOMERS", name: "Customers", icon: "PeopleRounded", route: "/portal/customers" },
  { code: "DOCUMENTS", name: "Documents", icon: "Description", route: "/portal/documents", subMenus: ['list', 'templates', 'extraction'] },
  { code: "INVOICES", name: "Invoices", icon: "AssignmentRounded", route: "/portal/invoices" },
  { code: "PROJECTS", name: "Projects", icon: "AccountTree", route: "/portal/projects" },
  { code: "USER_MANAGEMENT", name: "User Management", icon: "PeopleRounded", route: "/portal/user-management" },
  { code: "AUDIT", name: "Audit", icon: "AnalyticsRounded", route: "/portal/audit" },
  { code: "ANALYTICS", name: "Analytics", icon: "AnalyticsRounded", route: "/portal/analytics" },
  { code: "INTEGRATIONS", name: "Integrations", icon: "Business", route: "/portal/integrations" },
  { code: "ADMIN", name: "Admin Panel", icon: "AdminPanelSettings", route: "/portal/admin" },
];

const DEFAULT_DOCUMENT_TYPES = [
  { code: "QO1", name: "Quotation", description: "Quotation template" },
  { code: "DO", name: "Delivery Order", description: "Document for delivery tracking" },
  { code: "RDO", name: "Return Delivery Order", description: "Document for return deliveries" },
  { code: "TI", name: "Tax Invoice", description: "Invoice with tax details" },
  { code: "MSR", name: "Maintenance Service Report", description: "Service and maintenance reports" },
];

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

export default function OrganizationDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { getToken } = useAuth();
  const organizationId = params.id as string;

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [tabValue, setTabValue] = useState(0);
  const [moduleData, setModuleData] = useState<{ [key: string]: OrganizationModule }>({});
  const [customFields, setCustomFields] = useState<any>({});
  const [uiConfig, setUIConfig] = useState<any>(null);
  const [enabledDocumentTypes, setEnabledDocumentTypes] = useState<string[]>([]);

  // Module management state
  const [addModuleDialogOpen, setAddModuleDialogOpen] = useState(false);
  const [editModuleDialogOpen, setEditModuleDialogOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<OrganizationModule | null>(null);
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
    if (organizationId) {
      fetchOrganizationDetails();
      fetchConfigurationData();
    }
  }, [organizationId]);

  useEffect(() => {
    if (uiConfig) {
      setUIConfigForm(uiConfig);
    }
  }, [uiConfig]);

  const fetchOrganizationDetails = async () => {
    try {
      setLoading(true);
      const token = await getToken();

      if (!token) {
        console.error("No authentication token available");
        return;
      }

      // Fetch organization details with modules
      const response = await request(
        { path: `/admin/organizations/${organizationId}`, method: "GET" },
        {},
        token
      );

      if (response.success) {
        setOrganization(response.data);
        // Initialize module data
        const moduleDataMap: { [key: string]: OrganizationModule } = {};
        if (response.data.modules) {
          response.data.modules.forEach((module: OrganizationModule) => {
            moduleDataMap[module.id] = { ...module };
          });
        }
        setModuleData(moduleDataMap);

        // Initialize document types
        if (response.data.customDocumentTypes && Array.isArray(response.data.customDocumentTypes) && response.data.customDocumentTypes.length > 0) {
          // Use existing configuration
          setEnabledDocumentTypes(response.data.customDocumentTypes);
        } else {
          // If not set (null or empty), enable all document types by default for backward compatibility
          const allTypes = DEFAULT_DOCUMENT_TYPES.map(dt => dt.code);
          setEnabledDocumentTypes(allTypes);

          // Auto-save all document types for this organization for backward compatibility
          // This ensures existing organizations get all types enabled automatically
          try {
            const token = await getToken();
            await request(
              { path: `/admin/organizations/${organizationId}/document-types`, method: "PUT" },
              { customDocumentTypes: allTypes },
              token
            );
          } catch (error) {
            console.error("Error auto-initializing document types:", error);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching organization details:", error);
      toast.error("Failed to fetch organization details");
    } finally {
      setLoading(false);
    }
  };

  const fetchConfigurationData = async () => {
    try {
      const token = await getToken();

      // Fetch custom fields
      const customFieldsResponse = await request(
        { path: `/configuration/custom-fields`, method: "GET" },
        {},
        token,
        { "x-organization-id": organizationId }
      );

      if (customFieldsResponse.success) {
        const data = customFieldsResponse.data || customFieldsResponse;
        console.log("Custom fields response:", data);

        // Handle different response structures
        let fieldsData = {};
        if (data.customFields) {
          fieldsData = data.customFields;
        } else if (Array.isArray(data)) {
          // If data is an array, group by entityType
          fieldsData = data.reduce((acc: any, field: any) => {
            if (!acc[field.entityType]) {
              acc[field.entityType] = [];
            }
            acc[field.entityType].push(field);
            return acc;
          }, {});
        } else {
          fieldsData = data;
        }

        console.log("Setting custom fields:", fieldsData);
        setCustomFields(fieldsData);
      }

      // Fetch UI config
      const uiConfigResponse = await request(
        { path: `/configuration/ui`, method: "GET" },
        {},
        token,
        { "x-organization-id": organizationId }
      );

      if (uiConfigResponse.success) {
        const data = uiConfigResponse.data || uiConfigResponse;
        setUIConfig(data.uiConfig || data);
      }
    } catch (error) {
      console.error("Error fetching configuration:", error);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  // ===== MODULE MANAGEMENT =====

  const handleModuleToggle = async (module: OrganizationModule) => {
    try {
      const token = await getToken();

      const response = await request(
        {
          path: `/admin/organizations/${organizationId}/modules/${module.id}`,
          method: "PUT",
        },
        { enabled: !module.enabled },
        token
      );

      if (response.success) {
        toast.success(`Module ${!module.enabled ? "enabled" : "disabled"} successfully`);
        fetchOrganizationDetails();
      }
    } catch (error) {
      toast.error("Failed to update module");
    }
  };

  const handleEditClick = (module: OrganizationModule) => {
    setEditingModule(module);
    setModuleForm({
      moduleCode: module.moduleCode,
      displayName: module.displayName || "",
      icon: module.icon || "",
      enabled: module.enabled,
      sortOrder: module.sortOrder || 0,
      config: module.config || {},
    });
    setEditModuleDialogOpen(true);
  };

  const handleSaveModule = async () => {
    try {
      const token = await getToken();

      if (editingModule) {
        // Update existing module
        const response = await request(
          {
            path: `/admin/organizations/${organizationId}/modules/${editingModule.id}`,
            method: "PUT",
          },
          {
            displayName: moduleForm.displayName,
            icon: moduleForm.icon,
            sortOrder: moduleForm.sortOrder,
            enabled: moduleForm.enabled,
            config: moduleForm.config,
          },
          token
        );

        if (response.success) {
          toast.success("Module updated successfully");
          setEditModuleDialogOpen(false);
          setEditingModule(null);
          fetchOrganizationDetails();
        }
      } else {
        // Add new module
        const defaultConfig = DEFAULT_MODULES.find(m => m.code === moduleForm.moduleCode);

        const response = await request(
          {
            path: `/admin/organizations/${organizationId}/modules`,
            method: "POST",
          },
          {
            ...moduleForm,
            config: defaultConfig ? {
              route: defaultConfig.route,
              subMenus: defaultConfig.subMenus,
              ...moduleForm.config,
            } : moduleForm.config,
          },
          token
        );

        if (response.success) {
          toast.success("Module added successfully");
          setAddModuleDialogOpen(false);
          fetchOrganizationDetails();
        }
      }
    } catch (error) {
      toast.error(editingModule ? "Failed to update module" : "Failed to add module");
    }
  };

  const handleInitializeModules = async () => {
    try {
      const token = await getToken();

      const response = await request(
        {
          path: `/admin/organizations/${organizationId}/modules/initialize`,
          method: "POST",
        },
        {},
        token
      );

      if (response.success) {
        toast.success("Default modules initialized successfully");
        fetchOrganizationDetails();
      }
    } catch (error) {
      toast.error("Failed to initialize modules");
    }
  };

  // ===== CUSTOM FIELDS MANAGEMENT =====

  const handleSaveCustomField = async () => {
    try {
      const token = await getToken();
      const url = editingField
        ? `/configuration/custom-fields/${editingField.id}`
        : `/configuration/custom-fields`;

      const response = await request(
        { path: url, method: editingField ? "PUT" : "POST" },
        fieldForm,
        token,
        { "x-organization-id": organizationId }
      );

      if (response.success) {
        toast.success(`Custom field ${editingField ? "updated" : "created"} successfully`);
        setFieldDialogOpen(false);
        setEditingField(null);
        fetchConfigurationData();
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
      const response = await request(
        { path: `/configuration/custom-fields/${fieldId}`, method: "DELETE" },
        {},
        token,
        { "x-organization-id": organizationId }
      );

      if (response.success) {
        toast.success("Custom field deleted successfully");
        fetchConfigurationData();
      } else {
        toast.error("Failed to delete custom field");
      }
    } catch (error) {
      toast.error("Error deleting custom field");
    }
  };

  // ===== DOCUMENT TYPES MANAGEMENT =====

  const handleDocumentTypeToggle = (documentTypeCode: string) => {
    setEnabledDocumentTypes(prev => {
      if (prev.includes(documentTypeCode)) {
        return prev.filter(code => code !== documentTypeCode);
      } else {
        return [...prev, documentTypeCode];
      }
    });
  };

  const handleSaveDocumentTypes = async () => {
    try {
      const token = await getToken();
      const response = await request(
        { path: `/admin/organizations/${organizationId}/document-types`, method: "PUT" },
        { customDocumentTypes: enabledDocumentTypes },
        token
      );

      if (response.success) {
        toast.success("Document types updated successfully");
        fetchOrganizationDetails();
      } else {
        toast.error("Failed to update document types");
      }
    } catch (error) {
      toast.error("Error saving document types");
    }
  };

  // ===== UI CONFIGURATION =====

  const handleSaveUIConfig = async () => {
    try {
      const token = await getToken();
      const response = await request(
        { path: `/configuration/ui`, method: "PUT" },
        uiConfigForm,
        token,
        { "x-organization-id": organizationId }
      );

      if (response.success) {
        toast.success("UI configuration updated successfully");
        fetchConfigurationData();
      } else {
        toast.error("Failed to update UI configuration");
      }
    } catch (error) {
      toast.error("Error saving UI configuration");
    }
  };

  const resetModuleForm = () => {
    setModuleForm({
      moduleCode: "",
      displayName: "",
      icon: "",
      enabled: true,
      sortOrder: 0,
      config: {},
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!organization) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Organization not found</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton onClick={() => router.push("/portal/admin")}>
            <ArrowBackIcon />
          </IconButton>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: "bold" }}>
              {organization.name}
            </Typography>
            <Typography variant="subtitle2" color="text.secondary">
              Organization ID: {organization.id}
            </Typography>
          </Box>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => {
            fetchOrganizationDetails();
            fetchConfigurationData();
          }}
        >
          Refresh
        </Button>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={4} md={2}>
          <Card>
            <CardContent>
              <Typography variant="h4" color="primary">
                {organization._count.assets}
              </Typography>
              <Typography variant="caption">Assets</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <Card>
            <CardContent>
              <Typography variant="h4" color="secondary">
                {organization._count.inventories}
              </Typography>
              <Typography variant="caption">Inventory</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <Card>
            <CardContent>
              <Typography variant="h4" color="success.main">
                {organization._count.customers}
              </Typography>
              <Typography variant="caption">Customers</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <Card>
            <CardContent>
              <Typography variant="h4" color="warning.main">
                {organization._count.documents}
              </Typography>
              <Typography variant="caption">Documents</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <Card>
            <CardContent>
              <Typography variant="h4" color="info.main">
                {organization._count.projects}
              </Typography>
              <Typography variant="caption">Projects</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <Card>
            <CardContent>
              <Typography variant="h4" color="text.primary">
                {organization._count.userOrganizations}
              </Typography>
              <Typography variant="caption">Users</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Paper sx={{ width: "100%" }}>
        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Tabs value={tabValue} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
            <Tab icon={<ModuleIcon />} label="Modules" />
            <Tab icon={<FieldsIcon />} label="Custom Fields" />
            <Tab icon={<DescriptionOutlined />} label="Documents" />
            <Tab icon={<ThemeIcon />} label="UI Configuration" />
            <Tab icon={<SettingsIcon />} label="Settings" />
            <Tab icon={<SettingsIcon />} label="Advanced" />
          </Tabs>
        </Box>

        {/* MODULES TAB */}
        <TabPanel value={tabValue} index={0}>
          <Box sx={{ mb: 2, display: "flex", justifyContent: "space-between" }}>
            <Typography variant="h6">Module Management</Typography>
            <Box>
              {(!organization.modules || organization.modules.length === 0) && (
                <Button
                  variant="contained"
                  onClick={handleInitializeModules}
                  sx={{ mr: 2 }}
                >
                  Initialize Default Modules
                </Button>
              )}
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => {
                  resetModuleForm();
                  setAddModuleDialogOpen(true);
                }}
              >
                Add Module
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
                {organization.modules?.map((module) => {
                  const currentData = moduleData[module.id] || module;

                  return (
                    <TableRow key={module.id}>
                      <TableCell>
                        <Chip label={module.moduleCode} size="small" />
                      </TableCell>
                      <TableCell>
                        {currentData.displayName || "-"}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <IconRenderer iconName={currentData.icon} />
                          <Typography variant="caption" color="text.secondary">
                            {currentData.icon || "-"}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        {currentData.sortOrder || 0}
                      </TableCell>
                      <TableCell>{currentData.config?.route || "-"}</TableCell>
                      <TableCell>
                        <Switch
                          checked={currentData.enabled}
                          onChange={() => handleModuleToggle(module)}
                        />
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() => handleEditClick(module)}
                        >
                          <EditIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {(!organization.modules || organization.modules.length === 0) && (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography color="text.secondary">
                No modules configured. Click "Initialize Default Modules" to get started.
              </Typography>
            </Box>
          )}
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
                {(customFields[selectedEntityType] || []).map((field: any) => (
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

          {(!customFields[selectedEntityType] || customFields[selectedEntityType].length === 0) && (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography color="text.secondary">
                No custom fields configured for {selectedEntityType}. Click "Add Custom Field" to create one.
              </Typography>
            </Box>
          )}
        </TabPanel>

        {/* DOCUMENTS TAB */}
        <TabPanel value={tabValue} index={2}>
          <Box sx={{ mb: 2, display: "flex", justifyContent: "space-between" }}>
            <Typography variant="h6">Document Types Management</Typography>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSaveDocumentTypes}
            >
              Save Changes
            </Button>
          </Box>

          <Alert severity="info" sx={{ mb: 3 }}>
            Enable or disable document types that will be available in the Templates page for this organization.
          </Alert>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Document Type Code</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Enabled</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {DEFAULT_DOCUMENT_TYPES.map((docType) => (
                  <TableRow key={docType.code}>
                    <TableCell>
                      <Chip label={docType.code} size="small" color="primary" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body1">{docType.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {docType.description}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={Array.isArray(enabledDocumentTypes) && enabledDocumentTypes.includes(docType.code)}
                        onChange={() => handleDocumentTypeToggle(docType.code)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ mt: 3 }}>
            <Alert severity="success">
              <Typography variant="body2">
                <strong>Enabled Document Types:</strong>{' '}
                {Array.isArray(enabledDocumentTypes) && enabledDocumentTypes.length > 0
                  ? enabledDocumentTypes.join(', ')
                  : 'None'}
              </Typography>
            </Alert>
          </Box>
        </TabPanel>

        {/* UI CONFIGURATION TAB */}
        <TabPanel value={tabValue} index={3}>
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

        {/* SETTINGS TAB */}
        <TabPanel value={tabValue} index={4}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Organization Settings
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="subtitle1" gutterBottom>
                    Basic Information
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Organization Name
                      </Typography>
                      <Typography>{organization.name}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Organization ID
                      </Typography>
                      <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                        {organization.id}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Created At
                      </Typography>
                      <Typography>
                        {new Date(organization.createdAt).toLocaleDateString()}
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </TabPanel>

        {/* ADVANCED TAB */}
        <TabPanel value={tabValue} index={5}>
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

      {/* Add Module Dialog */}
      <Dialog open={addModuleDialogOpen} onClose={() => setAddModuleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Module</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Module Code</InputLabel>
              <Select
                value={moduleForm.moduleCode}
                onChange={(e) => {
                  const code = e.target.value;
                  const defaultModule = DEFAULT_MODULES.find(m => m.code === code);
                  setModuleForm({
                    ...moduleForm,
                    moduleCode: code,
                    displayName: defaultModule?.name || "",
                    icon: defaultModule?.icon || "",
                  });
                }}
                label="Module Code"
              >
                {DEFAULT_MODULES.map((module) => (
                  <MenuItem key={module.code} value={module.code}>
                    {module.code} - {module.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="Display Name"
              value={moduleForm.displayName}
              onChange={(e) => setModuleForm({ ...moduleForm, displayName: e.target.value })}
            />
            <Autocomplete
              fullWidth
              options={availableIcons}
              value={moduleForm.icon || null}
              onChange={(event, newValue) => setModuleForm({ ...moduleForm, icon: newValue || '' })}
              renderInput={(params) => <TextField {...params} label="Icon" />}
              renderOption={(props, option) => (
                <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <IconRenderer iconName={option} />
                  <Typography>{option}</Typography>
                </Box>
              )}
            />
            <TextField
              fullWidth
              type="number"
              label="Sort Order"
              value={moduleForm.sortOrder}
              onChange={(e) => setModuleForm({ ...moduleForm, sortOrder: parseInt(e.target.value) })}
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
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddModuleDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveModule} variant="contained">
            Add Module
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Module Dialog */}
      <Dialog open={editModuleDialogOpen} onClose={() => setEditModuleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Module</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 2 }}>
            <TextField
              fullWidth
              label="Module Code"
              value={moduleForm.moduleCode}
              disabled
            />
            <TextField
              fullWidth
              label="Display Name"
              value={moduleForm.displayName}
              onChange={(e) => setModuleForm({ ...moduleForm, displayName: e.target.value })}
            />
            <Autocomplete
              fullWidth
              options={availableIcons}
              value={moduleForm.icon || null}
              onChange={(event, newValue) => setModuleForm({ ...moduleForm, icon: newValue || '' })}
              renderInput={(params) => <TextField {...params} label="Icon" />}
              renderOption={(props, option) => (
                <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <IconRenderer iconName={option} />
                  <Typography>{option}</Typography>
                </Box>
              )}
            />
            <TextField
              fullWidth
              type="number"
              label="Sort Order"
              value={moduleForm.sortOrder}
              onChange={(e) => setModuleForm({ ...moduleForm, sortOrder: parseInt(e.target.value) })}
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
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setEditModuleDialogOpen(false);
            setEditingModule(null);
          }}>Cancel</Button>
          <Button onClick={handleSaveModule} variant="contained">
            Save Changes
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