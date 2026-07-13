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
  ListItemIcon,
  ListItemText,
  InputAdornment,
  ButtonGroup,
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
  CloudSync as CloudSyncIcon,
  NavigateBefore as NavigateBeforeIcon,
  NavigateNext as NavigateNextIcon,
  Inventory as InventoryIcon,
  Search as SearchIcon,
  LocalShipping as ReceiveIcon,
  UnfoldLess as UnfoldLessIcon,
  UnfoldMore as UnfoldMoreIcon,
  LocalOffer as PriceTagIcon,
  Route as RouteIcon,
  MoreVert as MoreVertIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  Autorenew as AutorenewIcon,
} from "@mui/icons-material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import DocumentAssistantDrawer, { ProposalPatch } from "./DocumentAssistantDrawer";
import DocumentHistoryDrawer from "./DocumentHistoryDrawer";
import QuotationSelectDialog from "./QuotationSelectDialog";
import { AutoAwesome as AutoAwesomeIcon } from "@mui/icons-material";
import CleanDocumentPreview from "./CleanDocumentPreview";
import RouteOrderPointsEditor from "./RouteOrderPointsEditor";
// Shared dialog — same component used by the Field Reports tab on the
// project detail page. Renders a Leaflet map of the live delivery route
// from /maintenance-reports/:reportId/location-track.
import DeliveryRouteDialog from "@/components/DeliveryRouteDialog";
import RichTextDescription from "./RichTextDescription";
import DocumentCustomizer from "./DocumentCustomizer";
import DynamicFormFields, { headerInputSx } from "./DynamicFormFields";
import StockCardDialog from "./StockCardDialog";
import RevenueItemPickerDialog from "./RevenueItemPickerDialog";
import LocateDocumentDialog from "./LocateDocumentDialog";
import ExtractQuotationDialog from "./ExtractQuotationDialog";
import ExtractDOToInvoiceDialog from "./ExtractDOToInvoiceDialog";
import ExtractQuotationToSODialog from "./ExtractQuotationToSODialog";
import ConfirmPODialog, { ConfirmPOData } from "./ConfirmPODialog";
import ConfirmAdjustmentDialog, { ConfirmAdjustmentData } from "./ConfirmAdjustmentDialog";
import ConfirmDODialog, { ConfirmDOData } from "./ConfirmDODialog";
import ConfirmPRDialog, { ConfirmPRData } from "./ConfirmPRDialog";
import ConfirmInvoiceDialog, { ConfirmInvoiceData } from "./ConfirmInvoiceDialog";
import PostingPreviewDialog, { PreviewResult, PreviewAccount } from "@/components/PostingPreviewDialog";
import CustomerSelectDialog from "./CustomerSelectDialog";
import SalesmanSelectDialog from "./SalesmanSelectDialog";
import PriceHistoryPopup from "@/components/PriceHistory/PriceHistoryPopup";
import SendInvoiceEmailDialog from "@/app/portal/invoices/components/SendInvoiceEmailDialog";
import RecordPaymentDialog from "@/app/portal/invoices/components/RecordPaymentDialog";
import { useAuth, useUser } from "@clerk/nextjs";
import { useReactToPrint } from "react-to-print";
import { request } from "@/helpers/request";
import { useDocumentLock } from "@/app/portal/hooks/useDocumentLock";
import { toast } from "react-toastify";
import { useForm, Controller } from "react-hook-form";
import { usePathname, useRouter } from "next/navigation";
import { usePastDescriptions } from "../hooks/usePastDescriptions";
import { useGetInventoriesForItemTable } from "../hooks/useGetInventoriesForItemTable";
import { getTemplateFormFields } from "../utils/templateFieldSync";
import { useGetDocuments } from "@/app/portal/hooks/api";
import { TemplateFieldConfig } from "../types/templateFieldTypes";
import { getDocumentListRoute, getListRouteFromPathname } from "@/app/portal/components/documentRoutes"; // co-pkg: depends on fa8351c

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

// Toolbar accent colors (Xero-style). Scoped here on purpose: the light
// theme maps palette.success/info to near-black/gray, so `color="success"`
// renders monochrome — these give the primary actions real color without
// touching the global palette.
// Theme-aware (sx accepts a (theme) => styles function): saturated fills on
// light, M3-style pastel fills with dark text on the dark "Editorial Ledger"
// theme — solid saturated buttons glare on dark surfaces.
// backgroundImage:none — the dark theme paints containedPrimary with a
// gradient background-image that would overlay (tint) the sx bgcolor.
const TOOLBAR_GREEN = (t: { palette: { mode: string } }) =>
  t.palette.mode === "dark"
    ? { bgcolor: "#8AD79E", color: "#0C2F17", backgroundImage: "none", "&:hover": { bgcolor: "#9FE0AF", backgroundImage: "none" } }
    : { bgcolor: "#15803D", color: "#FFFFFF", backgroundImage: "none", "&:hover": { bgcolor: "#116632", backgroundImage: "none" } };
const TOOLBAR_BLUE = (t: { palette: { mode: string } }) =>
  t.palette.mode === "dark"
    ? { bgcolor: "#8FC7F2", color: "#082A44", backgroundImage: "none", "&:hover": { bgcolor: "#A5D3F5", backgroundImage: "none" } }
    : { bgcolor: "#0077C5", color: "#FFFFFF", backgroundImage: "none", "&:hover": { bgcolor: "#005F9E", backgroundImage: "none" } };
