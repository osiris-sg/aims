"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import { Box, Button, Typography, MenuItem, Grid, FormControl, InputLabel, Skeleton, Select, Stack, IconButton, useTheme, DialogTitle, DialogContent, DialogActions } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import Dialog from "@mui/material/Dialog";
import useGetAssets from "../hooks/useGetAssets";
import useGetInventoryByAsset from "../hooks/useGetInventoryByAsset";
import Table from "@/components/Table";
import { ROUTES } from "@/routes";
import { toast } from "react-toastify";
import DateRangePicker from "@/form-components/FormDateRangePicker";
import { useForm, FormProvider } from "react-hook-form";

export default function ProjectDetailsPage({ params }: { params: { id: string } }) {
  const methods = useForm();
  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = methods;
  const watchedStartDate = watch("startDate");
  const watchedEndDate = watch("endDate");

  const onSubmit = async (data: any) => {
    const payload = selectedItems.map((item) => ({
      inventoryId: item.id,
      skuKey: item.sku,
      startDate: item.startDate || data.startDate,
      endDate: item.endDate || data.endDate,
      status: item.status || "reserved",
    }));

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/projects/${params.id}/assignments`,
          method: "POST",
        },
        {
          assignments: payload,
        },
        token
      );

      if (response.success) {
        toast.success("Assignments added successfully");
        setAddDialogOpen(false);
        fetchProject();
      } else {
        toast.error("Failed to add assignments");
      }
    } catch (error) {
      console.error("Error adding assignments:", error);
      toast.error("An error occurred while adding assignments");
    }
  };

  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;
  const [selectedAsset, setSelectedAsset] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedItems, setSelectedItems] = useState<any[]>([]);
  const { assets, isLoading } = useGetAssets();
  const { inventoryData, isLoading: isInventoryLoading } = useGetInventoryByAsset(selectedAsset);
  const inventoryItems = inventoryData.inventories || [];
  console.log("Assets:", assets);
  console.log("Inventory Items:", inventoryItems);
  // const [project, setProject] = useState<any>({
  //   id: "proj_001",
  //   name: "Sample Project Alpha",
  //   description: "Demo project to test layout",
  //   image: null,
  //   customer: { name: "Acme Corp" },
  // });
  const [project, setProject] = useState<any>(null);
  const [isProjectLoading, setIsProjectLoading] = useState(false);

  const fetchProject = async () => {
    if (!params?.id) return;
    setIsProjectLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/projects/${params.id}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        console.log("Project fetched successfully:", response.data);
        setProject(response.data);
      }
    } catch (error) {
      console.error("Error fetching project:", error);
    } finally {
      setIsProjectLoading(false);
    }
  };

  useEffect(() => {
    fetchProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);
  const handleAssetChange = (e: any) => {
    setSelectedAsset(e.target.value);
    setSelectedItem("");
  };

  const handleItemChange = (e: any) => {
    const itemId = e.target.value;
    setSelectedItem(itemId);
    const item = inventoryItems.find((i) => i.id === itemId);
    if (item && !selectedItems.some((i) => i.id === item.id)) {
      const newItem = {
        id: item.id,
        sku: item.sku,
        status: "reserved",
        startDate: null,
        endDate: null,
      };
      console.log("Adding item:", newItem);
      setSelectedItems((prev) => [...prev, newItem]);
      setValue("assignments", [
        ...selectedItems.map((i) => ({
          inventoryId: i.id,
          skuKey: i.id,
          startDate: i.startDate,
          endDate: i.endDate,
          status: i.status,
        })),
        {
          inventoryId: item.id,
          skuKey: item.sku,
          startDate: null,
          endDate: null,
          status: "reserved",
        },
      ]);
    }
  };

  // Mock data for documents
  const [documents, setDocuments] = useState<any[]>([
    { id: "doc_1", name: "Safety Checklist", doc_id: "doc_1" },
    { id: "doc_2", name: "Site Agreement", doc_id: "doc_2" },
  ]);

  // Add dialog state for document templates
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);

  if (isLoading || isProjectLoading) {
    return (
      <MainCard>
        <Box sx={{ p: 3, textAlign: "center" }}>Loading...</Box>
      </MainCard>
    );
  }

  if (!project) {
    return (
      <MainCard>
        <Box sx={{ p: 3, textAlign: "center" }}>Project not found</Box>
      </MainCard>
    );
  }

  return (
    <MainCard>
      <Box sx={{ p: 3 }}>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          <Box component="span" sx={{ cursor: "pointer" }} onClick={() => router.push(ROUTES.ASSETS)}>
            <strong>Project</strong>
          </Box>{" "}
          / {params.id}
        </Typography>

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Stack direction="column" gap={2}>
              <Typography variant="h5" fontWeight="bold">
                {project.name}
              </Typography>
              <Stack direction="column">
                <Typography variant="body1" color="text.secondary">
                  Project Details: {project.description}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  Customer: {project.customer?.name}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  Start Date: {new Date(project.startDate).toLocaleDateString()}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  End Date: {new Date(project.endDate).toLocaleDateString()}
                </Typography>
              </Stack>
            </Stack>
          </Grid>
          <Grid item xs={12} md={6} sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Stack spacing={2} sx={{ alignItems: "flex-end", width: "100%", maxWidth: 200 }}>
              <Box display="flex" gap={1} alignItems="center">
                <Typography variant="body1" color="text.secondary">
                  Edit Project
                </Typography>
                <IconButton
                  onClick={() => router.push(`${ROUTES.EDIT_ASSET}/${params.id}`)}
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
            </Stack>
          </Grid>
        </Grid>

        <Box sx={{ mt: 4, gap: 2 }}>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Assignments
          </Typography>
          <Button variant="contained" onClick={() => setAddDialogOpen(true)} sx={{ mb: 2 }}>
            Add Item
          </Button>
          <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} fullWidth maxWidth="md">
            <DialogTitle>Add Assignment</DialogTitle>
            <FormProvider {...methods}>
              <form onSubmit={handleSubmit(onSubmit)}>
                <DialogContent>
                  <Stack spacing={3} sx={{ mt: 1 }}>
                    <FormControl fullWidth>
                      <InputLabel>Asset</InputLabel>
                      <Select value={selectedAsset} label="Asset" onChange={handleAssetChange}>
                        {assets.docs.map((asset: any) => (
                          <MenuItem key={asset.id} value={asset.id}>
                            {asset.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <FormControl fullWidth disabled={!selectedAsset || isInventoryLoading}>
                      <InputLabel>Item</InputLabel>
                      {isInventoryLoading ? (
                        <Skeleton variant="rectangular" width="100%" height={56} />
                      ) : (
                        <Select value={selectedItem} label="Item" onChange={handleItemChange}>
                          {inventoryItems.map((item) => (
                            <MenuItem key={item.id} value={item.id} disabled={selectedItems.some((i) => i.id === item.sku)}>
                              {item.sku}
                            </MenuItem>
                          ))}
                        </Select>
                      )}
                    </FormControl>

                    <Box sx={{ mt: 2 }}>
                      <DateRangePicker
                        label="Project Duration *"
                        value={{
                          startDate: watchedStartDate,
                          endDate: watchedEndDate,
                        }}
                        onConfirm={(range) => {
                          setValue("startDate", range.startDate);
                          setValue("endDate", range.endDate);
                        }}
                      />
                      {(errors.startDate || errors.endDate) && (
                        <Typography variant="caption" color="error">
                          {(errors.startDate?.message as string) || (errors.endDate?.message as string)}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setAddDialogOpen(false)}>Close</Button>
                  <Button type="submit" variant="contained">
                    Save
                  </Button>
                </DialogActions>
              </form>
            </FormProvider>
          </Dialog>
          <Box>
            <Table
              columns={[
                {
                  id: "id",
                  accessorKey: "id",
                  header: "Item SKU",
                  cell: (info: any) => info.getValue(),
                },
                {
                  id: "startDate",
                  accessorKey: "startDate",
                  header: "Start Date",
                  cell: ({ row }: any) => (
                    <Box sx={{ minWidth: 150 }}>
                      <Typography variant="body2">{row.original.startDate ?? "N/A"}</Typography>
                    </Box>
                  ),
                },
                {
                  id: "endDate",
                  accessorKey: "endDate",
                  header: "End Date",
                  cell: ({ row }: any) => (
                    <Box sx={{ minWidth: 150 }}>
                      <Typography variant="body2">{row.original.endDate ?? "N/A"}</Typography>
                    </Box>
                  ),
                },
                {
                  id: "status",
                  accessorKey: "status",
                  header: "Status",
                  cell: ({ row }: any) => (
                    <Box sx={{ minWidth: 120 }}>
                      <Typography variant="body2">{row.original.status ?? "reserved"}</Typography>
                    </Box>
                  ),
                },
              ]}
              data={project.assignments.map((a: any) => ({
                id: a.inventoryId,
                startDate: a.startDate,
                endDate: a.endDate,
                status: "reserved",
              }))}
              onRowSelect={() => {}}
            />
          </Box>
        </Box>

        <Box sx={{ mt: 4, gap: 2 }}>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Documents
          </Typography>
          <Box>
            <Table
              columns={[
                {
                  id: "id",
                  accessorKey: "id",
                  header: "Document ID",
                  cell: (info: any) => info.getValue(),
                },
                {
                  id: "name",
                  accessorKey: "name",
                  header: "Name",
                  cell: ({ row }: any) => (
                    <Box sx={{ minWidth: 150 }}>
                      <Typography variant="body2">{row.original.name}</Typography>
                    </Box>
                  ),
                },
              ]}
              data={project.documents || []}
              onRowSelect={() => {}}
            />
          </Box>
        </Box>
      </Box>
    </MainCard>
  );
}
