"use client";

import { Box, Button, Chip, Divider, IconButton, Stack, Typography } from "@mui/material";
import React from "react";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useTheme } from "@mui/material/styles";
import AssetCreation from "./components/AssetCreation";
import CustomStepper from "@/components/CustomStepper";
import AdditionalDetails from "./components/AdditionalDetails";
import LastStep from "./components/LastStep";
import { FormProvider } from "react-hook-form";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";
import useAddAssetFormhandler from "./hooks/useAddAssetFormhandler";
import AddAssetSuccess from "./components/AddAssetSuccess";
import useGetAsset from "./hooks/useGetAsset";

export default function AddAsset() {
  const theme = useTheme();

  const { activeStep, handleBack, handleNext, methods, onSubmit, isAssetCreationSucceeded, isAssetUpdating, isSkuCheckInProgress, isSkuKeyAvailable } = useAddAssetFormhandler();

  const router = useRouter();
  const { handleSubmit } = methods;

  const { isEditMode } = useGetAsset();

  const steps = isEditMode ? ["Edit Asset", "Additional Details", "Confirm Changes"] : ["Asset Creation", "Additional Details", "Success"];
  return (
    <>
      {!isAssetCreationSucceeded ? (
        <FormProvider {...methods}>
          <Box
            sx={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              gap: "var(--double-gap)",
            }}
          >
            <Stack direction="row" spacing="var(--default-gap)" alignItems="center">
              <IconButton onClick={() => router.push(ROUTES.ASSETS)}>
                <ArrowBackIcon color="action" />
              </IconButton>
              <Typography variant="body1">All Assets</Typography>
              <Chip label="In progress" sx={{ color: theme.palette.primary.light }} />
            </Stack>

            <Box
              sx={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "2rem",
                width: "100%",
                maxWidth: "700px",
                mx: "auto",
              }}
            >
              <CustomStepper activeStep={activeStep} steps={steps} />

              <Divider />

              <Stack direction="column" spacing="var(--default-gap)">
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--half-gap)",
                  }}
                >
                  <Typography variant="h4" sx={{ color: "text.secondary" }}>
                    {activeStep === 0 ? (isEditMode ? "Edit Asset" : "Asset Creation") : activeStep === 1 ? "Additional Asset Details" : "Last Step"}
                  </Typography>

                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    {activeStep === 0
                      ? isEditMode
                        ? "Edit the details of this asset. Ensure all fields are accurate before saving."
                        : 'Add a new asset to the inventory by filling the details below. Every asset must have a unique identifier (SKUKEY) to help you identify different assets. If you wish to increase/decrease quantity to an existing asset, please head over to the inventory page and use "Add Item" instead.'
                      : activeStep === 1
                      ? "Fill up optional details about the asset. You can choose to edit these details later."
                      : "Confirm the details of this asset. Once confirmed, the asset will be created shortly. If you wish to add quantity, please head over to inventory to add items to this asset."}
                  </Typography>
                </Box>
                <form style={{ height: "100%" }}>
                  {activeStep === 0 && <AssetCreation />}
                  {activeStep === 1 && <AdditionalDetails />}
                  {activeStep === 2 && <LastStep />}
                </form>
              </Stack>

              <Stack
                direction="row"
                sx={{
                  justifyContent: "space-between",
                  py: "var(--quarter-gap)",
                  mt: "auto",
                }}
              >
                {activeStep === 0 && (
                  <Button variant="outlined" onClick={() => router.push(ROUTES.ASSETS)}>
                    Cancel
                  </Button>
                )}
                {(activeStep === 1 || activeStep === 2) && (
                  <Button variant="outlined" onClick={handleBack} disabled={isAssetUpdating}>
                    Back
                  </Button>
                )}
                {(activeStep === 0 || activeStep === 1) && (
                  <Button variant="contained" onClick={handleNext} disabled={isSkuCheckInProgress || !isSkuKeyAvailable}>
                    Next
                  </Button>
                )}
                {activeStep === 2 && (
                  <Button variant="contained" disabled={isAssetUpdating} onClick={handleSubmit(onSubmit)} loading={isAssetUpdating}>
                    {isEditMode ? "Save Changes" : "Submit"}
                  </Button>
                )}
              </Stack>
            </Box>
          </Box>
        </FormProvider>
      ) : (
        <AddAssetSuccess />
      )}
    </>
  );
}
