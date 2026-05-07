/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { Avatar, Box, Button, Skeleton, Stack, Typography, Grid2, useMediaQuery, useTheme, IconButton } from "@mui/material";
import { useParams } from "next/navigation";
import useGetInventory from "./hooks/useGetInventory";
import ArticleIcon from "@mui/icons-material/Article";
import { useGetDocuments } from "./hooks/useGetDocuments";
import useEditDocumentHandler from "./hooks/useEditDocumentHandler";

export default function ScanInventory() {
  const params = useParams();
  const sku = params.sku;
  const { inventory, asset, isGetInventoryLoading } = useGetInventory();
  const theme = useTheme();
  const isXsScreen = useMediaQuery(theme.breakpoints.down("md"));
  const { getTemplateOptions } = useGetDocuments();
  const { handleEdit } = useEditDocumentHandler();

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
                {isGetInventoryLoading ? (
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
                {getTemplateOptions(inventory?.status || "").map((template) => (
                  <Button
                    key={template.id}
                    onClick={() => handleEdit(template, inventory)}
                    variant="contained"
                    size="large"
                    fullWidth
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
                      {template.name}
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
