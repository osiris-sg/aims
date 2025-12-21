"use client";

import React, { useState } from "react";
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
} from "@mui/material";
import { Close as CloseIcon } from "@mui/icons-material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

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

export default function ProductDetailDialog({
  open,
  onClose,
  item,
}: ProductDetailDialogProps) {
  const [tabValue, setTabValue] = useState(0);
  const { isAssetTrackingModeEnabled } = useOrganizationFeatures();
  const itemType = isAssetTrackingModeEnabled ? "Item" : "Product";

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleClose = () => {
    setTabValue(0); // Reset to first tab
    onClose();
  };

  if (!item) return null;

  const getItemDescription = () => {
    return item.description || item.name || item.asset?.name || item.asset?.description || "-";
  };

  const getItemCategory = () => {
    return item.categoryName || item.category || item.asset?.category?.name || "-";
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: "60vh",
          maxHeight: "80vh",
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

        {/* Details Tab */}
        <TabPanel value={tabValue} index={1}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
              Additional Details
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Details content will be displayed here.
            </Typography>
          </Paper>
        </TabPanel>

        {/* Information Tab */}
        <TabPanel value={tabValue} index={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
              {itemType} Information
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Information content will be displayed here.
            </Typography>
          </Paper>
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
