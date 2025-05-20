"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import { Box, Button, Typography, Avatar, Grid, Paper, Card, Skeleton, Stack, IconButton, useTheme } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Table from "@/components/Table";

export default function ViewAssetPage({ params }: { params: { skuKey: string } }) {
  const router = useRouter();
  const theme = useTheme();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;
  const [asset, setAsset] = useState<any>(null);
  const [category, setCategory] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inventoriesStatusCounts, setInventoriesStatusCounts] = useState<Record<string, number>>({
    INSTOCK: 0,
    RENTAL: 0,
    RESERVED: 0,
    MAINTAINANCE: 0,
    SOLD: 0,
  });
  const [inventories, setInventories] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);

  const fetchAsset = async () => {
    if (!organizationId) return;
    setIsLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/assets/skuKey/${params.skuKey}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        setAsset(response.data);
      }
    } catch (error) {
      console.error("Error fetching asset:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchInventories = async () => {
    if (!organizationId || !asset?.id) return;

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/inventories/asset/${asset.id}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        setInventoriesStatusCounts(response.data.statusCounts);
        setInventories(response.data.inventories || []);
      }
    } catch (error) {
      console.error("Error fetching inventories:", error);
    }
  };

  const fetchDocuments = async () => {
    if (!organizationId || !inventories.length) return;
    setIsLoadingDocuments(true);

    try {
      const token = await getToken();
      if (!token) return;

      const allDocuments = [];
      for (const inventory of inventories) {
        const response = await request(
          {
            path: `/documents/inventory/${inventory.id}`,
            method: "GET",
          },
          {},
          token
        );

        if (response.success && Array.isArray(response.data)) {
          // Filter documents for this inventory
          const inventoryDocuments = response.data.filter((doc: { inventoryId: string }) => doc.inventoryId === inventory.id);
          allDocuments.push(...inventoryDocuments);
        }
      }
      setDocuments(allDocuments);
    } catch (error) {
      console.error("Error fetching documents:", error);
    } finally {
      setIsLoadingDocuments(false);
    }
  };

  useEffect(() => {
    fetchAsset();
  }, [organizationId, params.skuKey]);

  useEffect(() => {
    if (asset?.id) {
      fetchInventories();
    }
  }, [asset?.id]);

  useEffect(() => {
    if (inventories.length > 0) {
      fetchDocuments();
    }
  }, [inventories]);

  const handleDelete = async () => {
    if (!organizationId) return;
    setIsLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/assets/skuKey/${params.skuKey}`,
          method: "DELETE",
        },
        {},
        token
      );

      if (response.success) {
        router.push("/src/assets");
      }
    } catch (error) {
      console.error("Error deleting asset:", error);
    } finally {
      setIsLoading(false);
      setDeleteDialogOpen(false);
    }
  };

  if (isLoading) {
    return (
      <MainCard>
        <Box sx={{ p: 3, textAlign: "center" }}>Loading...</Box>
      </MainCard>
    );
  }

  if (!asset) {
    return (
      <MainCard>
        <Box sx={{ p: 3, textAlign: "center" }}>Asset not found</Box>
      </MainCard>
    );
  }

  const documentColumns = [
    { id: "name", field: "name", headerName: "Name", flex: 1 },
    { id: "type", field: "type", headerName: "Type", flex: 1 },
    { id: "createdAt", field: "createdAt", headerName: "Created At", flex: 1 },
    { id: "status", field: "status", headerName: "Status", flex: 1 },
  ];

  return (
    <MainCard>
      <Box sx={{ p: 3 }}>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          <Box component="span" sx={{ cursor: "pointer" }} onClick={() => router.push("/src/assets")}>
            <strong>Asset</strong>
          </Box>{" "}
          / {params.skuKey}
        </Typography>

        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Avatar src={`${process.env.NEXT_PUBLIC_RESOURCE_URL}${asset.image}`} alt={asset.name.toString().slice(0, 2).toUpperCase() || "NA"} sx={{ width: 400, height: 300, fontSize: 32, maxWidth: "100%", maxHeight: "300px" }} variant="rounded" />
          </Grid>
          <Grid item xs={12} md={4}>
            <Stack direction="column" gap={2}>
              <Typography variant="h5" fontWeight="bold">
                {asset.name}
              </Typography>
              <Stack direction="column">
                <Typography variant="body1" color="text.secondary">
                  Category: {category?.name}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  Asset Details: {asset.description}
                </Typography>
              </Stack>
            </Stack>
          </Grid>
          <Grid item xs={12} md={4} sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Stack spacing={2} sx={{ alignItems: "flex-end", width: "100%", maxWidth: 200 }}>
              <Box display="flex" gap={1} alignItems="center">
                <Typography variant="body1" color="text.secondary">
                  Edit Asset
                </Typography>
                <IconButton
                  onClick={() => router.push(`/src/assets/edit/${params.skuKey}`)}
                  sx={{
                    borderRadius: "8px",
                    color: "secondary.contrastText",
                    bgcolor: "secondary.main",
                    "&:hover": { bgcolor: "secondary.dark" },
                  }}
                >
                  <EditIcon />
                </IconButton>
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "flex-start" }}>
                <Typography variant="body1" color="text.secondary">
                  Inventory
                </Typography>
                <Button variant="contained">View</Button>
              </Box>
            </Stack>
          </Grid>
        </Grid>

        <Box sx={{ mt: 4, gap: 2 }}>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Inventory Status
          </Typography>

          <Box sx={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "20px" }}>
            {Object.entries(inventoriesStatusCounts).map(([status, count]) => (
              <Card
                key={status}
                sx={{
                  width: "170px",
                  height: "145px",
                  textAlign: "center",
                  boxShadow: 0,
                  backgroundColor: "transparent",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  border: `1px solid ${theme.palette.tertiary.main}`,
                  borderRadius: 1,
                  margin: "10px",
                }}
              >
                <Typography variant="h2" fontWeight={200}>
                  {count}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Typography>
              </Card>
            ))}
          </Box>
        </Box>

        <Box sx={{ mt: 4, gap: 2 }}>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Documents
          </Typography>
          {isLoadingDocuments ? <Skeleton variant="rectangular" width="100%" height={200} /> : <Table columns={documentColumns} data={documents} onRowSelect={() => {}} />}
        </Box>
      </Box>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Asset</DialogTitle>
        <DialogContent>
          <DialogContentText>Are you sure you want to delete this asset? This action cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" disabled={isLoading}>
            {isLoading ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
