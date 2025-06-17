"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import { Box, Button, Typography, Avatar, Grid, Skeleton, Stack, useTheme, IconButton } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Table from "@/components/Table";
import Image from "next/image";
import FormSelect from "@/form-components/FormSelect";
import { useForm } from "react-hook-form";
import { ROUTES } from "@/routes";

interface Inventory {
  id: string;
  sku: string;
  status: string;
  category: string;
  createdAt: string;
  assetId: string;
  asset: {
    id: string;
    name: string;
    image: string;
    description: string;
  };
}

interface TimelineItem {
  id: string;
  message: string;
  createdAt: string;
}

const INVENTORY_STATUS = [
  { value: "instock", label: "instock" },
  { value: "AVAILABLE", label: "Available" },
  { value: "IN_USE", label: "In Use" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "RETIRED", label: "Retired" },
];

export default function ViewInventoryPage({ params }: { params: { sku: string } }) {
  const router = useRouter();
  const theme = useTheme();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;
  const { control, setValue } = useForm();

  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [isLoadingQR, setIsLoadingQR] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);

  const fetchInventory = async () => {
    if (!organizationId) return;
    setIsLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/inventories/sku/${params.sku}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        setInventory(response.data);
        setValue("status", response.data.status);
      }
    } catch (error) {
      console.error("Error fetching inventory:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTimelineItems = async () => {
    if (!organizationId || !inventory?.id) return;
    setIsLoadingTimeline(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/timeline-items/inventory/${inventory.id}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        setTimelineItems(response.data);
      }
    } catch (error) {
      console.error("Error fetching timeline items:", error);
    } finally {
      setIsLoadingTimeline(false);
    }
  };

  const fetchQRCode = async () => {
    if (!organizationId || !inventory?.id) return;
    setIsLoadingQR(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/inventories/qrcode/${params.sku}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        setQrCode(response.data.qrCode);
      }
    } catch (error) {
      console.error("Error fetching QR code:", error);
    } finally {
      setIsLoadingQR(false);
    }
  };

  const handleDelete = async () => {
    if (!organizationId) return;
    setIsLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/inventories/sku/${params.sku}`,
          method: "DELETE",
        },
        {},
        token
      );

      if (response.success) {
        router.push(ROUTES.INVENTORY);
      }
    } catch (error) {
      console.error("Error deleting inventory:", error);
    } finally {
      setIsLoading(false);
      setDeleteDialogOpen(false);
    }
  };

  const handleOpenQRDialog = () => {
    setQrDialogOpen(true);
  };

  const handleCloseQRDialog = () => {
    setQrDialogOpen(false);
  };

  useEffect(() => {
    fetchInventory();
  }, [organizationId, params.sku]);

  useEffect(() => {
    if (inventory?.id) {
      fetchTimelineItems();
      fetchQRCode();
    }
  }, [inventory?.id]);

  const timelineColumns = [
    {
      id: "message",
      accessorKey: "message",
      header: "Message",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      header: "Created At",
      cell: (info: any) => {
        const value = info.getValue();
        return value ? new Date(value).toLocaleDateString() : "";
      },
    },
  ];

  if (isLoading) {
    return (
      <MainCard>
        <Box sx={{ p: 3, textAlign: "center" }}>Loading...</Box>
      </MainCard>
    );
  }

  if (!inventory) {
    return (
      <MainCard>
        <Box sx={{ p: 3, textAlign: "center" }}>Inventory not found</Box>
      </MainCard>
    );
  }

  return (
    <MainCard>
      <Box sx={{ gap: "var(--default-gap)", display: "flex", flexDirection: "column" }}>
        <Typography variant="body1" color="text.secondary">
          Inventory / <strong>{params.sku}</strong>
        </Typography>
        <Grid container spacing={3} sx={{ mt: 2 }}>
          <Grid item xs={12} md={6}>
            {isLoading ? (
              <Skeleton animation="wave" variant="rectangular" width={400} height={300} sx={{ maxWidth: "100%", borderRadius: 2 }} />
            ) : (
              <Avatar
                src={inventory.asset?.image ? `${process.env.NEXT_PUBLIC_RESOURCE_URL}${inventory.asset.image}` : undefined}
                alt={inventory.asset?.name ? inventory.asset.name.toString().slice(0, 2).toUpperCase() : "NA"}
                sx={{ width: 400, height: 300, fontSize: 32, maxWidth: "100%", maxHeight: "300px" }}
                variant="rounded"
              />
            )}
          </Grid>

          <Grid item xs={12} md={6}>
            <Grid container>
              <Grid item xs={12} md={6}>
                <Stack direction="column" gap="var(--default-gap)">
                  {isLoading ? (
                    <Skeleton animation="wave" variant="text" width={100} height={32} />
                  ) : (
                    <Typography variant="h5" fontWeight="bold">
                      {params.sku}
                    </Typography>
                  )}

                  <Stack direction="column">
                    {isLoading ? (
                      <>
                        <Skeleton animation="wave" variant="text" width={180} />
                        <Skeleton animation="wave" variant="text" width={140} />
                      </>
                    ) : (
                      <>
                        <Typography variant="body1" color="text.secondary">
                          Category: {inventory.category}
                        </Typography>
                        <Typography variant="body1" color="text.secondary">
                          Project: Project
                        </Typography>
                      </>
                    )}
                  </Stack>
                </Stack>

                <Stack direction="column" gap="var(--default-gap)" sx={{ mt: "var(--default-gap)" }}>
                  <Stack direction="column">
                    {isLoading ? (
                      <Skeleton animation="wave" variant="text" width={180} />
                    ) : (
                      <Typography variant="body1" color="text.secondary">
                        QR Code:
                      </Typography>
                    )}
                    <Box display="flex" justifyContent="center" alignItems="center" width={200} height={200}>
                      {isLoadingQR ? (
                        <Skeleton animation="wave" variant="rectangular" width={200} height={200} sx={{ borderRadius: 2 }} />
                      ) : qrCode ? (
                        <Box
                          onClick={handleOpenQRDialog}
                          sx={{
                            cursor: "pointer",
                            "&:hover": {
                              opacity: 0.8,
                            },
                          }}
                        >
                          <Image src={qrCode} alt="QR Code" width={200} height={200} style={{ objectFit: "contain" }} />
                        </Box>
                      ) : (
                        <Typography variant="body2" color="error">
                          Failed to load QR code.
                        </Typography>
                      )}
                    </Box>
                  </Stack>

                  <Stack direction="column">
                    {isLoading ? (
                      <Skeleton animation="wave" variant="text" width={180} />
                    ) : (
                      <Typography variant="body1" color="text.secondary">
                        Barcode:
                      </Typography>
                    )}
                    {isLoading ? <Skeleton animation="wave" variant="text" width={180} /> : "BARCODE"}
                  </Stack>
                </Stack>
              </Grid>
              <Grid item xs={12} md={6}>
                {isLoading ? <Skeleton animation="wave" variant="rectangular" width="100%" height={80} /> : <FormSelect control={control} name="status" label="Status" addItem={false} menuTitle="Choose status" menuItems={INVENTORY_STATUS} defaultValue={inventory.status} disabled />}

                <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)", alignItems: "flex-start", mt: "var(--default-gap)" }}>
                  {isLoading ? (
                    <Skeleton animation="wave" variant="text" width={220} />
                  ) : (
                    <Typography variant="body1" color="text.secondary">
                      Service Management Report
                    </Typography>
                  )}
                  {isLoading ? <Skeleton animation="wave" variant="rectangular" width={100} height={36} /> : <Button variant="contained">Create</Button>}
                </Box>
              </Grid>
            </Grid>
          </Grid>
        </Grid>

        <Box sx={{ gap: "var(--half-gap)", display: "flex", flexDirection: "column" }}>
          {isLoading ? <Skeleton animation="wave" variant="text" width={180} /> : <Typography variant="body1">History</Typography>}
          {isLoading ? <Skeleton animation="wave" variant="rectangular" width="100%" height={200} /> : <Table columns={timelineColumns} data={timelineItems} onRowSelect={() => {}} loading={isLoadingTimeline} isNoSelectionColumn={true} />}
        </Box>
      </Box>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Inventory</DialogTitle>
        <DialogContent>
          <DialogContentText>Are you sure you want to delete this inventory? This action cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" disabled={isLoading}>
            {isLoading ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={qrDialogOpen} onClose={handleCloseQRDialog} maxWidth="sm" fullWidth>
        <DialogTitle>QR Code</DialogTitle>
        <DialogContent>
          <Box display="flex" justifyContent="center" alignItems="center" p={2}>
            {isLoadingQR ? (
              <Skeleton animation="wave" variant="rectangular" width={300} height={300} sx={{ borderRadius: 2 }} />
            ) : qrCode ? (
              <Image src={qrCode} alt="QR Code" width={300} height={300} style={{ objectFit: "contain" }} />
            ) : (
              <Typography variant="body2" color="error">
                Failed to load QR code.
              </Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseQRDialog}>Close</Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
