import React, { useState } from "react";
import { Box, Typography, IconButton, Avatar, Chip, Collapse, Table, TableBody, TableCell, TableHead, TableRow, Button, Dialog, DialogTitle, DialogContent, DialogActions } from "@mui/material";
import { ExpandMore, ChevronRight, Add, Visibility, ModeEdit, Delete } from "@mui/icons-material";
import AddPartDrawer from "./AddPartDrawer";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";

interface AssetWithChildren {
  id: string;
  name: string;
  skuKey: string;
  image?: string;
  categoryId: string;
  parentAssetId?: string;
  instockInventoryCount: number;
  subAssets?: AssetWithChildren[];
  category?: { name: string };
}

interface AssetRowProps {
  asset: AssetWithChildren;
  level: number;
  onView: (skuKey: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onAddPart: (parentId: string) => void;
  categories: any[];
  onOpenAddPartDrawer: (parentId: string, parentName: string) => void;
  onOpenRemoveDialog: (id: string, name: string, level: number) => void;
}

const AssetRow: React.FC<AssetRowProps> = ({ asset, level, onView, onEdit, onDelete, onAddPart, categories, onOpenAddPartDrawer, onOpenRemoveDialog }) => {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = asset.subAssets && asset.subAssets.length > 0;

  return (
    <>
      <TableRow>
        {/* Hierarchy Indicator & Name */}
        <TableCell>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              paddingLeft: `${level * 2}rem`,
              gap: 1,
            }}
          >
            {hasChildren ? (
              <IconButton size="small" onClick={() => setExpanded(!expanded)} sx={{ p: 0.5 }}>
                {expanded ? <ExpandMore /> : <ChevronRight />}
              </IconButton>
            ) : (
              <Box sx={{ width: 32 }} /> // Spacer for alignment
            )}

            {level > 0 && (
              <Typography variant="caption" color="text.secondary">
                └─
              </Typography>
            )}

            <Avatar src={asset.image ? `${process.env.NEXT_PUBLIC_RESOURCE_URL}${asset.image}` : undefined} sx={{ width: 32, height: 32, borderRadius: 1 }}>
              {asset.name.substring(0, 2).toUpperCase()}
            </Avatar>

            <Box>
              <Typography variant="body2" fontWeight={level === 0 ? 600 : 400}>
                {asset.name}
              </Typography>
              {level > 0 && (
                <Typography variant="caption" color="text.secondary">
                  Part of parent asset
                </Typography>
              )}
            </Box>
          </Box>
        </TableCell>

        {/* SKU Key */}
        <TableCell>
          <Typography variant="body2" fontFamily="monospace">
            {asset.skuKey}
          </Typography>
        </TableCell>

        {/* Category */}
        <TableCell>
          <Typography variant="body2">{categories.find((cat) => cat.id === asset.categoryId)?.name || "N/A"}</Typography>
        </TableCell>

        {/* Stock Count */}
        <TableCell>
          <Chip label={asset.instockInventoryCount || 0} size="small" variant="outlined" />
        </TableCell>

        {/* Hierarchy Level */}
        <TableCell>
          <Chip label={level === 0 ? "Root Asset" : `Level ${level} Part`} size="small" color={level === 0 ? "success" : "default"} variant="outlined" />
        </TableCell>

        {/* Actions */}
        <TableCell>
          <Box sx={{ display: "flex", gap: 0.5 }}>
            <IconButton size="small" onClick={() => onView(asset.skuKey)} sx={{ color: "warning.main" }}>
              <Visibility fontSize="small" />
            </IconButton>

            <IconButton size="small" onClick={() => onEdit(asset.id)} sx={{ color: "primary.main" }}>
              <ModeEdit fontSize="small" />
            </IconButton>

            <IconButton size="small" onClick={() => onOpenAddPartDrawer(asset.id, asset.name)} sx={{ color: "success.main" }} title="Add Part">
              <Add fontSize="small" />
            </IconButton>

            <IconButton size="small" onClick={() => onOpenRemoveDialog(asset.id, asset.name, level)} sx={{ color: "error.main" }}>
              <Delete fontSize="small" />
            </IconButton>
          </Box>
        </TableCell>
      </TableRow>

