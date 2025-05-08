/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import Table from "@/components/Table";
import FormSelect from "@/form-components/FormSelect";
import { Avatar, Box, Button, Grid2, Skeleton, Stack, Typography } from "@mui/material";
import Image from "next/image";
import { useParams } from "next/navigation";
import useViewInventoryTableHeader from "./hooks/useViewInventoryTableHeader";
import useGetInventory from "./hooks/useGetInventory";
import useGetQR from "./hooks/useGetQR";
import { INVENTORY_STATUS } from "./slice/types";
import useUpdateStatus from "./hooks/useUpdateStatus";
export default function ViewInventory() {
  const params = useParams();
  const sku = params.sku;
  const { inventory, asset, isGetInventoryLoading, timelineItems, isGetTimelineItemsLoading } = useGetInventory();
  const { qrCode, isQRLoading } = useGetQR();
  const { control } = useUpdateStatus();
  const { columnsHistory } = useViewInventoryTableHeader();

  return (
    <Box sx={{ gap: "var(--default-gap)", display: "flex", flexDirection: "column" }}>
      <Typography variant="body1" color="text.secondary">
        Inventory / <strong>{sku}</strong>
      </Typography>
      <Grid2 container spacing={3} sx={{ mt: 2 }}>
        <Grid2 size={{ xs: 12, md: 6 }}>
          {isGetInventoryLoading ? (
            <Skeleton animation="wave" variant="rectangular" width={400} height={300} sx={{ maxWidth: "100%", borderRadius: 2 }} />
          ) : (
            <Avatar src={`${process.env.NEXT_PUBLIC_RESOURCE_URL}${asset?.image}`} alt={asset?.name.toString().slice(0, 2).toUpperCase() || "NA"} sx={{ width: 400, height: 300, fontSize: 32, maxWidth: "100%", maxHeight: "300px" }} variant="rounded" />
          )}
        </Grid2>

        <Grid2 size={{ xs: 12, md: 6 }}>
          <Grid2 container>
            <Grid2 size={{ xs: 12, md: 6 }}>
              <Stack direction="column" gap="var(--default-gap)">
                {isGetInventoryLoading ? (
                  <Skeleton animation="wave" variant="text" width={100} height={32} />
                ) : (
                  <Typography variant="h5" fontWeight="bold">
                    {sku}
                  </Typography>
                )}

                <Stack direction="column">
                  {isGetInventoryLoading ? (
                    <>
                      <Skeleton animation="wave" variant="text" width={180} />
                      <Skeleton animation="wave" variant="text" width={140} />
                    </>
                  ) : (
                    <>
                      <Typography variant="body1" color="text.secondary">
                        Category: {inventory?.category}
                      </Typography>
                      <Typography variant="body1" color="text.secondary">
                        Project: Project
                      </Typography>
                    </>
                  )}
                </Stack>
              </Stack>

              <Stack direction="column" gap="var(--default-gap)" marginTop="var(--default-gap)">
                <Stack direction="column">
                  {isGetInventoryLoading ? (
                    <Skeleton animation="wave" variant="text" width={180} />
                  ) : (
                    <Typography variant="body1" color="text.secondary">
                      QR Code:
                    </Typography>
                  )}
                  <Box display="flex" justifyContent="center" alignItems="center" width={200} height={200}>
                    {isQRLoading ? (
                      <Skeleton animation="wave" variant="rectangular" width={200} height={200} sx={{ borderRadius: 2 }} />
                    ) : qrCode ? (
                      <Image src={qrCode} alt="QR Code" width={200} height={200} style={{ objectFit: "contain" }} />
                    ) : (
                      <Typography variant="body2" color="error">
                        Failed to load QR code.
                      </Typography>
                    )}
                  </Box>
                </Stack>

                <Stack direction="column">
                  {isGetInventoryLoading ? (
                    <Skeleton animation="wave" variant="text" width={180} />
                  ) : (
                    <Typography variant="body1" color="text.secondary">
                      Barcode:
                    </Typography>
                  )}
                  {isGetInventoryLoading ? <Skeleton animation="wave" variant="text" width={180} /> : "BARCODE"}
                </Stack>
              </Stack>
            </Grid2>
            <Grid2 size={{ xs: 12, md: 6 }}>
              {isGetInventoryLoading ? <Skeleton animation="wave" variant="rectangular" width="100%" height={80} /> : <FormSelect control={control} name="status" label="Status" addItem={false} menuTitle="Choose status" menuItems={INVENTORY_STATUS} defaultValue={inventory?.status} disabled />}

              <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)", alignItems: "flex-start", marginTop: "var(--default-gap)" }}>
                {isGetInventoryLoading ? (
                  <Skeleton animation="wave" variant="text" width={220} />
                ) : (
                  <Typography variant="body1" color="text.secondary">
                    Service Management Report
                  </Typography>
                )}
                {isGetInventoryLoading ? <Skeleton animation="wave" variant="rectangular" width={100} height={36} /> : <Button variant="contained">Create</Button>}
              </Box>
            </Grid2>
          </Grid2>
        </Grid2>
      </Grid2>

      <Box sx={{ gap: "var(--half-gap)", display: "flex", flexDirection: "column" }}>
        {isGetInventoryLoading ? <Skeleton animation="wave" variant="text" width={180} /> : <Typography variant="body1">History</Typography>}
        {isGetInventoryLoading ? <Skeleton animation="wave" variant="rectangular" width="100%" height={200} /> : <Table columns={columnsHistory} data={timelineItems} subRowAccessor="subRows" onRowSelect={() => {}} loading={isGetTimelineItemsLoading} />}
      </Box>

      {/* <Box sx={{ gap: "var(--half-gap)", display: "flex", flexDirection: "column" }}>
        {isGetInventoryLoading ? <Skeleton animation="wave" variant="text" width={180} /> : <Typography variant="body1">Documents</Typography>}
        {isGetInventoryLoading ? <Skeleton animation="wave" variant="rectangular" width="100%" height={200} /> : <Table columns={columnsDocuments} data={documents} onRowSelect={() => {}} />}
      </Box> */}
    </Box>
  );
}
