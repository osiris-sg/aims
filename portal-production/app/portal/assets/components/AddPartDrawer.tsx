import React, { useState, useEffect } from "react";
import { Drawer, Box, Typography, Button, Autocomplete, TextField, CircularProgress, Alert, Stack, Divider, IconButton } from "@mui/material";
import { Close, Add } from "@mui/icons-material";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";

interface Asset {
  id: string;
  name: string;
  skuKey: string;
  image?: string;
  categoryId: string;
  parentAssetId?: string;
  category?: { name: string };
}

interface AddPartDrawerProps {
  open: boolean;
  onClose: () => void;
  parentAssetId: string;
  parentAssetName: string;
  onPartAdded: () => void;
}

const AddPartDrawer: React.FC<AddPartDrawerProps> = ({ open, onClose, parentAssetId, parentAssetName, onPartAdded }) => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open) {
      fetchAvailableAssets();
    }
  }, [open]);

  const fetchAvailableAssets = async () => {
    if (!organization?.id) return;

    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      // Fetch all assets
      const response = await request(
        {
          path: `/assets`,
          method: "POST",
        },
        {
          page: 1,
          limit: 1000, // Get all assets
          search: "",
          filters: {},
          organizationId: organization.id,
        },
        token
      );

      if (response.success) {
        let availableAssets;

        if (parentAssetId === "root") {
          // For root conversion, show only assets that currently have a parent
          availableAssets = response.data.docs.filter(
            (asset: Asset) => asset.parentAssetId // Only assets with parents
          );
        } else {
          // For adding parts, show only root assets (no parent) excluding current parent
          availableAssets = response.data.docs.filter(
            (asset: Asset) =>
              !asset.parentAssetId && // Only root assets (no parent)
              asset.id !== parentAssetId // Exclude the current parent asset
          );
        }

        setAssets(availableAssets);
      }
    } catch (error) {
      console.error("Error fetching assets:", error);
      toast.error("Failed to fetch assets");
    } finally {
      setLoading(false);
    }
  };

  const handleAddPart = async () => {
    if (!selectedAsset) return;

    setAdding(true);
    try {
      const token = await getToken();
      if (!token) return;

      // Special case: if parentAssetId is "root", we're making this asset a root asset
      const finalParentAssetId = parentAssetId === "root" ? null : parentAssetId;

      const response = await request(
        {
          path: `/assets/parent`,
          method: "PUT",
        },
        {
          assetId: selectedAsset.id,
          parentAssetId: finalParentAssetId,
        },
        token
      );

      if (response.success) {
        const actionText = parentAssetId === "root" ? "converted to root asset" : "added as part";
        toast.success(`${selectedAsset.name} ${actionText} successfully!`);
        onPartAdded();
        onClose();
        setSelectedAsset(null);
      }
    } catch (error) {
      console.error("Error adding part:", error);
      toast.error("Failed to add part");
    } finally {
      setAdding(false);
    }
  };

  const handleClose = () => {
    setSelectedAsset(null);
    onClose();
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClose}
      PaperProps={{
        sx: { width: 480, p: 0 },
      }}
    >
      <Box sx={{ p: 3, height: "100%", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
          <Typography variant="h6">Add Part to Asset</Typography>
          <IconButton onClick={handleClose} size="small">
            <Close />
          </IconButton>
        </Box>

        <Divider sx={{ mb: 3 }} />

        {/* Parent Asset Info */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {parentAssetId === "root" ? "Converting asset to:" : "Adding part to:"}
          </Typography>
          <Typography variant="h6" color="primary">
            {parentAssetName}
          </Typography>
        </Box>

        {/* Asset Selection */}
        <Stack spacing={3} sx={{ flex: 1 }}>
          <Box>
            <Typography variant="body1" sx={{ mb: 2, fontWeight: 500 }}>
              Select Asset to Add as Part
            </Typography>

            {loading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Autocomplete
                options={assets}
                getOptionLabel={(option) => `${option.name} (${option.skuKey})`}
                value={selectedAsset}
                onChange={(_, newValue) => setSelectedAsset(newValue)}
                renderOption={(props, option) => (
                  <Box component="li" {...props}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                      <Box>
                        <Typography variant="body2">{option.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          SKU: {option.skuKey} • Category: {option.category?.name || "N/A"}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                )}
                renderInput={(params) => <TextField {...params} placeholder="Search and select an asset..." variant="outlined" fullWidth />}
                noOptionsText={assets.length === 0 ? "No available assets (all assets are already parts of other assets)" : "No assets found"}
              />
            )}
          </Box>

          {/* Information Alert */}
          <Alert severity="info" sx={{ mt: 2 }}>
            {parentAssetId === "root"
              ? "Only assets that are currently parts of other assets can be converted to root assets. Root assets will become independent assets."
              : "Only root assets (assets without parents) are available to be added as parts. Once an asset becomes a part, it will be moved under this parent asset."}
          </Alert>

          {/* Selected Asset Preview */}
          {selectedAsset && (
            <Box
              sx={{
                p: 2,
                border: "1px solid",
                borderColor: "grey.300",
                borderRadius: 1,
                backgroundColor: "grey.50",
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Selected Asset:
              </Typography>
              <Typography variant="body1" fontWeight={500}>
                {selectedAsset.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                SKU: {selectedAsset.skuKey}
              </Typography>
            </Box>
          )}
        </Stack>

        {/* Action Buttons */}
        <Box sx={{ display: "flex", gap: 2, mt: 3 }}>
          <Button variant="outlined" onClick={handleClose} disabled={adding} fullWidth>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleAddPart} disabled={!selectedAsset || adding} startIcon={adding ? <CircularProgress size={16} /> : <Add />} fullWidth>
            {adding ? "Adding..." : "Add Part"}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
};

export default AddPartDrawer;
