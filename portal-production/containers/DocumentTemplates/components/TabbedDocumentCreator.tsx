"use client";

import React, { useState, useEffect } from "react";
import {
  Box,
  Tabs,
  Tab,
  Paper,
  Grid,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Card,
  CardContent,
  Divider,
  Autocomplete,
  FormControlLabel,
  Checkbox,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
} from "@mui/material";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Print as PrintIcon,
  Save as SaveIcon,
  Preview as PreviewIcon,
  Edit as EditIcon,
  Download as DownloadIcon,
  PictureAsPdf as PdfIcon,
  Settings as SettingsIcon,
  ArrowBack as ArrowBackIcon,
  CheckCircle as CheckCircleIcon,
  ContentCopy as ContentCopyIcon,
  History as HistoryIcon,
  Close as CloseIcon,
} from "@mui/icons-material";
import CleanDocumentPreview from "./CleanDocumentPreview";
import DocumentCustomizer from "./DocumentCustomizer";
import DynamicFormFields from "./DynamicFormFields";
import PriceHistoryPopup from "@/components/PriceHistory/PriceHistoryPopup";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import { useForm, Controller } from "react-hook-form";
import { usePathname, useRouter } from "next/navigation";
import { usePastDescriptions } from "../hooks/usePastDescriptions";
import { useGetInventoriesForItemTable } from "../hooks/useGetInventoriesForItemTable";
import { getTemplateFormFields } from "../utils/templateFieldSync";
import { TemplateFieldConfig } from "../config/templateFieldDefinitions";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ p: 0.5 }}>{children}</Box>}
    </div>
  );
}

interface DocumentCreatorProps {
  documentType: "QO1" | "DO" | "RDO" | "TI" | "TI2" | "MSR" | "INVOICE" | string;
  documentId?: string;
  onSave?: (data: any) => void;
  onPrint?: () => void;
  existingData?: any;
  customers?: any[];
  projects?: any[];
  deliveryOrders?: any[];
  siteOffices?: any[];
  onCustomerChange?: (customerId: string) => void;
  organization?: any;
}

