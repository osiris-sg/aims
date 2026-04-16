"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  Email as EmailIcon,
  Payment as PaymentIcon,
  NavigateBefore as NavigateBeforeIcon,
  NavigateNext as NavigateNextIcon,
  Inventory as InventoryIcon,
  Search as SearchIcon,
  LocalShipping as ReceiveIcon,
} from "@mui/icons-material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import CleanDocumentPreview from "./CleanDocumentPreview";
import RichTextDescription from "./RichTextDescription";
import DocumentCustomizer from "./DocumentCustomizer";
import DynamicFormFields from "./DynamicFormFields";
import StockCardDialog from "./StockCardDialog";
import LocateDocumentDialog from "./LocateDocumentDialog";
import ExtractQuotationDialog from "./ExtractQuotationDialog";
import ExtractDOToInvoiceDialog from "./ExtractDOToInvoiceDialog";
import ExtractQuotationToSODialog from "./ExtractQuotationToSODialog";
import ConfirmPODialog, { ConfirmPOData } from "./ConfirmPODialog";
import ConfirmAdjustmentDialog, { ConfirmAdjustmentData } from "./ConfirmAdjustmentDialog";
import ConfirmDODialog, { ConfirmDOData } from "./ConfirmDODialog";
import ConfirmPRDialog, { ConfirmPRData } from "./ConfirmPRDialog";
import ConfirmInvoiceDialog, { ConfirmInvoiceData } from "./ConfirmInvoiceDialog";
import CustomerSelectDialog from "./CustomerSelectDialog";
import SalesmanSelectDialog from "./SalesmanSelectDialog";
import PriceHistoryPopup from "@/components/PriceHistory/PriceHistoryPopup";
import SendInvoiceEmailDialog from "@/app/portal/invoices/components/SendInvoiceEmailDialog";
import RecordPaymentDialog from "@/app/portal/invoices/components/RecordPaymentDialog";
import { useAuth, useUser } from "@clerk/nextjs";
import { useReactToPrint } from "react-to-print";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import { useForm, Controller } from "react-hook-form";
import { usePathname, useRouter } from "next/navigation";
import { usePastDescriptions } from "../hooks/usePastDescriptions";
import { useGetInventoriesForItemTable } from "../hooks/useGetInventoriesForItemTable";
import { getTemplateFormFields } from "../utils/templateFieldSync";
import { useGetDocuments } from "@/app/portal/hooks/api";
import { TemplateFieldConfig } from "../types/templateFieldTypes";

// Helper to determine the parent route based on document type
const getParentRoute = (docType: string): string => {
  const inventoryTypes = ["PO", "PURCHASE_ORDER", "PR", "PURCHASE_RETURN", "SAI", "STOCK_ADJUSTMENT_IN", "SAO", "STOCK_ADJUSTMENT_OUT"];
  const upperType = docType?.toUpperCase() || "";

  if (inventoryTypes.includes(upperType)) {
    return "/portal/inventory";
  }
  // Default to sales for all other document types
  return "/portal/sales";
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
      {value === index && <Box sx={{ p: 0.5 }}>{children}</Box>}
    </div>
  );
}

interface DocumentCreatorProps {
  documentType: "QO1" | "DO" | "RDO" | "TI" | "TI2" | "MSR" | "INVOICE" | string;
  actualDocumentType?: string; // The actual document type (INVOICE, QUOTATION, etc.) for creating documents
  documentId?: string;
  templateId?: string; // Template ID for fetching custom field definitions
  fieldDefinitions?: TemplateFieldConfig; // Optional pre-loaded field definitions
  onSave?: (data: any) => void;
  onPrint?: () => void;
  existingData?: any;
  customers?: any[];
  suppliers?: any[];
  projects?: any[];
  deliveryOrders?: any[];
  siteOffices?: any[];
  salesmen?: any[];
  onCustomerChange?: (customerId: string) => void;
  organization?: any;
  // Navigation props for Previous/Next document navigation
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  // Callback when a new document is created (for refetching document list)
  onDocumentCreated?: () => void;
  // Force preview mode on initial render (used by view/print page)
  initialPreviewMode?: boolean;
}

