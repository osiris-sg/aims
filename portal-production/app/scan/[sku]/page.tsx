/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { Avatar, Box, Button, Skeleton, Stack, Typography, Grid2, useMediaQuery, useTheme, IconButton } from "@mui/material";
import { useParams } from "next/navigation";
import React, { useState, useEffect } from "react";
import ArticleIcon from "@mui/icons-material/Article";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { useRouter } from "next/navigation";

export default function ScanInventory() {
  const params = useParams();
  const { getToken } = useAuth();
  const router = useRouter();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const sku = params.sku;
  const [inventory, setInventory] = useState<any>(null);
  const [asset, setAsset] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [templateOptions, setTemplateOptions] = useState<any[]>([]);
  const theme = useTheme();
  const isXsScreen = useMediaQuery(theme.breakpoints.down("md"));
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [documents, setDocuments] = useState<any[]>([]);
  const [isDocumentTemplateUpdating, setIsDocumentTemplateUpdating] = useState(false);

  const fetchDocuments = React.useCallback(async () => {
    console.log("Fetching documents for asset:", asset?.id);
    if (!organizationId || !asset?.id) return;
    setIsLoadingDocuments(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/documents/asset/${asset.id}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        console.log("Fetched documents:", response.data);
        setTemplateOptions(response.data);
      }
    } catch (error) {
      console.error("Error fetching documents:", error);
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [organizationId, asset?.id, getToken]);
  const fetchInventoryBySku = React.useCallback(async () => {
    if (!organizationId || !sku) return;
    setIsLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/inventories/sku/${sku}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        const fetchedInventory = response.data;
        const fetchedAsset = fetchedInventory.assetId;

        console.log("Fetched inventory:", fetchedInventory);
        setInventory(fetchedInventory);
        setAsset(fetchedAsset);

        // Inline fetchDocuments logic
        console.log("Fetching documents for asset:", fetchedInventory?.assetId);
        if (fetchedAsset && organizationId) {
          setIsLoadingDocuments(true);
          try {
            const docResponse = await request(
              {
                path: `/documents/asset/${fetchedAsset}`,
                method: "GET",
              },
              {},
              token
            );

            if (docResponse.success) {
              console.log("Fetched documents:", docResponse.data);
              setTemplateOptions(docResponse.data);
            }
          } catch (docError) {
            console.error("Error fetching documents:", docError);
          } finally {
            setIsLoadingDocuments(false);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching inventory by SKU:", error);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, sku, getToken]);

  useEffect(() => {
    if (asset?.id) {
      fetchDocuments();
    }
  }, [asset, fetchDocuments]);
  useEffect(() => {
    fetchInventoryBySku();
  }, [fetchInventoryBySku]);

  const handleEditDocument = async (data: any) => {
    console.log("Editing document with data:", data);
    try {
      setIsDocumentTemplateUpdating(true);
      const token = await getToken();
      const documentTemplateId = data.doc_id;
      console.log("Selected Document Type:", organizationId);
      const response = await request(
        {
          path: "/documents/basic",
          method: "POST",
        },
        {
          type: data.doc_type,
          config: {},
          documentTemplateId: documentTemplateId,
          organizationId: organizationId,
        },
        token ?? undefined
      );

      const createdDocumentId = response?.data.id;
      console.log("Created Document ID:", createdDocumentId);
      router.push(`/portal/documents/${data.doc_type}/${documentTemplateId}/${createdDocumentId}?scannedInventoryId=${inventory?.id}`);
    } catch (error) {
      console.error("Error submitting form:", error);
    } finally {
      setIsDocumentTemplateUpdating(false);
    }
  };

  return (
    <Box
      sx={{
        flexGrow: 1,
        padding: isXsScreen ? "var(--mobile-portal-content-padding)" : "var(--portal-content-padding)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
        overflow: "hidden",
        bgcolor: "primary.main",
      }}
    >
      <Box
        sx={{
          width: "100%",
          height: "100%",
          px: "var(--default-padding)",
          overflowY: "auto",
          display: "flex",
          alignItems: "center",
          flexDirection: "column",
          //
        }}
      >
        <Box sx={{ maxWidth: "var(--page-max-width)", width: "100%", height: "100%" }}>
          <Grid2 container spacing={4} sx={{ height: "100%", alignItems: "center" }}>
            {/* Left Side */}
            <Grid2 size={{ xs: 12, md: 6 }}>
              <Box sx={{ height: "100%", gap: "var(--half-gap)", display: "flex", flexDirection: "column" }}>
                {isLoading ? (
                  <>
                    <Skeleton variant="text" width={100} height={32} />
                    <Skeleton variant="text" width={150} height={32} />
                    <Skeleton variant="rectangular" width="100%" height={300} sx={{ borderRadius: 2, minHeight: "60vh" }} />
                  </>
                ) : (
                  <>
                    <Typography variant="h2" fontWeight="bold" color="primary.contrastText">
                      {sku}
                    </Typography>
                    <Typography variant="h5" fontWeight="bold" color="customGray.main">
                      {asset?.name}
                    </Typography>

                    <Avatar
                      src={`${process.env.NEXT_PUBLIC_RESOURCE_URL}${asset?.image}`}
                      alt={asset?.name?.toString()?.slice(0, 2)?.toUpperCase() || "NA"}
                      sx={{
                        width: "100%",
                        height: "auto",
                        minHeight: "60vh",
                        fontSize: "2rem",
                      }}
                      variant="rounded"
                    />
                  </>
                )}
              </Box>
            </Grid2>

            {/* Right Side */}
            <Grid2 size={{ xs: 12, md: 6 }}>
              <Stack spacing={3} justifyContent="center" alignItems="center" height="100%">
                {templateOptions.map((template) => (
                  <Button
                    key={template.doc_id}
                    onClick={() => handleEditDocument(template)}
                    variant="contained"
                    size="large"
                    fullWidth
                    loading={isDocumentTemplateUpdating}
                    sx={{
                      width: "16.875rem",
                      height: "14.375rem",
                      backgroundColor: "customRed.light",
                      borderRadius: "0.25rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--double-gap)",
                    }}
                  >
                    <IconButton
                      size="large"
                      sx={{
                        backgroundColor: "primary.contrastText",
                        color: "text.primary",
                        borderRadius: "50%",
                        boxShadow: "0 0 0 8px rgba(255, 212, 212, 0.8)",
                        outline: "8px solid rgba(210, 70, 60, 0.3)",
                        "&:hover": {
                          backgroundColor: "primary.contrastText",
                        },
                      }}
                    >
                      <ArticleIcon />
                    </IconButton>
                    <Typography variant="h5" color="primary.contrastText" fontWeight="bold">
                      {template.doc_name}
                    </Typography>
                  </Button>
                ))}
              </Stack>
            </Grid2>
          </Grid2>
        </Box>
      </Box>
    </Box>
  );
}
