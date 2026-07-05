"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  TextField,
  RadioGroup,
  ToggleButton,
  ToggleButtonGroup,
  FormControlLabel,
  Radio,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Typography,
  InputAdornment,
  Chip,
} from "@mui/material";
import {
  Close as CloseIcon,
  Search as SearchIcon,
  Add as AddIcon,
  Visibility as ViewIcon,
} from "@mui/icons-material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import ProductDetailDialog from "./ProductDetailDialog";

interface InventoryItem {
  id: string;
  sku: string;
  name?: string;
  description?: string;
  category?: string;
  categoryName?: string;
  quantity?: number;
  minQuantity?: number;
  unitPrice?: number;
  costPrice?: number;
  customPrices?: any[];
  points?: number;
  capacityKw?: number;
  uom?: string;
  status?: string;
  assetId?: string;
  salesAccountCode?: string | null;
  rentalAccountCode?: string | null;
  asset?: {
    id: string;
    name: string;
    description?: string;
    uom?: string;
    price?: number;
    costPrice?: number;
    customPrices?: any[];
    points?: number;
    capacityKw?: number;
    salesAccountCode?: string | null;
    rentalAccountCode?: string | null;
    category?: {
      id: string;
      name: string;
    };
  };
}

interface StockCardDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectItem: (item: InventoryItem) => void;
  inventoryItems: InventoryItem[];
  // "cost" for PO/PR — column reads asset.costPrice and is labeled "Cost Price".
  // "selling" (default) — column reads unitPrice/asset.price labeled "Unit Price".
  priceMode?: "cost" | "selling";
  // When true, add a "Dealer Price" column (from customPrices "Discount Price").
  showDealerPrice?: boolean;
  // When true, add a "Points" column (from asset.points; 1 point = $1 discount).
  showPoints?: boolean;
  // When true, add a "Capacity" column (from asset.capacityKw, shown as "x kW").
  showCapacity?: boolean;
}

type SearchMode = "code" | "description" | "category";