export default function TabbedDocumentCreator({
  documentType,
  actualDocumentType,
  onSave,
  onPrint,
  existingData,
  customers = [],
  suppliers = [],
  projects = [],
  deliveryOrders = [],
  siteOffices = [],
  salesmen = [],
  documentId,
  templateId,
  fieldDefinitions: propFieldDefinitions,
  onCustomerChange,
  organization,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  onDocumentCreated,
  initialPreviewMode = false,
}: DocumentCreatorProps) {
  const { isServiceItemsEnabled } = useOrganizationFeatures();

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

  // Force preview mode for confirmed documents or when initialPreviewMode is set
  const [previewMode, setPreviewMode] = useState(isDocumentConfirmed || initialPreviewMode);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmPODialogOpen, setConfirmPODialogOpen] = useState(false);
  const [confirmAdjustmentDialogOpen, setConfirmAdjustmentDialogOpen] = useState(false);
  const [confirmDODialogOpen, setConfirmDODialogOpen] = useState(false);
  const [confirmPRDialogOpen, setConfirmPRDialogOpen] = useState(false);
  const [confirmInvoiceDialogOpen, setConfirmInvoiceDialogOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isToolBarOpen, setToolBarOpen] = useState(false);

  // PDF generation states
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Browser print ref for CleanDocumentPreview
  const printContentRef = useRef<HTMLDivElement>(null);
  const printDocumentTitle = existingData?.documentNumber || existingData?.name || documentId || "Document";
  const handleBrowserPrint = useReactToPrint({
    contentRef: printContentRef,
    documentTitle: printDocumentTitle,
    pageStyle: `
      @page {
        size: A4;
        margin: 20mm 15mm;
        @top-left { content: ""; }
        @top-center { content: ""; }
        @top-right { content: ""; }
        @bottom-left { content: ""; }
        @bottom-center { content: ""; }
        @bottom-right { content: ""; }
      }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
        /* Templates that previously simulated page margins via Paper padding
           should drop that padding when printing so margins aren't doubled. */
        [data-print-paper] { padding: 0 !important; }
      }
    `,
  });

  // Back button confirmation dialog
  const [backConfirmDialogOpen, setBackConfirmDialogOpen] = useState(false);

  // Send email dialog state
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false);

  // Payment dialog state
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  // Price history popup state
  const [priceHistoryDialogOpen, setPriceHistoryDialogOpen] = useState(false);
  const [selectedItemCode, setSelectedItemCode] = useState<string>("");
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const [priceHistoryCache, setPriceHistoryCache] = useState<Record<string, any>>({});

  // Stock card dialog state
  const [stockCardDialogOpen, setStockCardDialogOpen] = useState(false);

  // Locate document dialog state
  const [locateDialogOpen, setLocateDialogOpen] = useState(false);

  // Extract quotation dialog state (for Delivery Orders)
  const [extractQuotationDialogOpen, setExtractQuotationDialogOpen] = useState(false);
  const [extractDODialogOpen, setExtractDODialogOpen] = useState(false);
  const [extractQuotationToSODialogOpen, setExtractQuotationToSODialogOpen] = useState(false);
  const [deliveryOrdersForExtract, setDeliveryOrdersForExtract] = useState<any[]>([]);
  const [quotationsForExtract, setQuotationsForExtract] = useState<any[]>([]);

  // Receiving mode state (for Purchase Orders and Purchase Returns)
  const [isReceiving, setIsReceiving] = useState(false);
  const isPurchaseOrder = documentType === "PO" || documentType === "PURCHASE_ORDER";
  const isPurchaseReturn = documentType === "PR" || documentType === "PURCHASE_RETURN";
  const isPurchaseDocument = isPurchaseOrder || isPurchaseReturn;
  const isStockAdjustmentIn = documentType === "SAI" || documentType === "STOCK_ADJUSTMENT_IN";
  const isStockAdjustmentOut = documentType === "SAO" || documentType === "STOCK_ADJUSTMENT_OUT";
  const isStockAdjustment = isStockAdjustmentIn || isStockAdjustmentOut;
  const isDeliveryOrder = documentType === "DO" || documentType === "DELIVERY_ORDER";

  // Customer select dialog state
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [customerFieldName, setCustomerFieldName] = useState<string>("customer"); // Track which field opened the dialog
  const [customerStoreMode, setCustomerStoreMode] = useState<"object" | "code">("object"); // How to store the selected customer
  const [isSupplierDialog, setIsSupplierDialog] = useState(false); // Whether the dialog is for supplier selection

  // Salesman select dialog state
  const [salesmanDialogOpen, setSalesmanDialogOpen] = useState(false);
  const [salesmanFieldName, setSalesmanFieldName] = useState<string>("documentInfo.salesPerson"); // Track which field opened the dialog

  // Dynamic form field configuration
  const [templateFieldConfig, setTemplateFieldConfig] = useState<TemplateFieldConfig | null>(null);
  const [isLoadingFieldConfig, setIsLoadingFieldConfig] = useState(true);

  const { getToken } = useAuth();
  const { user } = useUser();

  // Past descriptions history hook
  const { pastDescriptions, isLoading: isLoadingDescriptions } = usePastDescriptions();

  // Inventory items for item table
  const { inventoriesForDocument } = useGetInventoriesForItemTable();

  // All documents for locate dialog
  const { documents: allDocuments } = useGetDocuments();

  // Filter documents for the locate dialog (same document type)
  const documentsForLocate = useMemo(() => {
    // Get the template ID from the current document
    const templateId = existingData?.documentTemplateId || pathSegments[3];
    if (!templateId || !allDocuments) return [];

    // Filter documents by the same template ID and sort by createdAt (newest first)
    return allDocuments
      .filter((doc: any) => doc.templateId === templateId)
      .sort((a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }, [allDocuments, existingData?.documentTemplateId, pathSegments]);


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
      id: existingData?.customer?.id || existingData?.customerId || "",
      name: existingData?.customer?.name || existingData?.customerName || "",
      address: existingData?.customer?.address || existingData?.customerAddress || "",
      email: existingData?.customer?.email || "",
      customerCode: existingData?.customer?.customerCode || existingData?.customerCode || "",
      gstRegNo: existingData?.customer?.gstRegNo || existingData?.customerGstRegNo || "",
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
      currency: existingData?.documentInfo?.currency || existingData?.currency || "SGD",
      qinRef: existingData?.documentInfo?.qinRef || existingData?.qinRef || "",
      // Additional fields for quotation extraction
      contact: existingData?.documentInfo?.contact || existingData?.contact || "",
      rate: existingData?.documentInfo?.rate || existingData?.rate || "",
      taxApplicable: existingData?.documentInfo?.taxApplicable ?? existingData?.taxApplicable ?? false,
      absorbTax: existingData?.documentInfo?.absorbTax ?? existingData?.absorbTax ?? false,
      gstPercent: existingData?.documentInfo?.gstPercent ?? existingData?.gstPercent ?? 0,
      // DO-specific fields
      issueBy: existingData?.documentInfo?.issueBy || existingData?.issueBy || "",
    },
    // Flat issueBy for direct access
    issueBy: existingData?.issueBy || existingData?.documentInfo?.issueBy || "",
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
    billTo: existingData?.billTo || "",
    deliveryTo: existingData?.deliveryTo || "",
    // Items data
    items: existingData?.items || [],
    // Source document tracking (for quotation/DO extraction)
    sourceDocumentId: existingData?.sourceDocumentId || "",
    sourceDocumentType: existingData?.sourceDocumentType || "",
    sourceDocumentNumber: existingData?.sourceDocumentNumber || "",
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
        // If field definitions are provided as props, use them directly
        if (propFieldDefinitions) {
          console.log('Using prop field definitions');
          setTemplateFieldConfig(propFieldDefinitions);
          setIsLoadingFieldConfig(false);
          return;
        }

        setIsLoadingFieldConfig(true);
        const token = await getToken();
        if (!token) {
          setIsLoadingFieldConfig(false);
          return;
        }

        // Try to get template ID from various sources
        const effectiveTemplateId = templateId || existingData?.documentTemplateId || existingData?.templateId;

        // Get field configuration for this template
        // Pass documentType as fallback for variant, and template ID if available
        const config = await getTemplateFormFields(
          documentType,        // template variant (TI, TI2, DO, etc.)
          effectiveTemplateId, // template ID for fetching from database
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
  }, [documentType, templateId, existingData?.documentTemplateId, existingData?.templateId, propFieldDefinitions, getToken]);

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

    // If no existing items, start with empty array - rows appear only when user adds items
    return [];
  });

  // Track initial form state for change detection
  const initialFormStateRef = useRef<{ formData: any; items: any[] } | null>(null);

  // Capture initial state when component mounts or existingData changes
  useEffect(() => {
    // Create a snapshot of the initial state for comparison
    const initialSnapshot = {
      formData: JSON.parse(JSON.stringify(formData)),
      items: JSON.parse(JSON.stringify(items)),
    };
    initialFormStateRef.current = initialSnapshot;
  }, [existingData]); // Only re-capture when existingData changes (document load)

  // Fill in customer details from customers list if missing
  useEffect(() => {
    // Only run if we have a customer ID and customers list is loaded
    if (formData.customer?.id && customers?.length > 0) {
      const customer = customers.find((c: any) => c.id === formData.customer.id);
      if (customer) {
        const needsUpdate = !formData.customer?.address || !formData.customer?.customerCode;
        if (needsUpdate) {
          console.log('Filling in missing customer details from customers list:', customer);
          setFormData((prev: any) => ({
            ...prev,
            customer: {
              ...prev.customer,
              address: prev.customer?.address || customer.address || "",
              customerCode: prev.customer?.customerCode || customer.customerCode || "",
              name: prev.customer?.name || customer.name || "",
            },
            // Also set billTo if it's empty
            billTo: prev.billTo || customer.address || "",
          }));
        }
      }
    }
  }, [customers, formData.customer?.id, formData.customer?.address, formData.customer?.customerCode]);

  // Fill in company details from organization if missing
  useEffect(() => {
    if (organization && !formData.company?.gstRegNo) {
      console.log('Filling in company gstRegNo from organization:', organization.registrationNumber);
      setFormData((prev: any) => ({
        ...prev,
        company: {
          ...prev.company,
          name: prev.company?.name || organization.name || "",
          address: prev.company?.address || organization.address || "",
          phoneNumber: prev.company?.phoneNumber || organization.phoneNumber || "",
          gstRegNo: organization.registrationNumber || "",
        },
      }));
    }
  }, [organization, formData.company?.gstRegNo]);

  // Sync documentInfo fields from existingData when it loads async
  useEffect(() => {
    if (existingData?.documentInfo) {
      console.log("=== SYNC documentInfo from existingData ===");
      console.log("existingData.documentInfo:", JSON.stringify(existingData.documentInfo));
      console.log("existingData.documentInfo.gstPercent:", existingData.documentInfo.gstPercent);
      console.log("existingData.documentInfo.currency:", existingData.documentInfo.currency);
      setFormData((prev: any) => {
        const merged = {
          ...prev,
          documentInfo: {
            ...prev.documentInfo,
            ...existingData.documentInfo,
          },
        };
        console.log("merged documentInfo.gstPercent:", merged.documentInfo.gstPercent);
        return merged;
      });
    }
  }, [existingData?.documentInfo]);

  // Function to check if form has changes compared to initial state
  const hasFormChanges = useCallback((): boolean => {
    if (!initialFormStateRef.current) return false;

    const initial = initialFormStateRef.current;

    // Compare formData (excluding tracking fields that change on save)
    const currentFormDataStr = JSON.stringify({
      ...formData,
      savedBy: undefined,
      savedAt: undefined,
      lastUsedBy: undefined,
      lastUsedAt: undefined,
    });
    const initialFormDataStr = JSON.stringify({
      ...initial.formData,
      savedBy: undefined,
      savedAt: undefined,
      lastUsedBy: undefined,
      lastUsedAt: undefined,
    });

    if (currentFormDataStr !== initialFormDataStr) {
      console.log('Form data changed');
      return true;
    }

    // Compare items (excluding id which is generated dynamically)
    const normalizeItems = (itemsList: any[]) =>
      itemsList.map(({ id, ...rest }) => rest);

    const currentItemsStr = JSON.stringify(normalizeItems(items));
    const initialItemsStr = JSON.stringify(normalizeItems(initial.items));

    if (currentItemsStr !== initialItemsStr) {
      console.log('Items changed');
      return true;
    }

    return false;
  }, [formData, items]);

  const addNewItem = () => {
    const isInvoiceType = documentType === "TI" || documentType === "TI2" || documentType === "INVOICE";
    const isStockAdjustmentIn = documentType === "SAI" || documentType === "STOCK_ADJUSTMENT_IN";
    const isStockAdjustmentOut = documentType === "SAO" || documentType === "STOCK_ADJUSTMENT_OUT";
    const isStockAdjustment = isStockAdjustmentIn || isStockAdjustmentOut;
    const isPurchaseOrderType = documentType === "PO" || documentType === "PURCHASE_ORDER" || documentType === "QT" || documentType === "QUOTATION" || documentType === "QO" || documentType === "QO1" || documentType === "QO2";
    const isDeliveryOrderType = documentType === "DO" || documentType === "DELIVERY_ORDER" || documentType === "RDO" || documentType === "RETURN_DELIVERY_ORDER";
    const needsUom = isStockAdjustment || isPurchaseOrderType || isDeliveryOrderType;
    const needsDiscount = isStockAdjustment || isPurchaseOrderType;
    setItems([
      ...items,
      {
        id: Date.now(),
        itemCode: "",
        inventoryItemId: "",  // Changed from inventoryId to inventoryItemId
        description: "",
        quantity: 1,
        unitPrice: 0,
        // Only include tax for non-invoice, non-stock-adjustment, and non-PO types
        tax: isInvoiceType || needsUom ? undefined : 9,
        // Include uom for stock adjustment, PO, and DO types
        uom: needsUom ? "" : undefined,
        // Include discount for stock adjustment and PO types only
        discount: needsDiscount ? 0 : undefined,
        // Include receivedQty for stock adjustment in
        receivedQty: isStockAdjustmentIn ? 0 : undefined,
        amount: 0,
      },
    ]);
  };

  // Handle item selection from Stock Card dialog
  const handleStockCardItemSelect = (selectedItem: any) => {
    const isInvoiceType = documentType === "TI" || documentType === "TI2" || documentType === "INVOICE";
    const isStockAdjustmentIn = documentType === "SAI" || documentType === "STOCK_ADJUSTMENT_IN";
    const isStockAdjustmentOut = documentType === "SAO" || documentType === "STOCK_ADJUSTMENT_OUT";
    const isStockAdjustmentType = isStockAdjustmentIn || isStockAdjustmentOut;
    const isPurchaseOrderType = documentType === "PO" || documentType === "PURCHASE_ORDER" || documentType === "QT" || documentType === "QUOTATION" || documentType === "QO" || documentType === "QO1" || documentType === "QO2";
    const isPurchaseReturnType = documentType === "PR" || documentType === "PURCHASE_RETURN";
    const isDeliveryOrderType = documentType === "DO" || documentType === "DELIVERY_ORDER" || documentType === "RDO" || documentType === "RETURN_DELIVERY_ORDER";
    const isCreditDebitNoteType = documentType === "CN" || documentType === "CREDIT_NOTE" || documentType === "DN" || documentType === "DEBIT_NOTE";
    const needsUom = isStockAdjustmentType || isPurchaseOrderType || isPurchaseReturnType || isDeliveryOrderType || isCreditDebitNoteType;
    const needsDiscount = isStockAdjustmentType || isPurchaseOrderType || isPurchaseReturnType;
    const description = selectedItem.description || selectedItem.name || selectedItem.asset?.name || selectedItem.asset?.description || "";
    const unitPrice = selectedItem.unitPrice || selectedItem.asset?.price || 0;
    const uom = selectedItem.uom || selectedItem.asset?.uom || "";

    const newItem: any = {
      id: Date.now(),
      itemCode: selectedItem.sku || "",
      inventoryItemId: selectedItem.id || "",
      description: description,
      quantity: 1,
      unitPrice: unitPrice,
      amount: unitPrice, // quantity is 1, so amount equals unitPrice
    };

    // Add uom for stock adjustment, PO, PR, and DO types
    if (needsUom) {
      newItem.uom = uom;
      // Add discount only for stock adjustment, PO, and PR types
      if (needsDiscount) {
        newItem.discount = 0;
      }
      // Add receivedQty for stock adjustment in and purchase return
      if (isStockAdjustmentIn || isPurchaseReturnType) {
        newItem.receivedQty = 0;
      }
    } else {
      newItem.tax = isInvoiceType ? undefined : 9;
    }

    setItems([...items, newItem]);

    // Prefetch price history for this asset if available
    if (selectedItem.assetId) {
      prefetchPriceHistory(selectedItem.assetId);
    }
  };

  const deleteItem = (id: number) => {
    setItems(items.filter((item: any) => item.id !== id));
  };

  const updateItem = (id: number, field: string, value: any) => {
    setItems((prevItems: any[]) => {
      const newItems = prevItems.map((item: any) => {
        if (item.id === id) {
          const updated = { ...item, [field]: value };
          // Calculate amount (accounting for discount if present)
          const discountMultiplier = updated.discount !== undefined ? (1 - (updated.discount || 0) / 100) : 1;
          updated.amount = updated.quantity * updated.unitPrice * discountMultiplier;
          return updated;
        }
        return item;
      });
      return newItems;
    });
  };

  // Calculations - use organization tax rate for invoices
  const isInvoiceType = documentType === "TI" || documentType === "TI2" || documentType === "INVOICE";
  const isCreditDebitNote = documentType === "CN" || documentType === "CREDIT_NOTE" || documentType === "DN" || documentType === "DEBIT_NOTE";
  const subtotal = items.reduce((acc: number, item: any) => acc + (item.amount || 0), 0);

  // Check if tax is applicable (from form Tax Y/N toggle)
  const isTaxApplicable = formData?.documentInfo?.taxApplicable !== 'N' && formData?.documentInfo?.taxApplicable !== false;

  // For invoices: use per-item tax if available (Xero imports), else org tax rate
  const hasItemLevelTax = isInvoiceType && items.some((item: any) => item.tax !== undefined && item.tax !== null && item.tax !== "");
  const isAbsorbTax = formData?.documentInfo?.absorbTax === 'Y' || formData?.documentInfo?.absorbTax === true;
  const taxRate = isInvoiceType && !hasItemLevelTax
    ? (organization?.taxRate || 9)
    : 0;
  const itemTaxTotal = items.reduce((acc: number, item: any) => acc + (item.amount || 0) * (parseFloat(item.tax || "0") / 100), 0);

  const totalTax = !isTaxApplicable ? 0
    : isAbsorbTax
    ? subtotal * taxRate / (100 + taxRate) // back-calculate GST from within
    : isInvoiceType && !hasItemLevelTax
    ? subtotal * (taxRate / 100)
    : itemTaxTotal;

  const total = isAbsorbTax ? subtotal : subtotal + totalTax;

  // Auto-calculate right-column summary fields when items/tax change
  useEffect(() => {
    const di = formData?.documentInfo as any;
    const discountPercent = parseFloat(di?.discountPercent) || 0;
    const grossTotal = subtotal;
    const discountAmount = grossTotal * (discountPercent / 100);
    const subTotalAfterDiscount = grossTotal - discountAmount;
    const gstPercent = isTaxApplicable ? (parseFloat(di?.gstPercent) || organization?.taxRate || 9) : 0;

    let gstAmount: number;
    let nettTotal: number;

    if (isAbsorbTax && gstPercent > 0) {
      // Absorb tax: total stays the same, GST is back-calculated from within
      // nettTotal = subTotalAfterDiscount (the item total IS the final total)
      // gstAmount = nettTotal × gstPercent / (100 + gstPercent)
      nettTotal = subTotalAfterDiscount;
      gstAmount = nettTotal * gstPercent / (100 + gstPercent);
    } else {
      // Normal: GST added on top
      gstAmount = subTotalAfterDiscount * (gstPercent / 100);
      nettTotal = subTotalAfterDiscount + gstAmount;
    }

    setFormData((prev: any) => ({
      ...prev,
      documentInfo: {
        ...prev.documentInfo,
        grossTotal: parseFloat(grossTotal.toFixed(2)),
        discountAmount: parseFloat(discountAmount.toFixed(2)),
        subTotal: isAbsorbTax ? parseFloat((subTotalAfterDiscount - gstAmount).toFixed(2)) : parseFloat(subTotalAfterDiscount.toFixed(2)),
        gstAmount: parseFloat(gstAmount.toFixed(2)),
        nettTotal: parseFloat(nettTotal.toFixed(2)),
      },
    }));
  }, [subtotal, (formData?.documentInfo as any)?.discountPercent, (formData?.documentInfo as any)?.gstPercent, formData?.documentInfo?.taxApplicable, formData?.documentInfo?.absorbTax, isTaxApplicable, isAbsorbTax]);

  const handleMainTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setMainTabValue(newValue);
  };

  const handleItemsTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setItemsTabValue(newValue);
  };

  const getDocumentTitle = () => {
    const titles: Record<string, string> = {
      QO1: "Quotation",
      QUOTATION: "Quotation",
      QT: "Quotation",
      QO: "Quotation",
      DO: "Delivery Order",
      DELIVERY_ORDER: "Delivery Order",
      RDO: "Return Delivery Order",
      TI: "Tax Invoice",
      TI2: "Tax Invoice",
      INVOICE: "Tax Invoice",
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
    // Switch to preview mode first if not already, then trigger browser print
    if (!previewMode) {
      setPreviewMode(true);
      // Wait for preview to render before printing
      setTimeout(() => {
        handleBrowserPrint();
      }, 500);
    } else {
      handleBrowserPrint();
    }
  };

  // Prefetch price history for an asset
  const prefetchPriceHistory = async (assetId: string) => {
    // Skip if already cached
    if (priceHistoryCache[assetId]) {
      return;
    }

    try {
      const token = await getToken();
      if (!token) return;

      const queryParams = new URLSearchParams();
      if (formData.customer?.id) queryParams.append('customerId', formData.customer.id);
      queryParams.append('limit', '10');
      queryParams.append('offset', '0');

      const response = await request(
        {
          path: `/price-history/asset/${assetId}?${queryParams.toString()}`,
          method: 'GET',
        },
        {},
        token
      );

      if (response?.success && response.data) {
        setPriceHistoryCache(prev => ({
          ...prev,
          [assetId]: response.data
        }));
      }
    } catch (error) {
      console.error('Error prefetching price history:', error);
    }
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
      // Get current user info for tracking
      const currentUserName = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || 'SYS';
      const currentTimestamp = new Date().toISOString();

      // First save the document with current data if not saved
      const saveData = {
        ...formData,
        items: items,
        name: formData.name || formData.documentInfo.documentNumber,
        status: "confirmed",
        // Tracking info
        confirmedBy: currentUserName,
        confirmedAt: currentTimestamp,
        lastUsedBy: currentUserName,
        lastUsedAt: currentTimestamp,
      };

      // Call onSave with confirmed status
      await onSave?.(saveData);

      toast.success("Document confirmed successfully");
      setConfirmDialogOpen(false);

      // Full page reload to update the status
      window.location.reload();
    } catch (error) {
      console.error("Error confirming document:", error);
      toast.error("Failed to confirm document");
    } finally {
      setIsConfirming(false);
    }
  };

  // Handle PO confirmation with supplier D/O info
  const handleConfirmPO = async (poData: ConfirmPOData) => {
    setIsConfirming(true);
    try {
      // Get current user info for tracking
      const currentUserName = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || 'SYS';
      const currentTimestamp = new Date().toISOString();

      // Prepare save data with PO-specific fields
      const saveData = {
        ...formData,
        items: items,
        name: formData.name || formData.documentInfo?.documentNumber,
        status: "confirmed",
        // Supplier D/O info from the dialog
        supplierDONo: poData.supplierDONo,
        supplierDODate: poData.supplierDODate,
        exchangeRate: poData.rate,
        linkToAccounts: poData.linkToAccounts,
        // Tracking info
        confirmedBy: currentUserName,
        confirmedAt: currentTimestamp,
        lastUsedBy: currentUserName,
        lastUsedAt: currentTimestamp,
      };

      // Call onSave with confirmed status
      await onSave?.(saveData);

      const docLabel = isPurchaseReturn ? "Purchase Return" : "Purchase Order";
      toast.success(`${docLabel} confirmed and stock updated`);
      setConfirmPODialogOpen(false);

      // Full page reload to update the status
      window.location.reload();
    } catch (error) {
      console.error("Error confirming PO/PR:", error);
      const docLabel = isPurchaseReturn ? "Purchase Return" : "Purchase Order";
      toast.error(`Failed to confirm ${docLabel}`);
    } finally {
      setIsConfirming(false);
    }
  };

  // Handle Stock Adjustment confirmation
  const handleConfirmAdjustment = async (adjustmentData: ConfirmAdjustmentData) => {
    setIsConfirming(true);
    try {
      // Get current user info for tracking
      const currentUserName = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || 'SYS';
      const currentTimestamp = new Date().toISOString();

      // Prepare save data with adjustment-specific fields
      const saveData = {
        ...formData,
        items: items,
        name: formData.name || formData.documentInfo?.documentNumber,
        status: "confirmed",
        // Adjustment reference info from the dialog
        fromReferenceNo: adjustmentData.fromReferenceNo,
        toReferenceNo: adjustmentData.toReferenceNo,
        deleteConfirmedReference: adjustmentData.deleteConfirmedReference,
        // Tracking info
        confirmedBy: currentUserName,
        confirmedAt: currentTimestamp,
        lastUsedBy: currentUserName,
        lastUsedAt: currentTimestamp,
      };

      // Call onSave with confirmed status
      await onSave?.(saveData);

      const docLabel = isStockAdjustmentIn ? "Stock Adjustment In" : "Stock Adjustment Out";
      toast.success(`${docLabel} confirmed and stock updated`);
      setConfirmAdjustmentDialogOpen(false);

      // Full page reload to update the status
      window.location.reload();
    } catch (error) {
      console.error("Error confirming adjustment:", error);
      const docLabel = isStockAdjustmentIn ? "Stock Adjustment In" : "Stock Adjustment Out";
      toast.error(`Failed to confirm ${docLabel}`);
    } finally {
      setIsConfirming(false);
    }
  };

  // Handle Delivery Order confirmation (may deduct stock based on org settings)
  const handleConfirmDO = async (doData: ConfirmDOData) => {
    setIsConfirming(true);
    try {
      const token = await getToken();
      if (!token) {
        toast.error("Authentication required");
        setIsConfirming(false);
        return;
      }

      const docId = existingData?.id || documentId;
      if (!docId) {
        toast.error("Document must be saved before confirming");
        setIsConfirming(false);
        return;
      }

      // First, save the current form data (without confirmed status - let backend handle that)
      const currentUserName = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || 'SYS';
      const currentTimestamp = new Date().toISOString();

      const saveData = {
        ...formData,
        items: items,
        name: formData.name || formData.documentInfo?.documentNumber,
        // Don't set status here - backend will set it to confirmed
        // Tracking info
        lastUsedBy: currentUserName,
        lastUsedAt: currentTimestamp,
      };

      // Save current form state first
      await onSave?.(saveData);

      // Call backend to confirm DO and handle stock deduction
      const confirmResponse = await request(
        {
          path: `/documents/${docId}/confirm-do`,
          method: "POST",
        },
        {
          fromDONo: doData.fromDONo,
          toDONo: doData.toDONo,
        },
        token
      );

      if (confirmResponse.success) {
        toast.success("Delivery Order confirmed successfully. Stock has been deducted.");
      } else {
        throw new Error(confirmResponse.message || "Confirmation failed");
      }

      setConfirmDODialogOpen(false);

      // Full page reload to update the status
      window.location.reload();
    } catch (error) {
      console.error("Error confirming DO:", error);
      toast.error("Failed to confirm Delivery Order");
    } finally {
      setIsConfirming(false);
    }
  };

  // Handle Purchase Return confirmation
  const handleConfirmPR = async (prData: ConfirmPRData) => {
    setIsConfirming(true);
    try {
      const token = await getToken();
      if (!token) {
        toast.error("Authentication required");
        setIsConfirming(false);
        return;
      }

      const docId = existingData?.id || documentId;
      if (!docId) {
        toast.error("Document must be saved before confirming");
        setIsConfirming(false);
        return;
      }

      // First, save the current form data (without confirmed status - let backend handle that)
      const currentUserName = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || 'SYS';
      const currentTimestamp = new Date().toISOString();

      const saveData = {
        ...formData,
        items: items,
        name: formData.name || formData.documentInfo?.documentNumber,
        // Tracking info
        lastUsedBy: currentUserName,
        lastUsedAt: currentTimestamp,
      };

      // Save current form state first
      await onSave?.(saveData);

      // Call backend to confirm PR and handle stock update
      const confirmResponse = await request(
        {
          path: `/documents/${docId}/confirm-pr`,
          method: "POST",
        },
        {
          purchaseReturnNo: prData.purchaseReturnNo,
          linkToAccounts: prData.linkToAccounts,
          supplierDONo: prData.supplierDONo,
          supplierDODate: prData.supplierDODate,
          supplierInvoiceNo: prData.supplierInvoiceNo,
          supplierInvoiceDate: prData.supplierInvoiceDate,
          rate: prData.rate,
          purchases: prData.purchases,
          purchasesAmount: prData.purchasesAmount,
          taxGST: prData.taxGST,
          taxGSTAmount: prData.taxGSTAmount,
          freightCharges: prData.freightCharges,
          freightChargesAmount: prData.freightChargesAmount,
          insurance: prData.insurance,
          insuranceAmount: prData.insuranceAmount,
          creditorBank: prData.creditorBank,
          creditorBankAmount: prData.creditorBankAmount,
        },
        token
      );

      if (confirmResponse.success) {
        toast.success("Purchase Return confirmed successfully. Stock has been updated.");
      } else {
        throw new Error(confirmResponse.message || "Confirmation failed");
      }

      setConfirmPRDialogOpen(false);

      // Full page reload to update the status
      window.location.reload();
    } catch (error) {
      console.error("Error confirming PR:", error);
      toast.error("Failed to confirm Purchase Return");
    } finally {
      setIsConfirming(false);
    }
  };

  // Handle Invoice confirmation (may deduct stock based on org settings)
  const handleConfirmInvoice = async (invoiceData: ConfirmInvoiceData) => {
    setIsConfirming(true);
    try {
      const token = await getToken();
      if (!token) {
        toast.error("Authentication required");
        setIsConfirming(false);
        return;
      }

      const docId = existingData?.id || documentId;
      if (!docId) {
        toast.error("Document must be saved before confirming");
        setIsConfirming(false);
        return;
      }

      // First, save the current form data (without confirmed status - let backend handle that)
      const currentUserName = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || 'SYS';
      const currentTimestamp = new Date().toISOString();

      const saveData = {
        ...formData,
        items: items,
        name: formData.name || formData.documentInfo?.documentNumber,
        // Don't set status here - backend will set it to confirmed
        // Tracking info
        lastUsedBy: currentUserName,
        lastUsedAt: currentTimestamp,
      };

      // Save current form state first
      await onSave?.(saveData);

      // Call backend to confirm Invoice and handle stock deduction
      const confirmResponse = await request(
        {
          path: `/documents/${docId}/confirm-invoice`,
          method: "POST",
        },
        {
          fromInvoiceNo: invoiceData.fromInvoiceNo,
          toInvoiceNo: invoiceData.toInvoiceNo,
        },
        token
      );

      if (confirmResponse.success) {
        const stockMessage = confirmResponse.stockDeducted
          ? " Stock has been deducted."
          : "";
        toast.success("Invoice confirmed successfully." + stockMessage);
      } else {
        throw new Error(confirmResponse.message || "Confirmation failed");
      }

      setConfirmInvoiceDialogOpen(false);

      // Full page reload to update the status
      window.location.reload();
    } catch (error) {
      console.error("Error confirming Invoice:", error);
      toast.error("Failed to confirm Invoice");
    } finally {
      setIsConfirming(false);
    }
  };

  const handleDuplicateDocument = async () => {
    try {
      const token = await getToken();
      if (!token) {
        toast.error("Authentication required");
        return;
      }

      const docId = existingData?.id || documentId;
      if (!docId) {
        toast.error("Save the document before duplicating");
        return;
      }

      const response = await request(
        { path: `/documents/${docId}/duplicate`, method: "POST" },
        {},
        token
      );

      if (response?.success && response?.data?.id) {
        toast.success("Document duplicated");
        onDocumentCreated?.();
        const newDocType = response.data.type || documentType;
        const templateId = response.data.documentTemplateId || documentId;
        router.push(`/portal/documents/${newDocType}/${templateId}/${response.data.id}`);
      } else {
        toast.error(response?.message || "Failed to duplicate document");
      }
    } catch (error) {
      console.error("Error duplicating document:", error);
      toast.error("Failed to duplicate document");
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
        // Refetch documents list so navigation works
        onDocumentCreated?.();
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
          ...(documentType === "TI" || documentType === "DO" || documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" ? [{ label: "Reference No", name: "referenceNo" }] : []),
          ...(documentType === "DO" || documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" || documentType === "RDO" ? [{ label: "PO No", name: "poNo" }] : []),
          ...(documentType === "DO" ? [{ label: "DO No", name: "doNo" }] : []),
          ...(documentType === "RDO" ? [{ label: "Return Order No", name: "returnOrderNo" }] : []),
          ...(documentType === "DO" || documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" ? [{ label: "Delivery To", name: "deliveryTo" }] : []),
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
          ...(documentType === "TI" || documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" ? [{ label: "Terms & Conditions", name: "defaultValues.termsAndConditions" }] : []),
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
      // Navigate to parent page for confirmed documents
      router.push(getParentRoute(documentType));
    } else {
      // Check if there are any changes to the form
      const hasChanges = hasFormChanges();

      if (hasChanges) {
        // Show dialog only if there are unsaved changes
        setBackConfirmDialogOpen(true);
      } else {
        // No changes, navigate to parent page
        router.push(getParentRoute(documentType));
      }
    }
  };

  // Handle save as draft from dialog
  const handleSaveAsDraft = async () => {
    // Get current user info for tracking
    const currentUserName = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || 'SYS';
    const currentTimestamp = new Date().toISOString();

    if (isTemplateEditMode) {
      const templateConfig = templateMethods.getValues();
      await onSave?.({ ...formData, config: templateConfig });
    } else {
      // Include items in the save data with tracking info
      const saveData = {
        ...formData,
        items: items, // Include items array
        name: formData.name || formData.documentInfo.documentNumber,
        // Tracking info for draft save
        savedBy: currentUserName,
        savedAt: currentTimestamp,
        lastUsedBy: currentUserName,
        lastUsedAt: currentTimestamp,
      };
      await onSave?.(saveData);
    }
    toast.success("Document saved as draft");
    // Navigate to parent page after saving
    router.push(getParentRoute(documentType));
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

      // Navigate to parent page regardless of deletion result
      router.push(getParentRoute(documentType));
    } catch (error) {
      console.error("Error deleting document:", error);
      toast.error("Failed to delete document");
      // Still navigate to parent page even if deletion fails
      router.push(getParentRoute(documentType));
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
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          {/* Navigation & Add Buttons */}
          {(onPrevious || onNext) && (
            <>
              <Button
                size="small"
                variant="outlined"
                startIcon={<NavigateBeforeIcon />}
                onClick={onPrevious}
                disabled={!hasPrevious}
              >
                Previous
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<NavigateNextIcon />}
                onClick={onNext}
                disabled={!hasNext}
              >
                Next
              </Button>
            </>
          )}
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={async () => {
              try {
                const token = await getToken();
                if (!token) {
                  toast.error("Authentication required");
                  return;
                }
                const templateId = existingData?.documentTemplateId || pathSegments[3] || documentId;
                // Use actualDocumentType prop (the real document category like INVOICE, QUOTATION)
                // This ensures we store the correct type, not the template variant (TI2, QO1, etc.)
                const docTypeForCreate = actualDocumentType || existingData?.type || "INVOICE";
                console.log("=== ADD BUTTON - docTypeForCreate ===");
                console.log("actualDocumentType prop:", actualDocumentType);
                console.log("existingData?.type:", existingData?.type);
                console.log("Final docTypeForCreate:", docTypeForCreate);
                if (!templateId) {
                  toast.error("Could not find document template. Please try creating from the main page.");
                  return;
                }
                const response = await request(
                  { path: "/documents/basic", method: "POST" },
                  {
                    type: docTypeForCreate,
                    config: {},
                    documentTemplateId: templateId,
                    organizationId: organization?.id,
                  },
                  token
                );
                if (response?.success && response?.data?.id) {
                  toast.success(`New ${getDocumentTitle()} created`);
                  // Refetch documents list so navigation works
                  onDocumentCreated?.();
                  // Use actual document type (INVOICE, QUOTATION, etc.) for URL, not template variant (TI2, QO1, etc.)
                  router.push(`/portal/documents/${docTypeForCreate}/${templateId}/${response.data.id}`);
                } else {
                  toast.error(response?.message || "Failed to create document");
                }
              } catch (error) {
                console.error("Error creating new document:", error);
                toast.error("Failed to create document");
              }
            }}
            color="primary"
          >
            Add
          </Button>
          {/* Extract from Quotation Button - Only for DO/DELIVERY_ORDER */}
          {(documentType === "DO" || documentType === "DELIVERY_ORDER") && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={async () => {
                try {
                  const token = await getToken();
                  if (!token) {
                    toast.error("Authentication required");
                    return;
                  }
                  // Fetch quotations
                  const quotationsResponse = await request(
                    { path: "/documents", method: "POST" },
                    { organizationId: organization?.id },
                    token
                  );
                  if (quotationsResponse?.success) {
                    // Filter to only quotation types - check both type and documentType fields
                    const quotationTypes = ["QUOTATION", "QT", "QO", "QO1"];
                    const quotations = (quotationsResponse.data || []).filter(
                      (doc: any) => {
                        const docType = doc.type || doc.documentType || "";
                        return quotationTypes.includes(docType.toUpperCase());
                      }
                    );
                    console.log("Fetched documents:", quotationsResponse.data?.length);
                    console.log("Filtered quotations:", quotations.length);
                    setQuotationsForExtract(quotations);
                    setExtractQuotationDialogOpen(true);
                  } else {
                    toast.error("Failed to fetch quotations");
                  }
                } catch (error) {
                  console.error("Error fetching quotations:", error);
                  toast.error("Failed to fetch quotations");
                }
              }}
              color="secondary"
            >
              Extract
            </Button>
          )}
          {/* Extract from Quotation Button - Only for SO/SALES_ORDER */}
          {(documentType === "SO" || documentType === "SALES_ORDER" || documentType?.toUpperCase() === "SALES_ORDER") && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={async () => {
                try {
                  const token = await getToken();
                  if (!token) {
                    toast.error("Authentication required");
                    return;
                  }
                  // Fetch quotations
                  const quotationsResponse = await request(
                    { path: "/documents", method: "POST" },
                    { organizationId: organization?.id },
                    token
                  );
                  if (quotationsResponse?.success) {
                    // Filter to only quotation types - check both type and documentType fields
                    const quotationTypes = ["QUOTATION", "QT", "QO", "QO1"];
                    const quotations = (quotationsResponse.data || []).filter(
                      (doc: any) => {
                        const docType = doc.type || doc.documentType || "";
                        return quotationTypes.includes(docType.toUpperCase());
                      }
                    );
                    console.log("Fetched documents:", quotationsResponse.data?.length);
                    console.log("Filtered quotations for SO:", quotations.length);
                    setQuotationsForExtract(quotations);
                    setExtractQuotationToSODialogOpen(true);
                  } else {
                    toast.error("Failed to fetch quotations");
                  }
                } catch (error) {
                  console.error("Error fetching quotations:", error);
                  toast.error("Failed to fetch quotations");
                }
              }}
              color="secondary"
            >
              Extract
            </Button>
          )}
          {/* Extract from DO Button - Only for TI/TI2/INVOICE */}
          {(documentType === "TI" || documentType === "TI2" || documentType === "INVOICE" || documentType?.toUpperCase() === "INVOICE") && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={async () => {
                try {
                  const token = await getToken();
                  if (!token) {
                    toast.error("Authentication required");
                    return;
                  }
                  // Fetch delivery orders
                  const doResponse = await request(
                    { path: "/documents", method: "POST" },
                    { organizationId: organization?.id },
                    token
                  );
                  if (doResponse?.success) {
                    // Filter to only delivery order types
                    const doTypes = ["DELIVERY_ORDER", "DO"];
                    const deliveryOrders = (doResponse.data || []).filter(
                      (doc: any) => {
                        const docType = doc.type || doc.documentType || "";
                        return doTypes.includes(docType.toUpperCase());
                      }
                    );
                    console.log("Fetched documents:", doResponse.data?.length);
                    console.log("Filtered delivery orders:", deliveryOrders.length);
                    setDeliveryOrdersForExtract(deliveryOrders);
                    setExtractDODialogOpen(true);
                  } else {
                    toast.error("Failed to fetch delivery orders");
                  }
                } catch (error) {
                  console.error("Error fetching delivery orders:", error);
                  toast.error("Failed to fetch delivery orders");
                }
              }}
              color="secondary"
            >
              Extract
            </Button>
          )}
          {/* Locate Document Button */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<SearchIcon />}
            onClick={() => setLocateDialogOpen(true)}
          >
            Locate
          </Button>
          {/* Duplicate Document Button — creates a fresh document with a new
              document number, copying over all current data. */}
          {(existingData?.id || documentId) && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={handleDuplicateDocument}
            >
              Duplicate
            </Button>
          )}
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
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
          <Button
            size="small"
            variant="outlined"
            startIcon={<InventoryIcon />}
            onClick={() => setStockCardDialogOpen(true)}
            color="secondary"
          >
            Stock Card
          </Button>
          <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint}>
            Print / PDF
          </Button>
          {!isDocumentConfirmed && (
            <Button
              size="small"
              variant={previewMode ? "contained" : "outlined"}
              startIcon={previewMode ? <EditIcon /> : <PreviewIcon />}
              onClick={() => setPreviewMode(!previewMode)}
              color={previewMode ? "primary" : "inherit"}
            >
              {previewMode ? "Edit" : "Preview"}
            </Button>
          )}
          {/* Receive button for Purchase Orders only (before receiving mode) */}
          {!isDocumentConfirmed && !isTemplateEditMode && isPurchaseOrder && !isReceiving && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<ReceiveIcon />}
              onClick={() => setIsReceiving(true)}
              color="info"
            >
              Receive
            </Button>
          )}
          {/* Cancel Receive button for Purchase Orders (in receiving mode) */}
          {!isDocumentConfirmed && !isTemplateEditMode && isPurchaseOrder && isReceiving && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<CloseIcon />}
              onClick={() => setIsReceiving(false)}
              color="inherit"
            >
              Cancel Receive
            </Button>
          )}
          {/* Confirm button for Purchase Orders (after entering received quantities) */}
          {!isDocumentConfirmed && !isTemplateEditMode && isPurchaseOrder && isReceiving && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<CheckCircleIcon />}
              onClick={() => setConfirmPODialogOpen(true)}
              color="success"
            >
              Confirm Purchase Order
            </Button>
          )}
          {/* Confirm button for Purchase Returns */}
          {!isDocumentConfirmed && !isTemplateEditMode && isPurchaseReturn && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<CheckCircleIcon />}
              onClick={() => setConfirmPRDialogOpen(true)}
              color="success"
            >
              Confirm Document
            </Button>
          )}
          {/* Confirm button for Stock Adjustments */}
          {!isDocumentConfirmed && !isTemplateEditMode && isStockAdjustment && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<CheckCircleIcon />}
              onClick={() => setConfirmAdjustmentDialogOpen(true)}
              color="success"
            >
              {isStockAdjustmentIn ? "Confirm Stock Adjustment In" : "Confirm Stock Adjustment Out"}
            </Button>
          )}
          {/* Confirm button for Delivery Orders */}
          {!isDocumentConfirmed && !isTemplateEditMode && isDeliveryOrder && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<CheckCircleIcon />}
              onClick={() => setConfirmDODialogOpen(true)}
              color="success"
            >
              Confirm Delivery Order
            </Button>
          )}
          {/* Confirm button for Invoices */}
          {!isDocumentConfirmed && !isTemplateEditMode && isInvoiceType && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<CheckCircleIcon />}
              onClick={() => setConfirmInvoiceDialogOpen(true)}
              color="success"
            >
              Confirm Invoice
            </Button>
          )}
          {/* Confirm button for non-Purchase Order/Return, non-Quotation, non-Stock Adjustment, non-DO, and non-Invoice documents */}
          {!isDocumentConfirmed && !isTemplateEditMode && !isPurchaseDocument && !isStockAdjustment && !isDeliveryOrder && !isInvoiceType &&
           !(documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO") && (
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
          {/* Send Email button for invoices (draft or confirmed, not pending_payment) */}
          {documentStatus !== "pending_payment" &&
           (documentType === "TI" || documentType === "TI2" || documentType === "INVOICE") && (
            <Button
              size="small"
              variant="contained"
              startIcon={<EmailIcon />}
              onClick={() => setSendEmailDialogOpen(true)}
              color="primary"
            >
              Send Email
            </Button>
          )}
          {/* Mark as Paid button for pending_payment invoices */}
          {documentStatus === "pending_payment" &&
           (documentType === "TI" || documentType === "TI2" || documentType === "INVOICE") && (
            <Button
              size="small"
              variant="contained"
              startIcon={<PaymentIcon />}
              onClick={() => setPaymentDialogOpen(true)}
              color="success"
            >
              Mark as Paid
            </Button>
          )}
          {!isDocumentConfirmed && (
            <Button
              size="small"
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={async () => {
                // Get current user info for tracking
                const currentUserName = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || 'SYS';
                const currentTimestamp = new Date().toISOString();

                if (isTemplateEditMode) {
                  // Save template configuration
                  const templateConfig = templateMethods.getValues();
                  await onSave?.({ ...formData, config: templateConfig });
                  toast.success("Template saved");
                } else {
                  // Save document data with name field, items, and tracking info
                  const saveData = {
                    ...formData,
                    items: items,
                    name: formData.name || formData.documentInfo.documentNumber,
                    // Tracking info for draft save
                    savedBy: currentUserName,
                    savedAt: currentTimestamp,
                    lastUsedBy: currentUserName,
                    lastUsedAt: currentTimestamp,
                  };
                  console.log("Direct Save - Data being sent to onSave:", saveData);
                  console.log("Direct Save - deliveryTo in saveData:", saveData.deliveryTo);
                  console.log("Direct Save - issueBy in saveData:", saveData.issueBy);
                  console.log("Direct Save - Items in saveData:", JSON.stringify(saveData.items, null, 2));
                  await onSave?.(saveData);
                  toast.success("Document saved as draft");
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

            {/* Document Tracking Info - Unconfirmed User, Confirmed User & Last Used */}
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-start",
                alignItems: "center",
                gap: 4,
                px: 2,
                py: 0.75,
                bgcolor: "grey.100",
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2" sx={{ fontStyle: "italic", fontWeight: 600, color: "text.secondary" }}>
                  Unconfirmed User:
                </Typography>
                <Typography variant="body2" sx={{ color: "text.primary" }}>
                  {existingData?.savedBy && existingData?.status !== 'confirmed'
                    ? `${existingData.savedBy} ${existingData.savedAt ? new Date(existingData.savedAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}`
                    : '-'}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2" sx={{ fontStyle: "italic", fontWeight: 600, color: "text.secondary" }}>
                  Confirmed User:
                </Typography>
                <Typography variant="body2" sx={{ color: "text.primary" }}>
                  {existingData?.confirmedBy
                    ? `${existingData.confirmedBy} ${existingData.confirmedAt ? new Date(existingData.confirmedAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}`
                    : '-'}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: "text.secondary" }}>
                  Last Used:
                </Typography>
                <Typography variant="body2" sx={{ color: "text.primary" }}>
                  {existingData?.lastUsedBy
                    ? `${existingData.lastUsedBy} ${existingData.lastUsedAt ? new Date(existingData.lastUsedAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}`
                    : existingData?.updatedAt
                    ? new Date(existingData.updatedAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : '-'}
                </Typography>
              </Box>
            </Box>

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
                  {/* Legacy delivery address tab for specific document types - only when no dynamic template config */}
                  {!templateFieldConfig && (documentType === "DO" || documentType === "RDO" || documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO") && (
                    <Tab label={documentType === "RDO" ? "Return Info" : "Delivery Address"} />
                  )}
                </Tabs>
              )}
            </Box>

          {/* Dynamic Tabs based on template config */}
          {templateFieldConfig?.tabs.map((tab, index) => (
            <TabPanel key={tab.tabId} value={mainTabValue} index={index}>
              <Card sx={{ maxHeight: 350, overflow: 'auto' }}>
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
                    suppliers={suppliers}
                    projects={projects}
                    deliveryOrders={deliveryOrders}
                    siteOffices={siteOffices}
                    salesmen={salesmen}
                    onOpenCustomerDialog={(fieldName?: string) => {
                      if (fieldName && fieldName !== 'customer') {
                        setCustomerFieldName(fieldName);
                        setCustomerStoreMode("code");
                      } else {
                        setCustomerFieldName("customer");
                        setCustomerStoreMode("object");
                      }
                      setIsSupplierDialog(false);
                      setCustomerDialogOpen(true);
                    }}
                    onOpenSupplierDialog={(fieldName?: string) => {
                      setCustomerFieldName(fieldName || "documentInfo.supplierCode");
                      setCustomerStoreMode("code");
                      setIsSupplierDialog(true);
                      setCustomerDialogOpen(true);
                    }}
                    onOpenSalesmanDialog={(fieldName?: string) => {
                      setSalesmanFieldName(fieldName || "documentInfo.salesPerson");
                      setSalesmanDialogOpen(true);
                    }}
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
                        <TextField
                          fullWidth
                          label="Customer Code"
                          size="small"
                          value={
                            formData.customer?.id
                              ? customers.find((c: any) => c.id === formData.customer.id)?.customerCode || formData.customer.name || "Selected"
                              : ""
                          }
                          onClick={() => setCustomerDialogOpen(true)}
                          InputProps={{
                            readOnly: true,
                            sx: { cursor: "pointer" },
                          }}
                          placeholder="Click to select customer"
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
                      {(documentType === "TI" || documentType === "DO" || documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO") && (!isTemplateEditMode || templateWatch("referenceNo")) && (
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
                      {(documentType === "DO" || documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" || documentType === "RDO") && (
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
                      {documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" && (
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
                      {(documentType === "TI" || documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO") && (
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


          {/* DELIVERY ADDRESS TAB - Only for DO, RDO, and QO1 when no dynamic template config */}
          {!templateFieldConfig && (documentType === "DO" || documentType === "RDO" || documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO") && (
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
                        {(documentType === "DO" || documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO") && (
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
                  <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 520px)", minHeight: 200 }}>
                    {/* Scrollable table area */}
                    <Box sx={{ flex: 1, overflow: "auto", minHeight: 0, borderBottom: "1px solid", borderColor: "divider" }}>
                      <TableContainer>
                        <Table sx={{ tableLayout: 'fixed' }} stickyHeader>
                        <TableHead>
                          <TableRow>
                            {/* Render columns based on configuration - exclude tax for invoices */}
                            {(() => {
                              const isInvoiceType = documentType === "TI" || documentType === "TI2" || documentType === "INVOICE";
                              const isStockAdjustmentIn = documentType === "SAI" || documentType === "STOCK_ADJUSTMENT_IN";
                              const isStockAdjustmentOut = documentType === "SAO" || documentType === "STOCK_ADJUSTMENT_OUT";
                              const isStockAdjustment = isStockAdjustmentIn || isStockAdjustmentOut;
                              const isPurchaseOrderType = documentType === "PO" || documentType === "PURCHASE_ORDER" || documentType === "QT" || documentType === "QUOTATION" || documentType === "QO" || documentType === "QO1" || documentType === "QO2";
                              const isPurchaseReturnType = documentType === "PR" || documentType === "PURCHASE_RETURN";
                              const isDeliveryOrderType = documentType === "DO" || documentType === "DELIVERY_ORDER" || documentType === "RDO" || documentType === "RETURN_DELIVERY_ORDER";
                              const isCreditDebitNote = documentType === "CN" || documentType === "CREDIT_NOTE" || documentType === "DN" || documentType === "DEBIT_NOTE";
                              const defaultColumns = isInvoiceType
                                ? ["item", "description", "quantity", "unitPrice", "amount"]
                                : isStockAdjustmentIn || isPurchaseReturnType
                                ? ["item", "description", "uom", "quantity", "unitPrice", "discount", "amount", "receivedQty"]
                                : isStockAdjustmentOut || isPurchaseOrderType
                                ? ["item", "description", "uom", "quantity", "unitPrice", "discount", "amount"]
                                : isDeliveryOrderType || isCreditDebitNote
                                ? ["item", "description", "uom", "quantity", "unitPrice", "amount"]
                                : ["item", "description", "quantity", "unitPrice", "tax", "amount"];
                              return (isTemplateEditMode ? templateWatch("tableColumnOrder") : defaultColumns).map((columnId: string) => {
                                // Skip tax column for invoices
                                if (isInvoiceType && columnId === "tax") return null;
                                const isVisible = isTemplateEditMode ? templateWatch(`tableHeaders.${columnId}`) : true;
                              const label = isTemplateEditMode ? templateWatch(`columnLabels.${columnId}`) || columnId :
                                columnId === "item" ? "Product Code" :
                                columnId === "description" ? "Description" :
                                columnId === "uom" ? "UOM" :
                                columnId === "quantity" ? "Quantity" :
                                columnId === "unitPrice" ? "Unit Price" :
                                columnId === "tax" ? "Tax %" :
                                columnId === "discount" ? "Disc %" :
                                columnId === "amount" ? "Amount" :
                                columnId === "receivedQty" ? "Received Qty" : columnId;

                              if (!isVisible) return null;

                              return (
                                <TableCell
                                  key={columnId}
                                  align={
                                    columnId === "quantity" || columnId === "unitPrice" || columnId === "tax" || columnId === "receivedQty" ? "center" :
                                    columnId === "amount" ? "right" : "left"
                                  }
                                  sx={{
                                    width: columnId === "description" ? "25%" :
                                           columnId === "item" ? "12%" :
                                           columnId === "uom" ? "6%" :
                                           columnId === "quantity" ? "8%" :
                                           columnId === "unitPrice" ? "10%" :
                                           columnId === "tax" ? "8%" :
                                           columnId === "discount" ? "6%" :
                                           columnId === "amount" ? "10%" :
                                           columnId === "receivedQty" ? "10%" : "auto"
                                  }}
                                >
                                  {label}
                                </TableCell>
                              );
                            });
                          })()}
                            {/* Received Qty and Outstanding Qty columns for Purchase Orders/Returns in receiving mode */}
                            {isPurchaseDocument && isReceiving && (
                              <>
                                <TableCell align="center" sx={{ width: "10%", bgcolor: "info.light" }}>
                                  Received Qty
                                </TableCell>
                                <TableCell align="center" sx={{ width: "10%", bgcolor: "warning.light" }}>
                                  Outstanding Qty
                                </TableCell>
                              </>
                            )}
                            <TableCell align="center" sx={{ width: "8%" }}>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {items.map((item: any, index: number) => (
                            <TableRow key={item.id}>
                              {/* Render cells based on configuration - exclude tax for invoices */}
                              {(() => {
                                const isInvoiceType = documentType === "TI" || documentType === "TI2" || documentType === "INVOICE";
                                const isStockAdjustmentIn = documentType === "SAI" || documentType === "STOCK_ADJUSTMENT_IN";
                                const isStockAdjustmentOut = documentType === "SAO" || documentType === "STOCK_ADJUSTMENT_OUT";
                                const isStockAdjustment = isStockAdjustmentIn || isStockAdjustmentOut;
                                const isPurchaseOrderType = documentType === "PO" || documentType === "PURCHASE_ORDER" || documentType === "QT" || documentType === "QUOTATION" || documentType === "QO" || documentType === "QO1" || documentType === "QO2";
                                const isPurchaseReturnType = documentType === "PR" || documentType === "PURCHASE_RETURN";
                                const isDeliveryOrderType = documentType === "DO" || documentType === "DELIVERY_ORDER" || documentType === "RDO" || documentType === "RETURN_DELIVERY_ORDER";
                                const isCreditDebitNote = documentType === "CN" || documentType === "CREDIT_NOTE" || documentType === "DN" || documentType === "DEBIT_NOTE";
                                const defaultColumns = isInvoiceType
                                  ? ["item", "description", "quantity", "unitPrice", "amount"]
                                  : isStockAdjustmentIn || isPurchaseReturnType
                                  ? ["item", "description", "uom", "quantity", "unitPrice", "discount", "amount", "receivedQty"]
                                  : isStockAdjustmentOut || isPurchaseOrderType
                                  ? ["item", "description", "uom", "quantity", "unitPrice", "discount", "amount"]
                                  : isDeliveryOrderType || isCreditDebitNote
                                  ? ["item", "description", "uom", "quantity", "unitPrice", "amount"]
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
                                            updateItem(item.id, "description", selectedInventory.name || selectedInventory.asset?.name || selectedInventory.description || "");
                                            updateItem(item.id, "unitPrice", selectedInventory.unitPrice || selectedInventory.asset?.price || 0);
                                            // UOM can be at root level (Products mode) or nested under asset (Inventory mode)
                                            updateItem(item.id, "uom", selectedInventory.uom || selectedInventory.asset?.uom || "PCS");

                                            // Prefetch price history for this asset
                                            if (selectedInventory.assetId) {
                                              prefetchPriceHistory(selectedInventory.assetId);
                                            }
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
                                      <RichTextDescription
                                        value={item.description || ""}
                                        onChange={(html) => updateItem(item.id, "description", html)}
                                        placeholder="Enter description"
                                        pastDescriptions={pastDescriptions}
                                        loadingDescriptions={isLoadingDescriptions}
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
                                } else if (columnId === "uom") {
                                  return (
                                    <TableCell key={columnId} align="center">
                                      <TextField
                                        value={item.uom || ""}
                                        onChange={(e) => updateItem(item.id, "uom", e.target.value)}
                                        size="small"
                                        sx={{ width: 60 }}
                                      />
                                    </TableCell>
                                  );
                                } else if (columnId === "discount") {
                                  return (
                                    <TableCell key={columnId} align="center">
                                      <TextField
                                        type="number"
                                        value={item.discount || 0}
                                        onChange={(e) => updateItem(item.id, "discount", parseFloat(e.target.value) || 0)}
                                        size="small"
                                        sx={{ width: 60 }}
                                      />
                                    </TableCell>
                                  );
                                } else if (columnId === "receivedQty") {
                                  return (
                                    <TableCell key={columnId} align="center">
                                      <TextField
                                        type="number"
                                        value={item.receivedQty || 0}
                                        onChange={(e) => updateItem(item.id, "receivedQty", parseFloat(e.target.value) || 0)}
                                        size="small"
                                        sx={{ width: 80 }}
                                      />
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
                              {/* Received Qty and Outstanding Qty cells for Purchase Orders/Returns in receiving mode */}
                              {isPurchaseDocument && isReceiving && (
                                <>
                                  <TableCell align="center" sx={{ bgcolor: "info.50" }}>
                                    <TextField
                                      type="number"
                                      value={item.receivedQty || 0}
                                      onChange={(e) => updateItem(item.id, "receivedQty", parseFloat(e.target.value) || 0)}
                                      size="small"
                                      sx={{ width: 80 }}
                                      inputProps={{ min: 0, max: item.quantity || 0 }}
                                    />
                                  </TableCell>
                                  <TableCell align="center" sx={{ bgcolor: "warning.50" }}>
                                    <Typography variant="body2" fontWeight={500}>
                                      {((item.quantity || 0) - (item.receivedQty || 0)).toFixed(2)}
                                    </Typography>
                                  </TableCell>
                                </>
                              )}
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
                      {/* Add Item / Add Service buttons */}
                      <Box sx={{ pt: 1, pl: 1, display: "flex", gap: 1 }}>
                        <Button
                          variant="contained"
                          startIcon={<AddIcon />}
                          onClick={() => setStockCardDialogOpen(true)}
                          size="small"
                        >
                          Add Item
                        </Button>
                        {isServiceItemsEnabled && (
                          <Button
                            variant="outlined"
                            startIcon={<AddIcon />}
                            onClick={() => {
                              const newItem: any = {
                                id: Date.now(),
                                itemCode: "",
                                inventoryItemId: "",
                                description: "",
                                quantity: 1,
                                unitPrice: 0,
                                amount: 0,
                                isService: true,
                              };
                              // Add fields based on document type
                              const isInvoiceType = documentType === "TI" || documentType === "TI2" || documentType === "INVOICE";
                              const isQuotationType = documentType === "QT" || documentType === "QUOTATION" || documentType === "QO" || documentType === "QO1" || documentType === "QO2";
                              const isStockAdjType = documentType === "SAI" || documentType === "SAO" || documentType === "STOCK_ADJUSTMENT_IN" || documentType === "STOCK_ADJUSTMENT_OUT";
                              const isPOType = documentType === "PO" || documentType === "PURCHASE_ORDER";
                              const isPRType = documentType === "PR" || documentType === "PURCHASE_RETURN";
                              const isDOType = documentType === "DO" || documentType === "DELIVERY_ORDER" || documentType === "RDO" || documentType === "RETURN_DELIVERY_ORDER";
                              const isCDNType = documentType === "CN" || documentType === "CREDIT_NOTE" || documentType === "DN" || documentType === "DEBIT_NOTE";
                              const needsUom = isStockAdjType || isPOType || isPRType || isDOType || isCDNType || isQuotationType;
                              if (needsUom) {
                                newItem.uom = "";
                                if (isStockAdjType || isPOType || isPRType) newItem.discount = 0;
                                if (isStockAdjType || isPRType) newItem.receivedQty = 0;
                              } else if (!isInvoiceType) {
                                newItem.tax = 9;
                              }
                              setItems([...items, newItem]);
                            }}
                            size="small"
                          >
                            Add Service
                          </Button>
                        )}
                      </Box>
                    </Box>

                    {/* Fixed bottom section with Totals */}
                    <Box sx={{ flexShrink: 0, pt: 1 }}>
                      <Box sx={{ display: "flex", justifyContent: "flex-end", alignItems: "flex-start" }}>
                        {/* Totals */}
                        <Card sx={{ minWidth: 250, bgcolor: "grey.50" }}>
                          <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                            {isCreditDebitNote || isPurchaseReturn ? (
                              <>
                                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                  <Typography variant="body2">Total Item:</Typography>
                                  <Typography variant="body2" fontWeight="bold">{items.length}</Typography>
                                </Box>
                                <Divider sx={{ my: 0.5 }} />
                                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                  <Typography variant="body2" fontWeight="bold">Nett Total:</Typography>
                                  <Typography variant="body2" fontWeight="bold" color="primary">
                                    {subtotal.toFixed(2)}
                                  </Typography>
                                </Box>
                              </>
                            ) : (
                              <>
                              {(() => {
                                const dInfo = formData?.documentInfo as any;
                                const currency = dInfo?.currency || "SGD";
                                const discPct = parseFloat(dInfo?.discountPercent) || 0;
                                const discAmt = subtotal * (discPct / 100);
                                const afterDisc = subtotal - discAmt;
                                const gstPct = isTaxApplicable ? (parseFloat(dInfo?.gstPercent) || organization?.taxRate || 9) : 0;
                                const gst = isAbsorbTax && gstPct > 0
                                  ? afterDisc * gstPct / (100 + gstPct)
                                  : afterDisc * (gstPct / 100);
                                const nett = isAbsorbTax ? afterDisc : afterDisc + gst;
                                const displaySubtotal = isAbsorbTax ? afterDisc - gst : afterDisc;

                                return (
                                  <>
                                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                      <Typography variant="body2">Gross Total:</Typography>
                                      <Typography variant="body2">{currency} {subtotal.toFixed(2)}</Typography>
                                    </Box>
                                    {discPct > 0 && (
                                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                        <Typography variant="body2">Discount ({discPct}%):</Typography>
                                        <Typography variant="body2" color="error.main">-{currency} {discAmt.toFixed(2)}</Typography>
                                      </Box>
                                    )}
                                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                      <Typography variant="body2">Sub-total:</Typography>
                                      <Typography variant="body2" fontWeight="bold">{currency} {displaySubtotal.toFixed(2)}</Typography>
                                    </Box>
                                    {isTaxApplicable && (
                                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                        <Typography variant="body2">
                                          GST ({gstPct}%){isAbsorbTax ? " (absorbed)" : ""}:
                                        </Typography>
                                        <Typography variant="body2">{currency} {gst.toFixed(2)}</Typography>
                                      </Box>
                                    )}
                                    <Divider sx={{ my: 0.5 }} />
                                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                      <Typography variant="body2" fontWeight="bold">Nett Total:</Typography>
                                      <Typography variant="body2" fontWeight="bold" color="primary">
                                        {currency} {nett.toFixed(2)}
                                      </Typography>
                                    </Box>
                                  </>
                                );
                              })()}
                              </>
                            )}
                          </CardContent>
                        </Card>
                      </Box>
                    </Box>
                  </Box>
                </TabPanel>

                {/* ITEMS FOOTER TAB */}
                <TabPanel value={itemsTabValue} index={1}>
                  <Grid container spacing={2} sx={{ height: "100%" }}>
                    {/* Notes - for all types */}
                    <Grid item xs={12} md={documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" ? 12 : 6} sx={{ display: "flex" }}>
                      <TextField
                        fullWidth
                        label="Notes"
                        value={formData.note}
                        onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                        multiline
                        minRows={6}
                        maxRows={20}
                        size="small"
                        sx={{ flex: 1 }}
                      />
                    </Grid>

                    {/* Terms & Conditions - for TI and QO1 */}
                    {(documentType === "TI" || documentType === "TI2" || documentType === "INVOICE" || documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO") && (
                      <Grid item xs={12} md={documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" ? 12 : 6} sx={{ display: "flex" }}>
                        <TextField
                          fullWidth
                          label="Terms & Conditions"
                          value={formData.termsAndConditions}
                          onChange={(e) =>
                            setFormData({ ...formData, termsAndConditions: e.target.value })
                          }
                          multiline
                          minRows={6}
                          maxRows={20}
                          size="small"
                          sx={{ flex: 1 }}
                        />
                      </Grid>
                    )}

                    {/* Quotation-specific fields */}
                    {documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" && (
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

                    {/* Bank Details now managed in Organization Settings */}
                  </Grid>
                </TabPanel>
              </CardContent>
            </Card>
          </Box>
          </Box>
        ) : (
          // PREVIEW MODE - Show clean document layout
          <Box sx={{ flex: 1, overflow: "auto", p: 2, bgcolor: "grey.100" }}>
            <div ref={printContentRef}>
              <CleanDocumentPreview
                documentType={documentType}
                data={{
                  ...formData,
                  items: items,
                  logo: organization?.logo, // Pass the logo from organization
                }}
                organization={organization}
              />
            </div>
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

      {/* Confirm PO/PR Dialog */}
      <ConfirmPODialog
        open={confirmPODialogOpen}
        onClose={() => !isConfirming && setConfirmPODialogOpen(false)}
        onConfirm={handleConfirmPO}
        poNumber={formData.name || formData.documentInfo?.documentNumber || ""}
        documentType={documentType}
      />

      {/* Confirm Stock Adjustment Dialog */}
      <ConfirmAdjustmentDialog
        open={confirmAdjustmentDialogOpen}
        onClose={() => !isConfirming && setConfirmAdjustmentDialogOpen(false)}
        onConfirm={handleConfirmAdjustment}
        documentNumber={formData.name || formData.documentInfo?.documentNumber || ""}
        documentType={documentType}
      />

      {/* Confirm Delivery Order Dialog */}
      <ConfirmDODialog
        open={confirmDODialogOpen}
        onClose={() => !isConfirming && setConfirmDODialogOpen(false)}
        onConfirm={handleConfirmDO}
        documentNumber={formData.name || formData.documentInfo?.documentNumber || ""}
      />

      {/* Confirm Purchase Return Dialog */}
      <ConfirmPRDialog
        open={confirmPRDialogOpen}
        onClose={() => !isConfirming && setConfirmPRDialogOpen(false)}
        onConfirm={handleConfirmPR}
        documentNumber={formData.name || formData.documentInfo?.documentNumber || ""}
      />

      {/* Invoice Confirmation Dialog */}
      <ConfirmInvoiceDialog
        open={confirmInvoiceDialogOpen}
        onClose={() => !isConfirming && setConfirmInvoiceDialogOpen(false)}
        onConfirm={handleConfirmInvoice}
        documentNumber={formData.name || formData.documentInfo?.documentNumber || ""}
      />

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
        initialData={priceHistoryCache[selectedAssetId]}
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

      {/* Send Email Dialog */}
      {(documentType === "TI" || documentType === "TI2" || documentType === "INVOICE") && (
        <SendInvoiceEmailDialog
          open={sendEmailDialogOpen}
          onClose={() => setSendEmailDialogOpen(false)}
          onSent={() => {
            setSendEmailDialogOpen(false);
            router.refresh(); // Refresh to update status
          }}
          invoice={{
            id: documentId || "",
            name: formData.name || formData.documentInfo?.documentNumber || "",
            config: formData,
            type: documentType,
            status: documentStatus,
            organizationId: organization?.id || ""
          }}
          customer={{
            id: formData.customer?.id || "",
            name: formData.customer?.name || "",
            email: formData.customer?.email || ""
          }}
        />
      )}

      {/* Payment Dialog for marking invoice as paid */}
      {(documentType === "TI" || documentType === "TI2" || documentType === "INVOICE") && (
        <RecordPaymentDialog
          open={paymentDialogOpen}
          onClose={() => setPaymentDialogOpen(false)}
          onSuccess={() => {
            setPaymentDialogOpen(false);
            router.refresh(); // Refresh to update status
            toast.success("Payment recorded and invoice marked as paid");
          }}
          invoice={{
            id: documentId || "",
            name: formData.name || formData.documentInfo?.documentNumber || "",
            customerId: formData.customer?.id,
            customerName: formData.customer?.name,
            status: documentStatus,
          }}
        />
      )}

      {/* Stock Card Dialog for item selection */}
      <StockCardDialog
        open={stockCardDialogOpen}
        onClose={() => setStockCardDialogOpen(false)}
        onSelectItem={handleStockCardItemSelect}
        inventoryItems={inventoriesForDocument}
      />

      {/* Locate Document Dialog */}
      <LocateDocumentDialog
        open={locateDialogOpen}
        onClose={() => setLocateDialogOpen(false)}
        documents={documentsForLocate}
        documentLabel={getDocumentTitle()}
        onSelectDocument={(doc) => {
          // Navigate to the selected document
          const urlType = pathSegments[2] || documentType;
          router.push(`/portal/documents/${urlType}/${doc.templateId}/${doc.id}`);
        }}
      />

      {/* Extract Quotation Dialog - for DO */}
      <ExtractQuotationDialog
        open={extractQuotationDialogOpen}
        onClose={() => setExtractQuotationDialogOpen(false)}
        quotations={quotationsForExtract}
        selectedCustomerId={formData.customer?.id}
        selectedCustomerName={formData.customer?.name}
        onSelectQuotation={(quotation) => {
          // Populate DO with data from the selected quotation
          const quotationConfig = quotation.config || {};

          // Look up customer address from customers list if not in quotation config
          const customerId = quotationConfig.customerId || "";
          const customerFromList = customers.find((c: any) => c.id === customerId);
          const customerAddress = quotationConfig.customerAddress || customerFromList?.address || "";

          // Update form data with quotation info
          setFormData({
            ...formData,
            customer: {
              id: customerId,
              name: quotationConfig.customerName || customerFromList?.name || "",
              address: customerAddress,
              email: quotationConfig.customerEmail || customerFromList?.email || "",
              customerCode: quotationConfig.customerCode || customerFromList?.customerCode || "",
              gstRegNo: quotationConfig.customerGstRegNo || customerFromList?.gstRegNo || "",
            },
            documentInfo: {
              ...formData.documentInfo,
              salesPerson: quotationConfig.salesmanCode || quotationConfig.salesPerson || "",
              poNo: quotationConfig.poNo || quotationConfig.referenceNo || "",
              contact: quotationConfig.contact || "",
              paymentTerms: quotationConfig.paymentTerms || "",
              currency: quotationConfig.currency || "",
              rate: quotationConfig.rate || "",
              taxApplicable: quotationConfig.taxApplicable,
              absorbTax: quotationConfig.absorbTax,
              gstPercent: quotationConfig.gstPercent,
            },
            deliveryTo: quotationConfig.deliveryTo || "",
            sourceDocumentId: quotation.id,
            sourceDocumentType: "QUOTATION",
            sourceDocumentNumber: quotation.name,
          });

          // Populate items from quotation
          if (quotationConfig.items && Array.isArray(quotationConfig.items)) {
            const newItems = quotationConfig.items.map((item: any, index: number) => ({
              id: Date.now() + index,
              itemCode: item.itemCode || "",
              inventoryItemId: item.inventoryItemId || "",
              description: item.description || "",
              quantity: item.quantity || 1,
              unitPrice: item.unitPrice || 0,
              uom: item.uom || "",
              discount: item.discount || 0,
              amount: item.amount || (item.quantity || 1) * (item.unitPrice || 0),
            }));
            setItems(newItems);
          }

          toast.success(`Quotation ${quotation.name} extracted to Delivery Order`);
        }}
        onSelectMultipleQuotations={(quotations) => {
          // Merge multiple quotations into the delivery order
          if (!quotations.length) return;

          // Use the first quotation for customer/header info (they should all have the same customer)
          const firstQuotation = quotations[0];
          const quotationConfig = firstQuotation.config || {};

          // Look up customer address from customers list if not in quotation config
          const customerId = quotationConfig.customerId || "";
          const customerFromList = customers.find((c: any) => c.id === customerId);
          const customerAddress = quotationConfig.customerAddress || customerFromList?.address || "";

          // Collect all source document references
          const sourceDocumentNumbers = quotations.map(q => q.name).join(", ");
          const sourceDocumentIds = quotations.map(q => q.id);

          // Update form data with quotation info from first quotation
          setFormData({
            ...formData,
            customer: {
              id: customerId,
              name: quotationConfig.customerName || customerFromList?.name || "",
              address: customerAddress,
              email: quotationConfig.customerEmail || customerFromList?.email || "",
              customerCode: quotationConfig.customerCode || customerFromList?.customerCode || "",
              gstRegNo: quotationConfig.customerGstRegNo || customerFromList?.gstRegNo || "",
            },
            documentInfo: {
              ...formData.documentInfo,
              salesPerson: quotationConfig.salesmanCode || quotationConfig.salesPerson || "",
              poNo: quotationConfig.poNo || quotationConfig.referenceNo || "",
              contact: quotationConfig.contact || "",
              paymentTerms: quotationConfig.paymentTerms || "",
              currency: quotationConfig.currency || "",
              rate: quotationConfig.rate || "",
              taxApplicable: quotationConfig.taxApplicable,
              absorbTax: quotationConfig.absorbTax,
              gstPercent: quotationConfig.gstPercent,
            },
            deliveryTo: quotationConfig.deliveryTo || "",
            sourceDocumentId: sourceDocumentIds.join(","), // Store multiple IDs as comma-separated
            sourceDocumentType: "QUOTATION",
            sourceDocumentNumber: sourceDocumentNumbers,
          });

          // Merge items from all quotations
          let allItems: any[] = [];
          let itemIdCounter = Date.now();

          quotations.forEach((quotation) => {
            const config = quotation.config || {};
            if (config.items && Array.isArray(config.items)) {
              const newItems = config.items.map((item: any) => ({
                id: itemIdCounter++,
                itemCode: item.itemCode || "",
                inventoryItemId: item.inventoryItemId || "",
                description: item.description || "",
                quantity: item.quantity || 1,
                unitPrice: item.unitPrice || 0,
                uom: item.uom || "",
                discount: item.discount || 0,
                amount: item.amount || (item.quantity || 1) * (item.unitPrice || 0),
                sourceQuotationNumber: quotation.name, // Track which quotation this item came from
              }));
              allItems = [...allItems, ...newItems];
            }
          });

          setItems(allItems);

          toast.success(`${quotations.length} Quotations extracted to Delivery Order`);
        }}
      />

      {/* Extract DO to Invoice Dialog - for Invoice */}
      <ExtractDOToInvoiceDialog
        open={extractDODialogOpen}
        onClose={() => setExtractDODialogOpen(false)}
        deliveryOrders={deliveryOrdersForExtract}
        selectedCustomerId={formData.customer?.id}
        selectedCustomerName={formData.customer?.name}
        onSelectDO={(deliveryOrder) => {
          // Populate Invoice with data from the selected Delivery Order
          const doConfig = deliveryOrder.config || {};

          // Look up customer address from customers list if not in DO config
          const customerId = doConfig.customerId || "";
          const customerFromList = customers.find((c: any) => c.id === customerId);
          const customerAddress = doConfig.customerAddress || customerFromList?.address || "";

          // Update form data with DO info
          setFormData({
            ...formData,
            customer: {
              id: customerId,
              name: doConfig.customerName || customerFromList?.name || "",
              address: customerAddress,
              email: doConfig.customerEmail || customerFromList?.email || "",
              customerCode: doConfig.customerCode || customerFromList?.customerCode || "",
              gstRegNo: doConfig.customerGstRegNo || customerFromList?.gstRegNo || "",
            },
            documentInfo: {
              ...formData.documentInfo,
              doNo: deliveryOrder.name || "", // Fill in D/O Number from the extracted DO
              salesPerson: doConfig.salesmanCode || doConfig.salesPerson || "",
              poNo: doConfig.poNo || doConfig.referenceNo || "",
              contact: doConfig.contact || "",
              paymentTerms: doConfig.paymentTerms || "",
              currency: doConfig.currency || "",
              rate: doConfig.rate || "",
              taxApplicable: doConfig.taxApplicable,
              absorbTax: doConfig.absorbTax,
              gstPercent: doConfig.gstPercent,
            },
            deliveryTo: doConfig.deliveryTo || "",
            sourceDocumentId: deliveryOrder.id,
            sourceDocumentType: "DELIVERY_ORDER",
            sourceDocumentNumber: deliveryOrder.name,
          });

          // Populate items from delivery order
          if (doConfig.items && Array.isArray(doConfig.items)) {
            const newItems = doConfig.items.map((item: any, index: number) => ({
              id: Date.now() + index,
              itemCode: item.itemCode || "",
              inventoryItemId: item.inventoryItemId || "",
              description: item.description || "",
              quantity: item.quantity || 1,
              unitPrice: item.unitPrice || 0,
              uom: item.uom || "",
              discount: item.discount || 0,
              amount: item.amount || (item.quantity || 1) * (item.unitPrice || 0),
            }));
            setItems(newItems);
          }

          toast.success(`Delivery Order ${deliveryOrder.name} extracted to Invoice`);
        }}
        onSelectMultipleDOs={(deliveryOrders) => {
          // Merge multiple delivery orders into the invoice
          if (!deliveryOrders.length) return;

          // Use the first DO for customer/header info (they should all have the same customer)
          const firstDO = deliveryOrders[0];
          const doConfig = firstDO.config || {};

          // Look up customer address from customers list if not in DO config
          const customerId = doConfig.customerId || "";
          const customerFromList = customers.find((c: any) => c.id === customerId);
          const customerAddress = doConfig.customerAddress || customerFromList?.address || "";

          // Collect all source document references
          const sourceDocumentNumbers = deliveryOrders.map(d => d.name).join(", ");
          const sourceDocumentIds = deliveryOrders.map(d => d.id);

          // Update form data with DO info from first delivery order
          setFormData({
            ...formData,
            customer: {
              id: customerId,
              name: doConfig.customerName || customerFromList?.name || "",
              address: customerAddress,
              email: doConfig.customerEmail || customerFromList?.email || "",
              customerCode: doConfig.customerCode || customerFromList?.customerCode || "",
              gstRegNo: doConfig.customerGstRegNo || customerFromList?.gstRegNo || "",
            },
            documentInfo: {
              ...formData.documentInfo,
              doNo: sourceDocumentNumbers, // Fill in D/O Number(s) from the extracted DOs
              salesPerson: doConfig.salesmanCode || doConfig.salesPerson || "",
              poNo: doConfig.poNo || doConfig.referenceNo || "",
              contact: doConfig.contact || "",
              paymentTerms: doConfig.paymentTerms || "",
              currency: doConfig.currency || "",
              rate: doConfig.rate || "",
              taxApplicable: doConfig.taxApplicable,
              absorbTax: doConfig.absorbTax,
              gstPercent: doConfig.gstPercent,
            },
            deliveryTo: doConfig.deliveryTo || "",
            sourceDocumentId: sourceDocumentIds.join(","), // Store multiple IDs as comma-separated
            sourceDocumentType: "DELIVERY_ORDER",
            sourceDocumentNumber: sourceDocumentNumbers,
          });

          // Merge items from all delivery orders
          let allItems: any[] = [];
          let itemIdCounter = Date.now();

          deliveryOrders.forEach((deliveryOrder) => {
            const config = deliveryOrder.config || {};
            if (config.items && Array.isArray(config.items)) {
              const newItems = config.items.map((item: any) => ({
                id: itemIdCounter++,
                itemCode: item.itemCode || "",
                inventoryItemId: item.inventoryItemId || "",
                description: item.description || "",
                quantity: item.quantity || 1,
                unitPrice: item.unitPrice || 0,
                uom: item.uom || "",
                discount: item.discount || 0,
                amount: item.amount || (item.quantity || 1) * (item.unitPrice || 0),
                sourceDoNumber: deliveryOrder.name, // Track which DO this item came from
              }));
              allItems = [...allItems, ...newItems];
            }
          });

          setItems(allItems);

          toast.success(`${deliveryOrders.length} Delivery Orders extracted to Invoice`);
        }}
      />

      {/* Extract Quotation to Sales Order Dialog - for SO */}
      <ExtractQuotationToSODialog
        open={extractQuotationToSODialogOpen}
        onClose={() => setExtractQuotationToSODialogOpen(false)}
        quotations={quotationsForExtract}
        selectedCustomerId={formData.customer?.id}
        selectedCustomerName={formData.customer?.name}
        onSelectQuotation={(quotation) => {
          // Populate SO with data from the selected quotation
          const quotationConfig = quotation.config || {};

          // Look up customer address from customers list if not in quotation config
          const customerId = quotationConfig.customerId || "";
          const customerFromList = customers.find((c: any) => c.id === customerId);
          const customerAddress = quotationConfig.customerAddress || customerFromList?.address || "";

          // Update form data with quotation info
          setFormData({
            ...formData,
            customer: {
              id: customerId,
              name: quotationConfig.customerName || customerFromList?.name || "",
              address: customerAddress,
              email: quotationConfig.customerEmail || customerFromList?.email || "",
              customerCode: quotationConfig.customerCode || customerFromList?.customerCode || "",
              gstRegNo: quotationConfig.customerGstRegNo || customerFromList?.gstRegNo || "",
            },
            documentInfo: {
              ...formData.documentInfo,
              salesPerson: quotationConfig.salesmanCode || quotationConfig.salesPerson || "",
              poNo: quotationConfig.poNo || quotationConfig.referenceNo || "",
              contact: quotationConfig.contact || "",
              paymentTerms: quotationConfig.paymentTerms || "",
              currency: quotationConfig.currency || "",
              rate: quotationConfig.rate || "",
              taxApplicable: quotationConfig.taxApplicable,
              absorbTax: quotationConfig.absorbTax,
              gstPercent: quotationConfig.gstPercent,
            },
            deliveryTo: quotationConfig.deliveryTo || "",
            sourceDocumentId: quotation.id,
            sourceDocumentType: "QUOTATION",
            sourceDocumentNumber: quotation.name,
          });

          // Populate items from quotation
          if (quotationConfig.items && Array.isArray(quotationConfig.items)) {
            const newItems = quotationConfig.items.map((item: any, index: number) => ({
              id: Date.now() + index,
              itemCode: item.itemCode || "",
              inventoryItemId: item.inventoryItemId || "",
              description: item.description || "",
              quantity: item.quantity || 1,
              unitPrice: item.unitPrice || 0,
              uom: item.uom || "",
              discount: item.discount || 0,
              amount: item.amount || (item.quantity || 1) * (item.unitPrice || 0),
            }));
            setItems(newItems);
          }

          toast.success(`Quotation ${quotation.name} extracted to Sales Order`);
        }}
        onSelectMultipleQuotations={(quotations) => {
          // Merge multiple quotations into the sales order
          if (!quotations.length) return;

          // Use the first quotation for customer/header info (they should all have the same customer)
          const firstQuotation = quotations[0];
          const quotationConfig = firstQuotation.config || {};

          // Look up customer address from customers list if not in quotation config
          const customerId = quotationConfig.customerId || "";
          const customerFromList = customers.find((c: any) => c.id === customerId);
          const customerAddress = quotationConfig.customerAddress || customerFromList?.address || "";

          // Collect all source document references
          const sourceDocumentNumbers = quotations.map(q => q.name).join(", ");
          const sourceDocumentIds = quotations.map(q => q.id);

          // Update form data with quotation info from first quotation
          setFormData({
            ...formData,
            customer: {
              id: customerId,
              name: quotationConfig.customerName || customerFromList?.name || "",
              address: customerAddress,
              email: quotationConfig.customerEmail || customerFromList?.email || "",
              customerCode: quotationConfig.customerCode || customerFromList?.customerCode || "",
              gstRegNo: quotationConfig.customerGstRegNo || customerFromList?.gstRegNo || "",
            },
            documentInfo: {
              ...formData.documentInfo,
              salesPerson: quotationConfig.salesmanCode || quotationConfig.salesPerson || "",
              poNo: quotationConfig.poNo || quotationConfig.referenceNo || "",
              contact: quotationConfig.contact || "",
              paymentTerms: quotationConfig.paymentTerms || "",
              currency: quotationConfig.currency || "",
              rate: quotationConfig.rate || "",
              taxApplicable: quotationConfig.taxApplicable,
              absorbTax: quotationConfig.absorbTax,
              gstPercent: quotationConfig.gstPercent,
            },
            deliveryTo: quotationConfig.deliveryTo || "",
            sourceDocumentId: sourceDocumentIds.join(","), // Store multiple IDs as comma-separated
            sourceDocumentType: "QUOTATION",
            sourceDocumentNumber: sourceDocumentNumbers,
          });

          // Merge items from all quotations
          let allItems: any[] = [];
          let itemIdCounter = Date.now();

          quotations.forEach((quotation) => {
            const config = quotation.config || {};
            if (config.items && Array.isArray(config.items)) {
              const newItems = config.items.map((item: any) => ({
                id: itemIdCounter++,
                itemCode: item.itemCode || "",
                inventoryItemId: item.inventoryItemId || "",
                description: item.description || "",
                quantity: item.quantity || 1,
                unitPrice: item.unitPrice || 0,
                uom: item.uom || "",
                discount: item.discount || 0,
                amount: item.amount || (item.quantity || 1) * (item.unitPrice || 0),
                sourceQuotationNumber: quotation.name, // Track which quotation this item came from
              }));
              allItems = [...allItems, ...newItems];
            }
          });

          setItems(allItems);

          toast.success(`${quotations.length} Quotations extracted to Sales Order`);
        }}
      />

      {/* Customer/Supplier Select Dialog */}
      <CustomerSelectDialog
        open={customerDialogOpen}
        onClose={() => setCustomerDialogOpen(false)}
        customers={isSupplierDialog ? suppliers : customers}
        onSelectCustomer={(customer) => {
          if (customerStoreMode === "code") {
            const setNestedValue = (obj: any, path: string, value: any) => {
              const newObj = JSON.parse(JSON.stringify(obj));
              const parts = path.split('.');
              let current = newObj;
              for (let i = 0; i < parts.length - 1; i++) {
                if (!current[parts[i]]) current[parts[i]] = {};
                current = current[parts[i]];
              }
              current[parts[parts.length - 1]] = value;
              return newObj;
            };
            // Store the code at the specified path (supplierCode for suppliers, customerCode for customers)
            const code = isSupplierDialog ? ((customer as any).supplierCode || customer.customerCode || "") : (customer.customerCode || "");
            let updatedFormData = setNestedValue(formData, customerFieldName, code);
            // Also store supplier name and address for PO/PR preview
            updatedFormData = setNestedValue(updatedFormData, "documentInfo.supplierName", customer.name || "");
            updatedFormData = setNestedValue(updatedFormData, "documentInfo.supplierAddress", customer.address || "");
            setFormData(updatedFormData);
          } else {
            // For regular customer field: store full customer object
            // Also auto-fill salesman if customer has one assigned
            const salesmanCode = customer.salesman?.salesmanCode || "";
            console.log("Customer selected:", customer);
            console.log("Customer address:", customer.address);
            setFormData({
              ...formData,
              customer: {
                id: customer.id || "",
                name: customer.name || "",
                address: customer.address || "",
                email: customer.email || "",
                customerCode: customer.customerCode || "",
                gstRegNo: (customer as any).gstRegNo || "",
              },
              // Auto-fill salesman from customer's assigned salesman
              ...(salesmanCode && {
                documentInfo: {
                  ...formData.documentInfo,
                  salesPerson: salesmanCode,
                },
              }),
            });
            // Call the customer change handler to fetch related data
            if (onCustomerChange && customer.id) {
              onCustomerChange(customer.id);
            }
          }
        }}
      />

      {/* Salesman Select Dialog */}
      <SalesmanSelectDialog
        open={salesmanDialogOpen}
        onClose={() => setSalesmanDialogOpen(false)}
        salesmen={salesmen}
        onSelectSalesman={(salesman) => {
          // Set the value at the tracked field path (e.g., "documentInfo.salesPerson" or "documentInfo.purchaserCode")
          const setNestedValue = (obj: any, path: string, value: any) => {
            const newObj = JSON.parse(JSON.stringify(obj)); // Deep clone
            const parts = path.split('.');
            let current = newObj;
            for (let i = 0; i < parts.length - 1; i++) {
              if (!current[parts[i]]) current[parts[i]] = {};
              current = current[parts[i]];
            }
            current[parts[parts.length - 1]] = value;
            return newObj;
          };
          setFormData(setNestedValue(formData, salesmanFieldName, salesman.salesmanCode || ""));
        }}
      />
    </Box>
  );
}