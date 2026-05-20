"use client";

import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  TextField,
  RadioGroup,
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
  uom?: string;
  status?: string;
  assetId?: string;
  asset?: {
    id: string;
    name: string;
    description?: string;
    uom?: string;
    price?: number;
    costPrice?: number;
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
}

type SearchMode = "code" | "description" | "category";

export default function StockCardDialog({
  open,
  onClose,
  onSelectItem,
  inventoryItems,
  priceMode = "selling",
}: StockCardDialogProps) {
  const showCost = priceMode === "cost";
  const priceColumnLabel = showCost ? "Cost Price" : "Unit Price";
  const getDisplayPrice = (it: InventoryItem) =>
    showCost
      ? (it.costPrice ?? it.asset?.costPrice ?? null)
      : (it.unitPrice ?? it.asset?.price ?? null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("code");
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedViewItem, setSelectedViewItem] = useState<InventoryItem | null>(null);
  const { isAssetTrackingModeEnabled } = useOrganizationFeatures();
  const itemType = isAssetTrackingModeEnabled ? "Item" : "Product";

  const handleViewItem = (item: InventoryItem, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click
    setSelectedViewItem(item);
    setViewDialogOpen(true);
  };

  const handleAddItem = (item: InventoryItem, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click
    onSelectItem(item);
    setSearchTerm("");
    onClose();
  };

  // Filter inventory items based on search term and mode
  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) {
      return inventoryItems;
    }

    const term = searchTerm.toLowerCase();

    return inventoryItems.filter((item) => {
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
  }, [inventoryItems, searchTerm, searchMode]);

  const handleRowClick = (item: InventoryItem) => {
    onSelectItem(item);
    setSearchTerm("");
    onClose();
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
                <TableCell align="center" sx={{ width: "10%" }}>Balance</TableCell>
                <TableCell align="center" sx={{ width: "10%" }}>Min Qty</TableCell>
                <TableCell align="right" sx={{ width: "12%" }}>{priceColumnLabel}</TableCell>
                {isAssetTrackingModeEnabled && (
                  <TableCell align="center" sx={{ width: "10%" }}>Status</TableCell>
                )}
                <TableCell align="center" sx={{ width: "12%" }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAssetTrackingModeEnabled ? 8 : 7} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {searchTerm ? `No ${itemType.toLowerCase()}s found matching your search` : `No ${itemType.toLowerCase()}s available`}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredItems.map((item, index) => (
                  <TableRow
                    key={item.id || index}
                    hover
                    onClick={() => handleRowClick(item)}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell sx={{ fontWeight: 500, color: "text.primary" }}>
                      {item.sku || "-"}
                    </TableCell>
                    <TableCell sx={{ color: "text.primary" }}>{getItemDescription(item)}</TableCell>
                    <TableCell sx={{ color: "text.secondary" }}>
                      {getItemCategory(item)}
                    </TableCell>
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