      {/* Render children when expanded */}
      {hasChildren && (
        <TableRow>
          <TableCell colSpan={6} sx={{ padding: 0, border: "none" }}>
            <Collapse in={expanded}>
              {asset.subAssets?.map((child) => (
                <AssetRow key={child.id} asset={child} level={level + 1} onView={onView} onEdit={onEdit} onDelete={onDelete} onAddPart={onAddPart} categories={categories} onOpenAddPartDrawer={onOpenAddPartDrawer} onOpenRemoveDialog={onOpenRemoveDialog} />
              ))}
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
};

interface AssetHierarchyTableProps {
  assets: AssetWithChildren[];
  categories: any[];
  loading?: boolean;
  onView: (skuKey: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onAddPart: (parentId: string) => void;
  onAddRootAsset: () => void;
  onRefresh: () => void;
}

const AssetHierarchyTable: React.FC<AssetHierarchyTableProps> = ({ assets, categories, loading = false, onView, onEdit, onDelete, onAddPart, onAddRootAsset, onRefresh }) => {
  const { getToken } = useAuth();
  const [addPartDrawerOpen, setAddPartDrawerOpen] = useState(false);
  const [targetParentAsset, setTargetParentAsset] = useState<{ id: string; name: string } | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [assetToRemove, setAssetToRemove] = useState<{ id: string; name: string; level: number } | null>(null);

  const handleRemoveAsset = async () => {
    if (!assetToRemove) return;

    try {
      const token = await getToken();
      if (!token) return;

      if (assetToRemove.level === 0) {
        // Root asset - use the original delete function
        onDelete(assetToRemove.id, assetToRemove.name);
      } else {
        // Part asset - remove parent relationship
        const response = await request(
          { path: `/assets/parent`, method: "PUT" },
          {
            assetId: assetToRemove.id,
            parentAssetId: null, // This makes it a root asset again
          },
          token
        );

        if (response.success) {
          toast.success(`${assetToRemove.name} removed from parent successfully!`);
          onRefresh();
        }
      }
    } catch (error) {
      console.error("Error removing asset:", error);
      toast.error("Failed to remove asset");
    } finally {
      setRemoveDialogOpen(false);
      setAssetToRemove(null);
    }
  };

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Typography variant="h6">Asset Hierarchy</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => {
            // For root assets, we'll use a special identifier
            setTargetParentAsset({ id: "root", name: "Root Level" });
            setAddPartDrawerOpen(true);
          }}
        >
          Add Root Asset
        </Button>
      </Box>

      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Asset Name</TableCell>
            <TableCell>SKU Key</TableCell>
            <TableCell>Category</TableCell>
            <TableCell>Stock</TableCell>
            <TableCell>Level</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={6} align="center">
                <Typography>Loading...</Typography>
              </TableCell>
            </TableRow>
          ) : assets.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} align="center">
                <Typography color="text.secondary">No assets found</Typography>
              </TableCell>
            </TableRow>
          ) : (
            assets.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                level={0}
                onView={onView}
                onEdit={onEdit}
                onDelete={onDelete}
                onAddPart={onAddPart}
                categories={categories}
                onOpenAddPartDrawer={(parentId, parentName) => {
                  setTargetParentAsset({ id: parentId, name: parentName });
                  setAddPartDrawerOpen(true);
                }}
                onOpenRemoveDialog={(id, name, level) => {
                  setAssetToRemove({ id, name, level });
                  setRemoveDialogOpen(true);
                }}
              />
            ))
          )}
        </TableBody>
      </Table>

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
            onRefresh();
            setTargetParentAsset(null);
          }}
        />
      )}

      {/* Remove Asset Dialog */}
      <Dialog open={removeDialogOpen} onClose={() => setRemoveDialogOpen(false)}>
        <DialogTitle>{assetToRemove?.level === 0 ? "Delete Root Asset" : "Remove Asset Part"}</DialogTitle>
        <DialogContent>
          <Typography>{assetToRemove?.level === 0 ? `Are you sure you want to permanently delete "${assetToRemove?.name}"? This action cannot be undone.` : `Are you sure you want to remove "${assetToRemove?.name}" from its parent? The asset will become a standalone root asset.`}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleRemoveAsset} color={assetToRemove?.level === 0 ? "error" : "warning"} variant="contained">
            {assetToRemove?.level === 0 ? "Delete" : "Remove"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AssetHierarchyTable;
