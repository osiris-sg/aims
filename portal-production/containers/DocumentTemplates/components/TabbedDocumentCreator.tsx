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
  Menu,
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
  Tooltip,
  Collapse,
  Stack,
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
  OpenInNew as OpenInNewIcon,
  History as HistoryIcon,
  Close as CloseIcon,
  Email as EmailIcon,
  Payment as PaymentIcon,
  NavigateBefore as NavigateBeforeIcon,
  NavigateNext as NavigateNextIcon,
  Inventory as InventoryIcon,
  Search as SearchIcon,
  LocalShipping as ReceiveIcon,
  UnfoldLess as UnfoldLessIcon,
  UnfoldMore as UnfoldMoreIcon,
  LocalOffer as PriceTagIcon,
  Route as RouteIcon,
} from "@mui/icons-material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import CleanDocumentPreview from "./CleanDocumentPreview";
// Shared dialog — same component used by the Field Reports tab on the
// project detail page. Renders a Leaflet map of the live delivery route
// from /maintenance-reports/:reportId/location-track.
import DeliveryRouteDialog from "@/components/DeliveryRouteDialog";
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
  const { isServiceItemsEnabled, isAssetPointsEnabled, isItemTaggingEnabled: isItemTaggingFlagOn, isConfirmQuotationEnabled, isNettRoundDownEnabled } = useOrganizationFeatures();
  // When enabled, the document's Nett Total is rounded DOWN to the nearest 5.
  const roundNettDown = (n: number) => (isNettRoundDownEnabled ? Math.floor((Number(n) || 0) / 5) * 5 : (Number(n) || 0));
  // Item tagging (checkbox column + Tag Items button) is scoped to quotation
  // doc types only — that's where the FCU/CU pairing makes sense. The flag
  // still gates org-level availability; the doc type narrows where it shows.
  const isItemTaggingEnabled =
    isItemTaggingFlagOn && (
      documentType === "QUOTATION" ||
      documentType === "QO" ||
      documentType === "QO1" ||
      documentType === "QO2" ||
      documentType === "QT"
    );

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
  // Collapse the General/Details fields panel to give the Items table more space.
  const [isFieldsCollapsed, setIsFieldsCollapsed] = useState(false);
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
  // Convert-after-confirm dialog state for quotations (gated by enableConfirmQuotation).
  const [convertQuotationDialogOpen, setConvertQuotationDialogOpen] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
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

  // Per-line price-tier menu (selling vs each customPrice on the asset).
  // Only opens for the row whose itemId matches; hidden entirely for PO/PR.
  const [tierMenu, setTierMenu] = useState<{ anchorEl: HTMLElement; itemId: number } | null>(null);

  // Stock card dialog state
  const [stockCardDialogOpen, setStockCardDialogOpen] = useState(false);
  // "add" = new line item, "tag" = attach picked asset to currently-checked rows.
  const [stockCardMode, setStockCardMode] = useState<"add" | "tag">("add");
  // FCU-CU (QF) stock-card picker: which row + whether we're picking the CU or
  // an FCU slot. Opens a dedicated, category-scoped StockCardDialog.
  const [qfPicker, setQfPicker] = useState<{ rowId: number; target: "cu" | "fcu" | "accessory"; slotIndex: number } | null>(null);

  // Item-tagging: tracks which item ids are checked in the leftmost column.
  // Cleared after a tagging round completes or all rows are deleted.
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const toggleItemSelected = (id: number) =>
    setSelectedItemIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Pending tag state — after a CU is picked from the Stock Card we open a
  // small dialog asking the user for the CU's qty + price before committing
  // the tag group. The CU has its own qty/price independent of the FCU rows.
  const [pendingTag, setPendingTag] = useState<{
    asset: any;
    rows: number[];
    qty: number;
    unitPrice: number;
  } | null>(null);

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

  // Delivery route dialog state (DO-only). Opens with the linked DO_START
  // MaintenanceServiceReport's id; the shared DeliveryRouteDialog handles
  // the fetch + polling internally. Must be declared AFTER isDeliveryOrder
  // — the useMemo's dep array references it, and a TDZ access here would
  // throw "Cannot access 'isDeliveryOrder' before initialization".
  const [routeDialogReportId, setRouteDialogReportId] = useState<string | null>(null);
  const doStartReportId = useMemo<string | null>(() => {
    if (!isDeliveryOrder) return null;
    const reports = (existingData as any)?.maintenanceReports as
      | Array<{ id: string; kind: string }>
      | undefined;
    return reports?.find((r) => r.kind === "DO_START")?.id ?? null;
  }, [isDeliveryOrder, existingData]);

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
  const [formData, setFormDataState] = useState({
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
  const [items, setItemsState] = useState(() => {
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

  // Tracks whether the user has actually edited anything in this document.
  // Auto-population / auto-calc effects call the raw setFormDataState /
  // setItemsState setters so they don't trip this; only edits routed through
  // the setFormData / setItems wrappers below (real UI interactions) mark the
  // document dirty. The back button uses this to decide whether to prompt
  // Save / Cancel / Delete — no prompt is shown if nothing was touched.
  const isDirtyRef = useRef(false);
  const setFormData = useCallback((update: any) => {
    isDirtyRef.current = true;
    setFormDataState(update);
  }, []);
  const setItems = useCallback((update: any) => {
    isDirtyRef.current = true;
    setItemsState(update);
  }, []);

  // Reset the dirty flag whenever a different document is loaded.
  useEffect(() => {
    isDirtyRef.current = false;
  }, [existingData]);

  // Fill in customer details from customers list if missing
  useEffect(() => {
    // Only run if we have a customer ID and customers list is loaded
    if (formData.customer?.id && customers?.length > 0) {
      const customer = customers.find((c: any) => c.id === formData.customer.id);
      if (customer) {
        const needsUpdate = !formData.customer?.address || !formData.customer?.customerCode;
        if (needsUpdate) {
          console.log('Filling in missing customer details from customers list:', customer);
          setFormDataState((prev: any) => ({
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
      setFormDataState((prev: any) => ({
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
      setFormDataState((prev: any) => {
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
    // For purchase docs (PO + PR) the default is asset.costPrice. In Products
    // mode `selectedItem.unitPrice` is pre-flattened to selling price, so we
    // can't fall back to it first — read costPrice explicitly and only drop to
    // selling if cost is unset.
    const isPurePurchaseType =
      documentType === "PO" || documentType === "PURCHASE_ORDER" ||
      documentType === "PR" || documentType === "PURCHASE_RETURN";
    const sellingPriceFallback = selectedItem.unitPrice ?? selectedItem.asset?.price ?? 0;
    const costPriceCandidate = selectedItem.costPrice ?? selectedItem.asset?.costPrice ?? null;
    let unitPrice = isPurePurchaseType
      ? (costPriceCandidate ?? sellingPriceFallback ?? 0)
      : (sellingPriceFallback ?? 0);
    // Apply asset points as a $1-per-point discount on sales-side docs (PO/PR
    // skip this — they pay supplier cost, no customer discount applies).
    if (!isPurePurchaseType && isAssetPointsEnabled) {
      const pts = Number(selectedItem.asset?.points || 0);
      if (pts > 0) unitPrice = Math.max(0, Number(unitPrice) - pts);
    }
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
          // Calculate amount (accounting for discount if present). discountType
          // is 'amount' for a flat $ discount, otherwise it's a % discount
          // (default — preserves existing behavior for rows without the field).
          const qty = Number(updated.quantity) || 0;
          const unit = Number(updated.unitPrice) || 0;
          const disc = Number(updated.discount) || 0;
          const gross = qty * unit;
          updated.amount =
            updated.discountType === "amount"
              ? Math.max(0, gross - disc)
              : gross * (1 - disc / 100);
          return updated;
        }
        return item;
      });
      return newItems;
    });
  };

  // ─── FCU-CU (QF) quotation helpers ──────────────────────────────────────
  // The QF variant swaps the item/taggedAsset columns for CU Model + FCU Model
  // dropdowns. Detected from the configured columns (no separate variant flag).
  const configuredColumnsForVariant = (existingData?.tableColumnOrder ?? existingData?.config?.tableColumnOrder) as string[] | undefined;
  const isFcuCuVariant = Array.isArray(configuredColumnsForVariant) && configuredColumnsForVariant.includes("cuModel");

  // Discount tier ("Discount Price" entry in the asset's customPrices).
  const discountPriceOf = (opt: any): number => {
    const cps = opt?.asset?.customPrices ?? opt?.customPrices;
    if (!Array.isArray(cps)) return 0;
    const hit = cps.find((cp: any) => cp && String(cp.label).toLowerCase() === "discount price");
    return Number(hit?.value) || 0;
  };

  const cuOptions = useMemo(
    () => inventoriesForDocument.filter((i: any) => (i.categoryName || i.category) === "Condensing Unit"),
    [inventoriesForDocument],
  );
  const fcuOptions = useMemo(
    () => inventoriesForDocument.filter((i: any) => (i.categoryName || i.category) === "Fan Coil Unit"),
    [inventoriesForDocument],
  );
  const accOptions = useMemo(
    () => inventoriesForDocument.filter((i: any) => (i.categoryName || i.category) === "Accessories"),
    [inventoriesForDocument],
  );
  // Children of a CU (single-split pairs). Empty => multi-split (mix-and-match).
  const childrenOfCu = (cuAssetId: string) =>
    inventoriesForDocument.filter((i: any) => i.parentAssetId === cuAssetId);
  const fcuOptionsForCu = (cuAssetId?: string) => {
    if (!cuAssetId) return fcuOptions;
    const kids = childrenOfCu(cuAssetId);
    return kids.length > 0 ? kids : fcuOptions;
  };

  // Recompute a QF row's prices. A row = ONE CU + N FCUs, each FCU with its own
  // qty, billed as one combined line: price = CU + sum(FCU.price × FCU.qty).
  // Single-split CUs (RKM, with a child) carry exactly their child FCU; multi-split
  // CUs (MKM, no children) hold several indoor units. CU is counted once.
  const recalcFcuCuRow = (row: any): any => {
    const cu = row.cuAssetId ? inventoriesForDocument.find((i: any) => i.id === row.cuAssetId) : null;
    const fcuRows = (row.fcus || [])
      .map((f: any) => ({ a: inventoriesForDocument.find((i: any) => i.id === f.assetId), qty: Number(f.qty) || 0 }))
      .filter((x: any) => x.a);
    // Accessories (Sky Air panel/remote/pump) — priced into the system, qty default 1.
    const accRows = (row.accessories || [])
      .map((a: any) => ({ a: inventoriesForDocument.find((i: any) => i.id === a.assetId), qty: Number(a.qty) || 1 }))
      .filter((x: any) => x.a);

    const sumFcu = (fn: (a: any) => number) => fcuRows.reduce((t: number, { a, qty }: any) => t + (Number(fn(a)) || 0) * qty, 0);
    const sumAcc = (fn: (a: any) => number) => accRows.reduce((t: number, { a, qty }: any) => t + (Number(fn(a)) || 0) * qty, 0);
    const pointsOf = (a: any) => (isAssetPointsEnabled ? (Number(a?.asset?.points ?? a?.points) || 0) : 0);
    // Unit Price = full LIST (points are NOT taken off the list). Dealer + points
    // are tracked per line; the document totals derive the Discounted Price from
    // (dealer − points − doc discount). See the totals useMemo / footer. Accessories
    // add to the system list/dealer/cost (they carry no points).
    const list = (Number(cu?.unitPrice) || 0) + sumFcu((a) => Number(a.unitPrice) || 0) + sumAcc((a) => Number(a.unitPrice) || 0);
    const dealer = (cu ? discountPriceOf(cu) : 0) + sumFcu((a) => discountPriceOf(a)) + sumAcc((a) => discountPriceOf(a));
    const cost = (Number(cu?.costPrice) || 0) + sumFcu((a) => a.costPrice) + sumAcc((a) => a.costPrice);
    const points = (cu ? pointsOf(cu) : 0) + sumFcu((a) => pointsOf(a));
    const label = [cu?.sku, ...fcuRows.map(({ a, qty }: any) => (qty > 1 ? `${qty}× ${a.sku}` : a.sku))].filter(Boolean).join(" + ");

    // Qty lives on each FCU now, so the row itself is a single combined unit.
    return { ...row, listPrice: list, discountPrice: dealer, costPrice: cost, pointsTotal: points, unitPrice: list, quantity: 1, amount: list, description: label, itemCode: label };
  };

  // Merge an FCU's tagged accessories (Sky Air panel + wired remote) into a row's
  // accessory list, de-duped (a shared panel isn't added twice).
  const addFcuAccessories = (accessories: any[], fcuObj: any) => {
    const next = [...(accessories || [])];
    for (const accId of (fcuObj?.accessoryIds || [])) {
      if (next.some((a: any) => a.assetId === accId)) continue;
      const acc = inventoriesForDocument.find((i: any) => i.id === accId);
      if (acc) next.push({ assetId: acc.id, code: acc.sku, name: acc.name, qty: 1 });
    }
    return next;
  };

  const handleSelectCu = (rowId: number, cuId: string) => {
    setItems((prev: any[]) => prev.map((it: any) => {
      if (it.id !== rowId) return it;
      const cu = inventoriesForDocument.find((i: any) => i.id === cuId);
      const kids = cu ? childrenOfCu(cu.id) : [];
      let fcus = it.fcus || [];
      let accessories = it.accessories || [];
      if (kids.length === 1) {
        // Exactly one compatible FCU (RKM, or single-child Sky Air): auto-pair it
        // and pull in its tagged accessories.
        fcus = [{ assetId: kids[0].id, code: kids[0].sku, name: kids[0].name, qty: 1 }];
        accessories = addFcuAccessories(accessories, kids[0]);
      } else {
        // Multiple compatible FCUs (Sky Air) or none (MKM): keep valid picks; the
        // FCU picker is scoped to the CU's children when it has any.
        fcus = fcus.filter((f: any) => inventoriesForDocument.some((i: any) => i.id === f.assetId));
      }
      return recalcFcuCuRow({ ...it, cuAssetId: cuId, cuCode: cu?.sku || "", cuName: cu?.name || "", fcus, accessories });
    }));
  };

  // Set/replace/remove the FCU at a given slot index (index === fcus.length appends).
  const setFcuAt = (rowId: number, index: number, fcuId: string) => {
    setItems((prev: any[]) => prev.map((it: any) => {
      if (it.id !== rowId) return it;
      const fcu = fcuId ? inventoriesForDocument.find((i: any) => i.id === fcuId) : null;
      const fcus = [...(it.fcus || [])];
      let accessories = it.accessories || [];
      if (!fcu) {
        if (index < fcus.length) fcus.splice(index, 1); // cleared -> drop the slot
      } else {
        const keepQty = index < fcus.length ? (Number(fcus[index]?.qty) || 1) : 1;
        const entry = { assetId: fcu.id, code: fcu.sku, name: fcu.name, qty: keepQty };
        if (index < fcus.length) fcus[index] = entry; else fcus.push(entry);
        accessories = addFcuAccessories(accessories, fcu); // auto-add the FCU's tagged accessories
      }
      return recalcFcuCuRow({ ...it, fcus, accessories });
    }));
  };

  // Per-FCU quantity.
  const setFcuQtyAt = (rowId: number, index: number, qty: number) => {
    setItems((prev: any[]) => prev.map((it: any) => {
      if (it.id !== rowId) return it;
      const fcus = [...(it.fcus || [])];
      if (index < fcus.length) fcus[index] = { ...fcus[index], qty };
      return recalcFcuCuRow({ ...it, fcus });
    }));
  };

  // Set/replace/remove an accessory slot (panel/remote/pump). Qty defaults to 1.
  const setAccessoryAt = (rowId: number, index: number, accId: string) => {
    setItems((prev: any[]) => prev.map((it: any) => {
      if (it.id !== rowId) return it;
      const acc = accId ? inventoriesForDocument.find((i: any) => i.id === accId) : null;
      const accessories = [...(it.accessories || [])];
      if (!acc) {
        if (index < accessories.length) accessories.splice(index, 1);
      } else {
        const entry = { assetId: acc.id, code: acc.sku, name: acc.name, qty: 1 };
        if (index < accessories.length) accessories[index] = entry; else accessories.push(entry);
      }
      return recalcFcuCuRow({ ...it, accessories });
    }));
  };

  const addFcuCuRow = () => {
    setItems((prev: any[]) => [
      ...prev,
      { id: Date.now(), cuAssetId: "", cuCode: "", cuName: "", fcus: [], accessories: [], quantity: 1, listPrice: 0, discountPrice: 0, costPrice: 0, unitPrice: 0, amount: 0 },
    ]);
  };

  // Open the QF stock-card picker for a row's CU, an FCU slot, or an accessory slot.
  const openQfPicker = (rowId: number, target: "cu" | "fcu" | "accessory", slotIndex: number) =>
    setQfPicker({ rowId, target, slotIndex });

  // Items shown in the QF picker: CUs, FCUs scoped to the CU's children, or accessories.
  const qfPickerRow = qfPicker ? items.find((it: any) => it.id === qfPicker.rowId) : null;
  const qfPickerItems = !qfPicker
    ? []
    : qfPicker.target === "cu"
    ? cuOptions
    : qfPicker.target === "accessory"
    ? accOptions
    : fcuOptionsForCu(qfPickerRow?.cuAssetId);

  const handleQfPick = (picked: any) => {
    if (!qfPicker) return;
    const id = picked?.id || picked?.assetId || "";
    if (qfPicker.target === "cu") handleSelectCu(qfPicker.rowId, id);
    else if (qfPicker.target === "accessory") setAccessoryAt(qfPicker.rowId, qfPicker.slotIndex, id);
    else setFcuAt(qfPicker.rowId, qfPicker.slotIndex, id);
    setQfPicker(null);
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
    const discountValue = parseFloat(di?.discountPercent) || 0;
    const discountType = di?.discountType || "percent";
    const gstPercent = isTaxApplicable ? (parseFloat(di?.gstPercent) || organization?.taxRate || 9) : 0;
    const r2 = (n: number) => parseFloat((Number(n) || 0).toFixed(2));

    // FCU-CU (QF) waterfall: Gross = Σ Unit Price (list); Discounted Price =
    // Σ Dealer − Σ Points − doc discount; Nett = Discounted Price + GST.
    if (isFcuCuVariant) {
      const grossTotal = items.reduce((a: number, it: any) => a + (Number(it.listPrice) || 0), 0);
      const dealerTotal = items.reduce((a: number, it: any) => a + (Number(it.discountPrice) || 0), 0);
      const pointsTotal = items.reduce((a: number, it: any) => a + (Number(it.pointsTotal) || 0), 0);
      const afterPoints = Math.max(0, dealerTotal - pointsTotal);
      const discountAmount = discountType === "amount" ? Math.min(discountValue, afterPoints) : afterPoints * (discountValue / 100);
      const discountedPrice = Math.max(0, afterPoints - discountAmount);
      let gstAmount: number, nettTotal: number;
      if (isAbsorbTax && gstPercent > 0) {
        nettTotal = discountedPrice;
        gstAmount = nettTotal * gstPercent / (100 + gstPercent);
      } else {
        gstAmount = discountedPrice * (gstPercent / 100);
        nettTotal = discountedPrice + gstAmount;
      }
      setFormDataState((prev: any) => ({
        ...prev,
        documentInfo: {
          ...prev.documentInfo,
          grossTotal: r2(grossTotal),
          dealerTotal: r2(dealerTotal),
          pointsTotal: r2(pointsTotal),
          discountAmount: r2(discountAmount),
          discountedPrice: r2(discountedPrice),
          subTotal: r2(discountedPrice),
          gstAmount: r2(gstAmount),
          nettTotal: r2(roundNettDown(nettTotal)),
        },
      }));
      return;
    }

    const grossTotal = subtotal;
    // Per-document discount: either a % of the gross or a flat $ amount (capped at gross).
    const discountAmount = discountType === "amount"
      ? Math.min(discountValue, grossTotal)
      : grossTotal * (discountValue / 100);
    const subTotalAfterDiscount = grossTotal - discountAmount;

    let gstAmount: number;
    let nettTotal: number;

    if (isAbsorbTax && gstPercent > 0) {
      // Absorb tax: total stays the same, GST is back-calculated from within
      nettTotal = subTotalAfterDiscount;
      gstAmount = nettTotal * gstPercent / (100 + gstPercent);
    } else {
      // Normal: GST added on top
      gstAmount = subTotalAfterDiscount * (gstPercent / 100);
      nettTotal = subTotalAfterDiscount + gstAmount;
    }

    setFormDataState((prev: any) => ({
      ...prev,
      documentInfo: {
        ...prev.documentInfo,
        grossTotal: r2(grossTotal),
        discountAmount: r2(discountAmount),
        subTotal: isAbsorbTax ? r2(subTotalAfterDiscount - gstAmount) : r2(subTotalAfterDiscount),
        gstAmount: r2(gstAmount),
        nettTotal: r2(nettTotal),
      },
    }));
  }, [subtotal, items, isFcuCuVariant, isNettRoundDownEnabled, (formData?.documentInfo as any)?.discountPercent, (formData?.documentInfo as any)?.discountType, (formData?.documentInfo as any)?.gstPercent, formData?.documentInfo?.taxApplicable, formData?.documentInfo?.absorbTax, isTaxApplicable, isAbsorbTax]);

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

  // Quotation-specific confirm flow: save with status=confirmed, then prompt the
  // user to optionally convert the quotation into a PO / DO / Invoice via the
  // ConvertQuotation dialog. Does NOT reload — the dialog handles next steps.
  const handleConfirmQuotation = async () => {
    setIsConfirming(true);
    try {
      const currentUserName = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || 'SYS';
      const currentTimestamp = new Date().toISOString();
      const saveData = {
        ...formData,
        items: items,
        name: formData.name || formData.documentInfo.documentNumber,
        status: "confirmed",
        confirmedBy: currentUserName,
        confirmedAt: currentTimestamp,
        lastUsedBy: currentUserName,
        lastUsedAt: currentTimestamp,
      };
      await onSave?.(saveData);
      toast.success("Quotation confirmed");
      setConvertQuotationDialogOpen(true);
    } catch (error) {
      console.error("Error confirming quotation:", error);
      toast.error("Failed to confirm quotation");
    } finally {
      setIsConfirming(false);
    }
  };

  // Convert the just-confirmed quotation into a new draft of the chosen type.
  // Looks up the active template for that type, pre-fills customer + items,
  // creates the new draft, and navigates to it.
  const handleConvertQuotation = async (targetType: "PO" | "DO" | "INVOICE") => {
    setIsConverting(true);
    try {
      const token = await getToken();
      if (!token) {
        toast.error("Not authenticated");
        return;
      }
      // DocumentTemplate.type stores canonical long names: DELIVERY_ORDER (not
      // DO), INVOICE, PO (sometimes PURCHASE_ORDER). Try the long form first,
      // then fall back so we don't 404 in orgs that still have legacy rows.
      const candidateTypes =
        targetType === "DO"
          ? ["DELIVERY_ORDER", "DO"]
          : targetType === "PO"
          ? ["PO", "PURCHASE_ORDER"]
          : ["INVOICE"];
      let newTemplateId: string | undefined;
      let resolvedType: string | undefined;
      for (const t of candidateTypes) {
        try {
          const r = await request(
            { path: `/documentTemplates/type/${t}`, method: "GET" },
            {},
            token,
          );
          if (r?.success && r?.data?.id) {
            newTemplateId = r.data.id;
            resolvedType = t;
            break;
          }
        } catch {
          // 404 → next candidate.
        }
      }
      if (!newTemplateId || !resolvedType) {
        toast.error(`No ${targetType} template found for this organization`);
        return;
      }

      // PO conversion: flatten any tag groups into independent line items and
      // swap each unit price for the asset's costPrice (since a PO is what we
      // pay the supplier, not what we quote the customer). The FCU/CU grouping
      // is intentionally dropped — every item gets its own row.
      // DO / Invoice: keep items as-is (customer-facing pricing stays).
      const lookupCost = (it: any): number => {
        const inv = inventoriesForDocument.find((i: any) =>
          i.id === it.inventoryItemId ||
          i.assetId === it.inventoryItemId ||
          i.asset?.id === it.inventoryItemId ||
          i.assetId === it.taggedAssetId ||
          i.asset?.id === it.taggedAssetId,
        );
        const cost = inv?.asset?.costPrice;
        if (cost != null) return Number(cost);
        return Number(inv?.asset?.price ?? it.unitPrice ?? 0);
      };
      const buildPOItems = () =>
        items.map((it: any, idx: number) => {
          const qty = Number(it.quantity || 1);
          const cost = lookupCost(it);
          // For tag-group items the FCU/CU asset info already lives on the row;
          // for FCU rows we use their own itemCode/description.
          return {
            id: Date.now() + idx,
            itemCode: it.itemCode || it.taggedAssetCode || "",
            inventoryItemId: it.inventoryItemId || it.taggedAssetId || "",
            description: it.description || it.taggedAssetName || "",
            uom: it.uom || "PCS",
            quantity: qty,
            unitPrice: cost,
            discount: 0,
            amount: qty * cost,
          };
        });

      const isPoTarget = targetType === "PO";
      const sourceConfig = {
        customer: formData.customer,
        customerId: formData.customer?.id,
        customerName: formData.customer?.name,
        items: isPoTarget ? buildPOItems() : items.map((it: any) => ({ ...it })),
        documentInfo: {
          ...formData.documentInfo,
        },
        sourceDocumentId: existingData?.id || documentId,
        sourceDocumentType: "QUOTATION",
        sourceDocumentNumber: formData.name || formData.documentInfo?.documentNumber,
      };

      const created = await request(
        { path: "/documents/basic", method: "POST" },
        {
          type: resolvedType,
          documentTemplateId: newTemplateId,
          config: sourceConfig,
        },
        token,
      );
      if (!created?.success || !created?.data?.id) {
        toast.error(`Failed to create ${targetType}`);
        return;
      }
      toast.success(`Created ${targetType} from quotation`);
      setConvertQuotationDialogOpen(false);
      router.push(`/portal/documents/${resolvedType}/${newTemplateId}/${created.data.id}`);
    } catch (err: any) {
      console.error("Convert quotation failed:", err);
      toast.error(err?.message || "Conversion failed");
    } finally {
      setIsConverting(false);
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
      // Only prompt if the user actually touched something in the document.
      const hasChanges = isDirtyRef.current;

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
          gap: 2,
          bgcolor: "background.paper",
          // Uniform-height action row — every button & icon-button matches.
          "& .MuiButton-root": {
            height: 30,
            whiteSpace: "nowrap",
            textTransform: "none",
            fontSize: "0.75rem",
            fontWeight: 500,
            px: 1,
            "& .MuiButton-startIcon": { mr: 0.5, "& > svg": { fontSize: "1rem" } },
          },
          "& .MuiIconButton-sizeSmall": { height: 30, width: 30 },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, flex: "1 1 auto" }}>
          <IconButton
            onClick={handleBackClick}
            size="small"
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography
            variant="h6"
            fontWeight="500"
            noWrap
            sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {isTemplateEditMode
              ? existingData?.name || `${getDocumentTitle()} Template`
              : formData.name || formData.documentInfo.documentNumber || `${getDocumentTitle()} - New`}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", flexShrink: 0, flexWrap: "nowrap" }}>
          {/* Show Route — DO-only. Disabled with tooltip when no delivery has
              been started yet (no DO_START MaintenanceServiceReport linked).
              Tooltip wrapper needs the <span> because MUI Tooltip won't fire
              on a disabled child otherwise. */}
          {isDeliveryOrder && (
            <Tooltip
              title={
                doStartReportId
                  ? "Show delivery route on map"
                  : "No delivery started yet"
              }
            >
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<RouteIcon />}
                  onClick={() => doStartReportId && setRouteDialogReportId(doStartReportId)}
                  disabled={!doStartReportId}
                >
                  Show Route
                </Button>
              </span>
            </Tooltip>
          )}
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
          {/* Extract Button - Invoices: Quotation if service items feature on, else DO */}
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
                  const response = await request(
                    { path: "/documents", method: "POST" },
                    { organizationId: organization?.id },
                    token
                  );
                  if (!response?.success) {
                    toast.error("Failed to fetch documents");
                    return;
                  }
                  if (isServiceItemsEnabled) {
                    const quotationTypes = ["QUOTATION", "QT", "QO", "QO1"];
                    const quotations = (response.data || []).filter((doc: any) => {
                      const docType = doc.type || doc.documentType || "";
                      return quotationTypes.includes(docType.toUpperCase());
                    });
                    setQuotationsForExtract(quotations);
                    setExtractQuotationDialogOpen(true);
                  } else {
                    const doTypes = ["DELIVERY_ORDER", "DO"];
                    const deliveryOrders = (response.data || []).filter((doc: any) => {
                      const docType = doc.type || doc.documentType || "";
                      return doTypes.includes(docType.toUpperCase());
                    });
                    setDeliveryOrdersForExtract(deliveryOrders);
                    setExtractDODialogOpen(true);
                  }
                } catch (error) {
                  console.error("Error fetching documents:", error);
                  toast.error("Failed to fetch documents");
                }
              }}
              color="secondary"
            >
              {isServiceItemsEnabled ? "Extract from Quotation" : "Extract from DO"}
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
          {/* View Original — present when this doc was created from an upload
              and we stashed the source PDF/image in S3. */}
          {(existingData?.config?.sourceFileUrl || (existingData as any)?.sourceFileUrl) && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<OpenInNewIcon />}
              onClick={() =>
                window.open(
                  existingData?.config?.sourceFileUrl || (existingData as any)?.sourceFileUrl,
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              View Original
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
          {/* Confirm button for Quotations — only when enableConfirmQuotation is on.
              After confirm saves, a popup asks if the user wants to convert the
              quotation into a PO / DO / Invoice. */}
          {!isDocumentConfirmed && !isTemplateEditMode && isConfirmQuotationEnabled &&
           (documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" || documentType === "QO2") && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<CheckCircleIcon />}
              onClick={handleConfirmQuotation}
              disabled={isConfirming}
              color="success"
            >
              {isConfirming ? "Confirming..." : "Confirm Quotation"}
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
                bgcolor: "surfaceTones.low",
                borderBottom: 1,
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

          {/* Project picker for template-driven DO/Invoice/Quotation flows.
              Lives outside the dynamic tabs so it's visible regardless of which
              tab is active (the legacy Details tab has its own copy below).
              QUOTATION variants additionally call PATCH /documents/:id/link-project
              on change so the link is committed without needing a full save. */}
          {templateFieldConfig && (
            documentType === "DO" ||
            documentType === "TI" ||
            documentType === "TI2" ||
            documentType === "INVOICE" ||
            documentType === "QUOTATION" ||
            documentType === "QO" ||
            documentType === "QO1" ||
            documentType === "QT"
          ) && (
            <Card sx={{ mb: 0.5 }}>
              <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.25 }}>
                  Linked Project
                </Typography>
                <Divider sx={{ mb: 0.5 }} />
                <Autocomplete
                  size="small"
                  options={projects.filter((p) => !formData.customer.id || !p.customerId || p.customerId === formData.customer.id)}
                  getOptionLabel={(option) => option.name}
                  value={projects.find((p) => p.id === formData.projectId) || null}
                  onChange={async (_, newValue) => {
                    const previousId = formData.projectId;
                    const nextId = newValue?.id || "";
                    setFormData({ ...formData, projectId: nextId });
                    // Live PATCH only for QUOTATIONs on already-saved documents.
                    // New/unsaved docs will pick up the projectId on first save.
                    const isQuotation =
                      documentType === "QUOTATION" ||
                      documentType === "QO" ||
                      documentType === "QO1" ||
                      documentType === "QT";
                    if (!isQuotation || !documentId) return;
                    try {
                      const token = await getToken();
                      if (!token) return;
                      const res = await request(
                        { path: `/documents/${documentId}/link-project`, method: "PATCH" },
                        { projectId: nextId || null },
                        token,
                      );
                      if (res?.success) {
                        toast.success(nextId ? "Project linked" : "Project unlinked");
                      } else {
                        toast.error(res?.message ?? "Failed to update project link");
                        // Roll back the optimistic update so the picker reflects truth.
                        setFormData((prev: any) => ({ ...prev, projectId: previousId }));
                      }
                    } catch (err) {
                      console.error("link-project PATCH failed:", err);
                      toast.error("Failed to update project link");
                      setFormData((prev: any) => ({ ...prev, projectId: previousId }));
                    }
                  }}
                  renderInput={(params) => (
                    <TextField {...params} label="Project (optional)" size="small" />
                  )}
                />
              </CardContent>
            </Card>
          )}

          {/* Dynamic Tabs based on template config */}
          {templateFieldConfig?.tabs.map((tab, index) => (
            <TabPanel key={tab.tabId} value={mainTabValue} index={index}>
              <Card sx={{ flexShrink: 0 }}>
                <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.25 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {tab.tabLabel}
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setIsFieldsCollapsed((prev) => !prev)}
                      endIcon={isFieldsCollapsed ? <UnfoldMoreIcon /> : <UnfoldLessIcon />}
                      sx={{ height: 24, py: 0, px: 1, minWidth: 0, fontSize: "0.75rem", textTransform: "none", lineHeight: 1 }}
                    >
                      {isFieldsCollapsed ? "Show fields" : "Hide fields"}
                    </Button>
                  </Box>
                  <Divider sx={{ mb: 0.5 }} />
                  <Collapse in={!isFieldsCollapsed} timeout="auto" unmountOnExit>
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
                  </Collapse>
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
                          <Paper sx={{ p: 0.5, bgcolor: "surfaceTones.low" }}>
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
                            options={projects.filter((p) => !formData.customer.id || !p.customerId || p.customerId === formData.customer.id)}
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
                            {isItemTaggingEnabled && !isTemplateEditMode && (
                              <TableCell sx={{ width: 40, p: 0 }} />
                            )}
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
                              // Allow the doc/template to override the default column layout
                              // (e.g. the FCU/CU Quotation variant uses location/taggedAsset/remarks).
                              const configuredColumns = (existingData?.tableColumnOrder ?? existingData?.config?.tableColumnOrder) as string[] | undefined;
                              const baseDefaultColumns = isInvoiceType
                                ? ["item", "description", "quantity", "unitPrice", "amount"]
                                : isStockAdjustmentIn || isPurchaseReturnType
                                ? ["item", "description", "uom", "quantity", "unitPrice", "discount", "amount", "receivedQty"]
                                : isStockAdjustmentOut || isPurchaseOrderType
                                ? ["item", "description", "uom", "quantity", "unitPrice", "discount", "amount"]
                                : isDeliveryOrderType || isCreditDebitNote
                                ? ["item", "description", "uom", "quantity", "unitPrice", "amount"]
                                : ["item", "description", "quantity", "unitPrice", "tax", "amount"];
                              const defaultColumns = (configuredColumns && configuredColumns.length > 0)
                                ? configuredColumns
                                : baseDefaultColumns;
                              return (isTemplateEditMode ? templateWatch("tableColumnOrder") : defaultColumns).map((columnId: string) => {
                                // Skip tax column for invoices
                                if (isInvoiceType && columnId === "tax") return null;
                                const isVisible = isTemplateEditMode ? templateWatch(`tableHeaders.${columnId}`) : true;
                              const isPurePurchaseDoc =
                                documentType === "PO" || documentType === "PURCHASE_ORDER" ||
                                documentType === "PR" || documentType === "PURCHASE_RETURN";
                              const configLabel = existingData?.columnLabels?.[columnId] ?? existingData?.config?.columnLabels?.[columnId];
                              const label = isTemplateEditMode ? templateWatch(`columnLabels.${columnId}`) || columnId :
                                configLabel ? configLabel :
                                columnId === "item" ? (items.some((i: any) => i.isService) ? "Item" : "Product Code") :
                                columnId === "description" ? "Description" :
                                columnId === "uom" ? "UOM" :
                                columnId === "quantity" ? "Quantity" :
                                columnId === "unitPrice" ? (isPurePurchaseDoc ? "Cost Price" : "Unit Price") :
                                columnId === "tax" ? "Tax %" :
                                columnId === "discount" ? "Discount" :
                                columnId === "amount" ? "Amount" :
                                columnId === "receivedQty" ? "Received Qty" :
                                columnId === "location" ? "Location" :
                                columnId === "taggedAsset" ? "Tagged Item" :
                                columnId === "cuModel" ? "CU Model" :
                                columnId === "fcuModel" ? "FCU Model" :
                                columnId === "accessories" ? "Accessories" :
                                columnId === "listPrice" ? "Unit Price" :
                                columnId === "discountPrice" ? "Dealer Price" :
                                columnId === "costPrice" ? "Cost Price" :
                                columnId === "remarks" ? "Remarks" : columnId;

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
                                           columnId === "discount" ? "11%" :
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
                          {items.filter((it: any) => !it.isTagGroup).map((item: any, index: number) => (
                            <TableRow key={item.id}>
                              {isItemTaggingEnabled && !isTemplateEditMode && (
                                <TableCell sx={{ width: 40, p: 0, textAlign: 'center' }}>
                                  <Checkbox
                                    size="small"
                                    checked={selectedItemIds.includes(item.id)}
                                    onChange={() => toggleItemSelected(item.id)}
                                  />
                                </TableCell>
                              )}
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
                                const configuredColumns = (existingData?.tableColumnOrder ?? existingData?.config?.tableColumnOrder) as string[] | undefined;
                                const baseDefaultColumns = isInvoiceType
                                  ? ["item", "description", "quantity", "unitPrice", "amount"]
                                  : isStockAdjustmentIn || isPurchaseReturnType
                                  ? ["item", "description", "uom", "quantity", "unitPrice", "discount", "amount", "receivedQty"]
                                  : isStockAdjustmentOut || isPurchaseOrderType
                                  ? ["item", "description", "uom", "quantity", "unitPrice", "discount", "amount"]
                                  : isDeliveryOrderType || isCreditDebitNote
                                  ? ["item", "description", "uom", "quantity", "unitPrice", "amount"]
                                  : ["item", "description", "quantity", "unitPrice", "tax", "amount"];
                                const defaultColumns = (configuredColumns && configuredColumns.length > 0)
                                  ? configuredColumns
                                  : baseDefaultColumns;
                                return (isTemplateEditMode ? templateWatch("tableColumnOrder") : defaultColumns).map((columnId: string) => {
                                  // Skip tax column for invoices
                                  if (isInvoiceType && columnId === "tax") return null;
                                  const isVisible = isTemplateEditMode ? templateWatch(`tableHeaders.${columnId}`) : true;
                                  if (!isVisible) return null;

                                if (columnId === "item") {
                                  // Service items get a plain free-text "Item" field
                                  if (item.isService) {
                                    return (
                                      <TableCell key={columnId}>
                                        <TextField
                                          fullWidth
                                          size="small"
                                          placeholder="Item name"
                                          value={item.itemCode || ""}
                                          onChange={(e) => updateItem(item.id, "itemCode", e.target.value)}
                                          sx={{ minWidth: 120 }}
                                        />
                                      </TableCell>
                                    );
                                  }
                                  // Product items keep the SKU autocomplete
                                  return (
                                    <TableCell key={columnId}>
                                      <Autocomplete
                                        fullWidth
                                        freeSolo
                                        value={(() => {
                                          if (item.inventoryItemId) {
                                            const inv = inventoriesForDocument.find(i => i.id === item.inventoryItemId);
                                            return inv ? inv.sku : item.itemCode || "";
                                          }
                                          return item.itemCode || "";
                                        })()}
                                        onChange={(event, newValue) => {
                                          if (newValue === null || newValue === undefined) {
                                            updateItem(item.id, "inventoryItemId", "");
                                            updateItem(item.id, "itemCode", "");
                                            return;
                                          }

                                          const selectedInventory = inventoriesForDocument.find(inv => inv.sku === newValue);

                                          if (selectedInventory) {
                                            updateItem(item.id, "inventoryItemId", selectedInventory.id);
                                            updateItem(item.id, "itemCode", selectedInventory.sku);
                                            updateItem(item.id, "description", selectedInventory.name || selectedInventory.asset?.name || selectedInventory.description || "");
                                            // Purchase docs (PO + PR) default to cost price. `unitPrice` may already be
                                            // flattened to selling price (Products mode), so check costPrice first.
                                            const isPurePurchaseTypeRow =
                                              documentType === "PO" || documentType === "PURCHASE_ORDER" ||
                                              documentType === "PR" || documentType === "PURCHASE_RETURN";
                                            const sellingFallback = selectedInventory.unitPrice ?? selectedInventory.asset?.price ?? 0;
                                            const costCandidate = selectedInventory.costPrice ?? selectedInventory.asset?.costPrice ?? null;
                                            let resolvedPrice = isPurePurchaseTypeRow
                                              ? (costCandidate ?? sellingFallback ?? 0)
                                              : (sellingFallback ?? 0);
                                            if (!isPurePurchaseTypeRow && isAssetPointsEnabled) {
                                              const pts = Number(selectedInventory.asset?.points || 0);
                                              if (pts > 0) resolvedPrice = Math.max(0, Number(resolvedPrice) - pts);
                                            }
                                            updateItem(item.id, "unitPrice", resolvedPrice);
                                            updateItem(item.id, "uom", selectedInventory.uom || selectedInventory.asset?.uom || "PCS");

                                            if (selectedInventory.assetId) {
                                              prefetchPriceHistory(selectedInventory.assetId);
                                            }
                                          } else {
                                            updateItem(item.id, "inventoryItemId", "");
                                            updateItem(item.id, "itemCode", newValue || "");
                                          }
                                        }}
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
                                  // For the FCU-CU variant qty is per-FCU: a stack of qty inputs
                                  // aligned 1:1 (same 40px row height) with the FCU chips.
                                  if (isFcuCuVariant) {
                                    const selectedFcus = (item.fcus || []) as any[];
                                    return (
                                      <TableCell key={columnId} align="center">
                                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                                          {selectedFcus.map((f: any, idx: number) => (
                                            <Box key={idx} sx={{ height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                              <TextField
                                                type="number"
                                                size="small"
                                                value={f.qty ?? 1}
                                                onChange={(e) => setFcuQtyAt(item.id, idx, parseFloat(e.target.value) || 0)}
                                                sx={{ width: 80 }}
                                                inputProps={{ min: 0 }}
                                              />
                                            </Box>
                                          ))}
                                        </Box>
                                      </TableCell>
                                    );
                                  }
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
                                  // Per-line tier picker — only on sales-side docs and only
                                  // when the linked asset actually has custom prices defined.
                                  const isPurePurchaseRow =
                                    documentType === "PO" || documentType === "PURCHASE_ORDER" ||
                                    documentType === "PR" || documentType === "PURCHASE_RETURN";
                                  const linkedInv = item.inventoryItemId
                                    ? inventoriesForDocument.find((inv: any) => inv.id === item.inventoryItemId)
                                    : null;
                                  const linkedCustomPrices = Array.isArray(linkedInv?.asset?.customPrices)
                                    ? linkedInv.asset.customPrices
                                    : [];
                                  const tierPickerVisible = !isPurePurchaseRow && linkedCustomPrices.length > 0;

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
                                        {tierPickerVisible && (
                                          <IconButton
                                            size="small"
                                            onClick={(e) => setTierMenu({ anchorEl: e.currentTarget, itemId: item.id })}
                                            sx={{
                                              padding: 0.5,
                                              color: 'success.main',
                                              '&:hover': { bgcolor: 'success.lighter' },
                                            }}
                                            title="Switch price tier"
                                          >
                                            <PriceTagIcon fontSize="small" />
                                          </IconButton>
                                        )}
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
                                  const isAmountMode = item.discountType === "amount";
                                  return (
                                    <TableCell key={columnId} align="center">
                                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.25 }}>
                                        <TextField
                                          type="number"
                                          value={item.discount || 0}
                                          onChange={(e) => updateItem(item.id, "discount", parseFloat(e.target.value) || 0)}
                                          size="small"
                                          sx={{ width: 56 }}
                                        />
                                        <Tooltip title={isAmountMode ? "Discount by amount ($) — click to switch to %" : "Discount by percent (%) — click to switch to $"}>
                                          <IconButton
                                            size="small"
                                            onClick={() => updateItem(item.id, "discountType", isAmountMode ? "percent" : "amount")}
                                            sx={{
                                              width: 24,
                                              height: 24,
                                              fontSize: "0.8rem",
                                              fontWeight: 700,
                                              border: "1px solid",
                                              borderColor: "divider",
                                              borderRadius: 1,
                                              color: "primary.main",
                                            }}
                                          >
                                            {isAmountMode ? "$" : "%"}
                                          </IconButton>
                                        </Tooltip>
                                      </Box>
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
                                } else if (columnId === "taggedAsset") {
                                  // Read-only display of the CU tagged onto this FCU row. The
                                  // CU itself lives as a separate isTagGroup item with its own
                                  // qty + price; the chip just references it. Untag → remove
                                  // this row's tagGroupId; if no rows reference the group
                                  // anymore, drop the group line item too.
                                  return (
                                    <TableCell key={columnId} align="center">
                                      {item.taggedAssetCode ? (
                                        <Chip
                                          size="small"
                                          label={item.taggedAssetCode}
                                          onDelete={() => {
                                            const droppedTagGroupId = item.tagGroupId;
                                            setItems((prev: any[]) => {
                                              const cleared = prev.map((it: any) =>
                                                it.id === item.id
                                                  ? { ...it, tagGroupId: "", taggedAssetId: "", taggedAssetCode: "", taggedAssetName: "" }
                                                  : it,
                                              );
                                              // Prune the shared CU line if no FCU rows reference it anymore.
                                              if (!droppedTagGroupId) return cleared;
                                              const stillUsed = cleared.some(
                                                (it: any) => !it.isTagGroup && it.tagGroupId === droppedTagGroupId,
                                              );
                                              if (stillUsed) return cleared;
                                              return cleared.filter(
                                                (it: any) => !(it.isTagGroup && it.tagGroupId === droppedTagGroupId),
                                              );
                                            });
                                          }}
                                          sx={{ maxWidth: "100%" }}
                                        />
                                      ) : (
                                        <Typography variant="caption" color="text.disabled">—</Typography>
                                      )}
                                    </TableCell>
                                  );
                                } else if (columnId === "cuModel") {
                                  // Opens the stock-card picker (CUs, with description + list/dealer).
                                  return (
                                    <TableCell key={columnId}>
                                      <Button
                                        variant="outlined"
                                        size="small"
                                        onClick={() => openQfPicker(item.id, "cu", 0)}
                                        sx={{ minWidth: 150, justifyContent: "flex-start", textTransform: "none", color: item.cuCode ? "text.primary" : "text.secondary" }}
                                      >
                                        {item.cuCode || "Select CU"}
                                      </Button>
                                    </TableCell>
                                  );
                                } else if (columnId === "fcuModel") {
                                  // Exactly one compatible FCU (RKM) => locked, no add/remove.
                                  // Multiple compatible FCUs (Sky Air) or none (MKM) => chips + "Add FCU"
                                  // button opening the stock-card picker (scoped to the CU's children when any).
                                  const kidCount = item.cuAssetId ? childrenOfCu(item.cuAssetId).length : 0;
                                  const lockedSingle = kidCount === 1;
                                  const selectedFcus = (item.fcus || []) as any[];
                                  return (
                                    <TableCell key={columnId}>
                                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                                        {selectedFcus.map((f: any, idx: number) => (
                                          <Box key={idx} sx={{ height: 40, display: "flex", alignItems: "center" }}>
                                            <Chip
                                              size="small"
                                              label={f.code}
                                              onDelete={lockedSingle ? undefined : () => setFcuAt(item.id, idx, "")}
                                              sx={{ maxWidth: "100%" }}
                                            />
                                          </Box>
                                        ))}
                                        {!lockedSingle && (
                                          <Button
                                            variant="text"
                                            size="small"
                                            startIcon={<AddIcon />}
                                            onClick={() => openQfPicker(item.id, "fcu", selectedFcus.length)}
                                            sx={{ alignSelf: "flex-start", textTransform: "none" }}
                                          >
                                            Add FCU
                                          </Button>
                                        )}
                                      </Box>
                                    </TableCell>
                                  );
                                } else if (columnId === "accessories") {
                                  // Panel / remote / pump — added via the stock-card picker (scoped
                                  // to the Accessories category). Priced into the system; editor-only.
                                  const selectedAcc = (item.accessories || []) as any[];
                                  return (
                                    <TableCell key={columnId}>
                                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                                        {selectedAcc.map((a: any, idx: number) => (
                                          <Box key={idx} sx={{ display: "flex", alignItems: "center", mb: 0.25 }}>
                                            <Chip
                                              size="small"
                                              label={a.code}
                                              onDelete={() => setAccessoryAt(item.id, idx, "")}
                                              sx={{ maxWidth: "100%" }}
                                            />
                                          </Box>
                                        ))}
                                        <Button
                                          variant="text"
                                          size="small"
                                          startIcon={<AddIcon />}
                                          onClick={() => openQfPicker(item.id, "accessory", selectedAcc.length)}
                                          sx={{ alignSelf: "flex-start", textTransform: "none" }}
                                        >
                                          Add Accessory
                                        </Button>
                                      </Box>
                                    </TableCell>
                                  );
                                } else if (columnId === "listPrice" || columnId === "discountPrice" || columnId === "costPrice") {
                                  return (
                                    <TableCell key={columnId} align="center">
                                      <TextField
                                        type="number"
                                        value={item[columnId] ?? 0}
                                        onChange={(e) => {
                                          const v = parseFloat(e.target.value) || 0;
                                          updateItem(item.id, columnId, v);
                                          // listPrice is the customer-facing unit price -> keep unitPrice/amount in sync.
                                          if (columnId === "listPrice") updateItem(item.id, "unitPrice", v);
                                        }}
                                        size="small"
                                        sx={{ width: 100 }}
                                      />
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

                      {/* Add Item / Add Service / Tag Items buttons */}
                      <Box sx={{ pt: 1, pl: 1, display: "flex", gap: 1 }}>
                        <Button
                          variant="contained"
                          startIcon={<AddIcon />}
                          onClick={() => {
                            if (isFcuCuVariant) { addFcuCuRow(); return; }
                            setStockCardMode("add");
                            setStockCardDialogOpen(true);
                          }}
                          size="small"
                        >
                          {isFcuCuVariant ? "Add Row" : "Add Item"}
                        </Button>
                        {isItemTaggingEnabled && selectedItemIds.length > 0 && (
                          <Button
                            variant="outlined"
                            color="success"
                            startIcon={<PriceTagIcon />}
                            onClick={() => {
                              setStockCardMode("tag");
                              setStockCardDialogOpen(true);
                            }}
                            size="small"
                          >
                            Tag Items ({selectedItemIds.length})
                          </Button>
                        )}
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
                        <Card sx={{ minWidth: 250, bgcolor: "surfaceTones.low" }}>
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
                                const discType = dInfo?.discountType || "percent";
                                const gstPct = isTaxApplicable ? (parseFloat(dInfo?.gstPercent) || organization?.taxRate || 9) : 0;

                                // FCU-CU (QF): Gross = Σ Unit Price (list); Discounted Price =
                                // Σ Dealer − Σ Points − doc discount; Nett = Discounted + GST.
                                if (isFcuCuVariant) {
                                  const gross = items.reduce((a: number, it: any) => a + (Number(it.listPrice) || 0), 0);
                                  const dealerTotal = items.reduce((a: number, it: any) => a + (Number(it.discountPrice) || 0), 0);
                                  const pointsTotal = items.reduce((a: number, it: any) => a + (Number(it.pointsTotal) || 0), 0);
                                  const afterPoints = Math.max(0, dealerTotal - pointsTotal);
                                  const discAmt = discType === "amount" ? Math.min(discPct, afterPoints) : afterPoints * (discPct / 100);
                                  const discountedPrice = Math.max(0, afterPoints - discAmt);
                                  const gst = isAbsorbTax && gstPct > 0 ? discountedPrice * gstPct / (100 + gstPct) : discountedPrice * (gstPct / 100);
                                  const nett = roundNettDown(isAbsorbTax ? discountedPrice : discountedPrice + gst);
                                  return (
                                    <>
                                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                        <Typography variant="body2">Gross Total:</Typography>
                                        <Typography variant="body2">{currency} {gross.toFixed(2)}</Typography>
                                      </Box>
                                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                        <Typography variant="body2" fontWeight="bold">Discounted Price:</Typography>
                                        <Typography variant="body2" fontWeight="bold">{currency} {discountedPrice.toFixed(2)}</Typography>
                                      </Box>
                                      {isTaxApplicable && (
                                        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                          <Typography variant="body2">GST ({gstPct}%){isAbsorbTax ? " (absorbed)" : ""}:</Typography>
                                          <Typography variant="body2">{currency} {gst.toFixed(2)}</Typography>
                                        </Box>
                                      )}
                                      <Divider sx={{ my: 0.5 }} />
                                      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                        <Typography variant="body2" fontWeight="bold">Nett Total:</Typography>
                                        <Typography variant="body2" fontWeight="bold" color="primary">{currency} {nett.toFixed(2)}</Typography>
                                      </Box>
                                    </>
                                  );
                                }

                                const discAmt = discType === "amount" ? Math.min(discPct, subtotal) : subtotal * (discPct / 100);
                                const afterDisc = subtotal - discAmt;
                                const gst = isAbsorbTax && gstPct > 0
                                  ? afterDisc * gstPct / (100 + gstPct)
                                  : afterDisc * (gstPct / 100);
                                const nett = roundNettDown(isAbsorbTax ? afterDisc : afterDisc + gst);
                                const displaySubtotal = isAbsorbTax ? afterDisc - gst : afterDisc;

                                return (
                                  <>
                                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                      <Typography variant="body2">Gross Total:</Typography>
                                      <Typography variant="body2">{currency} {subtotal.toFixed(2)}</Typography>
                                    </Box>
                                    {discAmt > 0 && (
                                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                        <Typography variant="body2">Discount{discType === "amount" ? "" : ` (${discPct}%)`}:</Typography>
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
                    <Grid item xs={12} md={documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" ? 12 : 6} sx={{ display: "flex", flexDirection: "column" }}>
                      <Typography variant="caption" sx={{ mb: 0.5, color: "text.secondary" }}>Notes</Typography>
                      <RichTextDescription
                        value={formData.note || ""}
                        onChange={(html) => setFormData({ ...formData, note: html })}
                        placeholder="Enter notes"
                      />
                    </Grid>

                    {/* Terms & Conditions - for TI and QO1 */}
                    {(documentType === "TI" || documentType === "TI2" || documentType === "INVOICE" || documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO") && (
                      <Grid item xs={12} md={documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" ? 12 : 6} sx={{ display: "flex", flexDirection: "column" }}>
                        <Typography variant="caption" sx={{ mb: 0.5, color: "text.secondary" }}>Terms & Conditions</Typography>
                        <RichTextDescription
                          value={formData.termsAndConditions || ""}
                          onChange={(html) => setFormData({ ...formData, termsAndConditions: html })}
                          placeholder="Enter terms & conditions"
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
                  // Forward the per-template column layout so the preview
                  // renders the configured columns (e.g. FCU/CU Quotation).
                  tableColumnOrder:
                    (existingData as any)?.tableColumnOrder ?? existingData?.config?.tableColumnOrder,
                  columnLabels:
                    (existingData as any)?.columnLabels ?? existingData?.config?.columnLabels,
                  internalColumns:
                    (existingData as any)?.internalColumns ?? existingData?.config?.internalColumns,
                }}
                organization={organization}
                // Field-tech delivery reports linked to this document. When
                // present and non-empty AND documentType === 'DO', the preview
                // renders a Proof of Delivery section at the bottom (photos +
                // signatures). The data is loaded by the parent page via
                // GET /documents/:id (which now includes the relation) and
                // forwarded onto existingData by fetchDocumentData.
                maintenanceReports={(existingData as any)?.maintenanceReports ?? []}
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

      {/* Per-line price tier menu — populated from the active row's asset.customPrices */}
      <Menu
        open={!!tierMenu}
        anchorEl={tierMenu?.anchorEl}
        onClose={() => setTierMenu(null)}
      >
        {(() => {
          const activeItem = tierMenu ? items.find((it: any) => it.id === tierMenu.itemId) : null;
          const linkedInv = activeItem?.inventoryItemId
            ? inventoriesForDocument.find((inv: any) => inv.id === activeItem.inventoryItemId)
            : null;
          const sellingPrice = linkedInv?.asset?.price ?? linkedInv?.unitPrice ?? 0;
          const tiers: { label: string; value: number }[] = [
            { label: "Selling Price", value: Number(sellingPrice || 0) },
            ...(Array.isArray(linkedInv?.asset?.customPrices) ? linkedInv.asset.customPrices : [])
              .filter((cp: any) => cp && cp.label)
              .map((cp: any) => ({ label: String(cp.label), value: Number(cp.value) || 0 })),
          ];
          return tiers.map((tier, idx) => (
            <MenuItem
              key={`${tier.label}-${idx}`}
              onClick={() => {
                if (activeItem) updateItem(activeItem.id, "unitPrice", tier.value);
                setTierMenu(null);
              }}
            >
              <Box sx={{ display: "flex", justifyContent: "space-between", width: 220 }}>
                <Typography variant="body2">{tier.label}</Typography>
                <Typography variant="body2" sx={{ ml: 2, fontWeight: 500 }}>
                  ${tier.value.toFixed(2)}
                </Typography>
              </Box>
            </MenuItem>
          ));
        })()}
      </Menu>

      {/* Tag CU confirmation dialog — opens after a CU is picked from the Stock
          Card in tag mode. The CU is its own billed entity with its own qty
          and price (independent of the FCU rows). On confirm we create one
          tag-group line item (isTagGroup=true) and link each checked FCU row
          to it via tagGroupId. */}
      <Dialog
        open={!!pendingTag}
        onClose={() => setPendingTag(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Tag {pendingTag?.rows.length || 0} item(s) with {pendingTag?.asset?.sku || pendingTag?.asset?.asset?.skuKey || ""}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {pendingTag?.asset?.name || pendingTag?.asset?.asset?.name || ""}
            </Typography>
            <TextField
              label="CU Quantity"
              type="number"
              size="small"
              value={pendingTag?.qty ?? 1}
              onChange={(e) =>
                setPendingTag((prev) => prev ? { ...prev, qty: parseFloat(e.target.value) || 0 } : prev)
              }
              inputProps={{ min: 0, step: 1 }}
            />
            <TextField
              label="CU Unit Price"
              type="number"
              size="small"
              value={pendingTag?.unitPrice ?? 0}
              onChange={(e) =>
                setPendingTag((prev) => prev ? { ...prev, unitPrice: parseFloat(e.target.value) || 0 } : prev)
              }
              inputProps={{ min: 0, step: "0.01" }}
              helperText="Defaults to the CU's selling price"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingTag(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!pendingTag) return;
              const picked = pendingTag.asset;
              const taggedAssetId = picked.assetId || picked.asset?.id || picked.id || "";
              const taggedAssetCode = picked.sku || picked.asset?.skuKey || "";
              const taggedAssetName = picked.name || picked.asset?.name || picked.description || "";
              const tagGroupId = `tg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const qty = Number(pendingTag.qty || 0);
              const unitPrice = Number(pendingTag.unitPrice || 0);
              const newTagGroupItem = {
                id: Date.now(),
                isTagGroup: true,
                tagGroupId,
                itemCode: taggedAssetCode,
                inventoryItemId: taggedAssetId,
                description: taggedAssetName,
                quantity: qty,
                unitPrice,
                amount: qty * unitPrice,
                taggedAssetId,
                taggedAssetCode,
                taggedAssetName,
              };
              const checkedIds = pendingTag.rows;
              setItems((prev: any[]) => {
                // Remove any existing tag groups orphaned by re-tagging these rows.
                const oldTagGroupIds = prev
                  .filter((it: any) => !it.isTagGroup && checkedIds.includes(it.id) && it.tagGroupId)
                  .map((it: any) => it.tagGroupId);
                const updatedFcus = prev.map((it: any) =>
                  checkedIds.includes(it.id) && !it.isTagGroup
                    ? { ...it, tagGroupId, taggedAssetId, taggedAssetCode, taggedAssetName }
                    : it,
                );
                // After re-pointing, drop any tag groups no longer referenced.
                const surviving = updatedFcus.filter((it: any) =>
                  !(it.isTagGroup && oldTagGroupIds.includes(it.tagGroupId) &&
                    !updatedFcus.some((row: any) => !row.isTagGroup && row.tagGroupId === it.tagGroupId)),
                );
                return [...surviving, newTagGroupItem];
              });
              setSelectedItemIds([]);
              setPendingTag(null);
            }}
            disabled={!pendingTag || (pendingTag.qty || 0) <= 0}
          >
            Tag Items
          </Button>
        </DialogActions>
      </Dialog>

      {/* Convert Quotation Dialog — opens after a quotation is confirmed.
          Lets the user spin off a PO / DO / Invoice with the quotation's items
          pre-filled, or close the dialog and extract later via the existing
          extract flows on the target doc. */}
      <Dialog
        open={convertQuotationDialogOpen}
        onClose={() => !isConverting && setConvertQuotationDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Quotation Confirmed — Convert?</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            The quotation has been confirmed. Would you like to convert it into another document now?
            The customer and line items will be copied into the new draft.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            You can also do this later via the Extract button on a new PO / DO / Invoice.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button
            onClick={() => {
              setConvertQuotationDialogOpen(false);
              window.location.reload();
            }}
            disabled={isConverting}
          >
            Leave for now
          </Button>
          <Button
            variant="outlined"
            onClick={() => handleConvertQuotation("PO")}
            disabled={isConverting}
          >
            Convert to PO
          </Button>
          <Button
            variant="outlined"
            onClick={() => handleConvertQuotation("DO")}
            disabled={isConverting}
          >
            Convert to DO
          </Button>
          <Button
            variant="contained"
            onClick={() => handleConvertQuotation("INVOICE")}
            disabled={isConverting}
          >
            Convert to Invoice
          </Button>
        </DialogActions>
      </Dialog>

      {/* Stock Card Dialog for item selection. In "tag" mode the dialog re-uses
          the same picker but writes the chosen asset onto every checked row
          rather than appending a new line. */}
      <StockCardDialog
        open={stockCardDialogOpen}
        onClose={() => {
          setStockCardDialogOpen(false);
          setStockCardMode("add");
        }}
        onSelectItem={(picked: any) => {
          if (stockCardMode === "tag") {
            // Don't commit yet — open the pending-tag dialog so the user can
            // set the CU's own qty + price before the tag group is created.
            const defaultPrice = Number(
              picked.unitPrice ?? picked.asset?.price ?? picked.price ?? 0,
            );
            setPendingTag({
              asset: picked,
              rows: [...selectedItemIds],
              qty: 1,
              unitPrice: defaultPrice,
            });
            setStockCardMode("add");
            setStockCardDialogOpen(false);
            return;
          }
          handleStockCardItemSelect(picked);
        }}
        inventoryItems={inventoriesForDocument}
        priceMode={
          documentType === "PO" || documentType === "PURCHASE_ORDER" ||
          documentType === "PR" || documentType === "PURCHASE_RETURN"
            ? "cost"
            : "selling"
        }
      />

      {/* Delivery Route dialog — triggered by the Show Route button at the
          top of the editor header. Mounted regardless of doc type because
          the gate is reportId presence (null when no DO_START exists, which
          keeps the dialog closed and the button disabled). */}
      <DeliveryRouteDialog
        reportId={routeDialogReportId}
        open={!!routeDialogReportId}
        onClose={() => setRouteDialogReportId(null)}
      />

      {/* FCU-CU (QF) stock-card picker — scoped to CUs or FCUs, shows
          description + Unit (list) + Dealer price. */}
      <StockCardDialog
        open={!!qfPicker}
        onClose={() => setQfPicker(null)}
        onSelectItem={handleQfPick}
        inventoryItems={qfPickerItems}
        priceMode="selling"
        showDealerPrice
        showPoints
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

          toast.success(`Quotation ${quotation.name} extracted to ${isInvoiceType ? "Invoice" : "Delivery Order"}`);
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

          toast.success(`${quotations.length} Quotations extracted to ${isInvoiceType ? "Invoice" : "Delivery Order"}`);
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