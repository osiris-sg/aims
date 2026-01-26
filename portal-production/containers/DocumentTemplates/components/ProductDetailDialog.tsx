"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  IconButton,
  Typography,
  Tabs,
  Tab,
  Grid,
  Paper,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Chip,
  Alert,
  Tooltip,
} from "@mui/material";
import {
  Close as CloseIcon,
  Refresh as RefreshIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useRouter } from "next/navigation";

interface ProductItem {
  id: string;
  sku: string;
  name?: string;
  description?: string;
  category?: string;
  categoryName?: string;
  quantity?: number;
  minQuantity?: number;
  unitPrice?: number;
  status?: string;
  assetId?: string;
  asset?: {
    id: string;
    name: string;
    description?: string;
    category?: {
      id: string;
      name: string;
    };
  };
}

interface StockMovement {
  reference: string;
  date: string;
  poNo: string;
  name: string;
  qtyIn: number;
  qtyOut: number;
  balance: number;
  priceOrCost: number;
  currency: string;
  documentId: string;
  documentType: string;
}

interface StockMovementHistory {
  itemId: string;
  itemName: string;
  currentBalance: number;
  movements: StockMovement[];
  totalMovements: number;
}

interface ProductDetailDialogProps {
  open: boolean;
  onClose: () => void;
  item: ProductItem | null;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`product-tabpanel-${index}`}
      aria-labelledby={`product-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 2 }}>{children}</Box>}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `product-tab-${index}`,
    "aria-controls": `product-tabpanel-${index}`,
  };
}

// Field display component
function DetailField({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {value !== undefined && value !== null && value !== "" ? value : "-"}
      </Typography>
    </Box>
  );
}

// Sub-tab panel component
function SubTabPanel(props: { children?: React.ReactNode; index: number; value: number }) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`info-subtabpanel-${index}`}
      aria-labelledby={`info-subtab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

// Information document table component
function InformationTable({
  data,
  emptyMessage,
  loading = false,
  title,
  description,
  onRefresh,
  onRowClick,
}: {
  data: Array<{ reference: string; date: string; name: string; qtyOut: number; documentId?: string }>;
  emptyMessage: string;
  loading?: boolean;
  title?: string;
  description?: string;
  onRefresh?: () => void;
  onRowClick?: (row: any) => void;
}) {
  const headerCellStyle = {
    fontWeight: 600,
    bgcolor: "grey.100",
    borderBottom: 2,
    borderColor: "primary.main",
  };

  return (
    <Paper variant="outlined" sx={{ p: 0 }}>
      {title && (
        <Box
          sx={{
            p: 2,
            bgcolor: "grey.50",
            borderBottom: 1,
            borderColor: "divider",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Box>
            <Typography variant="subtitle2" color="primary" sx={{ fontWeight: 600 }}>
              {title}
            </Typography>
            {description && (
              <Typography variant="caption" color="text.secondary">
                {description}
              </Typography>
            )}
          </Box>
          {onRefresh && (
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={onRefresh} disabled={loading}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )}
      <TableContainer sx={{ maxHeight: "calc(70vh - 450px)" }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...headerCellStyle, minWidth: 130 }}>
                Reference
              </TableCell>
              <TableCell sx={{ ...headerCellStyle, minWidth: 100 }}>
                Date
              </TableCell>
              <TableCell sx={{ ...headerCellStyle, minWidth: 180 }}>
                Name
              </TableCell>
              <TableCell align="right" sx={{ ...headerCellStyle, minWidth: 80 }}>
                Qty-Out
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 8 }}>
                  <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                    <CircularProgress size={32} />
                    <Typography sx={{ ml: 2 }} color="text.secondary">
                      Loading...
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                  <Box sx={{ textAlign: "center" }}>
                    <Typography color="text.secondary" sx={{ mb: 1 }}>
                      {emptyMessage}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Documents will appear here when confirmed
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, index) => (
                <TableRow
                  key={index}
                  hover
                  onClick={() => onRowClick?.(row)}
                  sx={{
                    cursor: onRowClick ? "pointer" : "default",
                    "&:hover": {
                      bgcolor: "action.hover",
                    },
                    "&:nth-of-type(even)": {
                      bgcolor: "grey.50",
                    },
                  }}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {row.reference}
                    </Typography>
                  </TableCell>
                  <TableCell>{row.date}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {row.qtyOut}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

// Document data type for sub-tabs
interface DocumentData {
  reference: string;
  date: string;
  name: string;
  qtyOut: number;
  documentId?: string;
  documentTemplateId?: string;
  documentType?: string;
}

interface DocumentTotals {
  invoiceQty: number;
  deliveryOrderQty: number;
  debitNoteQty: number;
  creditNoteQty: number;
  totalSalesQty: number;
}

// Information Sub-tabs Component
function InformationSubTabs({ item, itemType, onClose }: { item: ProductItem; itemType: string; onClose: () => void }) {
  const [subTabValue, setSubTabValue] = useState(0);
  const [invoiceData, setInvoiceData] = useState<DocumentData[]>([]);
  const [deliveryOrderData, setDeliveryOrderData] = useState<DocumentData[]>([]);
  const [debitNoteData, setDebitNoteData] = useState<DocumentData[]>([]);
  const [creditNoteData, setCreditNoteData] = useState<DocumentData[]>([]);
  const [totals, setTotals] = useState<DocumentTotals>({
    invoiceQty: 0,
    deliveryOrderQty: 0,
    debitNoteQty: 0,
    creditNoteQty: 0,
    totalSalesQty: 0,
  });
  const [loading, setLoading] = useState(false);
  const { getToken } = useAuth();
  const router = useRouter();

  // Navigate to document when row is clicked
  const handleDocumentClick = (row: DocumentData) => {
    console.log("[InformationSubTabs] Row clicked:", row);
    if (row.documentId && row.documentTemplateId && row.documentType) {
      // URL format: /portal/documents/[TYPE]/[templateId]/[documentId]
      const url = `/portal/documents/${row.documentType}/${row.documentTemplateId}/${row.documentId}`;
      console.log("[InformationSubTabs] Navigating to:", url);
      onClose();
      router.push(url);
    } else {
      console.warn("[InformationSubTabs] Missing required fields:", {
        documentId: row.documentId,
        documentTemplateId: row.documentTemplateId,
        documentType: row.documentType,
      });
    }
  };

  const handleSubTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setSubTabValue(newValue);
  };

  // Fetch documents for this item
  const fetchDocumentsForItem = async () => {
    if (!item?.id) return;

    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      // Fetch all confirmed documents containing this item
      const response = await request(
        {
          path: `/inventories/${item.id}/documents`,
          method: "GET",
        },
        {},
        token
      );

      console.log("[InformationSubTabs] Documents response:", response);

      const data = response?.data || response;
      console.log("[InformationSubTabs] Parsed data:", data);

      if (data) {
        // Helper to process document data
        const processDocuments = (docs: any[]) =>
          (docs || []).map((doc: any) => ({
            reference: doc.reference || "",
            date: doc.date ? new Date(doc.date).toLocaleDateString("en-GB") : "",
            name: doc.customerName || "",
            qtyOut: doc.quantity || 0,
            documentId: doc.documentId,
            documentTemplateId: doc.documentTemplateId,
            documentType: doc.documentType,
          }));

        // Process invoices
        console.log("[InformationSubTabs] Raw invoices:", data.invoices);
        const invoices = processDocuments(data.invoices);
        console.log("[InformationSubTabs] Processed invoices:", invoices);
        setInvoiceData(invoices);

        // Process delivery orders
        const deliveryOrders = processDocuments(data.deliveryOrders);
        setDeliveryOrderData(deliveryOrders);

        // Process debit notes
        const debitNotes = processDocuments(data.debitNotes);
        setDebitNoteData(debitNotes);

        // Process credit notes
        const creditNotes = processDocuments(data.creditNotes);
        setCreditNoteData(creditNotes);

        // Set totals
        if (data.totals) {
          setTotals(data.totals);
        }
      }
    } catch (error) {
      console.error("[InformationSubTabs] Error fetching documents:", error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch documents when component mounts or item changes
  useEffect(() => {
    fetchDocumentsForItem();
  }, [item?.id]);

  // Calculate balance values
  const balance = item?.quantity ?? 0;
  const actualBalance = balance - totals.totalSalesQty;
  const projectedBalance = actualBalance; // Add pending adjustments when implemented

  // Placeholder data for tabs not yet implemented
  const onOrderData: DocumentData[] = [];
  const pendingAdjustmentsData: DocumentData[] = [];

  return (
    <Box>
      {/* Sub-tabs */}
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={subTabValue}
          onChange={handleSubTabChange}
          aria-label="information sub-tabs"
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 40,
            "& .MuiTab-root": {
              minHeight: 40,
              py: 1,
              fontSize: "0.8125rem",
            },
          }}
        >
          <Tab label="On Order" id="info-subtab-0" aria-controls="info-subtabpanel-0" />
          <Tab label="Pending Adjustments" id="info-subtab-1" aria-controls="info-subtabpanel-1" />
          <Tab label="Invoice" id="info-subtab-2" aria-controls="info-subtabpanel-2" />
          <Tab label="Delivery Order" id="info-subtab-3" aria-controls="info-subtabpanel-3" />
          <Tab label="Debit Note" id="info-subtab-4" aria-controls="info-subtabpanel-4" />
          <Tab label="Credit Note" id="info-subtab-5" aria-controls="info-subtabpanel-5" />
        </Tabs>
      </Box>

      {/* On Order Sub-tab */}
      <SubTabPanel value={subTabValue} index={0}>
        <InformationTable
          data={onOrderData}
          emptyMessage={`No items on order for this ${itemType.toLowerCase()}`}
          title="Purchase Orders"
          description={`Items on order that have not been received for this ${itemType.toLowerCase()}`}
        />
      </SubTabPanel>

      {/* Pending Adjustments Sub-tab */}
      <SubTabPanel value={subTabValue} index={1}>
        <InformationTable
          data={pendingAdjustmentsData}
          emptyMessage={`No pending adjustments for this ${itemType.toLowerCase()}`}
          title="Pending Adjustments"
          description={`Stock adjustments that are pending approval for this ${itemType.toLowerCase()}`}
        />
      </SubTabPanel>

      {/* Invoice Sub-tab */}
      <SubTabPanel value={subTabValue} index={2}>
        <InformationTable
          data={invoiceData}
          emptyMessage={`No invoices for this ${itemType.toLowerCase()}`}
          loading={loading}
          title="Invoices"
          description={`Confirmed invoices containing this ${itemType.toLowerCase()}`}
          onRefresh={fetchDocumentsForItem}
          onRowClick={handleDocumentClick}
        />
      </SubTabPanel>

      {/* Delivery Order Sub-tab */}
      <SubTabPanel value={subTabValue} index={3}>
        <InformationTable
          data={deliveryOrderData}
          emptyMessage={`No delivery orders for this ${itemType.toLowerCase()}`}
          loading={loading}
          title="Delivery Orders"
          description={`Confirmed delivery orders containing this ${itemType.toLowerCase()}`}
          onRefresh={fetchDocumentsForItem}
          onRowClick={handleDocumentClick}
        />
      </SubTabPanel>

      {/* Debit Note Sub-tab */}
      <SubTabPanel value={subTabValue} index={4}>
        <InformationTable
          data={debitNoteData}
          emptyMessage={`No debit notes for this ${itemType.toLowerCase()}`}
          loading={loading}
          title="Debit Notes"
          description={`Confirmed debit notes containing this ${itemType.toLowerCase()}`}
          onRefresh={fetchDocumentsForItem}
          onRowClick={handleDocumentClick}
        />
      </SubTabPanel>

      {/* Credit Note Sub-tab */}
      <SubTabPanel value={subTabValue} index={5}>
        <InformationTable
          data={creditNoteData}
          emptyMessage={`No credit notes for this ${itemType.toLowerCase()}`}
          loading={loading}
          title="Credit Notes"
          description={`Confirmed credit notes containing this ${itemType.toLowerCase()}`}
          onRefresh={fetchDocumentsForItem}
          onRowClick={handleDocumentClick}
        />
      </SubTabPanel>

      {/* Summary Section at bottom */}
      <Box sx={{ mt: 3, display: "flex", gap: 4 }}>
        {/* Left Summary - Balance Calculations */}
        <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
          <Grid container spacing={1}>
            <Grid item xs={8}>
              <Typography variant="body2" color="primary" fontWeight={600}>BALANCE</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="body2" align="right" fontWeight={600}>{balance}</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2">LESS TOTAL SALES QTY</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="body2" align="right" color="error.main">-{totals.totalSalesQty}</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2" fontWeight={600}>ACTUAL BALANCE</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="body2" align="right" fontWeight={600}>{actualBalance}</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2">ADD PENDING ADJUSTMENTS</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="body2" align="right">0</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2" color="success.main" fontWeight={600}>PROJECTED BALANCE</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="body2" align="right" color="success.main" fontWeight={600}>{projectedBalance}</Typography>
            </Grid>
          </Grid>
        </Paper>

        {/* Right Summary - Document Quantities */}
        <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
          <Grid container spacing={1}>
            <Grid item xs={8}>
              <Typography variant="body2">Sales Order</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="body2" align="right">0</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2">Delivery Order</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="body2" align="right">-{totals.deliveryOrderQty}</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2" color="warning.main" sx={{ fontSize: "0.75rem" }}>
                Confirmed DO but not extracted to invoice
              </Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="body2" align="right">0</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2">Invoice</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="body2" align="right">-{totals.invoiceQty}</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2">Debit Note</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="body2" align="right">-{totals.debitNoteQty}</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2">Credit Note</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="body2" align="right">{totals.creditNoteQty}</Typography>
            </Grid>
            <Divider sx={{ width: "100%", my: 1 }} />
            <Grid item xs={8}>
              <Typography variant="body2" fontWeight={600}>TOTAL SALES QTY</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="body2" align="right" fontWeight={600}>-{totals.totalSalesQty}</Typography>
            </Grid>
          </Grid>
        </Paper>
      </Box>
    </Box>
  );
}

export default function ProductDetailDialog({
  open,
  onClose,
  item,
}: ProductDetailDialogProps) {
  const [tabValue, setTabValue] = useState(0);
  const [stockMovements, setStockMovements] = useState<StockMovementHistory | null>(null);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [movementsError, setMovementsError] = useState<string | null>(null);
  const { isAssetTrackingModeEnabled } = useOrganizationFeatures();
  const { getToken } = useAuth();
  const router = useRouter();
  const itemType = isAssetTrackingModeEnabled ? "Item" : "Product";

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleClose = () => {
    setTabValue(0); // Reset to first tab
    setStockMovements(null);
    setMovementsError(null);
    onClose();
  };

  // Fetch stock movements
  const fetchStockMovements = async () => {
    if (!item?.id) {
      console.log("[StockMovements] No item.id provided");
      return;
    }

    console.log("[StockMovements] Fetching for item:", item.id, "SKU:", item.sku);
    setLoadingMovements(true);
    setMovementsError(null);
    try {
      const token = await getToken();
      if (!token) {
        console.log("[StockMovements] No auth token");
        return;
      }

      const response = await request(
        {
          path: `/inventories/${item.id}/stock-movements`,
          method: "GET",
        },
        {},
        token
      );

      console.log("[StockMovements] API response:", response);

      // Check for error response from request helper
      if (response?.success === false) {
        setMovementsError(response.message || "Failed to load stock movements");
        return;
      }

      // Extract data - response may be wrapped in { success, data, message } or direct
      const data = response?.data || response;

      // Ensure response has the expected structure
      if (data && data.movements !== undefined) {
        setStockMovements(data);
      } else if (data) {
        // Response exists but doesn't have movements - might be wrapped differently
        console.log("[StockMovements] Unexpected response structure:", data);
        setStockMovements({
          itemId: item.id,
          itemName: item.name || item.sku || "",
          currentBalance: data.currentBalance ?? item.quantity ?? 0,
          movements: data.movements || [],
          totalMovements: data.totalMovements ?? 0,
        });
      }
    } catch (error: any) {
      console.error("[StockMovements] Error:", error);
      setMovementsError(error?.message || "Failed to load stock movements");
    } finally {
      setLoadingMovements(false);
    }
  };

  // Fetch stock movements when Details tab is selected
  useEffect(() => {
    if (tabValue === 1 && item?.id) {
      fetchStockMovements();
    }
  }, [item?.id, tabValue]);

  // Calculate summary statistics
  const movementStats = React.useMemo(() => {
    if (!stockMovements?.movements) return { totalIn: 0, totalOut: 0, netChange: 0 };

    const totalIn = stockMovements.movements.reduce((sum, m) => sum + m.qtyIn, 0);
    const totalOut = stockMovements.movements.reduce((sum, m) => sum + m.qtyOut, 0);

    return {
      totalIn,
      totalOut,
      netChange: totalIn - totalOut,
    };
  }, [stockMovements]);

  // Get document type display info
  const getDocumentTypeInfo = (docType: string) => {
    const typeMap: Record<string, { label: string; color: "success" | "error" | "primary" | "warning" | "info" }> = {
      PO: { label: "Purchase Order", color: "success" },
      PURCHASE_ORDER: { label: "Purchase Order", color: "success" },
      SAI: { label: "Stock Adj In", color: "success" },
      STOCK_ADJUSTMENT_IN: { label: "Stock Adj In", color: "success" },
      DO: { label: "Delivery Order", color: "error" },
      DELIVERY_ORDER: { label: "Delivery Order", color: "error" },
      INVOICE: { label: "Invoice", color: "error" },
      TI: { label: "Invoice", color: "error" },
      TI2: { label: "Invoice", color: "error" },
      SAO: { label: "Stock Adj Out", color: "error" },
      STOCK_ADJUSTMENT_OUT: { label: "Stock Adj Out", color: "error" },
      DN: { label: "Debit Note", color: "warning" },
      DEBIT_NOTE: { label: "Debit Note", color: "warning" },
    };
    return typeMap[docType] || { label: docType, color: "info" };
  };

  // Navigate to document
  const handleDocumentClick = (movement: StockMovement) => {
    // Close dialog and navigate to document
    handleClose();
    const docType = movement.documentType.toLowerCase().replace(/_/g, "-");
    router.push(`/portal/documents/${docType}/view/${movement.documentId}`);
  };

  if (!item) return null;

  const getItemDescription = () => {
    return item.description || item.name || item.asset?.name || item.asset?.description || "-";
  };

  const getItemCategory = () => {
    return item.categoryName || item.category || item.asset?.category?.name || "-";
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: "70vh",
          maxHeight: "85vh",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          bgcolor: "primary.main",
          color: "primary.contrastText",
          py: 1.5,
        }}
      >
        <Typography variant="h6" fontWeight={500}>
          {itemType} Details - {item.sku}
        </Typography>
        <IconButton onClick={handleClose} size="small" sx={{ color: "primary.contrastText" }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "grey.50" }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="product detail tabs"
          variant="fullWidth"
        >
          <Tab label="Stock Card" {...a11yProps(0)} />
          <Tab label="Details" {...a11yProps(1)} />
          <Tab label="Information" {...a11yProps(2)} />
          <Tab label="Latest Update / Remarks" {...a11yProps(3)} />
        </Tabs>
      </Box>

      <DialogContent sx={{ p: 0 }}>
        {/* Stock Card Tab */}
        <TabPanel value={tabValue} index={0}>
          <Grid container spacing={3}>
            {/* Left Column - Basic Info */}
            <Grid item xs={12} md={6}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
                  Basic Information
                </Typography>
                <DetailField label="Code" value={item.sku} />
                <DetailField label="Description" value={getItemDescription()} />
                <DetailField label="Category" value={getItemCategory()} />

                <Divider sx={{ my: 2 }} />

                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <DetailField label="Balance" value={item.quantity} />
                  </Grid>
                  <Grid item xs={6}>
                    <DetailField label="Minimum Qty" value={item.minQuantity} />
                  </Grid>
                </Grid>

                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <DetailField
                      label="Unit Price"
                      value={item.unitPrice != null ? `$${item.unitPrice.toFixed(2)}` : undefined}
                    />
                  </Grid>
                  <Grid item xs={6}>
                    <DetailField label="Status" value={item.status} />
                  </Grid>
                </Grid>
              </Paper>
            </Grid>

            {/* Right Column - Image & Stats */}
            <Grid item xs={12} md={6}>
              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
                  {itemType} Image
                </Typography>
                <Box
                  sx={{
                    width: "100%",
                    height: 150,
                    bgcolor: "grey.100",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 1,
                    border: "1px dashed",
                    borderColor: "grey.300",
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    No image available
                  </Typography>
                </Box>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
                  Document Summary
                </Typography>
                <Grid container spacing={1}>
                  <Grid item xs={8}>
                    <Typography variant="body2">Sales Order</Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography variant="body2" align="right" fontWeight={500}>0</Typography>
                  </Grid>
                  <Grid item xs={8}>
                    <Typography variant="body2">Delivery Order</Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography variant="body2" align="right" fontWeight={500}>0</Typography>
                  </Grid>
                  <Grid item xs={8}>
                    <Typography variant="body2">Invoice</Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography variant="body2" align="right" fontWeight={500}>0</Typography>
                  </Grid>
                </Grid>

                <Divider sx={{ my: 1.5 }} />

                <Grid container spacing={1}>
                  <Grid item xs={8}>
                    <Typography variant="body2" fontWeight={600}>Total Sales Qty</Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography variant="body2" align="right" fontWeight={600}>0</Typography>
                  </Grid>
                </Grid>

                <Divider sx={{ my: 1.5 }} />

                <Grid container spacing={1}>
                  <Grid item xs={8}>
                    <Typography variant="body2" color="primary">Balance</Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography variant="body2" align="right" color="primary" fontWeight={600}>
                      {item.quantity ?? 0}
                    </Typography>
                  </Grid>
                  <Grid item xs={8}>
                    <Typography variant="body2">Less Total Sales Qty</Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography variant="body2" align="right">0</Typography>
                  </Grid>
                  <Grid item xs={8}>
                    <Typography variant="body2" color="success.main" fontWeight={600}>
                      Actual Balance
                    </Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography variant="body2" align="right" color="success.main" fontWeight={600}>
                      {item.quantity ?? 0}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          </Grid>
        </TabPanel>

        {/* Details Tab - Stock Movement History */}
        <TabPanel value={tabValue} index={1}>
          {/* Summary Cards */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={3}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  textAlign: "center",
                  bgcolor: "primary.50",
                  borderColor: "primary.200",
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  Current Balance
                </Typography>
                <Typography variant="h5" fontWeight={600} color="primary.main">
                  {stockMovements?.currentBalance?.toLocaleString() ?? item.quantity ?? 0}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  textAlign: "center",
                  bgcolor: "success.50",
                  borderColor: "success.200",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5 }}>
                  <TrendingUpIcon fontSize="small" color="success" />
                  <Typography variant="caption" color="text.secondary">
                    Total In
                  </Typography>
                </Box>
                <Typography variant="h5" fontWeight={600} color="success.main">
                  {movementStats.totalIn.toLocaleString()}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  textAlign: "center",
                  bgcolor: "error.50",
                  borderColor: "error.200",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5 }}>
                  <TrendingDownIcon fontSize="small" color="error" />
                  <Typography variant="caption" color="text.secondary">
                    Total Out
                  </Typography>
                </Box>
                <Typography variant="h5" fontWeight={600} color="error.main">
                  {movementStats.totalOut.toLocaleString()}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  textAlign: "center",
                  bgcolor: "grey.50",
                  borderColor: "grey.300",
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  Transactions
                </Typography>
                <Typography variant="h5" fontWeight={600}>
                  {stockMovements?.totalMovements ?? 0}
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          <Paper variant="outlined" sx={{ p: 0 }}>
            <Box
              sx={{
                p: 2,
                bgcolor: "grey.50",
                borderBottom: 1,
                borderColor: "divider",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Box>
                <Typography variant="subtitle2" color="primary" sx={{ fontWeight: 600 }}>
                  Stock Movement History
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Transaction history showing all stock movements for this {itemType.toLowerCase()}
                </Typography>
              </Box>
              <Tooltip title="Refresh">
                <IconButton
                  size="small"
                  onClick={fetchStockMovements}
                  disabled={loadingMovements}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>

            {movementsError && (
              <Alert severity="error" sx={{ m: 2 }}>
                {movementsError}
              </Alert>
            )}

            {loadingMovements ? (
              <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 8 }}>
                <CircularProgress size={32} />
                <Typography sx={{ ml: 2 }} color="text.secondary">
                  Loading stock movements...
                </Typography>
              </Box>
            ) : (
              <TableContainer sx={{ maxHeight: "calc(70vh - 380px)" }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          bgcolor: "grey.100",
                          borderBottom: 2,
                          borderColor: "primary.main",
                          minWidth: 130,
                        }}
                      >
                        Reference
                      </TableCell>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          bgcolor: "grey.100",
                          borderBottom: 2,
                          borderColor: "primary.main",
                          minWidth: 90,
                        }}
                      >
                        Type
                      </TableCell>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          bgcolor: "grey.100",
                          borderBottom: 2,
                          borderColor: "primary.main",
                          minWidth: 100,
                        }}
                      >
                        Date
                      </TableCell>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          bgcolor: "grey.100",
                          borderBottom: 2,
                          borderColor: "primary.main",
                          minWidth: 100,
                        }}
                      >
                        P/O No
                      </TableCell>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          bgcolor: "grey.100",
                          borderBottom: 2,
                          borderColor: "primary.main",
                          minWidth: 180,
                        }}
                      >
                        Name
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontWeight: 600,
                          bgcolor: "grey.100",
                          borderBottom: 2,
                          borderColor: "primary.main",
                          minWidth: 80,
                        }}
                      >
                        Qty-In
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontWeight: 600,
                          bgcolor: "grey.100",
                          borderBottom: 2,
                          borderColor: "primary.main",
                          minWidth: 80,
                        }}
                      >
                        Qty-Out
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontWeight: 600,
                          bgcolor: "grey.100",
                          borderBottom: 2,
                          borderColor: "primary.main",
                          minWidth: 80,
                        }}
                      >
                        Balance
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontWeight: 600,
                          bgcolor: "grey.100",
                          borderBottom: 2,
                          borderColor: "primary.main",
                          minWidth: 100,
                        }}
                      >
                        Price / Cost
                      </TableCell>
                      <TableCell
                        align="center"
                        sx={{
                          fontWeight: 600,
                          bgcolor: "grey.100",
                          borderBottom: 2,
                          borderColor: "primary.main",
                          minWidth: 60,
                        }}
                      >
                        Curr
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {!stockMovements || !stockMovements.movements || stockMovements.movements.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} align="center" sx={{ py: 6 }}>
                          <Box sx={{ textAlign: "center" }}>
                            <Typography color="text.secondary" sx={{ mb: 1 }}>
                              No stock movements found for this {itemType.toLowerCase()}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Stock movements will appear here when documents (PO, DO, Invoice, etc.) are confirmed
                            </Typography>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ) : (
                      stockMovements.movements.map((movement, index) => {
                        const typeInfo = getDocumentTypeInfo(movement.documentType);
                        return (
                          <TableRow
                            key={`${movement.documentId}-${index}`}
                            hover
                            sx={{
                              cursor: "pointer",
                              "&:hover": {
                                bgcolor: "action.hover",
                              },
                              "&:nth-of-type(even)": {
                                bgcolor: "grey.50",
                              },
                            }}
                            onClick={() => handleDocumentClick(movement)}
                          >
                            <TableCell>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontWeight: 500,
                                    color: "primary.main",
                                    "&:hover": { textDecoration: "underline" },
                                  }}
                                >
                                  {movement.reference}
                                </Typography>
                                <OpenInNewIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={typeInfo.label}
                                size="small"
                                color={typeInfo.color}
                                variant="outlined"
                                sx={{ fontSize: "0.7rem", height: 22 }}
                              />
                            </TableCell>
                            <TableCell>{formatDate(movement.date)}</TableCell>
                            <TableCell>{movement.poNo || "-"}</TableCell>
                            <TableCell>
                              <Typography variant="body2" noWrap sx={{ maxWidth: 180 }}>
                                {movement.name || "-"}
                              </Typography>
                            </TableCell>
                            <TableCell
                              align="right"
                              sx={{
                                color: movement.qtyIn > 0 ? "success.main" : "text.disabled",
                                fontWeight: movement.qtyIn > 0 ? 600 : 400,
                                bgcolor: movement.qtyIn > 0 ? "success.50" : "transparent",
                              }}
                            >
                              {movement.qtyIn > 0 ? `+${movement.qtyIn.toLocaleString()}` : ""}
                            </TableCell>
                            <TableCell
                              align="right"
                              sx={{
                                color: movement.qtyOut > 0 ? "error.main" : "text.disabled",
                                fontWeight: movement.qtyOut > 0 ? 600 : 400,
                                bgcolor: movement.qtyOut > 0 ? "error.50" : "transparent",
                              }}
                            >
                              {movement.qtyOut > 0 ? `-${movement.qtyOut.toLocaleString()}` : ""}
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>
                              {movement.balance.toLocaleString()}
                            </TableCell>
                            <TableCell align="right">
                              {movement.priceOrCost > 0 ? `$${movement.priceOrCost.toFixed(2)}` : "-"}
                            </TableCell>
                            <TableCell align="center">{movement.currency}</TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {/* Footer with summary */}
            {stockMovements && stockMovements.movements && stockMovements.movements.length > 0 && (
              <Box
                sx={{
                  p: 1.5,
                  bgcolor: "grey.100",
                  borderTop: "1px solid",
                  borderColor: "divider",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Showing {stockMovements.movements?.length ?? 0} transactions
                </Typography>
                <Box sx={{ display: "flex", gap: 3 }}>
                  <Typography variant="body2">
                    Total In: <strong style={{ color: "#2e7d32" }}>+{movementStats.totalIn.toLocaleString()}</strong>
                  </Typography>
                  <Typography variant="body2">
                    Total Out: <strong style={{ color: "#d32f2f" }}>-{movementStats.totalOut.toLocaleString()}</strong>
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    Balance: {stockMovements.currentBalance?.toLocaleString() ?? 0}
                  </Typography>
                </Box>
              </Box>
            )}
          </Paper>
        </TabPanel>

        {/* Information Tab with Sub-tabs */}
        <TabPanel value={tabValue} index={2}>
          <InformationSubTabs item={item} itemType={itemType} onClose={handleClose} />
        </TabPanel>

        {/* Latest Update / Remarks Tab */}
        <TabPanel value={tabValue} index={3}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
              Latest Update / Remarks
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Update history and remarks will be displayed here.
            </Typography>
          </Paper>
        </TabPanel>
      </DialogContent>
    </Dialog>
  );
}