export default function StockCardDialog({
  open,
  onClose,
  onSelectItem,
  inventoryItems,
  priceMode = "selling",
  showDealerPrice = false,
  showPoints = false,
  showCapacity = false,
}: StockCardDialogProps) {
  const getPoints = (it: InventoryItem) => {
    const p = it.points ?? it.asset?.points;
    return p != null ? Number(p) : null;
  };
  const getCapacity = (it: InventoryItem) => {
    const c = it.capacityKw ?? it.asset?.capacityKw;
    return c != null ? Number(c) : null;
  };
  const showCost = priceMode === "cost";
  const priceColumnLabel = showCost ? "Cost Price" : "Unit Price";
  const getDisplayPrice = (it: InventoryItem) =>
    showCost
      ? (it.costPrice ?? it.asset?.costPrice ?? null)
      : (it.unitPrice ?? it.asset?.price ?? null);
  const getDealerPrice = (it: InventoryItem) => {
    const cps = it.customPrices ?? it.asset?.customPrices;
    if (!Array.isArray(cps)) return null;
    const hit = cps.find((cp: any) => cp && String(cp.label).toLowerCase() === "discount price");
    return hit != null ? Number(hit.value) : null;
  };
  const [searchTerm, setSearchTerm] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("code");
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedViewItem, setSelectedViewItem] = useState<InventoryItem | null>(null);
  // Keyboard navigation: highlighted row (Enter selects it; default = first match).
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);
  const { isAssetTrackingModeEnabled } = useOrganizationFeatures();
  const itemType = isAssetTrackingModeEnabled ? "Item" : "Product";

  // Rental / Sales tabs — shown only when products carry GL accounts. A product
  // appears under "Sales" if it has salesAccountCode, "Rental" if rentalAccountCode.
  const accSales = (it: InventoryItem) => it.salesAccountCode ?? it.asset?.salesAccountCode ?? null;
  const accRental = (it: InventoryItem) => it.rentalAccountCode ?? it.asset?.rentalAccountCode ?? null;
  const hasSales = useMemo(() => inventoryItems.some((i) => accSales(i)), [inventoryItems]);
  const hasRental = useMemo(() => inventoryItems.some((i) => accRental(i)), [inventoryItems]);
  const showRevenueTabs = hasSales || hasRental;
  const [revenueMode, setRevenueMode] = useState<"sales" | "rental">("sales");
  useEffect(() => { if (showRevenueTabs) setRevenueMode(hasSales ? "sales" : "rental"); }, [showRevenueTabs, hasSales]);
  const getRentalPrice = (it: InventoryItem) => {
    const cps = it.customPrices ?? it.asset?.customPrices;
    if (Array.isArray(cps)) {
      const hit = cps.find((cp: any) => cp && /rent/i.test(String(cp.label)));
      if (hit != null) return Number(hit.value);
    }
    return it.unitPrice ?? it.asset?.price ?? null;
  };
  // On select, tag the item with its chosen GL account + rental/sale price so
  // the invoice line self-codes.
  const decorate = (item: InventoryItem) => {
    if (!showRevenueTabs) return item;
    const accountCode = revenueMode === "rental" ? accRental(item) : accSales(item);
    const unitPrice = revenueMode === "rental" ? getRentalPrice(item) : (item.unitPrice ?? item.asset?.price ?? null);
    return { ...item, __revenueMode: revenueMode, accountCode, ...(unitPrice != null ? { unitPrice } : {}) } as any;
  };

  const handleViewItem = (item: InventoryItem, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click
    setSelectedViewItem(item);
    setViewDialogOpen(true);
  };

  const handleAddItem = (item: InventoryItem, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click
    onSelectItem(decorate(item));
    setSearchTerm("");
    onClose();
  };

  // Filter inventory items by the Rental/Sales tab, then the search term.
  // A product mapped to the OTHER mode only is hidden; unmapped products (no
  // account either way) stay visible in both tabs so nothing disappears — they
  // just won't self-code until an account is set.
  const filteredItems = useMemo(() => {
    let base = inventoryItems;
    if (showRevenueTabs) {
      base = base.filter((i) => {
        const s = accSales(i);
        const r = accRental(i);
        if (!s && !r) return true; // unmapped → always selectable
        return revenueMode === "rental" ? !!r : !!s;
      });
    }
    if (!searchTerm.trim()) return base;

    const term = searchTerm.toLowerCase();
    return base.filter((item) => {
      switch (searchMode) {
        case "code":
          return item.sku?.toLowerCase().includes(term);
        case "description":
          const desc = item.description || item.name || item.asset?.name || item.asset?.description || "";
          return desc.toLowerCase().includes(term);
        case "category":
          const cat = item.categoryName || item.category || item.asset?.category?.name || "";
          return cat.toLowerCase().includes(term);
        default:
          return true;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryItems, searchTerm, searchMode, showRevenueTabs, revenueMode]);

  // Reset the highlight to the first row whenever the filtered list changes.
  useEffect(() => { setActiveIndex(0); }, [searchTerm, searchMode, inventoryItems]);

  // Keep the highlighted row scrolled into view as you arrow through.
  useEffect(() => { activeRowRef.current?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);

  const handleRowClick = (item: InventoryItem) => {
    onSelectItem(decorate(item));
    setSearchTerm("");
    onClose();
  };

  // ↑/↓ to move the highlight, Enter to select it (default is the first match).
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!filteredItems.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filteredItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filteredItems[Math.min(activeIndex, filteredItems.length - 1)];
      if (item) handleRowClick(item);
    }
  };

  const handleClose = () => {
    setSearchTerm("");
    onClose();
  };

  const getItemDescription = (item: InventoryItem) => {
    return item.description || item.name || item.asset?.name || item.asset?.description || "-";
  };

  const getItemCategory = (item: InventoryItem) => {
    return item.categoryName || item.category || item.asset?.category?.name || "-";
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
          bgcolor: "background.paper",
          color: "text.primary",
          borderBottom: "1px solid",
          borderColor: "divider",
          py: 1.75,
        }}
      >
        <Typography variant="h6" fontWeight={600}>
          Stock Card — Select {itemType}
        </Typography>
        <IconButton onClick={handleClose} size="small" sx={{ color: "text.secondary" }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0, bgcolor: "background.paper" }}>
        {/* Search Section */}
        <Box
          sx={{
            p: 2,
            bgcolor: "background.paper",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          {/* Search Input */}
          <TextField
            fullWidth
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            size="small"
            autoFocus
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
            sx={{
              mb: 1.5,
              bgcolor: "background.paper",
            }}
          />

          {/* Rental / Sales tabs — a product credits its sales or rental account. */}
          {showRevenueTabs && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={revenueMode}
              onChange={(_, v) => v && setRevenueMode(v)}
              sx={{ mb: 1.5 }}
            >
              {hasSales && <ToggleButton value="sales" sx={{ px: 2 }}>Sales</ToggleButton>}
              {hasRental && <ToggleButton value="rental" sx={{ px: 2 }}>Rental</ToggleButton>}
            </ToggleButtonGroup>
          )}

          {/* Search Mode Radio Buttons */}
          <RadioGroup
            row
            value={searchMode}
            onChange={(e) => setSearchMode(e.target.value as SearchMode)}
          >
            <FormControlLabel
              value="code"
              control={<Radio size="small" color="primary" />}
              label="Search By Code"
              sx={{ mr: 3 }}
            />
            <FormControlLabel
              value="description"
              control={<Radio size="small" color="primary" />}
              label="Search By Description"
              sx={{ mr: 3 }}
            />
            <FormControlLabel
              value="category"
              control={<Radio size="small" color="primary" />}
              label="Search By Category"
            />
          </RadioGroup>
        </Box>

        {/* Results Table */}
        <TableContainer component={Paper} elevation={0} sx={{ maxHeight: "calc(85vh - 220px)", bgcolor: "background.paper" }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "18%" }}>Code</TableCell>
                <TableCell sx={{ width: "40%" }}>Description</TableCell>
                <TableCell sx={{ width: "15%" }}>Category</TableCell>
                {showCapacity && (
                  <TableCell align="center" sx={{ width: "9%" }}>Capacity</TableCell>
                )}
                <TableCell align="center" sx={{ width: "10%" }}>Balance</TableCell>
                <TableCell align="center" sx={{ width: "10%" }}>Min Qty</TableCell>
                <TableCell align="right" sx={{ width: "12%" }}>{priceColumnLabel}</TableCell>
                {showDealerPrice && (
                  <TableCell align="right" sx={{ width: "12%" }}>Dealer Price</TableCell>
                )}
                {showPoints && (
                  <TableCell align="center" sx={{ width: "8%" }}>Points</TableCell>
                )}
                {isAssetTrackingModeEnabled && (
                  <TableCell align="center" sx={{ width: "10%" }}>Status</TableCell>
                )}
                <TableCell align="center" sx={{ width: "12%" }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={(isAssetTrackingModeEnabled ? 8 : 7) + (showDealerPrice ? 1 : 0) + (showPoints ? 1 : 0) + (showCapacity ? 1 : 0)} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {searchTerm ? `No ${itemType.toLowerCase()}s found matching your search` : `No ${itemType.toLowerCase()}s available`}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredItems.map((item, index) => (
                  <TableRow
                    key={item.id || index}
                    ref={index === activeIndex ? activeRowRef : undefined}
                    hover
                    onClick={() => handleRowClick(item)}
                    onMouseEnter={() => setActiveIndex(index)}
                    selected={index === activeIndex}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell sx={{ fontWeight: 500, color: "text.primary" }}>
                      {item.sku || "-"}
                    </TableCell>
                    <TableCell sx={{ color: "text.primary" }}>{getItemDescription(item)}</TableCell>
                    <TableCell sx={{ color: "text.secondary" }}>
                      {getItemCategory(item)}
                    </TableCell>
                    {showCapacity && (
                      <TableCell align="center" className="tabular-nums" sx={{ color: "text.secondary" }}>
                        {(() => {
                          const v = getCapacity(item);
                          return v != null ? `${v} kW` : "-";
                        })()}
                      </TableCell>
                    )}
                    <TableCell align="center" sx={{ color: "text.primary" }}>
                      {item.quantity !== undefined ? item.quantity : "-"}
                    </TableCell>
                    <TableCell align="center" sx={{ color: "text.secondary" }}>
                      {item.minQuantity !== undefined && item.minQuantity !== null ? item.minQuantity : "-"}
                    </TableCell>
                    <TableCell align="right" className="tabular-nums" sx={{ color: "text.primary", fontWeight: 500 }}>
                      {(() => {
                        const v = getDisplayPrice(item);
                        return v != null ? `$${Number(v).toFixed(2)}` : "-";
                      })()}
                    </TableCell>
                    {showDealerPrice && (
                      <TableCell align="right" className="tabular-nums" sx={{ color: "text.secondary" }}>
                        {(() => {
                          const v = getDealerPrice(item);
                          return v != null ? `$${Number(v).toFixed(2)}` : "-";
                        })()}
                      </TableCell>
                    )}
                    {showPoints && (
                      <TableCell align="center" className="tabular-nums" sx={{ color: "text.primary" }}>
                        {(() => {
                          const v = getPoints(item);
                          return v != null && v > 0 ? v : "-";
                        })()}
                      </TableCell>
                    )}
                    {isAssetTrackingModeEnabled && (
                      <TableCell align="center">
                        <Chip
                          label={(item.status || "N/A").replace(/_/g, " ")}
                          size="small"
                          color={
                            item.status === "instock"
                              ? "success"
                              : item.status === "rental"
                              ? "warning"
                              : "default"
                          }
                          sx={{ textTransform: "capitalize" }}
                        />
                      </TableCell>
                    )}
                    <TableCell align="center">
                      <Box sx={{ display: "flex", gap: 0.5, justifyContent: "center" }}>
                        <IconButton
                          size="small"
                          onClick={(e) => handleAddItem(item, e)}
                          title="Add to document"
                          sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}
                        >
                          <AddIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={(e) => handleViewItem(item, e)}
                          title="View details"
                          sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}
                        >
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Footer with count */}
        <Box
          sx={{
            p: 1.5,
            bgcolor: "background.paper",
            borderTop: "1px solid",
            borderColor: "divider",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Showing {filteredItems.length} of {inventoryItems.length} {itemType.toLowerCase()}s
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click on a row to select a {itemType.toLowerCase()}
          </Typography>
        </Box>
      </DialogContent>

      {/* Product Detail Dialog */}
      <ProductDetailDialog
        open={viewDialogOpen}
        onClose={() => setViewDialogOpen(false)}
        item={selectedViewItem}
      />
    </Dialog>
  );
}
