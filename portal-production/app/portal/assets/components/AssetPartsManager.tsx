import React, { useState, useEffect } from "react";
import { Box, Typography, Button, Card, CardContent, Avatar, IconButton, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Grid, Alert, Divider, Switch, FormControlLabel, Tooltip } from "@mui/material";
import { Add, Edit, Delete, Visibility, AccountTree } from "@mui/icons-material";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";
import AddPartDrawer from "./AddPartDrawer";

interface AssetPart {
  id: string;
  name: string;
  skuKey: string;
  image?: string;
  categoryId: string;
  instockInventoryCount: number;
  isTracked?: boolean;
  autoCreateOnParentUnit?: boolean;
  category?: { name: string };
  subAssets?: AssetPart[];
}

interface AssetPartsManagerProps {
  assetId: string;
  assetName: string;
  onRefresh?: () => void;
}

const AssetPartsManager: React.FC<AssetPartsManagerProps> = ({ assetId, assetName, onRefresh }) => {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [parts, setParts] = useState<AssetPart[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [partToDelete, setPartToDelete] = useState<AssetPart | null>(null);
  const [addPartDrawerOpen, setAddPartDrawerOpen] = useState(false);
  const [targetParentAsset, setTargetParentAsset] = useState<{ id: string; name: string } | null>(null);

  const fetchParts = async () => {
    if (!organization?.id) return;

    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request({ path: `/assets/${assetId}/parts`, method: "GET" }, {}, token);

      if (response.success) {
        setParts(response.data);
      }
    } catch (error) {
      console.error("Error fetching asset parts:", error);
    } finally {
      setLoading(false);
    }
  };

  const removePart = async () => {
    if (!partToDelete) return;

    try {
      const token = await getToken();
      if (!token) return;

      // Remove the part by setting its parentAssetId to null
      const response = await request(
        { path: `/assets/parent`, method: "PUT" },
        {
          assetId: partToDelete.id,
          parentAssetId: null, // This makes it a root asset again
        },
        token
      );

      if (response.success) {
        setDeleteDialogOpen(false);
        setPartToDelete(null);
        fetchParts();
        onRefresh?.();
      }
    } catch (error) {
      console.error("Error removing part:", error);
    }
  };

  useEffect(() => {
    fetchParts();
  }, [assetId, organization?.id]);

  // Enforceable hierarchy: flip the child asset's autoCreateOnParentUnit flag.
  // When ON, every new unit of the parent silently spawns a 'pending'
  // placeholder unit of this part, linked to that specific parent unit.
  const toggleAutoCreate = async (part: AssetPart, enabled: boolean) => {
    try {
      const token = await getToken();
      if (!token) return;
      const response = await request(
        { path: `/assets/update`, method: "PUT" },
        { id: part.id, autoCreateOnParentUnit: enabled },
        token
      );
      if (response.success) fetchParts();
    } catch (error) {
      console.error("Error updating auto-create flag:", error);
    }
  };

  const renderPartCard = (part: AssetPart, level: number = 0) => (
    <Card
      key={part.id}
      sx={{
        mb: 2,
        ml: level * 2,
        border: level > 0 ? "1px dashed" : "1px solid",
        borderColor: level > 0 ? "divider" : "grey.300",
      }}
    >
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          {level > 0 && (
            <Typography variant="caption" color="text.secondary">
              {"└─ ".repeat(level)}
            </Typography>
          )}

          <Avatar src={part.image ? `${process.env.NEXT_PUBLIC_RESOURCE_URL}${part.image}` : undefined} sx={{ width: 48, height: 48, borderRadius: 1 }}>
            {part.name.substring(0, 2).toUpperCase()}
          </Avatar>

          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" gutterBottom>
              {part.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              SKU: {part.skuKey}
            </Typography>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <Chip label={part.category?.name || "Unknown Category"} size="small" variant="outlined" />
              <Chip label={`Stock: ${part.instockInventoryCount || 0}`} size="small" variant="outlined" />
              {level > 0 && <Chip label={`Level ${level} Part`} size="small" variant="outlined" />}
            </Box>
            {/* Auto-create toggle: only tracked parts can auto-create pending
                placeholder units when a parent unit is created. */}
            <Tooltip
              title={
                part.isTracked
                  ? "When ON, creating a unit of the parent auto-creates a 'pending' placeholder unit of this part, linked to that specific parent unit."
                  : "Unavailable — this part is not tracked (no individual units). Enable tracking on this asset first; placeholders are only auto-created for tracked child assets."
              }
              placement="top-start"
            >
              <span>
                <FormControlLabel
                  sx={{ mt: 0.5 }}
                  control={
                    <Switch
                      size="small"
                      checked={!!part.autoCreateOnParentUnit}
                      disabled={!part.isTracked}
                      onChange={(e) => toggleAutoCreate(part, e.target.checked)}
                    />
                  }
                  label={
                    <Typography variant="caption" color={part.isTracked ? "text.primary" : "text.disabled"}>
                      Auto-create per parent unit
                    </Typography>
                  }
                />
              </span>
            </Tooltip>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <IconButton size="small" onClick={() => router.push(`${ROUTES.ASSETS}/${part.skuKey}`)} sx={{ color: "warning.main" }} title="View Asset">
              <Visibility />
            </IconButton>

            <IconButton size="small" onClick={() => router.push(`${ROUTES.ADD_ASSET}?id=${part.id}`)} sx={{ color: "primary.main" }} title="Edit Asset">
              <Edit />
            </IconButton>

            <IconButton
              size="small"
              onClick={() => {
                setTargetParentAsset({ id: part.id, name: part.name });
                setAddPartDrawerOpen(true);
              }}
              sx={{ color: "success.main" }}
              title="Add Sub-Part"
            >
              <Add />
            </IconButton>

            <IconButton
              size="small"
              onClick={() => {
                setPartToDelete(part);
                setDeleteDialogOpen(true);
              }}
              sx={{ color: "error.main" }}
              title="Delete Part"
            >
              <Delete />
            </IconButton>
          </Box>
        </Box>

        {/* Render sub-parts recursively */}
        {part.subAssets && part.subAssets.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Sub-parts:
            </Typography>
            {part.subAssets.map((subPart) => renderPartCard(subPart, level + 1))}
          </Box>
        )}
      </CardContent>
    </Card>
  );

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="h6" gutterBottom>
            Asset Parts & Components
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage parts and sub-assemblies for {assetName}
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => {
            setTargetParentAsset({ id: assetId, name: assetName });
            setAddPartDrawerOpen(true);
          }}
        >
          Add Part
        </Button>
      </Box>

      {loading ? (
        <Typography>Loading parts...</Typography>
      ) : parts.length === 0 ? (
        <Alert severity="info" sx={{ mt: 2 }}>
          <Typography variant="body2">This asset doesn't have any parts yet. Click "Add Part" to create sub-components.</Typography>
        </Alert>
      ) : (
        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {parts.length} part{parts.length !== 1 ? "s" : ""} found
          </Typography>
          {parts.map((part) => renderPartCard(part))}
        </Box>
      )}

      {/* Remove Part Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Remove Asset Part</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to remove "{partToDelete?.name}" from this asset? The asset will become a standalone root asset again.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={removePart} color="warning" variant="contained">
            Remove Part
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Part Drawer */}
      {targetParentAsset && (
        <AddPartDrawer
          open={addPartDrawerOpen}
          onClose={() => {
            setAddPartDrawerOpen(false);
            setTargetParentAsset(null);
          }}
          parentAssetId={targetParentAsset.id}
          parentAssetName={targetParentAsset.name}
          onPartAdded={() => {
            fetchParts();
            onRefresh?.();
            setTargetParentAsset(null);
          }}
        />
      )}
    </Box>
  );
};

export default AssetPartsManager;