export default function TabbedDocumentCreator({
  documentType,
  onSave,
  onPrint,
  existingData,
  customers = [],
  projects = [],
  deliveryOrders = [],
  siteOffices = [],
  documentId,
  onCustomerChange,
  organization,
}: DocumentCreatorProps) {
  // Check if we're in template edit mode
  const pathname = usePathname();
  const router = useRouter();
  // Template edit path: /portal/documents/edit/[type]/[id] (5 segments)
  // Document edit path: /portal/documents/[type]/[id]/[documentId] (6 segments)
  const pathSegments = pathname.split("/").filter(Boolean);
  const isTemplateEditMode = pathname.includes("/documents/edit/") && pathSegments.length === 5;

  // Debug logging
  console.log("TabbedDocumentCreator - existingData:", existingData);
  console.log("TabbedDocumentCreator - existingData.name:", existingData?.name);
  console.log("TabbedDocumentCreator - isTemplateEditMode:", isTemplateEditMode);

  // Main tabs
  const [mainTabValue, setMainTabValue] = useState(0);
  // Items section tabs
  const [itemsTabValue, setItemsTabValue] = useState(0);
  const documentStatus = existingData?.status || "draft";
  const isDocumentConfirmed = documentStatus === "confirmed";
  const isDocumentEditable = !isDocumentConfirmed && !isTemplateEditMode;

  // Force preview mode for confirmed documents
  const [previewMode, setPreviewMode] = useState(isDocumentConfirmed);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isToolBarOpen, setToolBarOpen] = useState(false);

  // PDF generation states
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Back button confirmation dialog
  const [backConfirmDialogOpen, setBackConfirmDialogOpen] = useState(false);

  // Price history popup state
  const [priceHistoryDialogOpen, setPriceHistoryDialogOpen] = useState(false);
  const [selectedItemCode, setSelectedItemCode] = useState<string>("");
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");

  // Dynamic form field configuration
  const [templateFieldConfig, setTemplateFieldConfig] = useState<TemplateFieldConfig | null>(null);
  const [isLoadingFieldConfig, setIsLoadingFieldConfig] = useState(true);

  const { getToken } = useAuth();

  // Past descriptions history hook
  const { pastDescriptions, isLoading: isLoadingDescriptions } = usePastDescriptions();

  // Inventory items for item table
  const { inventoriesForDocument } = useGetInventoriesForItemTable();


  // Template configuration form for field visibility
  const templateMethods = useForm({
    mode: "onChange",
    defaultValues: {
      // Field visibility configuration
      logo: existingData?.config?.logo ?? true,
      company: {
        name: existingData?.config?.company?.name ?? true,
        address: existingData?.config?.company?.address ?? true,
        phoneNumber: existingData?.config?.company?.phoneNumber ?? true,
      },
      deliveryTo: existingData?.config?.deliveryTo ?? true,
      referenceNo: existingData?.config?.referenceNo ?? true,
      poNo: existingData?.config?.poNo ?? true,
      doNo: existingData?.config?.doNo ?? true,
      returnOrderNo: existingData?.config?.returnOrderNo ?? true,
      // Table configuration
      tableHeaders: existingData?.config?.tableHeaders ?? {
        item: true,
        description: true,
        quantity: true,
        unitPrice: true,
        tax: true,
        amount: true,
      },
      tableColumnOrder: existingData?.config?.tableColumnOrder ?? ["item", "description", "quantity", "unitPrice", "tax", "amount"],
      columnLabels: existingData?.config?.columnLabels ?? {
        item: "Item",
        description: "Description",
        quantity: "Quantity",
        unitPrice: "Unit Price",
        tax: "Tax %",
        amount: "Amount",
      },
      // Default values for template
      defaultValues: existingData?.config?.defaultValues ?? {
        companyName: "",
        companyAddress: "",
        gstRegNo: "",
        note: "",
        termsAndConditions: "",
        bankDetails: "",
      },
    }
  });

  const { watch: templateWatch } = templateMethods;

  // Form data state
  const [formData, setFormData] = useState({
    // Document name/number from database
    name: existingData?.name || "",
    // General tab data - use organization data as defaults
    company: {
      name: existingData?.company?.name || organization?.name || existingData?.config?.defaultValues?.companyName || "",
      address: existingData?.company?.address || organization?.address || existingData?.config?.defaultValues?.companyAddress || "",
      phoneNumber: existingData?.company?.phoneNumber || organization?.phoneNumber || "",
      gstRegNo: existingData?.gstRegNo || organization?.registrationNumber || existingData?.config?.defaultValues?.gstRegNo || "",
    },
    customer: {
      id: existingData?.customerId || "",
      name: "",
      address: "",
    },
    documentInfo: {
      date: existingData?.documentInfo?.date || existingData?.date || new Date().toISOString().split("T")[0],
      documentNumber: existingData?.documentInfo?.documentNumber || existingData?.documentNumber || existingData?.name || "",
      referenceNo: existingData?.documentInfo?.referenceNo || existingData?.referenceNo || "",
      poNo: existingData?.documentInfo?.poNo || existingData?.poNo || "",
      doNo: existingData?.documentInfo?.doNo || existingData?.doNo || "",
      returnOrderNo: existingData?.documentInfo?.returnOrderNo || existingData?.returnOrderNo || "",
      // Add all documentInfo fields from TI2 template
      salesPerson: existingData?.documentInfo?.salesPerson || existingData?.salesPerson || "",
      soNo: existingData?.documentInfo?.soNo || existingData?.soNo || "",
      page: existingData?.documentInfo?.page || existingData?.page || "1",
      paymentTerms: existingData?.documentInfo?.paymentTerms || existingData?.paymentTerms || "0 DAYS",
      currency: existingData?.documentInfo?.currency || existingData?.currency || "USD",
      qinRef: existingData?.documentInfo?.qinRef || existingData?.qinRef || "",
    },
    // Details tab data
    projectId: existingData?.projectId || "",
    salesPerson: existingData?.documentInfo?.salesPerson || existingData?.salesPerson || "",
    salesContact: existingData?.salesContact || "",
    salesEmail: existingData?.salesEmail || "",
    paymentTerms: existingData?.documentInfo?.paymentTerms || existingData?.paymentTerms || "30 days",
    dueDate: existingData?.dueDate || "",
    // Quotation-specific fields
    quotationNo: existingData?.quotationNo || "",
    validityTerm: existingData?.validityTerm || "",
    currency: existingData?.currency || "SGD",
    // MSR-specific fields
    equipmentId: existingData?.equipmentId || "",
    location: existingData?.location || "",
    reportType: existingData?.reportType || "",
    serviceDate: existingData?.serviceDate || "",
    description: existingData?.description || "",
    // RDO-specific fields
    collectFrom: existingData?.collectFrom || "",
    // Delivery Address tab data
    deliveryAddress: {
      attention: existingData?.attention?.name || "",
      phone: existingData?.attention?.phoneNumber || "",
      address: existingData?.deliveryTo || "",
      instructions: existingData?.deliveryInstructions || "",
    },
    deliveryTo: existingData?.deliveryTo || "",
    // Items data
    items: existingData?.items || [],
    // Footer data
    note: existingData?.note || "",
    termsAndConditions: existingData?.termsAndConditions || "",
    bankDetails: existingData?.bankDetails || "",
    remarks: existingData?.remarks || "",
    agreementText: existingData?.agreementText || "",
    title: existingData?.title || "",
  });

  // Load template field configuration
  useEffect(() => {
    async function loadTemplateFields() {
      try {
        setIsLoadingFieldConfig(true);
        const token = await getToken();
        if (!token) {
          setIsLoadingFieldConfig(false);
          return;
        }

        // Get field configuration for this template variant
        // Pass documentType as the template variant
        const config = await getTemplateFormFields(
          documentType,  // template variant (TI, TI2, DO, etc.)
          undefined,      // template ID (not available yet)
          token
        );

        console.log('Loaded template field config:', config);
        setTemplateFieldConfig(config);
      } catch (error) {
        console.error('Error loading template fields:', error);
        toast.error('Failed to load template configuration');
      } finally {
        setIsLoadingFieldConfig(false);
      }
    }

    loadTemplateFields();
  }, [documentType, documentId, getToken]);

  // Items management - normalize field names from old inventoryId to new inventoryItemId
  const [items, setItems] = useState(() => {
    const existingItems = existingData?.items || [];

    // Check if this is an invoice type that doesn't need item tax
    const isInvoiceType = documentType === "TI" || documentType === "TI2" || documentType === "INVOICE";

    // If there are existing items, map them
    if (existingItems.length > 0) {
      const mapped = existingItems.map((item: any) => ({
        ...item,
        inventoryItemId: item.inventoryItemId || item.inventoryId || "",  // Support both old and new field names
        inventoryId: undefined,  // Remove old field name if it exists
        // Only include tax for non-invoice types
        tax: isInvoiceType ? undefined : (item.tax || "9"),
      }));
      return mapped;
    }

    // If no existing items, create one empty item
    const defaultItem = {
      id: Date.now(),
      itemCode: "",
      inventoryItemId: "",
      description: "",
      quantity: 1,
      unitPrice: 0,
      // Only include tax for non-invoice types
      tax: isInvoiceType ? undefined : "9",
      amount: 0,
    };
    return [defaultItem];
  });

  const addNewItem = () => {
    const isInvoiceType = documentType === "TI" || documentType === "TI2" || documentType === "INVOICE";
    setItems([
      ...items,
      {
        id: Date.now(),
        itemCode: "",
        inventoryItemId: "",  // Changed from inventoryId to inventoryItemId
        description: "",
        quantity: 1,
        unitPrice: 0,
        // Only include tax for non-invoice types
        tax: isInvoiceType ? undefined : 9,
        amount: 0,
      },
    ]);
  };

  const deleteItem = (id: number) => {
    setItems(items.filter((item: any) => item.id !== id));
  };

  const updateItem = (id: number, field: string, value: any) => {
    setItems((prevItems: any[]) => {
      const newItems = prevItems.map((item: any) => {
        if (item.id === id) {
          const updated = { ...item, [field]: value };
          // Calculate amount
          updated.amount = updated.quantity * updated.unitPrice;
          return updated;
        }
        return item;
      });
      return newItems;
    });
  };

  // Calculations - use organization tax rate for invoices
  const isInvoiceType = documentType === "TI" || documentType === "TI2" || documentType === "INVOICE";
  const subtotal = items.reduce((acc: number, item: any) => acc + (item.amount || 0), 0);

  // For invoices, use organization tax rate; for others, use item-level tax
  const totalTax = isInvoiceType
    ? subtotal * ((organization?.taxRate || 9) / 100)
    : items.reduce((acc: number, item: any) => acc + (item.amount || 0) * ((item.tax || 0) / 100), 0);

  const total = subtotal + totalTax;

  const handleMainTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setMainTabValue(newValue);
  };

  const handleItemsTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setItemsTabValue(newValue);
  };

  const getDocumentTitle = () => {
    const titles = {
      QO1: "Quotation",
      DO: "Delivery Order",
      RDO: "Return Delivery Order",
      TI: "Tax Invoice",
      MSR: "Maintenance Service Report",
    };
    return titles[documentType] || "Document";
  };

  // Generate PDF and upload to S3
  const generatePdf = async () => {
    try {
      setPdfUrl(null); // Reset any previous PDF URL
      setIsGeneratingPdf(true);
      setPdfDialogOpen(true);

      const token = await getToken();
      if (!token) {
        throw new Error("Authentication token not found");
      }

      // Prepare document data with items
      const documentData = {
        ...formData,
        items: items,
      };

      // Call backend to generate PDF
      const response = await request(
        {
          path: "/documents/generate-pdf",
          method: "POST",
        },
        {
          documentType,
          documentId: documentId || `temp_${Date.now()}`,
          data: documentData,
        },
        token
      );

      console.log("PDF Generation Response:", response);

      // The response has the URL nested in response.data.url
      if (response && response.data && response.data.url) {
        setPdfUrl(response.data.url);
        setIsGeneratingPdf(false);
        toast.success("PDF generated successfully!");
      } else if (response && response.success === false) {
        // Error response from request helper
        setIsGeneratingPdf(false);
        throw new Error(response.message || "Failed to generate PDF");
      } else {
        // Unexpected response structure
        console.error("Unexpected response structure:", response);
        setIsGeneratingPdf(false);
        toast.error("Failed to generate PDF - unexpected response");
        setPdfDialogOpen(false);
      }
    } catch (error) {
      console.error("Error generating PDF:", error);
      setIsGeneratingPdf(false);
      toast.error("Failed to generate PDF. Please try again.");
      setPdfDialogOpen(false);
    }
  };

  const handleDownloadPdf = () => {
    if (pdfUrl) {
      // Open PDF in new tab
      window.open(pdfUrl, "_blank");
    }
  };

  const handlePrint = () => {
    // Generate PDF instead of browser print
    generatePdf();
  };

  const handleShowPriceHistory = (itemCode: string) => {
    if (!itemCode) {
      toast.error("Please select an item first");
      return;
    }

    // Find the item to get its inventoryItemId
    const currentItem = items.find((item: any) => item.itemCode === itemCode);
    if (!currentItem || !currentItem.inventoryItemId) {
      toast.error("Please select an inventory item first");
      return;
    }

    // Get the assetId from the inventory
    const inventory = inventoriesForDocument.find(inv => inv.id === currentItem.inventoryItemId);
    if (!inventory || !inventory.assetId) {
      toast.error("No asset linked to this inventory item");
      return;
    }

    setSelectedItemCode(itemCode);
    setSelectedAssetId(inventory.assetId);
    setPriceHistoryDialogOpen(true);
  };

  const handleConfirmDocument = async () => {
    setIsConfirming(true);
    try {
      // First save the document with current data if not saved
      const saveData = {
        ...formData,
        items: items,
        name: formData.name || formData.documentInfo.documentNumber,
        status: "confirmed"
      };

      // Call onSave with confirmed status
      await onSave?.(saveData);

      toast.success("Document confirmed successfully");
      setConfirmDialogOpen(false);

      // Refresh the page to update the status
      router.refresh();
    } catch (error) {
      console.error("Error confirming document:", error);
      toast.error("Failed to confirm document");
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCreateRevision = async () => {
    try {
      const token = await getToken();
      if (!token) {
        toast.error("Authentication required");
        return;
      }

      // Get the document ID from existingData or documentId prop
      const docId = existingData?.id || documentId;
      if (!docId) {
        toast.error("Document ID not found");
        return;
      }

      // Create revision through API using correct request format
      const response = await request(
        {
          path: `/documents/${docId}/revisions`,
          method: "POST",
        },
        {},
        token
      );

      if (response?.success && response?.data?.id) {
        toast.success("Revision created successfully");
        // Navigate to edit the new revision
        // Get the document type from the response (keep uppercase)
        const newDocType = response.data.type || 'INVOICE';
        const templateId = response.data.documentTemplateId || documentId;
        router.push(`/portal/documents/${newDocType}/${templateId}/${response.data.id}`);
      } else {
        toast.error(response?.message || "Failed to create revision");
      }
    } catch (error) {
      console.error("Error creating revision:", error);
      toast.error("Failed to create revision");
    }
  };

  // Get editable visibility fields based on document type
  const getEditableVisibilityFields = () => {
    const baseFields = [
      {
        title: "Company Fields",
        items: [
          { label: "Logo", name: "logo" },
          { label: "Company Name", name: "company.name" },
          { label: "Company Address", name: "company.address" },
          { label: "Phone Number", name: "company.phoneNumber" },
        ],
      },
      {
        title: "Document Fields",
        items: [
          ...(documentType === "TI" || documentType === "DO" || documentType === "QO1" ? [{ label: "Reference No", name: "referenceNo" }] : []),
          ...(documentType === "DO" || documentType === "QO1" || documentType === "RDO" ? [{ label: "PO No", name: "poNo" }] : []),
          ...(documentType === "DO" ? [{ label: "DO No", name: "doNo" }] : []),
          ...(documentType === "RDO" ? [{ label: "Return Order No", name: "returnOrderNo" }] : []),
          ...(documentType === "DO" || documentType === "QO1" ? [{ label: "Delivery To", name: "deliveryTo" }] : []),
        ],
      },
      {
        title: "Table Headers",
        items: [], // Will be handled by DraggableTableHeaders component
      },
    ];

    // Add document-specific sections
    if (isTemplateEditMode) {
      baseFields.push({
        title: "Default Values",
        items: [
          { label: "Company Name", name: "defaultValues.companyName" },
          { label: "Company Address", name: "defaultValues.companyAddress" },
          { label: "GST Reg No", name: "defaultValues.gstRegNo" },
          { label: "Note", name: "defaultValues.note" },
          ...(documentType === "TI" || documentType === "QO1" ? [{ label: "Terms & Conditions", name: "defaultValues.termsAndConditions" }] : []),
          ...(documentType === "TI" ? [{ label: "Bank Details", name: "defaultValues.bankDetails" }] : []),
        ],
      });
    }

    return baseFields;
  };

  const editableVisibilityFields = getEditableVisibilityFields();

  // Column management handlers
  const handleColumnReorder = (newOrder: string[]) => {
    templateMethods.setValue("tableColumnOrder", newOrder, { shouldDirty: true });
  };

  const handleToggleColumnVisibility = (columnId: string, visible: boolean) => {
    const current = templateMethods.getValues("tableHeaders") || {};
    templateMethods.setValue(`tableHeaders.${columnId}`, visible, { shouldDirty: true });
  };

  const handleEditLabel = (columnId: string, newLabel: string) => {
    templateMethods.setValue(`columnLabels.${columnId}`, newLabel, { shouldDirty: true });
  };

  const handleAddField = (fieldId: string, label: string) => {
    const currentOrder = templateMethods.getValues("tableColumnOrder") || [];
    templateMethods.setValue("tableColumnOrder", [...currentOrder, fieldId], { shouldDirty: true });
    templateMethods.setValue(`tableHeaders.${fieldId}`, true, { shouldDirty: true });
    templateMethods.setValue(`columnLabels.${fieldId}`, label, { shouldDirty: true });
  };

  // Handle back button click
  const handleBackClick = () => {
    // If document is confirmed, just navigate back without showing dialog
    const documentStatus = existingData?.status || "draft";
    if (documentStatus === "confirmed") {
      // Navigate back directly for confirmed documents
      if (documentType === "TI") {
        router.push("/portal/invoices");
      } else {
        router.push("/portal/documents");
      }
    } else {
      // Show dialog only for draft documents
      setBackConfirmDialogOpen(true);
    }
  };

  // Handle save as draft from dialog
  const handleSaveAsDraft = async () => {
    if (isTemplateEditMode) {
      const templateConfig = templateMethods.getValues();
      await onSave?.({ ...formData, config: templateConfig });
    } else {
      // Include items in the save data
      const saveData = {
        ...formData,
        items: items, // Include items array
        name: formData.name || formData.documentInfo.documentNumber
      };
      await onSave?.(saveData);
    }
    // Navigate back after saving
    if (documentType === "TI") {
      router.push("/portal/invoices");
    } else {
      router.push("/portal/documents");
    }
  };

  // Handle delete from dialog
  const handleDelete = async () => {
    try {
      // Only delete if document exists (has been saved before)
      if (existingData?.id || documentId) {
        const token = await getToken();
        if (!token) {
          toast.error("Authentication required");
          return;
        }

        const docId = existingData?.id || documentId;

        // Delete the document
        const response = await request(
          {
            path: `/documents/delete/${docId}`,
            method: "DELETE",
          },
          {},
          token
        );

        if (response?.success) {
          toast.success("Document deleted successfully");
        } else {
          toast.error(response?.message || "Failed to delete document");
        }
      }

      // Navigate back regardless of deletion result
      if (documentType === "TI") {
        router.push("/portal/invoices");
      } else {
        router.push("/portal/documents");
      }
    } catch (error) {
      console.error("Error deleting document:", error);
      toast.error("Failed to delete document");
      // Still navigate back even if deletion fails
      if (documentType === "TI") {
        router.push("/portal/invoices");
      } else {
        router.push("/portal/documents");
      }
    }
  };

  return (
    <Box sx={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header Actions */}
      <Box
        sx={{
          py: 0.5,
          px: 2,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          bgcolor: "white",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconButton
            onClick={handleBackClick}
            size="small"
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" fontWeight="500">
            {isTemplateEditMode
              ? existingData?.name || `${getDocumentTitle()} Template`
              : formData.name || formData.documentInfo.documentNumber || `${getDocumentTitle()} - New`}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          {isDocumentConfirmed && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={handleCreateRevision}
              color="info"
            >
              Create Revision
            </Button>
          )}
          {!isDocumentConfirmed && (
            <Button
              size="small"
              variant="outlined"
              startIcon={previewMode ? <EditIcon /> : <PreviewIcon />}
              onClick={() => setPreviewMode(!previewMode)}
            >
              {previewMode ? "Edit" : "Preview"}
            </Button>
          )}
          <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint}>
            Print / PDF
          </Button>
          {!isDocumentConfirmed && !isTemplateEditMode && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<CheckCircleIcon />}
              onClick={() => setConfirmDialogOpen(true)}
              color="success"
            >
              Confirm Document
            </Button>
          )}
          {!isDocumentConfirmed && (
            <Button
              size="small"
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={() => {
                if (isTemplateEditMode) {
                  // Save template configuration
                  const templateConfig = templateMethods.getValues();
                  onSave?.({ ...formData, config: templateConfig });
                } else {
                  // Save document data with name field and items
                  const saveData = {
                    ...formData,
                    items: items,
                    name: formData.name || formData.documentInfo.documentNumber
                  };
                  console.log("Direct Save - Data being sent to onSave:", saveData);
                  console.log("Direct Save - Items in saveData:", JSON.stringify(saveData.items, null, 2));
                  onSave?.(saveData);
                }
              }}
            >
              {isTemplateEditMode ? "Save Template" : "Save as Draft"}
            </Button>
          )}
          {isDocumentConfirmed && (
            <Typography
              variant="body2"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                color: 'success.main',
                fontWeight: 500,
                bgcolor: 'success.lighter',
                px: 2,
                py: 0.5,
                borderRadius: 1
              }}
            >
              <CheckCircleIcon fontSize="small" />
              Document Confirmed
            </Typography>
          )}
        </Box>
      </Box>

      {/* Main Content with Sidebar */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* DocumentCustomizer Sidebar - Only in template edit mode */}
        {isTemplateEditMode && isToolBarOpen && (
          <Box sx={{ width: 320, borderRight: 1, borderColor: "divider", p: 2, overflow: "auto", bgcolor: "background.paper" }}>
            <Typography variant="h6" sx={{ mb: 2 }}>Template Configuration</Typography>
            <DocumentCustomizer
              fields={editableVisibilityFields}
              control={templateMethods.control}
              tableHeaders={templateWatch("tableHeaders")}
              columnOrder={templateWatch("tableColumnOrder")}
              columnLabels={templateWatch("columnLabels")}
              onColumnReorder={handleColumnReorder}
              onToggleColumnVisibility={handleToggleColumnVisibility}
              onEditLabel={handleEditLabel}
              onAddField={handleAddField}
            />
          </Box>
        )}

        {/* Main Content Area */}
        {!previewMode && !isDocumentConfirmed ? (
          <Box sx={{ flex: 1, overflow: "auto", position: "relative", display: "flex", flexDirection: "column" }}>
            {/* Template Settings Toggle Button */}
            {isTemplateEditMode && (
              <IconButton
                onClick={() => setToolBarOpen(!isToolBarOpen)}
                sx={{
                  position: "absolute",
                  top: 8,
                  left: 8,
                  zIndex: 1,
                  bgcolor: "background.paper",
                  boxShadow: 1,
                }}
              >
                <SettingsIcon />
              </IconButton>
            )}

            {/* Main Tabs - Dynamic rendering based on template config */}
            <Box sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
              {isLoadingFieldConfig ? (
                <Box sx={{ p: 2, textAlign: 'center' }}>
                  <CircularProgress size={20} />
                </Box>
              ) : (
                <Tabs value={mainTabValue} onChange={handleMainTabChange} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0 } }}>
                  {templateFieldConfig?.tabs.map((tab) => (
                    <Tab key={tab.tabId} label={tab.tabLabel} />
                  ))}
                  {/* Legacy delivery address tab for specific document types */}
                  {(documentType === "DO" || documentType === "RDO" || documentType === "QO1") && (
                    <Tab label={documentType === "RDO" ? "Return Info" : "Delivery Address"} />
                  )}
                </Tabs>
              )}
            </Box>

          {/* Dynamic Tabs based on template config */}
          {templateFieldConfig?.tabs.map((tab, index) => (
            <TabPanel key={tab.tabId} value={mainTabValue} index={index}>
              <Card>
                <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                  <Typography variant="body2" fontWeight={600} sx={{ mb: 0.25 }}>
                    {tab.tabLabel}
                  </Typography>
                  <Divider sx={{ mb: 0.5 }} />
                  <DynamicFormFields
                    fields={tab.fields}
                    formData={formData}
                    setFormData={setFormData}
                    customers={customers}
                    projects={projects}
                    deliveryOrders={deliveryOrders}
                    siteOffices={siteOffices}
                  />
                </CardContent>
              </Card>
            </TabPanel>
          ))}

          {/* LEGACY: Keep old GENERAL TAB for backwards compatibility */}
          {!templateFieldConfig && (
          <TabPanel value={mainTabValue} index={0}>
            <Grid container spacing={0.5}>
              {/* Customer and Document Information in a single row */}
              <Grid item xs={12} md={6}>
                <Card sx={{ height: "100%" }}>
                  <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                    <Typography variant="body2" fontWeight={600} sx={{ mb: 0.25 }}>
                      Customer Information
                    </Typography>
                    <Divider sx={{ mb: 0.5 }} />
                    <Grid container spacing={0.5}>
                      <Grid item xs={12}>
                        <Autocomplete
                          options={customers}
                          getOptionLabel={(option) => option.name}
                          value={customers.find((c) => c.id === formData.customer.id) || null}
                          onChange={(_, newValue) => {
                            setFormData({
                              ...formData,
                              customer: {
                                id: newValue?.id || "",
                                name: newValue?.name || "",
                                address: newValue?.address || "",
                              },
                            });
                            // Call the customer change handler to fetch related data
                            if (onCustomerChange && newValue?.id) {
                              onCustomerChange(newValue.id);
                            }
                          }}
                          renderInput={(params) => (
                            <TextField {...params} label="Select Customer" size="small" />
                          )}
                          size="small"
                        />
                      </Grid>
                      {formData.customer.name && (
                        <Grid item xs={12}>
                          <Paper sx={{ p: 0.5, bgcolor: "grey.50" }}>
                            <Typography variant="caption" fontWeight={500}>
                              {formData.customer.name}
                            </Typography>
                            <Typography variant="caption" display="block" color="text.secondary">
                              {formData.customer.address}
                            </Typography>
                          </Paper>
                        </Grid>
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Document Information - same row */}
              <Grid item xs={12} md={6}>
                <Card sx={{ height: "100%" }}>
                  <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                    <Typography variant="body2" fontWeight={600} sx={{ mb: 0.25 }}>
                      Document Information
                    </Typography>
                    <Divider sx={{ mb: 0.5 }} />
                    <Grid container spacing={0.5}>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label="Date"
                          type="date"
                          value={formData.documentInfo.date}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              documentInfo: { ...formData.documentInfo, date: e.target.value },
                            })
                          }
                          size="small"
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label={`${getDocumentTitle()} Number`}
                          value={formData.documentInfo.documentNumber}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              name: e.target.value, // Update the name field as well
                              documentInfo: {
                                ...formData.documentInfo,
                                documentNumber: e.target.value,
                              },
                            })
                          }
                          size="small"
                        />
                      </Grid>
                      {(documentType === "TI" || documentType === "DO" || documentType === "QO1") && (!isTemplateEditMode || templateWatch("referenceNo")) && (
                        <Grid item xs={12} md={6}>
                          <TextField
                            fullWidth
                            label="Reference No"
                            value={isTemplateEditMode && templateWatch("defaultValues.referenceNo") ? templateWatch("defaultValues.referenceNo") : formData.documentInfo.referenceNo}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                documentInfo: {
                                  ...formData.documentInfo,
                                  referenceNo: e.target.value,
                                },
                              })
                            }
                            size="small"
                            disabled={isTemplateEditMode}
                          />
                        </Grid>
                      )}
                      {documentType === "TI" && (
                        <Grid item xs={12} md={6}>
                          <FormControl fullWidth size="small">
                            <InputLabel>DO No</InputLabel>
                            <Select
                              value={formData.documentInfo.doNo}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  documentInfo: {
                                    ...formData.documentInfo,
                                    doNo: e.target.value,
                                  },
                                })
                              }
                              label="DO No"
                              disabled={!formData.customer.id || deliveryOrders.length === 0}
                            >
                              {deliveryOrders.length === 0 ? (
                                <MenuItem value="" disabled>
                                  {formData.customer.id ? "No delivery orders available" : "Select customer first"}
                                </MenuItem>
                              ) : (
                                deliveryOrders.map((order) => (
                                  <MenuItem key={order.id} value={order.doNo}>
                                    {order.doNo}
                                  </MenuItem>
                                ))
                              )}
                            </Select>
                          </FormControl>
                        </Grid>
                      )}
                      {documentType === "RDO" && (
                        <Grid item xs={12} md={6}>
                          <TextField
                            fullWidth
                            label="Return Order No"
                            value={formData.documentInfo.returnOrderNo}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                documentInfo: {
                                  ...formData.documentInfo,
                                  returnOrderNo: e.target.value,
                                },
                              })
                            }
                            size="small"
                          />
                        </Grid>
                      )}
                      {documentType === "DO" && (
                        <Grid item xs={12} md={6}>
                          <TextField
                            fullWidth
                            label="DO No"
                            value={formData.documentInfo.doNo}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                documentInfo: {
                                  ...formData.documentInfo,
                                  doNo: e.target.value,
                                },
                              })
                            }
                            size="small"
                          />
                        </Grid>
                      )}
                      {(documentType === "DO" || documentType === "QO1" || documentType === "RDO") && (
                        <Grid item xs={12} md={6}>
                          <TextField
                            fullWidth
                            label="PO No"
                            value={formData.documentInfo.poNo}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                documentInfo: {
                                  ...formData.documentInfo,
                                  poNo: e.target.value,
                                },
                              })
                            }
                            size="small"
                          />
                        </Grid>
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </TabPanel>
          )}

          {/* LEGACY: DETAILS TAB */}
          {!templateFieldConfig && (
          <TabPanel value={mainTabValue} index={1}>
            <Grid container spacing={0.5}>
              <Grid item xs={12}>
                <Card>
                  <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                    <Typography variant="body2" fontWeight={600} sx={{ mb: 0.25 }}>
                      Additional Details
                    </Typography>
                    <Divider sx={{ mb: 0.5 }} />
                    <Grid container spacing={0.5}>
                      {/* Project - for DO and TI */}
                      {(documentType === "DO" || documentType === "TI") && (
                        <Grid item xs={12} md={6}>
                          <Autocomplete
                            options={projects.filter((p) => !formData.customer.id || p.customerId === formData.customer.id)}
                            getOptionLabel={(option) => option.name}
                            value={projects.find((p) => p.id === formData.projectId) || null}
                            onChange={(_, newValue) =>
                              setFormData({
                                ...formData,
                                projectId: newValue?.id || "",
                              })
                            }
                            renderInput={(params) => (
                              <TextField {...params} label="Project" size="small" />
                            )}
                            disabled={!formData.customer.id}
                          />
                        </Grid>
                      )}

                      {/* Quotation-specific fields */}
                      {documentType === "QO1" && (
                        <>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              label="Quotation No"
                              value={formData.quotationNo}
                              onChange={(e) =>
                                setFormData({ ...formData, quotationNo: e.target.value })
                              }
                              size="small"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              label="Validity Term"
                              value={formData.validityTerm}
                              onChange={(e) =>
                                setFormData({ ...formData, validityTerm: e.target.value })
                              }
                              size="small"
                              placeholder="e.g., 30 days"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              label="Currency"
                              value={formData.currency || "SGD"}
                              onChange={(e) =>
                                setFormData({ ...formData, currency: e.target.value })
                              }
                              size="small"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              label="Sales Person"
                              value={formData.salesPerson}
                              onChange={(e) =>
                                setFormData({ ...formData, salesPerson: e.target.value })
                              }
                              size="small"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              label="Sales Contact"
                              value={formData.salesContact}
                              onChange={(e) =>
                                setFormData({ ...formData, salesContact: e.target.value })
                              }
                              size="small"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              label="Sales Email"
                              value={formData.salesEmail}
                              onChange={(e) =>
                                setFormData({ ...formData, salesEmail: e.target.value })
                              }
                              size="small"
                              type="email"
                            />
                          </Grid>
                        </>
                      )}

                      {/* Payment Terms - for TI and QO1 */}
                      {(documentType === "TI" || documentType === "QO1") && (
                        <Grid item xs={12} md={6}>
                          <FormControl fullWidth size="small">
                            <InputLabel>Payment Terms</InputLabel>
                            <Select
                              value={formData.paymentTerms}
                              onChange={(e) =>
                                setFormData({ ...formData, paymentTerms: e.target.value })
                              }
                              label="Payment Terms"
                            >
                              <MenuItem value="Immediate">Immediate</MenuItem>
                              <MenuItem value="7 days">7 days</MenuItem>
                              <MenuItem value="14 days">14 days</MenuItem>
                              <MenuItem value="30 days">30 days</MenuItem>
                              <MenuItem value="60 days">60 days</MenuItem>
                              <MenuItem value="90 days">90 days</MenuItem>
                            </Select>
                          </FormControl>
                        </Grid>
                      )}

                      {/* Due Date - for TI only */}
                      {documentType === "TI" && (
                        <Grid item xs={12} md={6}>
                          <TextField
                            fullWidth
                            label="Due Date"
                            type="date"
                            value={formData.dueDate}
                            onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                            size="small"
                            InputLabelProps={{ shrink: true }}
                          />
                        </Grid>
                      )}

                      {/* MSR-specific fields */}
                      {documentType === "MSR" && (
                        <>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              label="Equipment ID"
                              value={formData.equipmentId}
                              onChange={(e) =>
                                setFormData({ ...formData, equipmentId: e.target.value })
                              }
                              size="small"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              label="Location"
                              value={formData.location}
                              onChange={(e) =>
                                setFormData({ ...formData, location: e.target.value })
                              }
                              size="small"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <FormControl fullWidth size="small">
                              <InputLabel>Report Type</InputLabel>
                              <Select
                                value={formData.reportType || ""}
                                onChange={(e) =>
                                  setFormData({ ...formData, reportType: e.target.value })
                                }
                                label="Report Type"
                              >
                                <MenuItem value="preventive">Preventive Maintenance</MenuItem>
                                <MenuItem value="corrective">Corrective Maintenance</MenuItem>
                                <MenuItem value="emergency">Emergency Repair</MenuItem>
                                <MenuItem value="inspection">Inspection</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              label="Service Date"
                              type="date"
                              value={formData.serviceDate}
                              onChange={(e) =>
                                setFormData({ ...formData, serviceDate: e.target.value })
                              }
                              size="small"
                              InputLabelProps={{ shrink: true }}
                            />
                          </Grid>
                          <Grid item xs={12}>
                            <TextField
                              fullWidth
                              multiline
                              rows={2}
                              label="Description"
                              placeholder="Enter detailed description of the maintenance work..."
                              value={formData.description}
                              onChange={(e) =>
                                setFormData({ ...formData, description: e.target.value })
                              }
                              size="small"
                            />
                          </Grid>
                        </>
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </TabPanel>
          )}


          {/* DELIVERY ADDRESS TAB - Only for DO, RDO, and QO1 */}
          {(documentType === "DO" || documentType === "RDO" || documentType === "QO1") && (
            <TabPanel value={mainTabValue} index={2}>
              <Grid container spacing={0.5}>
                <Grid item xs={12}>
                  <Card>
                    <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                      <Typography variant="body2" fontWeight={600} sx={{ mb: 0.25 }}>
                        {documentType === "RDO" ? "Return Information" : "Delivery Information"}
                      </Typography>
                      <Divider sx={{ mb: 0.5 }} />
                      <Grid container spacing={0.5}>
                        <Grid item xs={12} md={6}>
                          <TextField
                            fullWidth
                            label="Attention To"
                            value={formData.deliveryAddress.attention}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                deliveryAddress: {
                                  ...formData.deliveryAddress,
                                  attention: e.target.value,
                                },
                              })
                            }
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <TextField
                            fullWidth
                            label="Contact Phone"
                            value={formData.deliveryAddress.phone}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                deliveryAddress: {
                                  ...formData.deliveryAddress,
                                  phone: e.target.value,
                                },
                              })
                            }
                            size="small"
                          />
                        </Grid>

                        {/* Delivery To for DO and QO1 with site offices */}
                        {(documentType === "DO" || documentType === "QO1") && (
                          <Grid item xs={12}>
                            {siteOffices && siteOffices.length > 0 ? (
                              <Autocomplete
                                options={siteOffices}
                                getOptionLabel={(option) => `${option.name} - ${option.address || ""}`}
                                value={siteOffices.find((s) => s.id === formData.deliveryTo) || null}
                                onChange={(_, newValue) =>
                                  setFormData({
                                    ...formData,
                                    deliveryTo: newValue?.id || "",
                                    deliveryAddress: {
                                      ...formData.deliveryAddress,
                                      address: newValue?.address || formData.deliveryAddress.address,
                                    },
                                  })
                                }
                                renderInput={(params) => (
                                  <TextField {...params} label="Delivery To (Site Office)" size="small" />
                                )}
                                disabled={!formData.customer.id}
                              />
                            ) : (
                              <TextField
                                fullWidth
                                label="Delivery To"
                                value={formData.deliveryTo}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    deliveryTo: e.target.value,
                                  })
                                }
                                size="small"
                                placeholder={formData.customer.id ? "No site offices available" : "Select customer first"}
                                disabled={!formData.customer.id}
                              />
                            )}
                          </Grid>
                        )}

                        {/* Collect From for RDO */}
                        {documentType === "RDO" && (
                          <Grid item xs={12}>
                            <TextField
                              fullWidth
                              label="Collect From"
                              value={formData.collectFrom}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  collectFrom: e.target.value,
                                })
                              }
                              size="small"
                              placeholder="Enter collection location"
                            />
                          </Grid>
                        )}

                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            label={documentType === "RDO" ? "Collection Address" : "Delivery Address"}
                            value={formData.deliveryAddress.address}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                deliveryAddress: {
                                  ...formData.deliveryAddress,
                                  address: e.target.value,
                                },
                              })
                            }
                            size="small"
                            multiline
                            rows={2}
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            label={documentType === "RDO" ? "Return Instructions" : "Delivery Instructions"}
                            value={formData.deliveryAddress.instructions}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                deliveryAddress: {
                                  ...formData.deliveryAddress,
                                  instructions: e.target.value,
                                },
                              })
                            }
                            size="small"
                            multiline
                            rows={1}
                          />
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </TabPanel>
          )}

          {/* ITEMS SECTION - Always visible */}
          <Box sx={{ mt: 0.5, mx: 0.5, flex: 1, display: "flex", flexDirection: "column" }}>
            <Card sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <CardContent sx={{ p: 1, flex: 1, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.25 }}>
                  Items
                </Typography>
                <Divider />

                {/* Items Sub-tabs */}
                <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
                  <Tabs value={itemsTabValue} onChange={handleItemsTabChange} sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, py: 0 } }}>
                    <Tab label="Details" />
                    <Tab label="Footer" />
                  </Tabs>
                </Box>

                {/* ITEMS DETAILS TAB */}
                <TabPanel value={itemsTabValue} index={0}>
                  <Box>
                    <TableContainer>
                      <Table sx={{ tableLayout: 'fixed' }}>
                        <TableHead>
                          <TableRow>
                            {/* Render columns based on configuration - exclude tax for invoices */}
                            {(() => {
                              const isInvoiceType = documentType === "TI" || documentType === "TI2" || documentType === "INVOICE";
                              const defaultColumns = isInvoiceType
                                ? ["item", "description", "quantity", "unitPrice", "amount"]
                                : ["item", "description", "quantity", "unitPrice", "tax", "amount"];
                              return (isTemplateEditMode ? templateWatch("tableColumnOrder") : defaultColumns).map((columnId: string) => {
                                // Skip tax column for invoices
                                if (isInvoiceType && columnId === "tax") return null;
                                const isVisible = isTemplateEditMode ? templateWatch(`tableHeaders.${columnId}`) : true;
                              const label = isTemplateEditMode ? templateWatch(`columnLabels.${columnId}`) || columnId :
                                columnId === "item" ? "Item" :
                                columnId === "description" ? "Description" :
                                columnId === "quantity" ? "Quantity" :
                                columnId === "unitPrice" ? "Unit Price" :
                                columnId === "tax" ? "Tax %" :
                                columnId === "amount" ? "Amount" : columnId;

                              if (!isVisible) return null;

                              return (
                                <TableCell
                                  key={columnId}
                                  align={
                                    columnId === "quantity" || columnId === "unitPrice" || columnId === "tax" ? "center" :
                                    columnId === "amount" ? "right" : "left"
                                  }
                                  sx={{
                                    width: columnId === "description" ? "45%" :
                                           columnId === "item" ? "15%" :
                                           columnId === "quantity" ? "10%" :
                                           columnId === "unitPrice" ? "12%" :
                                           columnId === "tax" ? "8%" :
                                           columnId === "amount" ? "10%" : "auto"
                                  }}
                                >
                                  {label}
                                </TableCell>
                              );
                            });
                          })()}
                            <TableCell align="center" sx={{ width: "8%" }}>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {items.map((item: any, index: number) => (
                            <TableRow key={item.id}>
                              {/* Render cells based on configuration - exclude tax for invoices */}
                              {(() => {
                                const isInvoiceType = documentType === "TI" || documentType === "TI2" || documentType === "INVOICE";
                                const defaultColumns = isInvoiceType
                                  ? ["item", "description", "quantity", "unitPrice", "amount"]
                                  : ["item", "description", "quantity", "unitPrice", "tax", "amount"];
                                return (isTemplateEditMode ? templateWatch("tableColumnOrder") : defaultColumns).map((columnId: string) => {
                                  // Skip tax column for invoices
                                  if (isInvoiceType && columnId === "tax") return null;
                                  const isVisible = isTemplateEditMode ? templateWatch(`tableHeaders.${columnId}`) : true;
                                  if (!isVisible) return null;

                                if (columnId === "item") {
                                  return (
                                    <TableCell key={columnId}>
                                      <Autocomplete
                                        fullWidth
                                        freeSolo
                                        // Display the SKU based on the inventoryItemId
                                        value={(() => {
                                          if (item.inventoryItemId) {
                                            const inv = inventoriesForDocument.find(i => i.id === item.inventoryItemId);
                                            return inv ? inv.sku : item.itemCode || "";
                                          }
                                          return item.itemCode || "";
                                        })()}
                                        onChange={(event, newValue) => {
                                          console.log("Item autocomplete onChange triggered");
                                          console.log("Event:", event);
                                          console.log("New value:", newValue);
                                          console.log("Available inventories:", inventoriesForDocument);

                                          if (newValue === null || newValue === undefined) {
                                            // Clear selection
                                            updateItem(item.id, "inventoryItemId", "");
                                            updateItem(item.id, "itemCode", "");
                                            return;
                                          }

                                          // Check if the selected value matches an inventory SKU
                                          const selectedInventory = inventoriesForDocument.find(inv => inv.sku === newValue);
                                          console.log("Selected inventory found:", selectedInventory);

                                          if (selectedInventory) {
                                            // Save the inventory ID and display the SKU
                                            console.log("Setting inventory ID to:", selectedInventory.id);
                                            console.log("Setting item code to:", selectedInventory.sku);
                                            updateItem(item.id, "inventoryItemId", selectedInventory.id);
                                            updateItem(item.id, "itemCode", selectedInventory.sku);
                                            updateItem(item.id, "description", selectedInventory.name || selectedInventory.description || "");
                                            updateItem(item.id, "unitPrice", selectedInventory.unitPrice || 0);
                                          } else {
                                            // For custom text entry (freeSolo), clear inventory ID but keep the text
                                            console.log("Custom text entered:", newValue);
                                            updateItem(item.id, "inventoryItemId", "");
                                            updateItem(item.id, "itemCode", newValue || "");
                                          }
                                        }}
                                        // Remove onInputChange to avoid conflicts
                                        options={inventoriesForDocument.map(inv => inv.sku)}
                                        getOptionLabel={(option) => option || ""}
                                        size="small"
                                        sx={{ minWidth: 120 }}
                                        renderInput={(params) => (
                                          <TextField
                                            {...params}
                                            placeholder="Select or type SKU"
                                          />
                                        )}
                                      />
                                    </TableCell>
                                  );
                                } else if (columnId === "description") {
                                  return (
                                    <TableCell key={columnId} sx={{ verticalAlign: 'top', padding: '8px' }}>
                                      <Autocomplete
                                        fullWidth
                                        freeSolo
                                        value={item.description || ""}
                                        onChange={(_, newValue) => updateItem(item.id, "description", newValue || "")}
                                        onInputChange={(_, newInputValue) => updateItem(item.id, "description", newInputValue)}
                                        options={pastDescriptions}
                                        loading={isLoadingDescriptions}
                                        size="small"
                                        renderInput={(params) => (
                                          <TextField
                                            {...params}
                                            placeholder="Enter or select description"
                                            multiline
                                            minRows={1}
                                            maxRows={10}
                                            sx={{
                                              '& .MuiInputBase-root': {
                                                alignItems: 'flex-start',
                                                padding: '4px 0',
                                              },
                                              '& .MuiInputBase-input': {
                                                overflow: 'auto !important',
                                                textOverflow: 'initial !important',
                                                whiteSpace: 'pre-wrap !important',
                                                wordBreak: 'break-word !important',
                                                minHeight: '24px',
                                                lineHeight: '1.5',
                                                padding: '4px 8px !important',
                                              },
                                              '& .MuiAutocomplete-endAdornment': {
                                                alignSelf: 'flex-start',
                                                marginTop: '4px',
                                              },
                                            }}
                                            InputProps={{
                                              ...params.InputProps,
                                              endAdornment: (
                                                <>
                                                  {isLoadingDescriptions ? <CircularProgress color="inherit" size={20} /> : null}
                                                  {params.InputProps.endAdornment}
                                                </>
                                              ),
                                            }}
                                          />
                                        )}
                                      />
                                    </TableCell>
                                  );
                                } else if (columnId === "quantity") {
                                  return (
                                    <TableCell key={columnId} align="center">
                                      <TextField
                                        type="number"
                                        value={item.quantity}
                                        onChange={(e) => updateItem(item.id, "quantity", parseFloat(e.target.value))}
                                        size="small"
                                        sx={{ width: 80 }}
                                      />
                                    </TableCell>
                                  );
                                } else if (columnId === "unitPrice") {
                                  return (
                                    <TableCell key={columnId} align="center">
                                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                        <TextField
                                          type="number"
                                          value={item.unitPrice}
                                          onChange={(e) => updateItem(item.id, "unitPrice", parseFloat(e.target.value))}
                                          size="small"
                                          sx={{ width: 100 }}
                                        />
                                        {item.itemCode && (
                                          <IconButton
                                            size="small"
                                            onClick={() => handleShowPriceHistory(item.itemCode)}
                                            sx={{
                                              padding: 0.5,
                                              color: 'primary.main',
                                              '&:hover': { bgcolor: 'primary.lighter' }
                                            }}
                                            title="View price history"
                                          >
                                            <HistoryIcon fontSize="small" />
                                          </IconButton>
                                        )}
                                      </Box>
                                    </TableCell>
                                  );
                                } else if (columnId === "tax") {
                                  return (
                                    <TableCell key={columnId} align="center">
                                      <TextField
                                        type="number"
                                        value={item.tax}
                                        onChange={(e) => updateItem(item.id, "tax", parseFloat(e.target.value))}
                                        size="small"
                                        sx={{ width: 60 }}
                                      />
                                    </TableCell>
                                  );
                                } else if (columnId === "amount") {
                                  return (
                                    <TableCell key={columnId} align="right">
                                      {(item.amount || 0).toFixed(2)}
                                    </TableCell>
                                  );
                                } else {
                                  // Custom column - render as text field
                                  return (
                                    <TableCell key={columnId}>
                                      <TextField
                                        fullWidth
                                        value={item[columnId] || ""}
                                        onChange={(e) => updateItem(item.id, columnId, e.target.value)}
                                        size="small"
                                        placeholder={`Enter ${columnId}`}
                                      />
                                    </TableCell>
                                  );
                                }
                              });
                            })()}
                              <TableCell align="center">
                                <IconButton
                                  size="small"
                                  onClick={() => deleteItem(item.id)}
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

                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={addNewItem}
                      sx={{ mt: 2 }}
                      size="small"
                    >
                      Add Item
                    </Button>

                    {/* Totals */}
                    <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2 }}>
                      <Card sx={{ minWidth: 250, bgcolor: "grey.50" }}>
                        <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                            <Typography variant="body2">Subtotal:</Typography>
                            <Typography variant="body2" fontWeight="bold">SGD {subtotal.toFixed(2)}</Typography>
                          </Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                            <Typography variant="body2">
                              Tax{isInvoiceType ? ` (${organization?.taxRate || 9}%)` : ''}:
                            </Typography>
                            <Typography variant="body2">SGD {totalTax.toFixed(2)}</Typography>
                          </Box>
                          <Divider sx={{ my: 0.5 }} />
                          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                            <Typography variant="body2" fontWeight="bold">Total:</Typography>
                            <Typography variant="body2" fontWeight="bold" color="primary">
                              SGD {total.toFixed(2)}
                            </Typography>
                          </Box>
                        </CardContent>
                      </Card>
                    </Box>
                  </Box>
                </TabPanel>

                {/* ITEMS FOOTER TAB */}
                <TabPanel value={itemsTabValue} index={1}>
                  <Grid container spacing={2}>
                    {/* Notes - for all types */}
                    <Grid item xs={12} md={documentType === "QO1" ? 12 : 6}>
                      <TextField
                        fullWidth
                        label="Notes"
                        value={formData.note}
                        onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                        multiline
                        rows={documentType === "QO1" ? 3 : 4}
                        size="small"
                      />
                    </Grid>

                    {/* Terms & Conditions - for TI and QO1 */}
                    {(documentType === "TI" || documentType === "TI2" || documentType === "INVOICE" || documentType === "QO1") && (
                      <Grid item xs={12} md={documentType === "QO1" ? 12 : 6}>
                        <TextField
                          fullWidth
                          label="Terms & Conditions"
                          value={formData.termsAndConditions}
                          onChange={(e) =>
                            setFormData({ ...formData, termsAndConditions: e.target.value })
                          }
                          multiline
                          rows={documentType === "QO1" ? 3 : 4}
                          size="small"
                        />
                      </Grid>
                    )}

                    {/* Quotation-specific fields */}
                    {documentType === "QO1" && (
                      <>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            label="Remarks"
                            value={formData.remarks}
                            onChange={(e) =>
                              setFormData({ ...formData, remarks: e.target.value })
                            }
                            multiline
                            rows={3}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            label="Agreement Text"
                            value={formData.agreementText || "You understand and agree to the above quotation and terms."}
                            onChange={(e) =>
                              setFormData({ ...formData, agreementText: e.target.value })
                            }
                            multiline
                            rows={2}
                            size="small"
                            placeholder="e.g., You understand and agree to the above quotation and terms."
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            label="Title"
                            value={formData.title}
                            onChange={(e) =>
                              setFormData({ ...formData, title: e.target.value })
                            }
                            size="small"
                            placeholder="Enter quotation title"
                          />
                        </Grid>
                      </>
                    )}

                    {/* Bank Details - for TI only */}
                    {(documentType === "TI" || documentType === "TI2" || documentType === "INVOICE") && (
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Bank Details"
                          value={formData.bankDetails}
                          onChange={(e) => setFormData({ ...formData, bankDetails: e.target.value })}
                          multiline
                          rows={3}
                          size="small"
                        />
                      </Grid>
                    )}
                  </Grid>
                </TabPanel>
              </CardContent>
            </Card>
          </Box>
          </Box>
        ) : (
          // PREVIEW MODE - Show clean document layout
          <Box sx={{ flex: 1, overflow: "auto", p: 2, bgcolor: "grey.100" }}>
            <CleanDocumentPreview
              documentType={documentType}
              data={{
                ...formData,
                items: items,
                logo: organization?.logo, // Pass the logo from organization
              }}
              organization={organization}
            />
          </Box>
        )}
      </Box>

      {/* PDF Generation Dialog */}
      <Dialog
        open={pdfDialogOpen}
        onClose={() => !isGeneratingPdf && setPdfDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <PdfIcon color="primary" />
            Document PDF
          </Box>
        </DialogTitle>
        <DialogContent>
          {isGeneratingPdf ? (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 3 }}>
              <CircularProgress size={48} />
              <Typography sx={{ mt: 2 }}>Generating PDF...</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Please wait while we create your document
              </Typography>
            </Box>
          ) : pdfUrl ? (
            <Box sx={{ py: 2 }}>
              <Typography variant="body1" gutterBottom>
                Your PDF has been generated successfully!
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                The document is ready for download or printing.
              </Typography>

              <Box sx={{ display: "flex", gap: 2, justifyContent: "center" }}>
                <Button
                  variant="contained"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownloadPdf}
                  size="large"
                  fullWidth
                >
                  Open PDF
                </Button>
              </Box>

              <Typography variant="caption" display="block" sx={{ mt: 3, textAlign: "center", color: "text.secondary" }}>
                The PDF will open in a new tab where you can view, download, or print it.
              </Typography>
            </Box>
          ) : (
            <Typography>Error generating PDF. Please try again.</Typography>
          )}
        </DialogContent>
        {!isGeneratingPdf && (
          <DialogActions>
            <Button onClick={() => setPdfDialogOpen(false)}>Close</Button>
            {pdfUrl && (
              <Button variant="outlined" startIcon={<PrintIcon />} onClick={handleDownloadPdf}>
                Open Again
              </Button>
            )}
          </DialogActions>
        )}
      </Dialog>

      {/* Back Button Confirmation Dialog */}
      <Dialog
        open={backConfirmDialogOpen}
        onClose={() => setBackConfirmDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
            p: 1,
          }
        }}
      >
        <DialogContent>
          <Typography variant="body1" sx={{ textAlign: 'center', fontWeight: 500 }}>
            Do you want to <strong>save this {getDocumentTitle().toLowerCase()} as draft</strong> or <strong>delete</strong> it?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', gap: 1, pb: 2 }}>
          <Button
            onClick={() => setBackConfirmDialogOpen(false)}
            variant="text"
            color="inherit"
            sx={{
              color: 'text.secondary',
              textTransform: 'uppercase',
              fontWeight: 500,
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveAsDraft}
            variant="text"
            sx={{
              color: '#4CAF50',
              textTransform: 'uppercase',
              fontWeight: 500,
            }}
          >
            Save as Draft
          </Button>
          <Button
            onClick={handleDelete}
            variant="text"
            sx={{
              color: '#f44336',
              textTransform: 'uppercase',
              fontWeight: 500,
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Document Dialog */}
      <Dialog
        open={confirmDialogOpen}
        onClose={() => !isConfirming && setConfirmDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Confirm Document</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Are you sure you want to confirm this document? Once confirmed:
          </Typography>
          <Box component="ul" sx={{ pl: 2 }}>
            <Typography component="li" variant="body2" sx={{ mb: 1 }}>
              The document will be locked and cannot be edited
            </Typography>
            <Typography component="li" variant="body2" sx={{ mb: 1 }}>
              Any changes will require creating a revision
            </Typography>
            <Typography component="li" variant="body2">
              The document status will change to &quot;Confirmed&quot;
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialogOpen(false)} disabled={isConfirming}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDocument}
            variant="contained"
            color="success"
            disabled={isConfirming}
            startIcon={isConfirming ? <CircularProgress size={16} /> : <CheckCircleIcon />}
          >
            {isConfirming ? "Confirming..." : "Confirm Document"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Price History Popup */}
      <PriceHistoryPopup
        open={priceHistoryDialogOpen}
        onClose={() => setPriceHistoryDialogOpen(false)}
        assetId={selectedAssetId}
        itemCode={selectedItemCode}
        itemDescription={
          items.find((item: any) => item.itemCode === selectedItemCode)?.description || selectedItemCode
        }
        customerId={formData.customer?.id}
        onSelectPrice={(price, quantity) => {
          // Find the item and update its price
          const itemToUpdate = items.find((item: any) => item.itemCode === selectedItemCode);
          if (itemToUpdate) {
            updateItem(itemToUpdate.id, 'unitPrice', price);
            updateItem(itemToUpdate.id, 'quantity', quantity);
          }
          setPriceHistoryDialogOpen(false);
        }}
      />
    </Box>
  );
}