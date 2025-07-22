import React, { useState, useEffect } from "react";
import { Autocomplete, TextField, Box, Typography, Avatar, Chip, Checkbox, FormControlLabel } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface Asset {
  id: string;
  name: string;
  skuKey: string;
  image?: string;
  parentAssetId?: string;
}

interface ParentAssetSelectorProps {
  value?: string;
  onChange: (parentAssetId: string | null) => void;
  excludeAssetId?: string; // Don't show the current asset in the list
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
}

const ParentAssetSelector: React.FC<ParentAssetSelectorProps> = ({ value, onChange, excludeAssetId, disabled = false, error = false, helperText }) => {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [isStandalone, setIsStandalone] = useState(!value);

  const fetchAssets = async () => {
    if (!organization?.id) return;

    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        { path: "/assets", method: "POST" },
        {
          page: 1,
          limit: 100, // Get more assets for selection
          search: "",
          filters: {},
          organizationId: organization.id,
        },
        token
      );

      if (response.success) {
        // Filter out the current asset and its descendants to prevent circular references
        const filteredAssets = response.data.docs.filter((asset: Asset) => asset.id !== excludeAssetId);
        setAssets(filteredAssets);
      }
    } catch (error) {
      console.error("Error fetching assets:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, [organization?.id, excludeAssetId]);

  const selectedAsset = assets.find((asset) => asset.id === value);

  const handleAssetChange = (newValue: Asset | null) => {
    onChange(newValue?.id || null);
  };

  const handleStandaloneChange = (checked: boolean) => {
    setIsStandalone(checked);
    if (checked) {
      onChange(null);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <FormControlLabel control={<Checkbox checked={isStandalone} onChange={(e) => handleStandaloneChange(e.target.checked)} disabled={disabled} />} label="This is a standalone asset (not a part of another asset)" />

      {!isStandalone && (
        <Autocomplete
          value={selectedAsset || null}
          onChange={(_, newValue) => handleAssetChange(newValue)}
          options={assets}
          loading={loading}
          disabled={disabled}
          getOptionLabel={(option) => `${option.name} (${option.skuKey})`}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderInput={(params) => <TextField {...params} label="Parent Asset" placeholder="Search for a parent asset..." error={error} helperText={helperText || "Select the asset this will be a part of"} />}
          renderOption={(props, option) => (
            <Box component="li" {...props} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <Avatar src={option.image ? `${process.env.NEXT_PUBLIC_RESOURCE_URL}${option.image}` : undefined} sx={{ width: 32, height: 32, borderRadius: 1 }}>
                {option.name.substring(0, 2).toUpperCase()}
              </Avatar>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" fontWeight={500}>
                  {option.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  SKU: {option.skuKey}
                </Typography>
              </Box>
              {option.parentAssetId && <Chip label="Has Parent" size="small" variant="outlined" color="secondary" />}
            </Box>
          )}
          noOptionsText="No assets found"
        />
      )}

      {selectedAsset && (
        <Box
          sx={{
            p: 2,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            backgroundColor: "grey.50",
          }}
        >
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Selected Parent Asset:
          </Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Avatar src={selectedAsset.image ? `${process.env.NEXT_PUBLIC_RESOURCE_URL}${selectedAsset.image}` : undefined} sx={{ width: 40, height: 40, borderRadius: 1 }}>
              {selectedAsset.name.substring(0, 2).toUpperCase()}
            </Avatar>
            <Box>
              <Typography variant="body2" fontWeight={500}>
                {selectedAsset.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                SKU: {selectedAsset.skuKey}
              </Typography>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default ParentAssetSelector;
