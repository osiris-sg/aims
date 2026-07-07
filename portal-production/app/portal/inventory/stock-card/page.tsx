"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Box,
  TextField,
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
  Card,
  CardContent,
  Button,
} from "@mui/material";
import {
  Search as SearchIcon,
  Visibility as ViewIcon,
} from "@mui/icons-material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import ProductDetailDialog from "@/containers/DocumentTemplates/components/ProductDetailDialog";

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

export default function InventoryStockCardPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedViewItem, setSelectedViewItem] = useState<InventoryItem | null>(null);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const ITEMS_PER_PAGE = 50;

  const { isAssetTrackingModeEnabled } = useOrganizationFeatures();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const itemType = isAssetTrackingModeEnabled ? "Item" : "Product";

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch items with server-side search and pagination
  const fetchItems = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const assetsResponse = await request(
        { path: "/assets", method: "POST" },
        // No searchMode → backend searches all fields (code + name + description + category).
        { page, limit: ITEMS_PER_PAGE, search: debouncedSearch },
        token
      );
      const assets = assetsResponse?.data?.docs || [];
      const total = assetsResponse?.data?.totalDocuments || 0;
      const mappedAssets = assets.map((asset: any) => ({
        id: asset.id,
        sku: asset.skuKey,
        name: asset.name,
        description: asset.description || asset.name,
        category: asset.category?.name || "",
        categoryName: asset.category?.name || "",
        quantity: asset.quantity ?? asset.stockCount ?? 0,
        minQuantity: asset.minQuantity,
        unitPrice: asset.price,
        status: asset.quantity > 0 ? "available" : "out_of_stock",
        assetId: asset.id,
        asset: {
          id: asset.id,
          name: asset.name,
          description: asset.description,
          category: asset.category,
        },
      }));

      setInventoryItems(mappedAssets);
      setTotalItems(total);
    } catch (error) {
      console.error("Error fetching items:", error);
    } finally {
      setLoading(false);
    }
  }, [organizationId, getToken, page, debouncedSearch]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleViewItem = (item: InventoryItem) => {
    setSelectedViewItem(item);
    setViewDialogOpen(true);
  };

  const filteredItems = inventoryItems;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  const getItemDescription = (item: InventoryItem) => {
    return item.description || item.name || item.asset?.name || item.asset?.description || "-";
  };

  const getItemCategory = (item: InventoryItem) => {
    return item.categoryName || item.category || item.asset?.category?.name || "-";
  };

  return (
    <MainCard>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            Stock Card
          </Typography>
          <Typography variant="body2" color="text.secondary">
            View detailed stock transaction history for {itemType.toLowerCase()}s
          </Typography>
        </CardContent>
      </Card>

      {/* Search Section */}
      <Box
        sx={{
          p: 2,
          bgcolor: "background.paper",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          mb: 2,
        }}
      >
        {/* Search Input */}
        <TextField
          fullWidth
          placeholder={`Search ${itemType.toLowerCase()}s...`}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          size="small"
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

      </Box>

      {/* Results Table */}
      <TableContainer component={Paper} elevation={0} sx={{ maxHeight: "calc(100vh - 400px)" }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: "15%" }}>Code</TableCell>
              <TableCell sx={{ width: "35%" }}>Description</TableCell>
              <TableCell sx={{ width: "15%" }}>Category</TableCell>
              <TableCell align="center" sx={{ width: "10%" }}>Balance</TableCell>
              <TableCell align="center" sx={{ width: "10%" }}>Min Qty</TableCell>
              <TableCell align="right" sx={{ width: "10%" }}>Unit Price</TableCell>
              {isAssetTrackingModeEnabled && (
                <TableCell align="center" sx={{ width: "10%" }}>Status</TableCell>
              )}
              <TableCell align="center" sx={{ width: "8%" }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={isAssetTrackingModeEnabled ? 8 : 7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">Loading...</Typography>
                </TableCell>
              </TableRow>
            ) : filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAssetTrackingModeEnabled ? 8 : 7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    {searchTerm
                      ? `No ${itemType.toLowerCase()}s found matching your search`
                      : `No ${itemType.toLowerCase()}s available`}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredItems.map((item, index) => (
                <TableRow key={item.id || index} hover>
                  <TableCell sx={{ fontWeight: 500, color: "text.primary" }}>
                    {item.sku || "-"}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{getItemDescription(item)}</TableCell>
                  <TableCell>
                    <Chip
                      label={getItemCategory(item)}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="center">
                    {item.quantity !== undefined ? item.quantity : "-"}
                  </TableCell>
                  <TableCell align="center">
                    {item.minQuantity !== undefined && item.minQuantity !== null
                      ? item.minQuantity
                      : "-"}
                  </TableCell>
                  <TableCell align="right">
                    {item.unitPrice != null ? `$${item.unitPrice.toFixed(2)}` : "-"}
                  </TableCell>
                  {isAssetTrackingModeEnabled && (
                    <TableCell align="center">
                      <Chip
                        label={item.status || "N/A"}
                        size="small"
                        color={
                          item.status === "instock"
                            ? "success"
                            : item.status === "rental"
                            ? "warning"
                            : "default"
                        }
                        sx={{
                          fontWeight: 500,
                          fontSize: "0.7rem",
                          textTransform: "capitalize",
                        }}
                      />
                    </TableCell>
                  )}
                  <TableCell align="center">
                    <IconButton
                      size="small"
                      color="secondary"
                      onClick={() => handleViewItem(item)}
                      title="View details"
                    >
                      <ViewIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Footer with pagination */}
      <Box
        sx={{
          p: 1.5,
          bgcolor: "background.paper",
          border: 1,
          borderColor: "divider",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mt: 2,
          borderRadius: 1,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Showing {(page - 1) * ITEMS_PER_PAGE + 1}-{Math.min(page * ITEMS_PER_PAGE, totalItems)} of {totalItems} {itemType.toLowerCase()}s
        </Typography>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Button size="small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            Previous
          </Button>
          <Typography variant="body2">
            Page {page} of {totalPages || 1}
          </Typography>
          <Button size="small" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </Box>
      </Box>

      {/* Product Detail Dialog */}
      <ProductDetailDialog
        open={viewDialogOpen}
        onClose={() => setViewDialogOpen(false)}
        item={selectedViewItem}
      />
    </MainCard>
  );
}
