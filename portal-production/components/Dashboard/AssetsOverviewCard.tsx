"use client";
import React, { useEffect } from "react";

import { Box, Card, CardContent, Typography, CircularProgress, Alert } from "@mui/material";
import InventoryIcon from "@mui/icons-material/Inventory";
import useAssetsOverview from "@/hooks/useAssetsOverview";

export default function AssetsOverviewCard() {
  const { assetsData, loading, error } = useAssetsOverview();

  useEffect(() => {
    console.log("🔍 Assets data:", assetsData);
  }, [assetsData]);

  return (
    <Card sx={{ height: "100%", display: "flex", flexDirection: "column", backgroundColor: "white" }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <InventoryIcon sx={{ fontSize: 32, mr: 1, color: "primary.main" }} />
          <Typography variant="h6" component="h2">
            Assets In Stock
          </Typography>
        </Box>

        {loading && <CircularProgress />}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && !error && assetsData && (
          <Box>
            <Typography variant="h3" sx={{ mb: 1, fontWeight: "bold", color: "primary.main" }}>
              {assetsData.data.totalInStock}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Total Assets In Stock
            </Typography>

            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>Top Categories:</strong>
              </Typography>
              {assetsData.data.topCategories?.map((category, index) => (
                <Typography key={index} variant="body2" color="text.secondary">
                  {category.name}: {category.count} items
                </Typography>
              ))}
            </Box>

            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>Low Stock: {assetsData.data.lowStockCount} items</strong>
              </Typography>
              {assetsData.data.lowStockAssets?.map((asset, index) => (
                <Typography key={index} variant="body2" color="text.secondary" sx={{ fontSize: "0.875rem" }}>
                  • {asset.name} ({asset.skuKey}): {asset.totalQuantity} qty
                </Typography>
              ))}
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