const PREVIEW_LINK_SX = (t: { palette: { mode: string } }) => ({
  color: t.palette.mode === "dark" ? "#8FC7F2" : "#0077C5",
});
// Items-table cell grid (Xero-style visible cell borders) — CSS var flips the
// shade for dark mode (app/globals.css).
const TABLE_GRID_COLOR = "var(--table-grid)";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
  // Viewport-locked panels: fill the remaining flex height and let the
  // children scroll internally instead of growing the page.
  grow?: boolean;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, grow, ...other } = props;
  const growSx = { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } as const;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      style={grow && value === index ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } : undefined}
      {...other}
    >
      {value === index && <Box sx={{ p: 0.5, ...(grow ? growSx : {}) }}>{children}</Box>}
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
  const { isServiceItemsEnabled, isAssetPointsEnabled, isConfirmQuotationEnabled, isNettRoundDownEnabled, isDocumentListViewEnabled, isQuotationProjectLinkEnabled, isXeroDocSyncEnabled } = useOrganizationFeatures();
  // "Sync to Xero" only shows when the editor was opened from the accounting
  // section (?from=/portal/accounting/... set by the embedded AR list).
  const openedFromAccounting =
    typeof window !== "undefined" &&
    (new URLSearchParams(window.location.search).get("from") || "").startsWith("/portal/accounting");
  // When the list-view feature is on, the back arrow returns to that doc type's
  // list page (e.g. /portal/sales/sales-orders) instead of the generic section
  // landing — so the sidebar highlight + browsing context stay consistent.
  // Resolve from the URL type first (always the canonical type, e.g. INVOICE):
  // confirmed docs' stored templateVariant may not be in LIST_ROUTES, which
  // used to drop them onto the generic /portal/sales instead of the real list.
  const resolveBackRoute = (docType: string) => {
    // An explicit ?from=<portal path> on the editor URL wins — set by embedded
    // lists (e.g. the AR tab at /portal/accounting/receivables) so Back returns
    // to the actual origin instead of the type's default list page. Validated
    // to an in-portal path so a crafted link can't redirect elsewhere.
    if (typeof window !== "undefined") {
      const fromParam = new URLSearchParams(window.location.search).get("from");
      if (fromParam && fromParam.startsWith("/portal")) return fromParam;
    }
    const fromUrl =
      typeof window !== "undefined" ? getListRouteFromPathname(window.location.pathname) : null;
    return (isDocumentListViewEnabled && (fromUrl || getDocumentListRoute(docType))) || getParentRoute(docType);
  };
  // When enabled, the document's Nett Total is rounded DOWN to the nearest 5.
  const roundNettDown = (n: number) => (isNettRoundDownEnabled ? Math.floor((Number(n) || 0) / 5) * 5 : (Number(n) || 0));
  // Item tagging (checkbox column + Tag Items button) is removed from every
  // document template — keep this false so the checkbox column and the
  // "Tag Items" button never render anywhere.
  const isItemTaggingEnabled = false;

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
  // Guest delivery share link — held here so the URL is ALWAYS shown in a
  // copyable dialog after generation, independent of whether the auto-copy
  // (navigator.clipboard) succeeds. Null = dialog closed.
  const [shareLinkUrl, setShareLinkUrl] = useState<string | null>(null);
  // Collapse the General/Details fields panel to give the Items table more space.
  const [isFieldsCollapsed, setIsFieldsCollapsed] = useState(false);
  // Items section tabs
  const [itemsTabValue, setItemsTabValue] = useState(0);
  const documentStatus = existingData?.status || "draft";
  // A document is editable ONLY while it is a draft. Once it moves past draft —
  // "confirmed" and every post-confirm status (pending_payment, paid,
  // pending_delivery, delivered_*, pending_return, returned, cancelled, …) — it
  // is locked to the read-only preview. Named "confirmed" for history; it really
  // means "not a draft" so all downstream lock/preview gates cover those states.
  const isDocumentConfirmed = documentStatus !== "draft";
  const isDocumentEditable = !isDocumentConfirmed && !isTemplateEditMode;

  // Force preview mode for confirmed documents or when initialPreviewMode is set
  const [previewMode, setPreviewMode] = useState(isDocumentConfirmed || initialPreviewMode);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmPODialogOpen, setConfirmPODialogOpen] = useState(false);
  const [confirmAdjustmentDialogOpen, setConfirmAdjustmentDialogOpen] = useState(false);
  const [confirmDODialogOpen, setConfirmDODialogOpen] = useState(false);
  const [confirmPRDialogOpen, setConfirmPRDialogOpen] = useState(false);
  const [confirmInvoiceDialogOpen, setConfirmInvoiceDialogOpen] = useState(false);
  // "Confirm & make recurring": dropdown anchor on the invoice Confirm split
  // button; the ref makes the post-confirm step route to the recurring setup
  // (prefilled from this invoice) instead of reloading.
  const [confirmMenuAnchor, setConfirmMenuAnchor] = useState<null | HTMLElement>(null);
  const makeRecurringAfterConfirmRef = useRef(false);
  // AI posting-preview ("Review") state for invoices.
  const [invoicePreviewOpen, setInvoicePreviewOpen] = useState(false);
  const [invoicePreviewLoading, setInvoicePreviewLoading] = useState(false);
  const [invoicePreviewData, setInvoicePreviewData] = useState<PreviewResult | null>(null);
  const [invoiceAccounts, setInvoiceAccounts] = useState<PreviewAccount[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSyncingXero, setIsSyncingXero] = useState(false);
  // Confirm-quotation dialog state. On confirm we resolve the auto-created
  // Order (matched by sourceQuotationId) and offer a one-click jump to it.
  const [convertQuotationDialogOpen, setConvertQuotationDialogOpen] = useState(false);
  const [linkedOrderId, setLinkedOrderId] = useState<string | null>(null);
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

  // "Saving, please wait…" dialog shown on exit while a save is flushing.
  const [savingExitDialogOpen, setSavingExitDialogOpen] = useState(false);

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
  const [revenueItemPickerOpen, setRevenueItemPickerOpen] = useState(false);
  // When set, the Stock Card / Service picker EDITS this existing row (via the
  // pencil next to Product Code) instead of appending a new line. Cleared on
  // pick or dialog close.
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  // Whether this org has set up a Revenue Master File. When true, "Add Item"
  // (and "Add Service") pick from it so lines self-code; when false, "Add Item"
  // keeps the product-catalog Stock Card (Cappitech-style orgs).
  const [hasRevenueItems, setHasRevenueItems] = useState(false);
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
  const isQuotation =
    documentType === "QUOTATION" ||
    documentType === "QO" ||
    documentType === "QO1" ||
    documentType === "QO2" ||
    documentType === "QT";

  // Biofuel org gate — drives the Biofuel-only quotation header fields
  // (editable Sale person / Mobile, defaulting to Eugene Lee / 9818 9200).
  const BIOFUEL_ORG_ID = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
  const isBiofuel =
    organization?.id === BIOFUEL_ORG_ID ||
    organization?.name === "Biofuel Industries Pte Ltd";

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

  // Does this org have a Revenue Master File? Drives whether "Add Item" opens
  // the master-file picker (self-coding) or the product-catalog Stock Card.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        if (typeof window !== "undefined") {
          const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
          if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
        }
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/revenue-items?activeOnly=true`, { headers });
        const json = await res.json();
        const list = json?.data ?? json;
        if (!cancelled) setHasRevenueItems(Array.isArray(list) && list.length > 0);
      } catch {
        /* leave false */
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);
  const { user } = useUser();

  // Concurrent-edit guard. Only locks a persisted document being edited (not a
  // brand-new draft, not the template editor, not a confirmed/preview view).
  const lockDocId = (existingData?.id || documentId) as string | undefined;
  // Don't lock the read-only view page (opens in preview), the template editor,
  // or confirmed documents — only a real edit session claims the lock.
  const lockEnabled = !!lockDocId && !isTemplateEditMode && !isDocumentConfirmed && !initialPreviewMode;
  const lock = useDocumentLock(lockDocId, lockEnabled);
  // Read-only when someone else is editing, an idle lock hasn't been taken over
  // yet, or someone took the lock from under us.
  const lockReadOnly = lockEnabled && (lock.isReadOnly || lock.lostLock);

  // Every editor save path funnels through this: block saves while read-only,
  // stamp the optimistic-concurrency version, then re-pull the bumped version
  // so a follow-up save by the same user doesn't false-conflict.
  // Live tracking info for the header row (Unconfirmed User / Last Used).
  // existingData is a load-time snapshot that never refreshes during a
  // session, so on fresh docs (or until a reload) the row showed "-" even
  // though every save writes savedBy/lastUsedBy. Mirror the fields from each
  // successful save and let the header prefer them.
  const [liveTracking, setLiveTracking] = useState<{
    savedBy?: string;
    savedAt?: string;
    lastUsedBy?: string;
    lastUsedAt?: string;
  }>({});

  const guardedSave = useCallback(async (saveData: any) => {
    if (lockReadOnly) {
      toast.error(
        lock.lostLock
          ? `${lock.holderName || "Someone"} took over editing — reload to see their changes.`
          : `${lock.holderName || "Someone"} is editing this document. Take over to make changes.`,
      );
      return;
    }
    const result = await onSave?.({ ...saveData, version: lockEnabled ? lock.version : undefined });
    if (lockEnabled) lock.refreshVersion();
    if (saveData?.savedBy || saveData?.lastUsedBy) {
      setLiveTracking((prev) => ({
        savedBy: saveData.savedBy ?? prev.savedBy,
        savedAt: saveData.savedAt ?? prev.savedAt,
        lastUsedBy: saveData.lastUsedBy ?? prev.lastUsedBy,
        lastUsedAt: saveData.lastUsedAt ?? prev.lastUsedAt,
      }));
    }
    return result;
  }, [onSave, lockEnabled, lockReadOnly, lock.lostLock, lock.holderName, lock.version, lock.refreshVersion]);

  // Draft autosave: while we hold the lock on a persisted draft, edits save
  // automatically (debounced) so there's no manual Save button — Confirm stays
  // explicit. New (unsaved) drafts and the template editor keep the manual Save.
  const autosaveActive = lockEnabled && !lockReadOnly && !isTemplateEditMode;
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const isAutosavingRef = useRef(false);

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
      currency: existingData?.documentInfo?.currency
        || existingData?.currency
        || (organization as any)?.defaultCurrency
        || "SGD",
      qinRef: existingData?.documentInfo?.qinRef || existingData?.qinRef || "",
      // Additional fields for quotation extraction
      contact: existingData?.documentInfo?.contact || existingData?.contact || "",
      rate: existingData?.documentInfo?.rate || existingData?.rate || "",
      // New docs fall back to the org's Tax Defaults (Company Profile page).
      // The form Select uses "Y" / "N" string values, but the org stores
      // booleans — coerce so the select renders the right option instead of
      // sitting empty.
      taxApplicable: existingData?.documentInfo?.taxApplicable
        ?? existingData?.taxApplicable
        ?? ((organization as any)?.taxApplicable != null
          ? ((organization as any).taxApplicable ? "Y" : "N")
          : "Y"),
      absorbTax: existingData?.documentInfo?.absorbTax
        ?? existingData?.absorbTax
        ?? ((organization as any)?.absorbTax != null
          ? ((organization as any).absorbTax ? "Y" : "N")
          : "N"),
      gstPercent: existingData?.documentInfo?.gstPercent
        ?? existingData?.gstPercent
        ?? organization?.taxRate
        ?? 0,
      // DO-specific fields
      issueBy: existingData?.documentInfo?.issueBy || existingData?.issueBy || "",
    },
    // Flat issueBy for direct access
    issueBy: existingData?.issueBy || existingData?.documentInfo?.issueBy || "",
    // Details tab data
    projectId: existingData?.projectId || "",
    salesPerson: existingData?.documentInfo?.salesPerson || existingData?.salesPerson || "",
    // Biofuel quotation header mobile (editable, default seeded below). Flat
    // top-level so it round-trips via the transformer's flatFields whitelist.
    salesMobile: existingData?.salesMobile || "",
    salesContact: existingData?.salesContact || "",
    salesEmail: existingData?.salesEmail || "",
    paymentTerms: existingData?.documentInfo?.paymentTerms || existingData?.paymentTerms || "30 days",
    dueDate: existingData?.dueDate || "",
    // Quotation-specific fields
    quotationNo: existingData?.quotationNo || "",
    validityTerm: existingData?.validityTerm || "",
    currency: existingData?.currency || (organization as any)?.defaultCurrency || "SGD",
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
    // Top-level attention (contact person / number / email) — initialised from
    // the saved config.attention so it ROUND-TRIPS through reload + confirm.
    // The transformer already persists AND rehydrates config.attention; this
    // editor-side init was missing, which is why attention vanished after
    // confirming a quotation (the confirmed view re-mounts with empty attention).
    attention: {
      name: existingData?.attention?.name || "",
      phoneNumber: existingData?.attention?.phoneNumber || "",
      email: existingData?.attention?.email || "",
    },
    // Items data
    items: existingData?.items || [],
    // Source document tracking (for quotation/DO extraction)
    sourceDocumentId: existingData?.sourceDocumentId || "",
    sourceDocumentType: existingData?.sourceDocumentType || "",
    sourceDocumentNumber: existingData?.sourceDocumentNumber || "",
    // Footer data — fall back to org per-doc-type defaults (Company Profile
    // → Doc Defaults) when the doc itself doesn't carry a value. Per-doc
    // edits still win. Looks up by doc type, and tolerates either the
    // canonical type or a templateVariant alias.
    note: existingData?.documentInfo?.note
      || existingData?.note
      || ((organization as any)?.docTypeDefaults?.[documentType]?.notes)
      || "",
    termsAndConditions: existingData?.documentInfo?.termsAndConditions
      || existingData?.termsAndConditions
      || ((organization as any)?.docTypeDefaults?.[documentType]?.tnc)
      || "",
    footerMessage: existingData?.documentInfo?.footerMessage
      || existingData?.footerMessage
      // Doc Defaults are keyed by the canonical doc type (e.g. "QUOTATION"), but
      // documentType here is the template VARIANT ("QO1"/"QF"). Check the variant
      // first (back-compat) then fall back to actualDocumentType so the footer
      // default actually inherits for variant-based quotes.
      || ((organization as any)?.docTypeDefaults?.[documentType]?.footerMessage)
      || ((organization as any)?.docTypeDefaults?.[actualDocumentType as string]?.footerMessage)
      || "",
    bankDetails: existingData?.bankDetails || "",
    remarks: existingData?.remarks || "",
    agreementText: existingData?.agreementText || "",
    title: existingData?.title || "",
  });

  // Load template field configuration
  // DO editor is single-tab: Reference No moves onto the General tab (ordering
  // via HEADER_FIELD_ORDER puts it after Issue By) and the leftover Details
  // tab (Reference No + Remarks) is dropped. Presentation-only — the page's
  // own fieldConfig still maps every field for save/load.
  const mergeDoDetailsIntoGeneral = useCallback((cfg: any) => {
    if (!isDeliveryOrder || !cfg?.tabs) return cfg;
    const details = cfg.tabs.find((t: any) => t.tabId === 'details');
    if (!details) return cfg;
    const refField = details.fields?.find((f: any) => f.fieldName === 'documentInfo.referenceNo');
    return {
      ...cfg,
      tabs: cfg.tabs
        .filter((t: any) => t.tabId !== 'details')
        .map((t: any) =>
          t.tabId === 'general' && refField && !t.fields.some((f: any) => f.fieldName === 'documentInfo.referenceNo')
            ? { ...t, fields: [...t.fields, refField] }
            : t,
        ),
    };
  }, [isDeliveryOrder]);

  useEffect(() => {
    async function loadTemplateFields() {
      try {
        // If field definitions are provided as props, use them directly
        if (propFieldDefinitions) {
          console.log('Using prop field definitions');
          setTemplateFieldConfig(mergeDoDetailsIntoGeneral(propFieldDefinitions));
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
        setTemplateFieldConfig(mergeDoDetailsIntoGeneral(config));
      } catch (error) {
        console.error('Error loading template fields:', error);
        toast.error('Failed to load template configuration');
      } finally {
        setIsLoadingFieldConfig(false);
      }
    }

    loadTemplateFields();
  }, [documentType, templateId, existingData?.documentTemplateId, existingData?.templateId, propFieldDefinitions, getToken, mergeDoDetailsIntoGeneral]);

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
  const markEdited = lock.markEdited;
  const setFormData = useCallback((update: any) => {
    isDirtyRef.current = true;
    markEdited(); // real edit → bump the lock's idle clock on next heartbeat
    setFormDataState(update);
  }, [markEdited]);
  const setItems = useCallback((update: any) => {
    isDirtyRef.current = true;
    markEdited();
    setItemsState(update);
  }, [markEdited]);

  // ── Biofuel DO "Our Ref" quotation selector ────────────────────────────
  // On Biofuel DOs, Reference No is picked from the customer's CONFIRMED
  // quotations via a search dialog (Customer-code-field pattern). The editor
  // stores just the quotation NUMBER; the confirm date rides along in
  // documentInfo.referenceQuotationDate so the printout can render
  // "Our Ref. No : QO… dated dd/mm/yyyy". Free typing still allowed.
  const [refQuotations, setRefQuotations] = useState<any[]>([]);
  const [refQuotationDialogOpen, setRefQuotationDialogOpen] = useState(false);
  useEffect(() => {
    if (!(isBiofuel && isDeliveryOrder) || !formData.customer?.id) {
      setRefQuotations([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: "/documents", method: "POST" }, { organizationId: organization?.id }, token);
        if (cancelled || !res?.success) return;
        const qTypes = ["QUOTATION", "QT", "QO", "QO1", "QO2"];
        setRefQuotations(
          (res.data || []).filter(
            (d: any) =>
              qTypes.includes(String(d.documentType || d.type || "").toUpperCase()) &&
              d.config?.customerId === formData.customer.id &&
              d.status === "confirmed",
          ),
        );
      } catch (e) {
        console.error("ref-quotation fetch failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBiofuel, isDeliveryOrder, formData.customer?.id, organization?.id]);

  const handleRefQuotationSelect = useCallback((q: any) => {
    setFormData((prev: any) => ({
      ...prev,
      documentInfo: {
        ...prev.documentInfo,
        referenceNo: q?.name || "",
        // Printed as " dated dd/mm/yyyy" after the number on the DO.
        referenceQuotationDate: q ? (q.config?.confirmedAt || q.createdAt || null) : null,
      },
    }));
  }, [setFormData]);

  // ---- AI Document Assistant ----
  const [assistantOpen, setAssistantOpen] = useState(false);

  // Apply a proposal (or section of one) from the assistant into the form.
  // Each part is merged non-destructively; proposed line items are appended
  // (mapped to the editor's item shape) so existing rows aren't clobbered.
  const handleApplyProposal = useCallback((patch: ProposalPatch) => {
    if (!patch) return;
    if (patch.documentInfo || patch.customer || patch.note != null || patch.termsAndConditions != null || patch.footerMessage != null) {
      setFormData((prev: any) => ({
        ...prev,
        ...(patch.documentInfo ? { documentInfo: { ...prev.documentInfo, ...patch.documentInfo } } : {}),
        ...(patch.customer ? { customer: { ...prev.customer, ...patch.customer } } : {}),
        ...(patch.note != null ? { note: patch.note } : {}),
        ...(patch.termsAndConditions != null ? { termsAndConditions: patch.termsAndConditions } : {}),
        ...(patch.footerMessage != null ? { footerMessage: patch.footerMessage } : {}),
      }));
    }
    if (Array.isArray(patch.items) && patch.items.length) {
      const isInvoiceType = documentType === "TI" || documentType === "TI2" || documentType === "INVOICE";
      const base = Date.now();
      const mapped = patch.items.map((it, i) => {
        const quantity = Number(it.quantity) || 0;
        const unitPrice = Number(it.unitPrice) || 0;
        return {
          id: base + i,
          itemCode: "",
          inventoryItemId: "",
          description: it.description || "",
          quantity,
          unitPrice,
          uom: it.uom || "",
          tax: isInvoiceType ? undefined : (it.tax != null ? String(it.tax) : "9"),
          amount: quantity * unitPrice,
        };
      });
      setItems((prev: any[]) => [...(prev || []), ...mapped]);
      toast.success(`Added ${mapped.length} item${mapped.length > 1 ? "s" : ""} from the assistant`);
    }
  }, [setFormData, setItems, documentType]);

  // Linked-project change handler used by the QUOTATION project picker.
  // Purely local state update — the actual PATCH to
  // /documents/:id/link-project is deferred until the document is saved
  // (see persistProjectLinkIfChanged below).
  const handleProjectLinkChange = useCallback((nextId: string) => {
    setFormData((prev: any) => (prev.projectId === nextId ? prev : { ...prev, projectId: nextId }));
  }, [setFormData]);

  // Local projects = props.projects + any project the user has just created
  // via the "+ Create new project" inline flow. Lets the picker show the new
  // row immediately without waiting for the parent's useGetProjects refetch.
  const [locallyCreatedProjects, setLocallyCreatedProjects] = useState<any[]>([]);
  const effectiveProjects = useMemo(
    () => [...projects, ...locallyCreatedProjects],
    [projects, locallyCreatedProjects],
  );
  // Drop locally-created entries that have shown up in the refreshed parent
  // list — keeps the union from growing forever as the parent refetches.
  useEffect(() => {
    if (locallyCreatedProjects.length === 0) return;
    setLocallyCreatedProjects((prev) =>
      prev.filter((local) => !projects.some((p: any) => p.id === local.id)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  // Create-Project inline dialog state.
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [createProjectName, setCreateProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const handleCreateProjectSubmit = useCallback(async () => {
    const trimmed = createProjectName.trim();
    if (!trimmed) {
      toast.error("Project name is required");
      return;
    }
    const customerId = formData.customer?.id;
    if (!customerId) {
      toast.error("Pick a customer first");
      return;
    }
    setCreatingProject(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await request(
        { path: "/projects/create-by-name", method: "POST" },
        { name: trimmed, customerId },
        token,
      );
      if (res?.success && res.data?.id) {
        const created = {
          id: res.data.id,
          name: res.data.name ?? trimmed,
          customerId: res.data.customerId ?? customerId,
          status: res.data.status ?? "pending",
        };
        setLocallyCreatedProjects((prev) => [...prev, created]);
        // Auto-select the new project in the picker.
        setFormData((prev: any) => ({ ...prev, projectId: created.id }));
        toast.success("Project created");
        setCreateProjectDialogOpen(false);
        setCreateProjectName("");
      } else {
        toast.error(res?.message ?? "Failed to create project");
      }
    } catch (err) {
      console.error("create project failed:", err);
      toast.error("Failed to create project");
    } finally {
      setCreatingProject(false);
    }
  }, [createProjectName, formData.customer?.id, getToken, setFormData]);

  // Tracks the last projectId successfully persisted to the backend so we
  // know whether to fire the link-project PATCH on save. Initialized from
  // existingData.projectId on each document load.
  const persistedProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    persistedProjectIdRef.current = existingData?.projectId ?? null;
  }, [existingData?.id, existingData?.projectId]);

  // Commit the document→project link to the backend. Called from each save
  // flow (Save as Draft, Confirm, etc.). No-op when the picker value matches
  // what's already persisted; skipped for doc types without the picker and
  // for unsaved (no documentId) drafts — those persist via the normal
  // document update flow when the doc is first created. Quotations and
  // delivery orders carry the picker (link-project endpoint allows both).
  const persistProjectLinkIfChanged = useCallback(async () => {
    if (!isQuotation && !isDeliveryOrder) return;
    const docId = documentId || existingData?.id;
    if (!docId) return;
    const desired = formData.projectId || null;
    const persisted = persistedProjectIdRef.current || null;
    if (desired === persisted) return;
    try {
      const token = await getToken();
      if (!token) return;
      const res = await request(
        { path: `/documents/${docId}/link-project`, method: "PATCH" },
        { projectId: desired },
        token,
      );
      if (res?.success) {
        persistedProjectIdRef.current = desired;
      } else {
        toast.error(res?.message ?? "Failed to save project link");
      }
    } catch (err) {
      console.error("link-project PATCH failed:", err);
      toast.error("Failed to save project link");
    }
  }, [isQuotation, isDeliveryOrder, documentId, existingData?.id, formData.projectId, getToken]);

  // Reset the dirty flag whenever a different document is loaded.
  useEffect(() => {
    isDirtyRef.current = false;
  }, [existingData]);

  // Projects are customer-scoped: clear formData.projectId whenever the
  // currently-selected customer changes to one the project doesn't belong to.
  // Skips while projects haven't loaded yet so we don't blow away a valid link
  // pre-fetch.
  useEffect(() => {
    if (!formData.projectId) return;
    if (!projects || projects.length === 0) return;
    const proj = projects.find((p: any) => p.id === formData.projectId);
    if (!proj) return; // unknown project (filtered out / not loaded) — leave alone
    const customerId = formData.customer?.id;
    if (proj.customerId && customerId && proj.customerId !== customerId) {
      setFormDataState((prev: any) => ({ ...prev, projectId: "" }));
    }
  }, [formData.customer?.id, projects]);

  // Fill in customer details from customers list if missing
  useEffect(() => {
    // Only run if we have a customer ID and customers list is loaded
    if (formData.customer?.id && customers?.length > 0) {
      const customer = customers.find((c: any) => c.id === formData.customer.id);
      if (customer) {
        // Seed documentInfo.contact from the customer's phone when it's empty
        // — templates that show a Contact field (QO/DO/PO/etc.) get an
        // auto-fill instead of forcing the user to retype the phone.
        const contactNeedsSeed = !formData.documentInfo?.contact && !!customer.phone;
        const needsUpdate =
          !formData.customer?.address ||
          !formData.customer?.customerCode ||
          contactNeedsSeed;
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
            documentInfo: {
              ...prev.documentInfo,
              contact: prev.documentInfo?.contact || customer.phone || "",
            },
            // Also set billTo if it's empty
            billTo: prev.billTo || customer.address || "",
          }));
        }
      }
    }
  }, [customers, formData.customer?.id, formData.customer?.address, formData.customer?.customerCode, formData.documentInfo?.contact]);

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

  // Biofuel quotations: seed the salesperson MOBILE to the house default
  // (9818 9200) when empty. The salesperson NAME comes from the Salesman Code
  // field (documentInfo.salesPerson), so it's no longer seeded here. Runs once
  // when org/type resolve (deps are isBiofuel/isQuotation, NOT formData), so the
  // user can freely edit/clear within the session. Per-quote only.
  useEffect(() => {
    if (!isBiofuel || !isQuotation) return;
    setFormDataState((prev: any) => {
      if (prev.salesMobile != null && prev.salesMobile !== "") return prev;
      return { ...prev, salesMobile: "9818 9200" };
    });
  }, [isBiofuel, isQuotation]);

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

  // Sync top-level attention from existingData when it loads async (mirrors the
  // documentInfo sync above). Only fills when the current attention is empty, so
  // it never clobbers an in-progress edit. Belt-and-suspenders with the useState
  // init for the case where existingData arrives after mount.
  useEffect(() => {
    const ea = existingData?.attention;
    if (ea && typeof ea === "object") {
      setFormDataState((prev: any) => {
        const cur = prev.attention || {};
        if (cur.name || cur.phoneNumber || cur.email) return prev;
        return { ...prev, attention: { name: ea.name || "", phoneNumber: ea.phoneNumber || "", email: ea.email || "" } };
      });
    }
  }, [existingData?.attention]);

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
      // GL account from the Stock Card Rental/Sales tab → line self-codes for posting.
      ...(selectedItem.accountCode ? { accountCode: selectedItem.accountCode } : {}),
      // Editor-only tag (rental/sale/service) — shown in the editor, never in the preview/PDF.
      ...(selectedItem.__revenueMode ? { revenueTag: selectedItem.__revenueMode === "rental" ? "rental" : "sale" } : {}),
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

    if (editingItemId != null) {
      // Pencil edit — replace THIS row's product fields, keep its id/quantity.
      setItems(items.map((it: any) => {
        if (it.id !== editingItemId) return it;
        const qty = Number(it.quantity) || 1;
        return {
          ...it,
          isService: false,
          itemCode: newItem.itemCode,
          inventoryItemId: newItem.inventoryItemId,
          description: newItem.description,
          unitPrice: newItem.unitPrice,
          amount: qty * Number(newItem.unitPrice || 0),
          ...(newItem.uom !== undefined ? { uom: newItem.uom } : {}),
          // Reflect the NEW selection's GL account + rental/sale tag (overwrite,
          // and clear if the new pick is unmapped — don't keep the stale one).
          accountCode: newItem.accountCode ?? null,
          revenueTag: newItem.revenueTag ?? null,
        };
      }));
      setEditingItemId(null);
    } else {
      setItems([...items, newItem]);
    }

    // Prefetch price history for this asset if available
    if (selectedItem.assetId) {
      prefetchPriceHistory(selectedItem.assetId);
    }
  };

  // Build a service line carrying the doc-type-specific fields. Shared by the
  // blank "Add Service" and the Revenue Master File picker (which also sets the
  // description / unit price / GL accountCode so the invoice self-codes).
  const makeServiceItem = (base: any = {}) => {
    const newItem: any = { id: Date.now() + Math.floor(Math.random() * 1000), itemCode: "", inventoryItemId: "", description: "", quantity: 1, unitPrice: 0, amount: 0, isService: true, revenueTag: "service", ...base };
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
    return newItem;
  };
  const addBlankServiceLine = () => {
    // Pencil edit + "blank" picked → keep the existing row as-is, just exit edit.
    if (editingItemId != null) { setEditingItemId(null); return; }
    setItems([...items, makeServiceItem()]);
  };
  const addRevenueItemLine = (rev: any) => {
    const up = rev.unitPrice != null ? Number(rev.unitPrice) : 0;
    if (editingItemId != null) {
      setItems(items.map((it: any) => it.id === editingItemId ? {
        ...it,
        isService: rev.type === "SERVICE",
        itemCode: rev.code || it.itemCode,
        description: rev.name,
        unitPrice: up,
        amount: (Number(it.quantity) || 1) * up,
        accountCode: rev.accountCode ?? null,
        revenueTag: rev.type === "SERVICE" ? "service" : null,
      } : it));
      setEditingItemId(null);
      return;
    }
    setItems([...items, makeServiceItem({ itemCode: rev.code || "", description: rev.name, unitPrice: up, amount: up, accountCode: rev.accountCode, isService: rev.type === "SERVICE" })]);
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
    // One "set" = CU + (each FCU × FCU Qty) + (each accessory × Accessory Qty).
    // Set Qty (masterQty) multiplies the whole set.
    const m = Number(row.masterQty) || 1;
    const setList = (Number(cu?.unitPrice) || 0) + sumFcu((a) => Number(a.unitPrice) || 0) + sumAcc((a) => Number(a.unitPrice) || 0);
    const setDealer = (cu ? discountPriceOf(cu) : 0) + sumFcu((a) => discountPriceOf(a)) + sumAcc((a) => discountPriceOf(a));
    const setCost = (Number(cu?.costPrice) || 0) + sumFcu((a) => a.costPrice) + sumAcc((a) => a.costPrice);
    const setPoints = (cu ? pointsOf(cu) : 0) + sumFcu((a) => pointsOf(a));
    const list = m * setList;
    const dealer = m * setDealer;
    const cost = m * setCost;
    const points = m * setPoints;
    const label = [cu?.sku, ...fcuRows.map(({ a, qty }: any) => (qty > 1 ? `${qty}× ${a.sku}` : a.sku))].filter(Boolean).join(" + ");

    return { ...row, masterQty: m, listPrice: list, discountPrice: dealer, costPrice: cost, pointsTotal: points, unitPrice: list, quantity: m, amount: list, description: label, itemCode: label };
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
    const q = Math.max(0, Number(qty) || 0);
    setItems((prev: any[]) => prev.map((it: any) => {
      if (it.id !== rowId) return it;
      const fcus = [...(it.fcus || [])];
      if (index < fcus.length) fcus[index] = { ...fcus[index], qty: q };
      return recalcFcuCuRow({ ...it, fcus });
    }));
  };

  // Per-accessory quantity.
  const setAccessoryQtyAt = (rowId: number, index: number, qty: number) => {
    const q = Math.max(0, Number(qty) || 0);
    setItems((prev: any[]) => prev.map((it: any) => {
      if (it.id !== rowId) return it;
      const accessories = [...(it.accessories || [])];
      if (index < accessories.length) accessories[index] = { ...accessories[index], qty: q };
      return recalcFcuCuRow({ ...it, accessories });
    }));
  };

  // Master/Set qty — multiplies CU + all FCUs + all accessories for the row.
  const setMasterQty = (rowId: number, qty: number) => {
    const q = Math.max(0, Number(qty) || 0);
    setItems((prev: any[]) => prev.map((it: any) => (it.id === rowId ? recalcFcuCuRow({ ...it, masterQty: q }) : it)));
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
      { id: Date.now(), cuAssetId: "", cuCode: "", cuName: "", fcus: [], accessories: [], masterQty: 1, quantity: 1, listPrice: 0, discountPrice: 0, costPrice: 0, unitPrice: 0, amount: 0 },
    ]);
  };

  // Open the QF stock-card picker for a row's CU, an FCU slot, or an accessory slot.
  const openQfPicker = (rowId: number, target: "cu" | "fcu" | "accessory", slotIndex: number) =>
    setQfPicker({ rowId, target, slotIndex });

  // Items shown in the QF picker: CUs, FCUs scoped to the CU's children, or
  // accessories scoped to the row's selected FCU(s) (defaults + options).
  const qfPickerRow = qfPicker ? items.find((it: any) => it.id === qfPicker.rowId) : null;
  const accessoriesForRow = (row: any) => {
    const ids = new Set<string>();
    (row?.fcus || []).forEach((f: any) => {
      const fcuObj = inventoriesForDocument.find((i: any) => i.id === f.assetId);
      (fcuObj?.accessoryIds || []).forEach((id: string) => ids.add(id));
      (fcuObj?.accessoryOptionIds || []).forEach((id: string) => ids.add(id));
    });
    const scoped = accOptions.filter((a: any) => ids.has(a.id));
    return scoped.length ? scoped : accOptions; // fall back to all if no FCU picked
  };

  // VRV (and any capacityKw-tagged) sizing rule: total FCU capacity on a
  // row must not exceed the CU's capacity by more than 130%. Hide CUs
  // whose capacity × 1.3 < the FCU total currently on the row. CUs with
  // no capacityKw set (most non-VRV CUs) pass through unfiltered.
  const FCU_TO_CU_RATIO = 1.3;
  const fcuTotalKwForRow = (row: any): number => {
    if (!row) return 0;
    let sum = 0;
    for (const f of row.fcus || []) {
      const fAsset = inventoriesForDocument.find((i: any) => i.id === f.assetId);
      const cap = Number(fAsset?.capacityKw) || 0;
      const qty = Number(f.qty) || 1;
      sum += cap * qty;
    }
    return sum;
  };
  const cuOptionsForRow = (row: any): any[] => {
    const fcuKw = fcuTotalKwForRow(row);
    // No FCUs picked yet (or none have capacityKw) → show the full CU list,
    // so non-VRV product lines (RKM / MKM / SkyAir, none of which have a
    // capacityKw rating) work exactly as before.
    if (fcuKw <= 0) return cuOptions;
    // VRV mode (the row has FCU capacities). Only CUs that *also* have a
    // capacityKw AND meet the 130% rule survive — that automatically drops
    // mis-categorised entries like the Heat Recovery Ventilators (VAM*HVE),
    // which are sitting in the Condensing Unit category but aren't real CUs
    // and have no capacityKw.
    return cuOptions.filter((cu: any) => {
      const cuKw = Number(cu.capacityKw);
      if (!Number.isFinite(cuKw) || cuKw <= 0) return false;
      return fcuKw <= cuKw * FCU_TO_CU_RATIO;
    });
  };

  const qfPickerItems = !qfPicker
    ? []
    : qfPicker.target === "cu"
    ? cuOptionsForRow(qfPickerRow)
    : qfPicker.target === "accessory"
    ? accessoriesForRow(qfPickerRow)
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

  // PO-from-order discount gating by the source order's Type (carried in config.orderType).
  // Project: the top discount % cascades into item-level discounts (applied once, at item level).
  // Route Order: both the top discount and the item Discount column are hidden.
  const poOrderType = String(
    (formData?.documentInfo as any)?.orderType ?? (formData as any)?.orderType ??
    (existingData as any)?.orderType ?? existingData?.documentInfo?.orderType ?? "",
  );
  const isPurchaseOrderDoc = documentType === "PO" || documentType === "PURCHASE_ORDER";
  const isRouteOrderPO = isPurchaseOrderDoc && poOrderType === "Route Order";
  const isProjectPO = isPurchaseOrderDoc && poOrderType === "Project";
  // Route Order PO: auto-computed Σ points × qty across items — used as the
  // default "Less Points" deduction unless the user has manually edited the
  // amount they want to redeem from the org-wide Points balance.
  const poTotalPoints = isRouteOrderPO
    ? items.reduce((s: number, it: any) => s + (Number(it.points) || 0) * (Number(it.quantity) || 0), 0)
    : 0;
  // User-editable redemption (lives on documentInfo.pointsRedeemed). When
  // unset, fall back to the auto-computed total so existing POs keep
  // showing what they always did. Cleared (empty string) → fall back too.
  const pointsRedeemedRaw = (formData?.documentInfo as any)?.pointsRedeemed;
  const poPointsRedeemed =
    isRouteOrderPO
      ? pointsRedeemedRaw != null && String(pointsRedeemedRaw) !== ""
        ? Math.max(0, Number(pointsRedeemedRaw) || 0)
        : poTotalPoints
      : 0;

  // QF quotation "Type" drives the pricing waterfall. Project sells at the
  // list/unit price — only the document discount applies, no dealer tier and no
  // points deduction. Route Order (the default) sells at dealer − points.
  const isProjectQuote = isFcuCuVariant && poOrderType === "Project";

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
    // Explicit 0 is a real rate (zero-rated / exempt tax codes) — only fall
    // back to the org default when gstPercent is genuinely unset.
    const gstRaw = parseFloat(di?.gstPercent);
    const gstPercent = !isTaxApplicable ? 0 : Number.isFinite(gstRaw) ? gstRaw : (organization?.taxRate ?? 9);
    const r2 = (n: number) => parseFloat((Number(n) || 0).toFixed(2));

    // FCU-CU (QF) waterfall. Route Order: Gross = Σ list; base = Σ Dealer −
    // Σ Points; Discounted Price = base − doc discount. Project: base = Σ list
    // (no dealer, no points) so the quotation shows the unit price minus only
    // the document discount. Nett = Discounted Price + GST either way.
    if (isFcuCuVariant) {
      const grossTotal = items.reduce((a: number, it: any) => a + (Number(it.listPrice) || 0), 0);
      const dealerTotal = isProjectQuote ? 0 : items.reduce((a: number, it: any) => a + (Number(it.discountPrice) || 0), 0);
      const pointsTotal = isProjectQuote ? 0 : items.reduce((a: number, it: any) => a + (Number(it.pointsTotal) || 0), 0);
      const afterPoints = isProjectQuote ? grossTotal : Math.max(0, dealerTotal - pointsTotal);
      const userDiscount = discountType === "amount" ? Math.min(discountValue, afterPoints) : afterPoints * (discountValue / 100);

      // Hardcoded round-down rules for QF quotes (Cappitech):
      //  • Project: round the Discounted Price (pre-GST) DOWN to the nearest 100,
      //    then let the salesperson fine-tune it anywhere inside that hundred
      //    band [floor, floor+99] via documentInfo.discountedPriceOverride. The
      //    Discount line absorbs whatever gap is left (afterPoints − final).
      //  • Route Order: round the Nett Total (post-GST) DOWN to the nearest 5
      //    (the legacy enableNettRoundDown step); crumb shows as a 'Round-down'
      //    line below GST.
      const PROJECT_STEP = 100;
      const ROUTE_STEP = 5;
      const step = isProjectQuote ? PROJECT_STEP : ROUTE_STEP;

      let discountAmount = userDiscount;
      let discountedPrice = Math.max(0, afterPoints - userDiscount);
      if (isProjectQuote) {
        const bandFloor = Math.floor(discountedPrice / PROJECT_STEP) * PROJECT_STEP;
        const bandCeil = bandFloor + (PROJECT_STEP - 1);
        const ovRaw = di?.discountedPriceOverride;
        const hasOverride = ovRaw != null && String(ovRaw) !== "" && !isNaN(Number(ovRaw));
        // Default = auto round-down to the hundred floor; an override is clamped
        // back into the band so it can never escape [floor, floor+99].
        discountedPrice = hasOverride
          ? Math.min(bandCeil, Math.max(bandFloor, Number(ovRaw)))
          : bandFloor;
        discountAmount = Math.max(0, afterPoints - discountedPrice);
      }

      let gstAmount: number, nettTotal: number;
      if (isAbsorbTax && gstPercent > 0) {
        nettTotal = discountedPrice;
        gstAmount = nettTotal * gstPercent / (100 + gstPercent);
      } else {
        gstAmount = discountedPrice * (gstPercent / 100);
        nettTotal = discountedPrice + gstAmount;
      }

      let routeRoundAbsorbed = 0;
      if (!isProjectQuote) {
        const target = Math.floor(nettTotal / ROUTE_STEP) * ROUTE_STEP;
        routeRoundAbsorbed = nettTotal - target;
        nettTotal = target;
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
          // Per-quote round-down absorbed amount; surfaced as a line on the
          // editor footer + clean preview when > 0 (Route Order only — the
          // Project version is already baked into discountAmount above).
          quoteRoundDown: r2(routeRoundAbsorbed),
          quoteRoundStep: step,
          nettTotal: r2(nettTotal),
        },
      }));
      return;
    }

    const grossTotal = subtotal;
    // Per-document discount: either a % of the gross or a flat $ amount (capped at gross).
    // Project PO: the discount lives on the item lines (cascaded), so don't apply it
    // again at the document level.
    const discountAmount = isProjectPO
      ? 0
      : discountType === "amount"
      ? Math.min(discountValue, grossTotal)
      : grossTotal * (discountValue / 100);
    const subTotalAfterDiscount = grossTotal - discountAmount;

    let gstAmount: number;
    let nettTotal: number;

    if (isAbsorbTax && gstPercent > 0) {
      // Absorb tax: total stays the same, GST is back-calculated from within.
      // Points come off after that so 1 point = $1 off the displayed Nett.
      gstAmount = subTotalAfterDiscount * gstPercent / (100 + gstPercent);
      nettTotal = subTotalAfterDiscount - poPointsRedeemed;
    } else {
      // Normal: GST is computed on the full sub-total (not on sub − points),
      // then points come off the Nett directly. This makes "Less Points"
      // behave like a flat $-for-$ deduction — the value the user types is
      // exactly what comes off the Nett Total.
      gstAmount = subTotalAfterDiscount * (gstPercent / 100);
      nettTotal = subTotalAfterDiscount + gstAmount - poPointsRedeemed;
    }

    setFormDataState((prev: any) => ({
      ...prev,
      documentInfo: {
        ...prev.documentInfo,
        grossTotal: r2(grossTotal),
        discountAmount: r2(discountAmount),
        // Saved: the user's chosen redemption (drives Less Points everywhere
        // including the clean preview); pointsDeducted kept as a legacy alias.
        pointsRedeemed: r2(poPointsRedeemed),
        pointsDeducted: r2(poPointsRedeemed),
        subTotal: isAbsorbTax ? r2(subTotalAfterDiscount - gstAmount) : r2(subTotalAfterDiscount),
        gstAmount: r2(gstAmount),
        nettTotal: r2(nettTotal),
      },
    }));
  }, [subtotal, items, isFcuCuVariant, isProjectQuote, isNettRoundDownEnabled, poPointsRedeemed, (formData?.documentInfo as any)?.discountPercent, (formData?.documentInfo as any)?.discountType, (formData?.documentInfo as any)?.discountedPriceOverride, (formData?.documentInfo as any)?.gstPercent, formData?.documentInfo?.taxApplicable, formData?.documentInfo?.absorbTax, isTaxApplicable, isAbsorbTax]);

  // Project PO: when the top Discount % changes, cascade it into every item's
  // discount (applied once at item level — the document-level discount is then
  // zeroed in the totals so it isn't double-counted). Skips the initial mount so
  // a saved PO's per-item discounts aren't clobbered on load.
  const cascadedDiscRef = useRef<number | null>(null);
  useEffect(() => {
    const dp = parseFloat((formData?.documentInfo as any)?.discountPercent) || 0;
    if (!isProjectPO) { cascadedDiscRef.current = dp; return; }
    if (cascadedDiscRef.current === null) { cascadedDiscRef.current = dp; return; } // skip mount
    if (cascadedDiscRef.current === dp) return;
    cascadedDiscRef.current = dp;
    setItems((prev: any[]) => prev.map((it: any) => {
      const qty = Number(it.quantity) || 0;
      const unit = Number(it.unitPrice) || 0;
      return { ...it, discount: dp, discountType: "percent", amount: qty * unit * (1 - dp / 100) };
    }));
  }, [(formData?.documentInfo as any)?.discountPercent, isProjectPO]);

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
      await guardedSave(saveData);
      // Persist any pending quotation→project link before the page reloads.
      await persistProjectLinkIfChanged();

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
    // Type gate — every quotation that has a Type field configured (the QF
    // template's Project / Route Order picker) must have one chosen before
    // confirm. Without it the auto-created Order has orderType=null, and
    // downstream gating (Route Order PO points, Project per-item discount
    // cascade) silently breaks. Stop the user here instead.
    const docInfo: any = formData?.documentInfo || {};
    const typeFieldConfigured =
      isFcuCuVariant ||
      Object.prototype.hasOwnProperty.call(docInfo, "orderType") ||
      Object.prototype.hasOwnProperty.call(formData || {}, "orderType");
    if (typeFieldConfigured) {
      const ot = String(docInfo.orderType ?? (formData as any)?.orderType ?? "").trim();
      if (!ot) {
        toast.error("Please select a Type (Project or Route Order) before confirming.");
        return;
      }
    }

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
      await guardedSave(saveData);
      // Persist any pending quotation→project link.
      await persistProjectLinkIfChanged();
      toast.success("Quotation confirmed");

      // The backend auto-creates an Order with sourceQuotationId = this doc's
      // id (gated by enableConfirmQuotation). Look it up so the dialog can
      // offer a direct jump. Best-effort — if the order isn't there yet
      // (very fast confirm + slower auto-create), the dialog still opens
      // and the "Go to Order" button will be disabled.
      try {
        const quotationId = documentId || (existingData as any)?.id;
        if (quotationId) {
          const token = await getToken();
          const res = await request({ path: "/orders", method: "GET" }, {}, token ?? undefined);
          const list: any[] = res?.data ?? [];
          const found = list.find((o) => o?.sourceQuotationId === quotationId);
          setLinkedOrderId(found?.id ?? null);
        }
      } catch (err) {
        console.warn("Failed to resolve linked order after confirm:", err);
        setLinkedOrderId(null);
      }

      setConvertQuotationDialogOpen(true);
    } catch (error) {
      console.error("Error confirming quotation:", error);
      toast.error("Failed to confirm quotation");
    } finally {
      setIsConfirming(false);
    }
  };

  // (handleConvertQuotation was removed — the post-confirm dialog now offers
  // only "Go to Order" and "Leave it"; PO/DO/Invoice spin-offs happen from
  // the order page where the items are already in hand.)

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
      await guardedSave(saveData);

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
      await guardedSave(saveData);

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
      await guardedSave(saveData);

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
      await guardedSave(saveData);

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
      await guardedSave(saveData);

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

      if (makeRecurringAfterConfirmRef.current) {
        // "Confirm & make recurring" — hand off to the recurring setup screen,
        // prefilled from this now-confirmed invoice (customer, lines, deployment).
        makeRecurringAfterConfirmRef.current = false;
        router.push(`/portal/accounting/receivables?tab=recurring-invoices&fromInvoice=${docId}`);
        return;
      }

      // Full page reload to update the status
      window.location.reload();
    } catch (error) {
      console.error("Error confirming Invoice:", error);
      toast.error("Failed to confirm Invoice");
      makeRecurringAfterConfirmRef.current = false;
    } finally {
      setIsConfirming(false);
    }
  };

  // Open the AI posting-preview ("Review") for the invoice — a dry-run that
  // suggests a revenue account per line. Saves/posts nothing.
  const openInvoiceReview = async () => {
    const hasLines = (items || []).some((it: any) => parseFloat(it.amount) > 0);
    if (!hasLines) {
      toast.error("Add at least one line with an amount first");
      return;
    }
    setInvoicePreviewOpen(true);
    setInvoicePreviewLoading(true);
    setInvoicePreviewData(null);
    try {
      const token = await getToken();
      if (!token) return;
      // Load the chart of accounts for the picker (once).
      if (invoiceAccounts.length === 0) {
        const accRes: any = await request({ path: "/accounting/accounts", method: "GET" }, {}, token);
        const list: PreviewAccount[] = (accRes?.data || accRes || [])
          .filter((a: any) => a.isActive)
          .map((a: any) => ({ id: a.id, code: a.code, name: a.name }));
        setInvoiceAccounts(list);
      }
      const taxAmount =
        parseFloat(
          (formData as any)?.gstAmount ??
            (formData as any)?.summary?.taxAmount ??
            (formData as any)?.documentInfo?.gstAmount ??
            0,
        ) || 0;
      const res: any = await request(
        { path: "/posting-preview", method: "POST" },
        {
          type: documentType,
          documentNumber: (formData as any)?.name || (formData as any)?.documentInfo?.documentNumber,
          taxAmount,
          // Tax-inclusive doc → line amounts are gross; the preview nets them.
          amountsInclusive:
            (formData as any)?.documentInfo?.absorbTax === "Y" ||
            (formData as any)?.documentInfo?.absorbTax === true,
          lines: (items || []).map((it: any) => ({
            description: it.description || undefined,
            amount: parseFloat(it.amount) || 0,
            accountCode: it.accountCode || undefined,
          })),
        },
        token,
      );
      if (res?.success) {
        setInvoicePreviewData(res.data);
      } else {
        toast.error(res?.message || "Couldn't get account suggestions");
        setInvoicePreviewOpen(false);
      }
    } catch (e: any) {
      toast.error(e?.message || "Couldn't get account suggestions");
      setInvoicePreviewOpen(false);
    } finally {
      setInvoicePreviewLoading(false);
    }
  };

  // Confirm the review: write the chosen account code back onto each invoice
  // line and close. Does NOT post — the user keeps editing / confirms the
  // invoice when ready.
  const applyInvoiceReview = (
    picks: Array<{ lineIndex: number; accountId: string | null; accountCode: string | null }>,
  ) => {
    const override: Record<number, string | null> = {};
    for (const p of picks) override[p.lineIndex] = p.accountCode;
    setItems((rows: any[]) => rows.map((r, i) => (i in override ? { ...r, accountCode: override[i] } : r)));
    setInvoicePreviewOpen(false);
    toast.success("Accounts applied — review and confirm when ready");
  };

  // Teach the account-coding memory when the accountant overrides a suggestion,
  // so next time the same description is coded the same way. Fire-and-forget.
  const learnInvoiceCorrections = async (corrections: Array<{ text: string; accountCode: string }>) => {
    try {
      const token = await getToken();
      if (!token) return;
      await request({ path: "/posting-preview/learn", method: "POST" }, { side: "SALES", corrections }, token);
    } catch {
      /* non-blocking */
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

  // ⋮ overflow menu (Xero-style) — hosts the secondary toolbar actions.
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<null | HTMLElement>(null);
  const closeMoreMenu = () => setMoreMenuAnchor(null);

  // Xero-style per-document "History & notes" drawer (⋮ menu).
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  const handleAddNewDocument = async () => {
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
        router.push(`/portal/documents/${docTypeForCreate}/${templateId}/${response.data.id}`);
      } else {
        toast.error(response?.message || "Failed to create document");
      }
    } catch (error) {
      console.error("Error creating new document:", error);
      toast.error("Failed to create document");
    }
  };

  // Shared fetch for the Extract-from-Quotation flows (DO and SO variants).
  const fetchQuotationsForExtract = async (): Promise<any[] | null> => {
    const token = await getToken();
    if (!token) {
      toast.error("Authentication required");
      return null;
    }
    const response = await request(
      { path: "/documents", method: "POST" },
      { organizationId: organization?.id },
      token
    );
    if (!response?.success) {
      toast.error("Failed to fetch quotations");
      return null;
    }
    const quotationTypes = ["QUOTATION", "QT", "QO", "QO1"];
    return (response.data || []).filter((doc: any) => {
      const docType = doc.type || doc.documentType || "";
      return quotationTypes.includes(docType.toUpperCase());
    });
  };

  const handleExtractForDO = async () => {
    try {
      const quotations = await fetchQuotationsForExtract();
      if (!quotations) return;
      setQuotationsForExtract(quotations);
      setExtractQuotationDialogOpen(true);
    } catch (error) {
      console.error("Error fetching quotations:", error);
      toast.error("Failed to fetch quotations");
    }
  };

  const handleExtractForSO = async () => {
    try {
      const quotations = await fetchQuotationsForExtract();
      if (!quotations) return;
      setQuotationsForExtract(quotations);
      setExtractQuotationToSODialogOpen(true);
    } catch (error) {
      console.error("Error fetching quotations:", error);
      toast.error("Failed to fetch quotations");
    }
  };

  // Invoices always extract from a DO — the paper trail is quotation → DO →
  // invoice, so the invoice inherits the DO (and through it the project link).
  const handleExtractForInvoice = async () => {
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
      const doTypes = ["DELIVERY_ORDER", "DO"];
      const deliveryOrders = (response.data || []).filter((doc: any) => {
        const docType = doc.type || doc.documentType || "";
        return doTypes.includes(docType.toUpperCase());
      });
      setDeliveryOrdersForExtract(deliveryOrders);
      setExtractDODialogOpen(true);
    } catch (error) {
      console.error("Error fetching documents:", error);
      toast.error("Failed to fetch documents");
    }
  };

  const handleShareDeliveryLink = async () => {
    const token = await getToken();
    if (!token) { toast.error("Authentication required"); return; }
    const id = existingData?.id || documentId;
    // 1) Generate the link. A failure HERE is the real backend error.
    let full = "";
    try {
      const res = await request({ path: `/documents/${id}/delivery-share-link`, method: "POST" }, {}, token);
      const body = res?.data ?? res;
      // Build an ABSOLUTE guest URL so the copied link is complete for
      // external recipients. The backend's body.url is only absolute
      // when PORTAL_URL is set (else it's a bare "/guest/..." path), and
      // window.location.origin is unreliable here — the office app can
      // run in a Capacitor WebView / preview host that isn't the public
      // site. So base off NEXT_PUBLIC_APP_URL, defaulting to the prod
      // host; the token/path come from the response.
      const base = (process.env.NEXT_PUBLIC_APP_URL || "https://www.ai-ms.io").replace(/\/$/, "");
      const path = body?.path || (body?.token ? `/guest/delivery/${body.token}` : "");
      full = path ? `${base}${path}` : (body?.url ?? "");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || "Failed to create delivery link");
      return;
    }
    if (!full) { toast.error("Delivery link created but no URL was returned"); return; }
    // 2) Link exists → always surface it in a copyable dialog so it's
    //    usable regardless of the clipboard outcome.
    setShareLinkUrl(full);
    // 3) Best-effort auto-copy in its OWN try/catch. A rejected
    //    clipboard write (user-activation lapses across the awaited
    //    request, or an unfocused tab) must NOT read as a creation
    //    failure — the dialog still shows the URL for manual copy.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(full);
        toast.success("Delivery link copied to clipboard");
      }
    } catch {
      toast.info("Delivery link ready — copy it from the dialog");
    }
  };

  const handleBulkCompleteDO = async () => {
    if (!window.confirm("Mark ALL items on this delivery order as completed? This deducts stock for any not-yet-delivered items and triggers the invoice.")) return;
    try {
      const token = await getToken();
      if (!token) { toast.error("Authentication required"); return; }
      const id = existingData?.id || documentId;
      await request({ path: `/documents/${id}/bulk-complete-do`, method: "POST" }, {}, token);
      toast.success("Delivery order completed");
    } catch {
      toast.error("Failed to complete delivery order");
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

  // Handle back button click. With autosave there's no save/discard prompt:
  // if a save is pending or in flight we show a "Saving, please wait…" dialog,
  // flush the save, then auto-navigate. Otherwise we leave immediately.
  const handleBackClick = async () => {
    const backRoute = resolveBackRoute(documentType);
    const documentStatus = existingData?.status || "draft";
    // Any non-draft (locked) document: nothing to save/clean up — just leave.
    if (documentStatus !== "draft") {
      router.push(backRoute);
      return;
    }

    // Auto-delete a brand-new, UNTOUCHED, EMPTY draft on exit instead of leaving
    // an orphaned blank document behind. Strictly guarded: only a real persisted
    // draft the user never edited (isDirtyRef false), with no line items and no
    // customer selected — never a template, a read-only view, or anything with
    // content. Best-effort; navigation is never blocked.
    const exitDocId = existingData?.id || documentId;
    const isUntouchedEmptyDraft =
      !!exitDocId &&
      !isTemplateEditMode &&
      !initialPreviewMode &&
      !isDirtyRef.current &&
      !isAutosavingRef.current &&
      saveStatus !== "saving" &&
      (items?.length ?? 0) === 0 &&
      !formData?.customer?.id;
    if (isUntouchedEmptyDraft) {
      try {
        const token = await getToken();
        if (token) {
          await request({ path: `/documents/delete/${exitDocId}`, method: "DELETE" }, {}, token);
        }
      } catch {
        // ignore — leaving an empty draft is acceptable if delete fails
      }
      router.push(backRoute);
      return;
    }

    const pending = isDirtyRef.current || isAutosavingRef.current || saveStatus === "saving";
    if (!pending) {
      router.push(backRoute);
      return;
    }
    setSavingExitDialogOpen(true);
    try {
      // Let any in-flight autosave settle first (avoids a double-save / version race).
      let waited = 0;
      while (isAutosavingRef.current && waited < 15000) {
        await new Promise((r) => setTimeout(r, 150));
        waited += 150;
      }
      if (isDirtyRef.current) {
        setSaveStatus("saving");
        const name = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || "SYS";
        const ts = new Date().toISOString();
        if (isTemplateEditMode) {
          await guardedSave({ ...formData, config: templateMethods.getValues() });
        } else {
          await guardedSave({
            ...formData,
            items,
            name: formData.name || (formData?.documentInfo as any)?.documentNumber,
            savedBy: name,
            savedAt: ts,
            lastUsedBy: name,
            lastUsedAt: ts,
          });
          await persistProjectLinkIfChanged();
        }
        isDirtyRef.current = false;
        setSaveStatus("saved");
      }
    } finally {
      setSavingExitDialogOpen(false);
      router.push(backRoute);
    }
  };

  // Handle save as draft from dialog
  // OSI-8: persist the editor state BEFORE the send dialog opens. The backend
  // validates the customer and builds the PDF from the PERSISTED config, so an
  // unsaved customer pick (or any unsaved edit) would 400 or email stale data.
  const [sendEmailDocId, setSendEmailDocId] = useState<string>("");
  // Push this invoice to Xero (DRAFT, mapped accounts + tax settings). The
  // backend stamps xeroInvoiceId into config, so re-sync updates in place.
  const handleSyncToXero = async () => {
    const docId = existingData?.id || documentId;
    if (!docId) {
      toast.error("Save the document before syncing to Xero");
      return;
    }
    setIsSyncingXero(true);
    try {
      const token = await getToken();
      const res = await request({ path: `/documents/${docId}/sync-to-xero`, method: "POST" }, {}, token);
      if (res?.success) {
        toast.success(
          `${res.action === "updated" ? "Updated in Xero" : "Created in Xero"}: ${res.xeroInvoiceNumber || "(auto number)"} — ${res.xeroStatus || "DRAFT"}`,
        );
      } else {
        throw new Error(res?.message || "Xero sync failed");
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to sync to Xero");
    } finally {
      setIsSyncingXero(false);
    }
  };

  const handleOpenSendEmail = async () => {
    if (lockReadOnly) {
      toast.error("Cannot send — someone else is editing this document.");
      return;
    }
    try {
      const currentUserName = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || "SYS";
      const currentTimestamp = new Date().toISOString();
      const saved = await guardedSave({
        ...formData,
        items,
        name: formData.name || (formData?.documentInfo as any)?.documentNumber,
        savedBy: currentUserName,
        savedAt: currentTimestamp,
        lastUsedBy: currentUserName,
        lastUsedAt: currentTimestamp,
      });
      // Page-level onSave handlers currently return void on success; if one
      // ever returns the saved document, prefer its id — that covers a
      // never-persisted draft receiving its id at save time.
      const savedId = (saved as any)?.id || (saved as any)?.data?.id || "";
      const idForSend = savedId || documentId || existingData?.id || "";
      if (!idForSend) {
        toast.error("Save the document first — it doesn't have an ID yet.");
        return;
      }
      setSendEmailDocId(idForSend);
      setSendEmailDialogOpen(true);
    } catch (e) {
      console.error("Pre-send save failed:", e);
      toast.error("Could not save the document — email not opened. Fix the save error and try again.");
    }
  };

  const handleSaveAsDraft = async () => {
    // Get current user info for tracking
    const currentUserName = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || 'SYS';
    const currentTimestamp = new Date().toISOString();

    if (isTemplateEditMode) {
      const templateConfig = templateMethods.getValues();
      await guardedSave({ ...formData, config: templateConfig });
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
      await guardedSave(saveData);
      // Commit the quotation project link after the document itself has
      // persisted. Safe no-op for non-quotation flows and for unchanged links.
      await persistProjectLinkIfChanged();
    }
    toast.success("Document saved as draft");
    // Navigate to parent page after saving
    router.push(resolveBackRoute(documentType));
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
      router.push(resolveBackRoute(documentType));
    } catch (error) {
      console.error("Error deleting document:", error);
      toast.error("Failed to delete document");
      // Still navigate to parent page even if deletion fails
      router.push(resolveBackRoute(documentType));
    }
  };

  // Debounce: 2s after the last edit, autosave the draft. Re-runs on every
  // items/formData change (resetting the timer), so it only fires once editing
  // pauses. Gated on holding the lock + having real unsaved edits (isDirtyRef).
  useEffect(() => {
    if (!autosaveActive) return;
    if (!isDirtyRef.current) return;
    const t = setTimeout(async () => {
      if (isAutosavingRef.current || !isDirtyRef.current) return;
      isAutosavingRef.current = true;
      setSaveStatus("saving");
      try {
        const name = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress || "SYS";
        const ts = new Date().toISOString();
        await guardedSave({
          ...formData,
          items,
          name: formData.name || (formData?.documentInfo as any)?.documentNumber,
          savedBy: name,
          savedAt: ts,
          lastUsedBy: name,
          lastUsedAt: ts,
        });
        await persistProjectLinkIfChanged();
        isDirtyRef.current = false;
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      } finally {
        isAutosavingRef.current = false;
      }
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, formData, autosaveActive]);

  // Hold the editor render until the template field config resolves, so the
  // loaded layout paints once instead of flashing the legacy fallback first.
  // isLoadingFieldConfig clears on EVERY path of the loader effect (prop
  // shortcut, no-token, and the try/catch's finally on both success and
  // error), so this can never hang on the spinner.
  if (isLoadingFieldConfig) {
    return (
      <Box sx={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    // flex:1 + minHeight:0 (NOT height:100%): the layout column also holds the
    // ViewingAsBanner/OrgSwitcher rows — height:100% ignored those siblings and
    // overflowed the viewport by their height, forcing a page scrollbar.
    <Box sx={{ width: "100%", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Concurrent-edit banner: read-only when someone else holds the lock. */}
      {lockEnabled && lockReadOnly && (
        <Box
          sx={{
            px: 2,
            py: 1,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            // Explicit high-contrast colors so the banner is clearly legible in
            // BOTH light and dark mode (the theme warning/error tokens render as
            // pale fills with dark text that wash out on the dark surface).
            bgcolor: lock.lostLock ? "#C62828" : "#F9A825",
            color: lock.lostLock ? "#FFFFFF" : "#1A1100",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>
            {lock.lostLock
              ? `${lock.holderName || "Someone"} took over editing this document. Reload to see the latest version before making changes.`
              : lock.canTakeOver
              ? `${lock.holderName || "Someone"} has this document open but hasn't edited it in a while — you can take over editing.`
              : `${lock.holderName || "Someone"} is currently editing this document. Please wait until they're done before you can take over.`}
          </Typography>
          {lock.lostLock ? (
            <Button size="small" variant="contained" color="inherit" onClick={() => window.location.reload()}>
              Reload
            </Button>
          ) : lock.canTakeOver ? (
            <Button size="small" variant="contained" color="inherit" onClick={() => lock.takeOver()}>
              Take over
            </Button>
          ) : null}
        </Box>
      )}
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
              : formData.documentInfo?.documentNumber || formData.name || `${getDocumentTitle()} - New`}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", flexShrink: 0, flexWrap: "nowrap" }}>
          {/* Prev/Next document navigation — compact icon arrows */}
          {(onPrevious || onNext) && (
            <>
              <Tooltip title="Previous document">
                <span>
                  <IconButton size="small" onClick={onPrevious} disabled={!hasPrevious}>
                    <NavigateBeforeIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Next document">
                <span>
                  <IconButton size="small" onClick={onNext} disabled={!hasNext}>
                    <NavigateNextIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
          {!isTemplateEditMode && (
            <Button
              size="small"
              variant={assistantOpen ? "contained" : "outlined"}
              startIcon={<AutoAwesomeIcon />}
              onClick={() => setAssistantOpen((o) => !o)}
              color="secondary"
            >
              Ask AI
            </Button>
          )}
          {!isDocumentConfirmed && (
            <Button
              size="small"
              variant={previewMode ? "contained" : "text"}
              startIcon={previewMode ? <EditIcon /> : <PreviewIcon />}
              onClick={() => setPreviewMode(!previewMode)}
              sx={previewMode ? TOOLBAR_BLUE : PREVIEW_LINK_SX}
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
              variant="contained"
              startIcon={<CheckCircleIcon />}
              onClick={() => setConfirmPODialogOpen(true)}
              sx={TOOLBAR_GREEN}
            >
              Confirm Purchase Order
            </Button>
          )}
          {/* Confirm button for Purchase Returns */}
          {!isDocumentConfirmed && !isTemplateEditMode && isPurchaseReturn && (
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckCircleIcon />}
              onClick={() => setConfirmPRDialogOpen(true)}
              sx={TOOLBAR_GREEN}
            >
              Confirm Document
            </Button>
          )}
          {/* Confirm button for Stock Adjustments */}
          {!isDocumentConfirmed && !isTemplateEditMode && isStockAdjustment && (
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckCircleIcon />}
              onClick={() => setConfirmAdjustmentDialogOpen(true)}
              sx={TOOLBAR_GREEN}
            >
              {isStockAdjustmentIn ? "Confirm Stock Adjustment In" : "Confirm Stock Adjustment Out"}
            </Button>
          )}
          {/* Confirm button for Delivery Orders */}
          {!isDocumentConfirmed && !isTemplateEditMode && isDeliveryOrder && (
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckCircleIcon />}
              onClick={() => {
                // Project link is MANDATORY on delivery orders before confirm
                // (only enforced where the picker feature is enabled).
                if (isQuotationProjectLinkEnabled && !(formData.projectId || existingData?.projectId)) {
                  toast.error("Select a project before confirming this Delivery Order");
                  return;
                }
                setConfirmDODialogOpen(true);
              }}
              sx={TOOLBAR_GREEN}
            >
              Confirm Delivery Order
            </Button>
          )}
          {/* Confirm split-button for Invoices: primary confirms as always;
              the dropdown adds "Confirm & make recurring", which confirms then
              opens the recurring setup prefilled from this invoice. */}
          {!isDocumentConfirmed && !isTemplateEditMode && isInvoiceType && (
            <>
              <ButtonGroup size="small" variant="contained">
                <Button
                  startIcon={<CheckCircleIcon />}
                  onClick={() => {
                    makeRecurringAfterConfirmRef.current = false;
                    setConfirmInvoiceDialogOpen(true);
                  }}
                  sx={TOOLBAR_GREEN}
                >
                  Confirm Invoice
                </Button>
                <Button
                  aria-label="More confirm options"
                  onClick={(e) => setConfirmMenuAnchor(e.currentTarget)}
                  sx={{ ...TOOLBAR_GREEN, px: 0.5, minWidth: 32 }}
                >
                  <KeyboardArrowDownIcon fontSize="small" />
                </Button>
              </ButtonGroup>
              <Menu
                anchorEl={confirmMenuAnchor}
                open={Boolean(confirmMenuAnchor)}
                onClose={() => setConfirmMenuAnchor(null)}
              >
                <MenuItem
                  onClick={() => {
                    setConfirmMenuAnchor(null);
                    makeRecurringAfterConfirmRef.current = true;
                    setConfirmInvoiceDialogOpen(true);
                  }}
                >
                  <ListItemIcon><AutorenewIcon fontSize="small" /></ListItemIcon>
                  <ListItemText
                    primary="Confirm & make recurring"
                    secondary="Confirm this invoice, then set up its schedule"
                  />
                </MenuItem>
              </Menu>
            </>
          )}
          {/* Confirm button for Quotations — only when enableConfirmQuotation is on.
              After confirm saves, a popup asks if the user wants to convert the
              quotation into a PO / DO / Invoice. */}
          {!isDocumentConfirmed && !isTemplateEditMode && isConfirmQuotationEnabled &&
           (documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO" || documentType === "QO2") && (
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckCircleIcon />}
              onClick={handleConfirmQuotation}
              disabled={isConfirming}
              sx={TOOLBAR_GREEN}
            >
              {isConfirming ? "Confirming..." : "Confirm Quotation"}
            </Button>
          )}
          {/* Confirm button for non-Purchase Order/Return, non-Quotation, non-Stock Adjustment, non-DO, and non-Invoice documents */}
          {!isDocumentConfirmed && !isTemplateEditMode && !isPurchaseDocument && !isStockAdjustment && !isDeliveryOrder && !isInvoiceType &&
           !(documentType === "QO1" || documentType === "QUOTATION" || documentType === "QT" || documentType === "QO") && (
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckCircleIcon />}
              onClick={() => setConfirmDialogOpen(true)}
              sx={TOOLBAR_GREEN}
            >
              Confirm Document
            </Button>
          )}
          {/* Send Email button for invoices (draft or confirmed, not
              pending_payment) and quotations (any status — no confirm step). */}
          {documentStatus !== "pending_payment" &&
           (documentType === "TI" || documentType === "TI2" || documentType === "INVOICE" || isQuotation) && (
            <Button
              size="small"
              variant="contained"
              startIcon={<EmailIcon />}
              onClick={handleOpenSendEmail}
              sx={TOOLBAR_BLUE}
            >
              Send Email
            </Button>
          )}
          {/* Sync to Xero — accounting-context only (opened from /portal/accounting),
              feature-flagged per org, invoices only. Creates/updates a Xero DRAFT
              with mapped account codes + tax-inclusive/exclusive settings. */}
          {openedFromAccounting && isXeroDocSyncEnabled && !isTemplateEditMode &&
           (documentType === "TI" || documentType === "TI2" || documentType === "INVOICE") && (
            <Button
              size="small"
              variant="contained"
              startIcon={<CloudSyncIcon />}
              onClick={handleSyncToXero}
              disabled={isSyncingXero}
              sx={TOOLBAR_BLUE}
            >
              {isSyncingXero ? "Syncing..." : "Sync to Xero"}
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
              sx={TOOLBAR_GREEN}
            >
              Mark as Paid
            </Button>
          )}
          {/* Autosave status indicator — replaces the manual Save button while
              we hold the lock on a persisted draft (Confirm stays explicit). */}
          {!isDocumentConfirmed && autosaveActive && (
            <Typography
              variant="body2"
              sx={{ display: "flex", alignItems: "center", gap: 0.5, color: saveStatus === "error" ? "error.main" : "text.secondary", fontWeight: 500, px: 1 }}
            >
              {saveStatus === "saving" ? (
                <>
                  <CircularProgress size={14} thickness={5} />
                  Saving…
                </>
              ) : saveStatus === "error" ? (
                "Couldn't save"
              ) : (
                <>
                  <CheckCircleIcon fontSize="small" color="success" />
                  Saved
                </>
              )}
            </Typography>
          )}
          {!isDocumentConfirmed && !autosaveActive && (
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
                  await guardedSave({ ...formData, config: templateConfig });
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
                  await guardedSave(saveData);
                  // Persist any pending quotation→project link.
                  await persistProjectLinkIfChanged();
                  toast.success("Document saved as draft");
                }
              }}
            >
              {isTemplateEditMode ? "Save Template" : isQuotation ? "Save" : "Save as Draft"}
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
          {/* ⋮ overflow menu — secondary actions (Xero-style) */}
          <Tooltip title="More actions">
            <IconButton size="small" onClick={(e) => setMoreMenuAnchor(e.currentTarget)}>
              <MoreVertIcon />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={moreMenuAnchor}
            open={Boolean(moreMenuAnchor)}
            onClose={closeMoreMenu}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{ paper: { sx: { minWidth: 230 } } }}
          >
            {/* Create / copy */}
            <MenuItem onClick={() => { closeMoreMenu(); handleAddNewDocument(); }}>
              <ListItemIcon><AddIcon fontSize="small" /></ListItemIcon>
              <ListItemText>New {getDocumentTitle()}</ListItemText>
            </MenuItem>
            {(existingData?.id || documentId) && (
              <MenuItem onClick={() => { closeMoreMenu(); handleDuplicateDocument(); }}>
                <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Duplicate</ListItemText>
              </MenuItem>
            )}
            {isDocumentConfirmed && (
              <MenuItem onClick={() => { closeMoreMenu(); handleCreateRevision(); }}>
                <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Create Revision</ListItemText>
              </MenuItem>
            )}
            {(documentType === "DO" || documentType === "DELIVERY_ORDER") && (
              <MenuItem onClick={() => { closeMoreMenu(); handleExtractForDO(); }}>
                <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Extract from Quotation</ListItemText>
              </MenuItem>
            )}
            {(documentType === "SO" || documentType === "SALES_ORDER" || documentType?.toUpperCase() === "SALES_ORDER") && (
              <MenuItem onClick={() => { closeMoreMenu(); handleExtractForSO(); }}>
                <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Extract from Quotation</ListItemText>
              </MenuItem>
            )}
            {(documentType === "TI" || documentType === "TI2" || documentType === "INVOICE" || documentType?.toUpperCase() === "INVOICE") && (
              <MenuItem onClick={() => { closeMoreMenu(); handleExtractForInvoice(); }}>
                <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Extract from DO</ListItemText>
              </MenuItem>
            )}
            <Divider />
            {/* Tools */}
            <MenuItem onClick={() => { closeMoreMenu(); handlePrint(); }}>
              <ListItemIcon><PrintIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Print / PDF</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { closeMoreMenu(); setLocateDialogOpen(true); }}>
              <ListItemIcon><SearchIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Locate</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { closeMoreMenu(); setStockCardDialogOpen(true); }}>
              <ListItemIcon><InventoryIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Stock Card</ListItemText>
            </MenuItem>
            {(existingData?.id || documentId) && (
              <MenuItem onClick={() => { closeMoreMenu(); setHistoryDrawerOpen(true); }}>
                <ListItemIcon><HistoryIcon fontSize="small" /></ListItemIcon>
                <ListItemText>History &amp; notes</ListItemText>
              </MenuItem>
            )}
            {/* AI posting-preview ("Review") for Invoices — suggests a revenue
                account per line before confirming. */}
            {!isDocumentConfirmed && !isTemplateEditMode && isInvoiceType && (
              <MenuItem disabled={invoicePreviewLoading} onClick={() => { closeMoreMenu(); openInvoiceReview(); }}>
                <ListItemIcon><AutoAwesomeIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Review Posting</ListItemText>
              </MenuItem>
            )}
            {(existingData?.config?.sourceFileUrl || (existingData as any)?.sourceFileUrl) && (
              <MenuItem
                onClick={() => {
                  closeMoreMenu();
                  window.open(
                    existingData?.config?.sourceFileUrl || (existingData as any)?.sourceFileUrl,
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
              >
                <ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>
                <ListItemText>View Original</ListItemText>
              </MenuItem>
            )}
            {/* Delivery-order extras */}
            {isDeliveryOrder && <Divider />}
            {isDeliveryOrder && (
              <MenuItem
                disabled={!doStartReportId}
                onClick={() => { closeMoreMenu(); doStartReportId && setRouteDialogReportId(doStartReportId); }}
              >
                <ListItemIcon><RouteIcon fontSize="small" /></ListItemIcon>
                <ListItemText>{doStartReportId ? "Show Route" : "Show Route (no delivery yet)"}</ListItemText>
              </MenuItem>
            )}
            {(documentType === "DO" || documentType === "DELIVERY_ORDER") && (existingData?.id || documentId) && (
              <MenuItem onClick={() => { closeMoreMenu(); handleShareDeliveryLink(); }}>
                <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Share delivery link</ListItemText>
              </MenuItem>
            )}
            {(documentType === "DO" || documentType === "DELIVERY_ORDER") && (existingData?.id || documentId) && (
              <MenuItem onClick={() => { closeMoreMenu(); handleBulkCompleteDO(); }}>
                <ListItemIcon><CheckCircleIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Bulk complete</ListItemText>
              </MenuItem>
            )}
          </Menu>
        </Box>
      </Box>

      {/* Main Content with Sidebar — minHeight:0 so this flex child can shrink
          below its content height; without it the viewport lock clips. */}
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
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
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>
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
                justifyContent: "flex-end",
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
                  {(() => {
                    const savedBy = liveTracking.savedBy ?? existingData?.savedBy;
                    const savedAt = liveTracking.savedAt ?? existingData?.savedAt;
                    return savedBy && existingData?.status !== 'confirmed'
                      ? `${savedBy} ${savedAt ? new Date(savedAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}`
                      : '-';
                  })()}
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
                  {(() => {
                    const lastUsedBy = liveTracking.lastUsedBy ?? existingData?.lastUsedBy;
                    const lastUsedAt = liveTracking.lastUsedAt ?? existingData?.lastUsedAt;
                    return lastUsedBy
                      ? `${lastUsedBy} ${lastUsedAt ? new Date(lastUsedAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}`
                      : existingData?.updatedAt
                      ? new Date(existingData.updatedAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
                      : '-';
                  })()}
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
              <Card sx={{ flexShrink: 0, maxHeight: 320, display: "flex", flexDirection: "column" }}>
                <CardContent sx={{ p: 1, flex: 1, overflow: "auto", "&:last-child": { pb: 1 } }}>
                  <Collapse in={!isFieldsCollapsed} timeout="auto" unmountOnExit>
                  {/* Quotations: drop the RE (documentInfo.subject) row — replaced
                      by the Contact row per guru (2026-07-08). documentInfo.contact
                      now flows through so DynamicFormFields pairs Contact + Terms
                      and hosts the Contact Person / No. / Email trio on that row,
                      same as invoices. */}
                  <DynamicFormFields
                    fields={(() => {
                      let fields = tab.fields;
                      if (isQuotation) {
                        fields = fields.filter((f: any) => f.fieldName !== "documentInfo.subject");
                        // Salesperson mobile (default seeded "9818 9200", saved via
                        // formData.salesMobile) — a normal header row under Salesman
                        // code (ordering via HEADER_FIELD_ORDER). Biofuel quotes only,
                        // General tab only (this render runs per tab — without the
                        // guard the row duplicates into Details etc.).
                        if (isBiofuel && tab.tabId === "general" && !fields.some((f: any) => f.fieldName === "salesMobile")) {
                          fields = [...fields, { fieldName: "salesMobile", displayLabel: "Salesman Mobile", fieldType: "text", required: false }];
                        }
                      }
                      // DO templates carry contactName/contactNumber but no contact
                      // field — inject one so the Contact row hosts the attention
                      // trio + Terms (the name/number fields are hidden below and
                      // kept in sync by the trio for the printout).
                      if (
                        (documentType === "DO" || documentType === "DELIVERY_ORDER") &&
                        tab.tabId === "general" &&
                        !fields.some((f: any) => f.fieldName === "documentInfo.contact")
                      ) {
                        fields = [...fields, { fieldName: "documentInfo.contact", displayLabel: "Contact", fieldType: "text", required: false }];
                      }
                      return fields;
                    })()}
                    formData={formData}
                    setFormData={setFormData}
                    hideDiscount={isRouteOrderPO}
                    hiddenFields={
                      // Legacy invoice arrangement drops Bill to / Deliver to
                      // (auto-filled from the customer master, printed as-is)
                      // and Currency (defaults to SGD; code still shows in the
                      // totals panel next to Rate). Quotations drop Currency too.
                      documentType === "TI" || documentType === "TI2" || documentType === "INVOICE"
                        ? ["billTo", "deliveryTo", "documentInfo.currency"]
                        : isQuotation
                        ? ["documentInfo.currency"]
                        : documentType === "DO" || documentType === "DELIVERY_ORDER"
                        ? // Contact Name/Number replaced by the Contact-row trio
                          // (kept in sync for the printout); currency hidden like
                          // invoices/quotations; salesman and payment terms not
                          // used on DOs.
                          ["documentInfo.currency", "documentInfo.contactName", "documentInfo.contactNumber", "documentInfo.salesPerson", "documentInfo.paymentTerms"]
                        : []
                    }
                    customInputs={
                      // Biofuel DO: Reference No = quotation picker (Customer-code
                      // pattern — search icon opens the dialog). Editor shows just
                      // the quotation number; the confirm date is stored alongside
                      // and only printed ("Our Ref. No : QO… dated dd/mm/yyyy").
                      isBiofuel && isDeliveryOrder
                        ? {
                            "documentInfo.referenceNo": (
                              <TextField
                                size="small"
                                value={(formData.documentInfo as any)?.referenceNo || ""}
                                onChange={(e) =>
                                  setFormData((prev: any) => ({
                                    ...prev,
                                    documentInfo: {
                                      ...prev.documentInfo,
                                      referenceNo: e.target.value,
                                      // Typed-over refs are no longer a picked quotation.
                                      referenceQuotationDate: null,
                                    },
                                  }))
                                }
                                sx={{ ...headerInputSx, flex: 1, maxWidth: 420 }}
                                InputProps={{
                                  startAdornment: (
                                    <InputAdornment position="start" sx={{ mr: 0 }}>
                                      <IconButton
                                        size="small"
                                        onClick={() => setRefQuotationDialogOpen(true)}
                                        sx={{ p: 0.25, ml: -0.5 }}
                                        title="Select quotation"
                                      >
                                        <SearchIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    </InputAdornment>
                                  ),
                                }}
                              />
                            ),
                          }
                        : undefined
                    }
                    appendRow={
                      // Project picker as the LAST header row, styled like the
                      // rest. Quotations (optional) + delivery orders (required
                      // before confirm — enforced on the Confirm button). Gated
                      // behind enableQuotationProjectLink; only rendered after a
                      // customer is picked (a disabled picker here used to block
                      // Customer Code clicks via an MUI Autocomplete-portal
                      // interaction).
                      (isQuotation || isDeliveryOrder) && isQuotationProjectLinkEnabled && formData.customer?.id && tab.tabId === "general"
                        ? {
                            label: isDeliveryOrder ? "Project *" : "Project",
                            content: (
                              <>
                                <Autocomplete
                                  size="small"
                                  sx={{ flex: 1, maxWidth: 420 }}
                                  options={effectiveProjects.filter((p: any) => !p.customerId || p.customerId === formData.customer.id)}
                                  getOptionLabel={(option: any) => option?.projectNumber ? `${option.projectNumber} — ${option.name}` : (option?.name ?? "")}
                                  value={effectiveProjects.find((p: any) => p.id === formData.projectId) || null}
                                  onChange={(_, newValue: any) => handleProjectLinkChange(newValue?.id || "")}
                                  noOptionsText="No projects for this customer"
                                  renderInput={(params) => (
                                    <TextField
                                      {...params}
                                      size="small"
                                      placeholder="Select a project"
                                      sx={{
                                        ...headerInputSx,
                                        // Autocomplete wraps the input in its own padded
                                        // root — flatten it to match the 28px boxed fields.
                                        "& .MuiAutocomplete-inputRoot": { paddingTop: 0, paddingBottom: 0, paddingLeft: "2px" },
                                      }}
                                    />
                                  )}
                                />
                                <Button
                                  size="small"
                                  variant="text"
                                  startIcon={<AddIcon />}
                                  onClick={() => {
                                    setCreateProjectName("");
                                    setCreateProjectDialogOpen(true);
                                  }}
                                  sx={{ textTransform: "none" }}
                                >
                                  Create new project
                                </Button>
                              </>
                            ),
                          }
                        : undefined
                    }
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
          <Box sx={{ mt: 0.5, mx: 0.5, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Card sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <CardContent sx={{ p: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
                {/* Items Sub-tabs */}
                <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
                  <Tabs value={itemsTabValue} onChange={handleItemsTabChange} sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, py: 0 } }}>
                    <Tab label="Details" />
                    <Tab label="Footer" />
                  </Tabs>
                </Box>

                {/* ITEMS DETAILS TAB — flexes to the remaining viewport height
                    (no hard-coded calc offset), so any screen-size change is
                    absorbed by the table's internal scroll, not the page. */}
                <TabPanel value={itemsTabValue} index={0} grow>
                  <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 120 }}>
                    {/* Scrollable table area — TableContainer itself scrolls so
                        stickyHeader on the Table actually pins the column
                        headers to the top of the scroll box on scroll. */}
                    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                      <TableContainer
                        sx={{
                          flex: 1,
                          overflow: "auto",
                          // Xero-style bordered grid container
                          border: `1px solid ${TABLE_GRID_COLOR}`,
                          borderRadius: 1,
                        }}
                      >
                        <Table
                          sx={{
                            tableLayout: 'fixed',
                            // Tighten body-cell padding so rows sit at ~36px like
                            // Xero. The TableHead sx below still owns its own
                            // typography rules; this rule only sets padding.
                            "& .MuiTableBody-root .MuiTableCell-root": {
                              paddingTop: "4px",
                              paddingBottom: "4px",
                              paddingLeft: "8px",
                              paddingRight: "8px",
                              verticalAlign: "middle",
                            },
                            // Xero-style cell grid: every cell shows its right +
                            // bottom border; the container border closes the
                            // outer edges (so last-column/last-row borders are
                            // dropped to avoid doubled lines).
                            "& .MuiTableCell-root": {
                              borderRight: `1px solid ${TABLE_GRID_COLOR}`,
                              borderBottom: `1px solid ${TABLE_GRID_COLOR}`,
                            },
                            "& .MuiTableCell-root:last-child": {
                              borderRight: "none",
                            },
                          }}
                          stickyHeader
                        >
                        <TableHead
                          sx={{
                            "& .MuiTableCell-root": {
                              fontFamily: "'Helvetica Neue', Arial, sans-serif",
                              fontSize: "13px",
                              fontWeight: 700,
                              letterSpacing: 0,
                              textTransform: "none",
                              color: "text.primary",
                              // Solid bg so scrolled rows don't bleed through
                              // when stickyHeader pins the row to the top.
                              backgroundColor: "surfaceTones.low",
                            },
                          }}
                        >
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
                              const defaultColumns = ((configuredColumns && configuredColumns.length > 0)
                                ? configuredColumns
                                : baseDefaultColumns)
                                .filter((c: string) => !(isRouteOrderPO && c === "discount"))
                                // S/No removed from quotations — auto-numbered in the DB/renderer.
                                .filter((c: string) => !(isQuotation && c === "no"));
                              // Quotations always get the item/Product Code column in the
                              // editor (like invoices) even when the template's configured
                              // tableColumnOrder omits it — the preview filters it out.
                              // FCU/CU variant excluded: its rows are CU/FCU-driven.
                              if (isQuotation && !isFcuCuVariant && !defaultColumns.includes("item")) {
                                defaultColumns.unshift("item");
                              }
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
                                columnId === "accessoryQty" ? "Accessory Qty" :
                                columnId === "masterQty" ? "Set Qty" :
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
                                    width: columnId === "description" ? "38%" :
                                           columnId === "item" ? "10%" :
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
                                const defaultColumns = ((configuredColumns && configuredColumns.length > 0)
                                  ? configuredColumns
                                  : baseDefaultColumns)
                                  .filter((c: string) => !(isRouteOrderPO && c === "discount"))
                                  // S/No removed from quotations — auto-numbered in the DB/renderer.
                                  .filter((c: string) => !(isQuotation && c === "no"));
                                // Keep in sync with the header block above: quotations always
                                // get the item column in the editor; preview hides it.
                                if (isQuotation && !isFcuCuVariant && !defaultColumns.includes("item")) {
                                  defaultColumns.unshift("item");
                                }
                                return (isTemplateEditMode ? templateWatch("tableColumnOrder") : defaultColumns).map((columnId: string) => {
                                  // Skip tax column for invoices
                                  if (isInvoiceType && columnId === "tax") return null;
                                  const isVisible = isTemplateEditMode ? templateWatch(`tableHeaders.${columnId}`) : true;
                                  if (!isVisible) return null;

                                if (columnId === "item") {
                                  // Read-only Product Code + an edit pencil. The inline
                                  // SKU dropdown / free-text field is gone — the pencil
                                  // reopens the Stock Card (stock lines) or the Service
                                  // picker (service lines) to change/re-pick this row.
                                  const isSvcRow = item.isService;
                                  const rowCode = isSvcRow
                                    ? (item.itemCode || "")
                                    : (item.inventoryItemId
                                        ? (inventoriesForDocument.find((i: any) => i.id === item.inventoryItemId)?.sku || item.itemCode || "")
                                        : (item.itemCode || ""));
                                  return (
                                    <TableCell key={columnId}>
                                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 120 }}>
                                        <Typography variant="body2" sx={{ flex: 1, wordBreak: "break-word", color: rowCode ? "text.primary" : "text.disabled" }}>
                                          {rowCode || "—"}
                                        </Typography>
                                        <Tooltip title={isSvcRow ? "Change service" : "Change item / stock"}>
                                          <IconButton
                                            size="small"
                                            onClick={() => {
                                              setEditingItemId(item.id);
                                              if (isSvcRow) {
                                                setRevenueItemPickerOpen(true);
                                              } else {
                                                setStockCardMode("add");
                                                setStockCardDialogOpen(true);
                                              }
                                            }}
                                          >
                                            <EditIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                      </Box>
                                      {item.revenueTag && (
                                        <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 0.25 }}>({item.revenueTag})</Typography>
                                      )}
                                    </TableCell>
                                  );
                                } else if (columnId === "description") {
                                  return (
                                    <TableCell key={columnId}>
                                      <RichTextDescription
                                        value={item.description || ""}
                                        onChange={(html) => updateItem(item.id, "description", html)}
                                        placeholder="Enter description"
                                        pastDescriptions={pastDescriptions}
                                        loadingDescriptions={isLoadingDescriptions}
                                        compact
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
                                        onChange={(e) => updateItem(item.id, "quantity", Math.max(0, parseFloat(e.target.value) || 0))}
                                        size="small"
                                        sx={{ width: 80 }}
                                        inputProps={{ min: 0 }}
                                      />
                                    </TableCell>
                                  );
                                } else if (columnId === "accessoryQty") {
                                  // Per-accessory qty, stacked to line up with the accessory chips.
                                  const selectedAcc = (item.accessories || []) as any[];
                                  return (
                                    <TableCell key={columnId} align="center">
                                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                                        {selectedAcc.map((a: any, idx: number) => (
                                          <Box key={idx} sx={{ height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            <TextField
                                              type="number"
                                              size="small"
                                              value={a.qty ?? 1}
                                              onChange={(e) => setAccessoryQtyAt(item.id, idx, parseFloat(e.target.value) || 0)}
                                              sx={{ width: 80 }}
                                              inputProps={{ min: 0 }}
                                            />
                                          </Box>
                                        ))}
                                      </Box>
                                    </TableCell>
                                  );
                                } else if (columnId === "masterQty") {
                                  // Master/Set qty — multiplies CU + all FCUs + all accessories.
                                  return (
                                    <TableCell key={columnId} align="center">
                                      <TextField
                                        type="number"
                                        size="small"
                                        value={item.masterQty ?? 1}
                                        onChange={(e) => setMasterQty(item.id, parseFloat(e.target.value) || 0)}
                                        sx={{ width: 80 }}
                                        inputProps={{ min: 0 }}
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
                                        onChange={(e) => updateItem(item.id, "receivedQty", Math.max(0, parseFloat(e.target.value) || 0))}
                                        size="small"
                                        sx={{ width: 80 }}
                                        inputProps={{ min: 0 }}
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
                                          <Box key={idx} sx={{ height: 40, display: "flex", alignItems: "center" }}>
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
                                      onChange={(e) => updateItem(item.id, "receivedQty", Math.max(0, parseFloat(e.target.value) || 0))}
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
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      </TableContainer>
                    </Box>

                    {/* Sticky action row at the bottom — Add Item / Add Service
                        sit outside the scroll container so they're always
                        visible without scrolling to the end of the items list. */}
                    <Box sx={{ pt: 1, pb: 0.5, pl: 1, display: "flex", gap: 1, flexShrink: 0 }}>
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
                          onClick={() => setRevenueItemPickerOpen(true)}
                          size="small"
                        >
                          Add Service
                        </Button>
                      )}
                    </Box>

                    {/* Fixed bottom section with Totals — hidden, totals already
                        surfaced in the General fields' right column. Kept as a
                        no-op so the JSX/expression scopes below are preserved. */}
                    {false && (
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

                                // FCU-CU (QF): Route Order base = Σ Dealer − Σ Points;
                                // Project base = Σ list (unit price). Discounted Price =
                                // base − doc discount; Nett = Discounted + GST.
                                // Org-wide round-down step applied at different
                                // stages per type: Project absorbs into Discount,
                                // Route Order absorbs from Nett (shown as
                                // 'Round-down' line below GST).
                                if (isFcuCuVariant) {
                                  const gross = items.reduce((a: number, it: any) => a + (Number(it.listPrice) || 0), 0);
                                  const dealerTotal = isProjectQuote ? 0 : items.reduce((a: number, it: any) => a + (Number(it.discountPrice) || 0), 0);
                                  const pointsTotal = isProjectQuote ? 0 : items.reduce((a: number, it: any) => a + (Number(it.pointsTotal) || 0), 0);
                                  const afterPoints = isProjectQuote ? gross : Math.max(0, dealerTotal - pointsTotal);
                                  const userDiscAmt = discType === "amount" ? Math.min(discPct, afterPoints) : afterPoints * (discPct / 100);
                                  // Project: round Discounted Price down to 100,
                                  // editable within [floor, floor+99]. Route:
                                  // round Nett down to 5. (Hardcoded for QF.)
                                  const PROJECT_STEP = 100, ROUTE_STEP = 5;
                                  let displayDiscAmt = userDiscAmt;
                                  let discountedPrice = Math.max(0, afterPoints - userDiscAmt);
                                  let bandFloor = 0, bandCeil = 0;
                                  if (isProjectQuote) {
                                    bandFloor = Math.floor(discountedPrice / PROJECT_STEP) * PROJECT_STEP;
                                    bandCeil = bandFloor + (PROJECT_STEP - 1);
                                    const ovRaw = dInfo?.discountedPriceOverride;
                                    const hasOverride = ovRaw != null && String(ovRaw) !== "" && !isNaN(Number(ovRaw));
                                    discountedPrice = hasOverride ? Math.min(bandCeil, Math.max(bandFloor, Number(ovRaw))) : bandFloor;
                                    displayDiscAmt = Math.max(0, afterPoints - discountedPrice);
                                  }
                                  const gst = isAbsorbTax && gstPct > 0 ? discountedPrice * gstPct / (100 + gstPct) : discountedPrice * (gstPct / 100);
                                  const nettRaw = isAbsorbTax ? discountedPrice : discountedPrice + gst;
                                  const nett = !isProjectQuote ? Math.floor(nettRaw / ROUTE_STEP) * ROUTE_STEP : nettRaw;
                                  const roundCrumb = !isProjectQuote ? nettRaw - nett : 0;
                                  return (
                                    <>
                                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                        <Typography variant="body2">Gross Total:</Typography>
                                        <Typography variant="body2">{currency} {gross.toFixed(2)}</Typography>
                                      </Box>
                                      {isProjectQuote && displayDiscAmt > 0 && (
                                        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                          <Typography variant="body2">Discount:</Typography>
                                          <Typography variant="body2" color="error.main">-{currency} {displayDiscAmt.toFixed(2)}</Typography>
                                        </Box>
                                      )}
                                      {isProjectQuote ? (
                                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
                                          <Typography variant="body2" fontWeight="bold">Discounted Price:</Typography>
                                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                            <Typography variant="body2">{currency}</Typography>
                                            <TextField
                                              size="small"
                                              type="number"
                                              value={dInfo?.discountedPriceOverride ?? bandFloor}
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                setFormDataState((prev: any) => ({ ...prev, documentInfo: { ...prev.documentInfo, discountedPriceOverride: v === "" ? null : Number(v) } }));
                                              }}
                                              onBlur={(e) => {
                                                const n = Number(e.target.value);
                                                const clamped = isNaN(n) ? bandFloor : Math.min(bandCeil, Math.max(bandFloor, n));
                                                setFormDataState((prev: any) => ({ ...prev, documentInfo: { ...prev.documentInfo, discountedPriceOverride: clamped } }));
                                              }}
                                              inputProps={{ min: bandFloor, max: bandCeil, step: 1, style: { textAlign: "right", padding: "2px 6px", width: 84, fontWeight: 700 } }}
                                              helperText={`${bandFloor}–${bandCeil}`}
                                              FormHelperTextProps={{ sx: { m: 0, textAlign: "right", fontSize: "0.65rem" } }}
                                            />
                                          </Box>
                                        </Box>
                                      ) : (
                                        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                          <Typography variant="body2" fontWeight="bold">Discounted Price:</Typography>
                                          <Typography variant="body2" fontWeight="bold">{currency} {discountedPrice.toFixed(2)}</Typography>
                                        </Box>
                                      )}
                                      {isTaxApplicable && (
                                        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                          <Typography variant="body2">GST ({gstPct}%){isAbsorbTax ? " (absorbed)" : ""}:</Typography>
                                          <Typography variant="body2">{currency} {gst.toFixed(2)}</Typography>
                                        </Box>
                                      )}
                                      {roundCrumb > 0 && (
                                        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                                          <Typography variant="body2">Round-down:</Typography>
                                          <Typography variant="body2" color="error.main">-{currency} {roundCrumb.toFixed(2)}</Typography>
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

                                const discAmt = isProjectPO ? 0 : (discType === "amount" ? Math.min(discPct, subtotal) : subtotal * (discPct / 100));
                                const afterDisc = subtotal - discAmt;
                                // 1 point = $1 off the Nett: GST is computed
                                // on the sub-total (no points adjustment),
                                // then points are deducted from the Nett.
                                const gst = isAbsorbTax && gstPct > 0
                                  ? afterDisc * gstPct / (100 + gstPct)
                                  : afterDisc * (gstPct / 100);
                                // Skip round-down on Route Order POs — the
                                // user is fine-tuning points to the dollar
                                // and round-to-nearest-5 would mask their
                                // per-tick edits.
                                const nettRaw = (isAbsorbTax ? afterDisc : afterDisc + gst) - poPointsRedeemed;
                                const nett = isRouteOrderPO ? nettRaw : roundNettDown(nettRaw);
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
                                    {isRouteOrderPO && (
                                      <RouteOrderPointsEditor
                                        currency={currency}
                                        autoComputed={poTotalPoints}
                                        redeemed={poPointsRedeemed}
                                        onChangeRedeemed={(v) =>
                                          setFormDataState((prev: any) => ({
                                            ...prev,
                                            documentInfo: { ...prev.documentInfo, pointsRedeemed: v },
                                          }))
                                        }
                                        onResetRedeemed={() =>
                                          setFormDataState((prev: any) => {
                                            const di = { ...(prev.documentInfo || {}) };
                                            delete di.pointsRedeemed;
                                            return { ...prev, documentInfo: di };
                                          })
                                        }
                                      />
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
                    )}
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
                  // Forward the resolved order Type so the PO/PR preview can
                  // gate the "Less Points" deduction. orderType lives on
                  // existingData (and documentInfo) — formData alone drops it,
                  // which is why the footer showed Less Points but the preview
                  // didn't.
                  orderType: poOrderType || (formData as any)?.orderType,
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

      {/* Saving-on-exit dialog: shown while the draft flushes its last save,
          then auto-closes and navigates. No save/discard choice — autosave
          already persisted everything; this just waits for the tail save. */}
      <Dialog
        open={savingExitDialogOpen}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2, p: 1 } }}
      >
        <DialogContent>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1.5, py: 1 }}>
            <CircularProgress size={20} thickness={5} />
            <Typography variant="body1" sx={{ fontWeight: 500 }}>
              Saving… please wait
            </Typography>
          </Box>
        </DialogContent>
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
        onClose={() => {
          if (isConfirming) return;
          makeRecurringAfterConfirmRef.current = false;
          setConfirmInvoiceDialogOpen(false);
        }}
        onConfirm={handleConfirmInvoice}
        documentNumber={formData.name || formData.documentInfo?.documentNumber || ""}
      />

      {/* Guest delivery share link — shown after generation so the URL is always
          usable even if auto-copy failed. The Copy button here is a direct user
          gesture (no preceding await), so it copies reliably. */}
      <Dialog open={!!shareLinkUrl} onClose={() => setShareLinkUrl(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Guest delivery link</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Anyone with this link can view and update this delivery order — no login required.
          </Typography>
          <TextField
            value={shareLinkUrl ?? ""}
            fullWidth
            size="small"
            InputProps={{ readOnly: true }}
            onFocus={(e) => e.target.select()}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShareLinkUrl(null)}>Close</Button>
          <Button
            startIcon={<OpenInNewIcon />}
            onClick={() => { if (shareLinkUrl) window.open(shareLinkUrl, "_blank", "noopener"); }}
          >
            Open
          </Button>
          <Button
            variant="contained"
            startIcon={<ContentCopyIcon />}
            onClick={async () => {
              if (!shareLinkUrl) return;
              try {
                await navigator.clipboard.writeText(shareLinkUrl);
                toast.success("Copied");
              } catch {
                toast.info("Select the link above and copy manually");
              }
            }}
          >
            Copy
          </Button>
        </DialogActions>
      </Dialog>

      {/* AI posting-preview ("Review") dialog for invoices */}
      <PostingPreviewDialog
        open={invoicePreviewOpen}
        loading={invoicePreviewLoading}
        preview={invoicePreviewData}
        accounts={invoiceAccounts}
        title="Review invoice posting"
        onClose={() => setInvoicePreviewOpen(false)}
        onConfirm={applyInvoiceReview}
        onLearn={learnInvoiceCorrections}
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
      {(documentType === "TI" || documentType === "TI2" || documentType === "INVOICE" || isQuotation) && (
        <SendInvoiceEmailDialog
          open={sendEmailDialogOpen}
          onClose={() => setSendEmailDialogOpen(false)}
          onSent={() => {
            setSendEmailDialogOpen(false);
            router.refresh(); // Refresh to update status
          }}
          invoice={{
            // Set by handleOpenSendEmail after the pre-send save (covers a
            // draft that only received its id at save time).
            id: sendEmailDocId || documentId || "",
            name: formData.name || formData.documentInfo?.documentNumber || "",
            config: formData,
            type: documentType,
            status: documentStatus,
            organizationId: organization?.id || ""
          }}
          customer={{
            id: formData.customer?.id || "",
            name: formData.customer?.name || "",
            // NOT used for TO prefill: the dialog prefills only from a
            // COMPLETE config.attention record (name+email+phone) and
            // otherwise leaves TO empty by design.
            email: formData.customer?.email || ""
          }}
          organizationName={organization?.name || ""}
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

      {/* Post-confirm dialog: two options only — jump straight to the auto-
          created Order, or leave it (close + reload to show confirmed state).
          The PO/DO/Invoice spin-offs that used to live here have moved to the
          order page itself, where the items are already on hand. */}
      <Dialog
        open={convertQuotationDialogOpen}
        onClose={() => setConvertQuotationDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Quotation Confirmed</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            The quotation has been confirmed and a new Order has been created from it.
            You can jump to the order now or come back later from the Orders list.
          </Typography>
          {convertQuotationDialogOpen && !linkedOrderId && (
            <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 1 }}>
              Couldn&apos;t locate the linked order automatically — open the Orders list to find it.
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button
            onClick={() => {
              setConvertQuotationDialogOpen(false);
              window.location.reload();
            }}
          >
            Leave it
          </Button>
          <Button
            variant="contained"
            disabled={!linkedOrderId}
            onClick={() => {
              if (linkedOrderId) router.push(`/portal/orders/${linkedOrderId}`);
            }}
          >
            Go to Order
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
          setEditingItemId(null);
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
        showCapacity
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
        showCapacity
      />

      {/* Service master-file picker — "Add Service" self-codes the line (services only) */}
      <RevenueItemPickerDialog
        open={revenueItemPickerOpen}
        onClose={() => { setRevenueItemPickerOpen(false); setEditingItemId(null); }}
        onSelect={addRevenueItemLine}
        onBlank={addBlankServiceLine}
        typeFilter="SERVICE"
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

      {/* AI Document Assistant sidebar — always available in the editor */}
      {!isTemplateEditMode && (
        <DocumentAssistantDrawer
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          documentType={documentType}
          documentId={(existingData?.id || documentId) as string | undefined}
          formData={formData}
          items={items}
          organization={organization}
          onApplyProposal={handleApplyProposal}
        />
      )}

      {/* Per-document History & notes (⋮ menu) */}
      <DocumentHistoryDrawer
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        documentId={(existingData?.id || documentId || "") as string}
      />

      {/* Biofuel DO "Our Ref" quotation picker */}
      <QuotationSelectDialog
        open={refQuotationDialogOpen}
        onClose={() => setRefQuotationDialogOpen(false)}
        onSelect={handleRefQuotationSelect}
        quotations={refQuotations}
        customerName={formData.customer?.name}
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
              // P/O comes over only if the quotation actually had one — the
              // quotation's Reference No is NOT a P/O (was wrongly used as a
              // fallback here).
              poNo: quotationConfig.poNo || "",
              contact: quotationConfig.contact || "",
              paymentTerms: quotationConfig.paymentTerms || "",
              currency: quotationConfig.currency || "",
              rate: quotationConfig.rate || "",
              taxApplicable: quotationConfig.taxApplicable,
              absorbTax: quotationConfig.absorbTax,
              gstPercent: quotationConfig.gstPercent,
              // Biofuel DO: pre-fill "Our Ref" with the source quotation
              // (number only in the editor; the confirm date prints as
              // " dated dd/mm/yyyy" on the DO).
              ...(isBiofuel && !isInvoiceType
                ? {
                    referenceNo: quotation.name,
                    referenceQuotationDate: quotationConfig.confirmedAt || quotation.createdAt || null,
                  }
                : {}),
            },
            deliveryTo: quotationConfig.deliveryTo || "",
            // Carry the Attn To contact trio — without this the combined
            // "Name - Phone" contact string lands in the phone box.
            attention: {
              name: quotationConfig.attention?.name || "",
              phoneNumber: quotationConfig.attention?.phoneNumber || "",
              email: quotationConfig.attention?.email || "",
            },
            // Carry the quotation's project link onto this document — the
            // save-time link-project PATCH persists it (mandatory on DOs).
            projectId: quotation.projectId || quotationConfig.projectId || formData.projectId || "",
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
              // P/O comes over only if the quotation actually had one — the
              // quotation's Reference No is NOT a P/O (was wrongly used as a
              // fallback here).
              poNo: quotationConfig.poNo || "",
              contact: quotationConfig.contact || "",
              paymentTerms: quotationConfig.paymentTerms || "",
              currency: quotationConfig.currency || "",
              rate: quotationConfig.rate || "",
              taxApplicable: quotationConfig.taxApplicable,
              absorbTax: quotationConfig.absorbTax,
              gstPercent: quotationConfig.gstPercent,
              // Biofuel DO: pre-fill "Our Ref" with the FIRST source quotation.
              ...(isBiofuel && !isInvoiceType
                ? {
                    referenceNo: firstQuotation.name,
                    referenceQuotationDate: quotationConfig.confirmedAt || firstQuotation.createdAt || null,
                  }
                : {}),
            },
            deliveryTo: quotationConfig.deliveryTo || "",
            // Attn To trio from the FIRST quotation (merged quotations share a
            // customer, so the contact is the same in practice).
            attention: {
              name: quotationConfig.attention?.name || "",
              phoneNumber: quotationConfig.attention?.phoneNumber || "",
              email: quotationConfig.attention?.email || "",
            },
            // Project link from the FIRST quotation (merged quotations share a
            // customer and, in practice, a project).
            projectId: firstQuotation.projectId || quotationConfig.projectId || formData.projectId || "",
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
            // Carry the Attn To contact trio — without this the combined
            // "Name - Phone" contact string lands in the phone box.
            attention: {
              name: doConfig.attention?.name || "",
              phoneNumber: doConfig.attention?.phoneNumber || "",
              email: doConfig.attention?.email || "",
            },
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
            // Attn To trio from the FIRST DO (merged DOs share a customer).
            attention: {
              name: doConfig.attention?.name || "",
              phoneNumber: doConfig.attention?.phoneNumber || "",
              email: doConfig.attention?.email || "",
            },
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
              // P/O comes over only if the quotation actually had one — the
              // quotation's Reference No is NOT a P/O (was wrongly used as a
              // fallback here).
              poNo: quotationConfig.poNo || "",
              contact: quotationConfig.contact || "",
              paymentTerms: quotationConfig.paymentTerms || "",
              currency: quotationConfig.currency || "",
              rate: quotationConfig.rate || "",
              taxApplicable: quotationConfig.taxApplicable,
              absorbTax: quotationConfig.absorbTax,
              gstPercent: quotationConfig.gstPercent,
              // Biofuel DO: pre-fill "Our Ref" with the source quotation
              // (number only in the editor; the confirm date prints as
              // " dated dd/mm/yyyy" on the DO).
              ...(isBiofuel && !isInvoiceType
                ? {
                    referenceNo: quotation.name,
                    referenceQuotationDate: quotationConfig.confirmedAt || quotation.createdAt || null,
                  }
                : {}),
            },
            deliveryTo: quotationConfig.deliveryTo || "",
            // Carry the Attn To contact trio — without this the combined
            // "Name - Phone" contact string lands in the phone box.
            attention: {
              name: quotationConfig.attention?.name || "",
              phoneNumber: quotationConfig.attention?.phoneNumber || "",
              email: quotationConfig.attention?.email || "",
            },
            // Carry the quotation's project link onto this document — the
            // save-time link-project PATCH persists it (mandatory on DOs).
            projectId: quotation.projectId || quotationConfig.projectId || formData.projectId || "",
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
              // P/O comes over only if the quotation actually had one — the
              // quotation's Reference No is NOT a P/O (was wrongly used as a
              // fallback here).
              poNo: quotationConfig.poNo || "",
              contact: quotationConfig.contact || "",
              paymentTerms: quotationConfig.paymentTerms || "",
              currency: quotationConfig.currency || "",
              rate: quotationConfig.rate || "",
              taxApplicable: quotationConfig.taxApplicable,
              absorbTax: quotationConfig.absorbTax,
              gstPercent: quotationConfig.gstPercent,
              // Biofuel DO: pre-fill "Our Ref" with the FIRST source quotation.
              ...(isBiofuel && !isInvoiceType
                ? {
                    referenceNo: firstQuotation.name,
                    referenceQuotationDate: quotationConfig.confirmedAt || firstQuotation.createdAt || null,
                  }
                : {}),
            },
            deliveryTo: quotationConfig.deliveryTo || "",
            // Attn To trio from the FIRST quotation (merged quotations share a
            // customer, so the contact is the same in practice).
            attention: {
              name: quotationConfig.attention?.name || "",
              phoneNumber: quotationConfig.attention?.phoneNumber || "",
              email: quotationConfig.attention?.email || "",
            },
            // Project link from the FIRST quotation (merged quotations share a
            // customer and, in practice, a project).
            projectId: firstQuotation.projectId || quotationConfig.projectId || formData.projectId || "",
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
            // Document trades in the customer's master-file currency — the GL
            // converts to base at the accountant's standing rate on posting.
            const customerCurrency = (customer as any).currency || "";
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
              documentInfo: {
                ...formData.documentInfo,
                ...(salesmanCode ? { salesPerson: salesmanCode } : {}),
                ...(customerCurrency ? { currency: customerCurrency } : {}),
              },
              ...(customerCurrency ? { currency: customerCurrency } : {}),
            });
            // Call the customer change handler to fetch related data
            if (onCustomerChange && customer.id) {
              onCustomerChange(customer.id);
            }
          }
        }}
      />

      {/* Create Project Dialog — QUOTATION picker's "+ Create new project"
          inline flow. Creates a minimal project linked to the currently-
          selected customer and auto-selects it in the picker. */}
      <Dialog
        open={createProjectDialogOpen}
        onClose={() => (creatingProject ? null : setCreateProjectDialogOpen(false))}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Create Project</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            For customer <strong>{formData.customer?.name || formData.customer?.id}</strong>.
            Status defaults to pending; you can fill in the rest later from the
            Projects page.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Project Name"
            value={createProjectName}
            onChange={(e) => setCreateProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !creatingProject) {
                e.preventDefault();
                handleCreateProjectSubmit();
              }
            }}
            disabled={creatingProject}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateProjectDialogOpen(false)} disabled={creatingProject}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleCreateProjectSubmit}
            disabled={creatingProject || !createProjectName.trim()}
            startIcon={creatingProject ? <CircularProgress size={14} color="inherit" /> : <AddIcon />}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

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