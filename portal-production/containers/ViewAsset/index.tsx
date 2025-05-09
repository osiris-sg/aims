"use client";

import Table from "@/components/Table";
import { Avatar, Box, Button, Card, Grid2, IconButton, Skeleton, Stack, Typography, useTheme } from "@mui/material";
// import Image from "next/image";
import { useParams } from "next/navigation";
import useViewInventoryTableHeader from "./hooks/useViewAssetTableHeader";
import useStatusCountsHandler from "./hooks/useStatusCountsHandler";
import ModeEditIcon from "@mui/icons-material/ModeEdit";
import useEditAssetHandler from "../Assets/hooks/useEditAssetHandler";
import useGetAsset from "./hooks/useGetAsset";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";

export default function ViewAsset() {
  const params = useParams();
  const theme = useTheme();
  const router = useRouter();
  const skuKey = params.skuKey;
  const { asset, category, isGetAssetLoading } = useGetAsset();
  const { inventoriesStatusCounts, isGetInventoriesLoading } = useStatusCountsHandler();
  const { handleEdit } = useEditAssetHandler();

  const { columnsDocuments, sampleDataDocuments } = useViewInventoryTableHeader();

  return (
    <Box sx={{ gap: "var(--default-gap)", display: "flex", flexDirection: "column" }}>
      <Typography variant="body1" color="text.secondary">
        <Box component="span" sx={{ cursor: "pointer" }} onClick={() => router.push(ROUTES.ASSETS)}>
          <strong>Asset</strong>
        </Box>{" "}
        / {skuKey}
      </Typography>

      <Grid2 container spacing={3}>
        <Grid2 container spacing={3} justifyContent="space-between" alignItems="flex-start">
          <Grid2 item xs={12} md={4}>
            {isGetAssetLoading ? (
              <Skeleton variant="rectangular" width={400} height={300} sx={{ maxWidth: "100%", borderRadius: 2 }} />
            ) : (
              <Avatar src={`${process.env.NEXT_PUBLIC_RESOURCE_URL}${asset?.image}`} alt={asset?.name.toString().slice(0, 2).toUpperCase() || "NA"} sx={{ width: 400, height: 300, fontSize: 32, maxWidth: "100%", maxHeight: "300px" }} variant="rounded" />
            )}
          </Grid2>
          <Grid2 item xs={12} md={4} sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Stack direction="column" gap="var(--default-gap)">
              {isGetAssetLoading ? (
                <Skeleton variant="text" width={200} height={32} />
              ) : (
                <Typography variant="h5" fontWeight="bold">
                  {asset?.name}
                </Typography>
              )}
              <Stack direction="column">
                {isGetAssetLoading ? (
                  <Skeleton variant="text" width={180} />
                ) : (
                  <Typography variant="body1" color="text.secondary">
                    Category: {category?.name}
                  </Typography>
                )}
                {isGetAssetLoading ? (
                  <Skeleton variant="text" width={100} height={32} />
                ) : (
                  <Typography variant="body1" color="text.secondary">
                    Asset Details: {asset?.description}
                  </Typography>
                )}
              </Stack>
            </Stack>
          </Grid2>
        </Grid2>

        <Grid2 item xs={12} md={4} sx={{ display: "flex", justifyContent: "flex-end", pr: 4, ml: "auto" }}>
          <Grid2
            item
            sx={{
              display: "flex",
              justifyContent: "flex-end",
              width: "100%",
              maxWidth: "100%",
            }}
          >
            <Stack spacing={2} sx={{ alignItems: "flex-end", width: "100%", maxWidth: 200 }}>
              {" "}
              {/* You can tweak spacing (e.g., 1.5, 2.5) */}
              <Box display="flex" gap="var(--half-gap)" alignItems="center">
                {isGetAssetLoading ? (
                  <Skeleton variant="text" width={100} height={32} />
                ) : (
                  <Typography variant="body1" color="text.secondary">
                    Edit Asset
                  </Typography>
                )}
                {isGetAssetLoading ? (
                  <Skeleton variant="rectangular" width={40} height={40} />
                ) : (
                  <IconButton
                    onClick={() => handleEdit(asset?.id)}
                    sx={{
                      borderRadius: "8px",
                      color: "secondary.contrastText",
                      bgcolor: "secondary.main",
                      "&:hover": { bgcolor: "secondary.dark" },
                    }}
                  >
                    <ModeEditIcon />
                  </IconButton>
                )}
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)", alignItems: "flex-start" }}>
                {isGetAssetLoading ? (
                  <Skeleton variant="text" width={100} height={32} />
                ) : (
                  <Typography variant="body1" color="text.secondary">
                    Inventory
                  </Typography>
                )}
                {isGetAssetLoading ? <Skeleton variant="rectangular" width={100} height={40} /> : <Button variant="contained">View</Button>}
              </Box>
            </Stack>
          </Grid2>
        </Grid2>
      </Grid2>

      <Box sx={{ gap: "var(--half-gap)" }}>
        {isGetInventoriesLoading || isGetAssetLoading ? <Skeleton variant="text" width={100} height={32} /> : <Typography variant="body1">Inventory Status</Typography>}

        <Box sx={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "20px" }}>
          {isGetInventoriesLoading || isGetAssetLoading
            ? Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} variant="rectangular" width={170} height={145} sx={{ borderRadius: 1 }} />)
            : Object.entries(inventoriesStatusCounts).map(([status, count]) => (
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

      <Box sx={{ gap: "var(--half-gap)", display: "flex", flexDirection: "column" }}>
        {isGetAssetLoading ? <Skeleton variant="text" width={100} height={32} /> : <Typography variant="body1">Documents</Typography>}
        {isGetAssetLoading ? <Skeleton variant="rectangular" width="100%" height={200} /> : <Table columns={columnsDocuments} data={sampleDataDocuments} onRowSelect={() => {}} />}
      </Box>
    </Box>
  );
}
