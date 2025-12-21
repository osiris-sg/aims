"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { Box, Button, Chip, Divider, IconButton, Stack, Typography } from "@mui/material";
import { FormProvider } from "react-hook-form";
import { ROUTES } from "@/routes";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useTheme } from "@mui/material/styles";
import CustomStepper from "@/components/CustomStepper";
import { useAddAssetFormHandler } from "../hooks/useAddAssetFormHandler";
import AssetCreation from "../components/AssetCreation";
import AdditionalDetails from "../components/AdditionalDetails";
import LastStep from "../components/LastStep";
import AddAssetSuccess from "../components/AddAssetSuccess";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

export default function AddAssetPage() {
  const theme = useTheme();
  const router = useRouter();
  const { activeStep, handleNext, handleBack, methods, handleSubmit, onSubmit, isAssetUpdating, isSkuCheckInProgress, isSkuKeyAvailable, error, isEditMode, logFormState } = useAddAssetFormHandler();

  // Get organization's tracking mode - ON = Assets, OFF = Products
  const { isAssetTrackingModeEnabled } = useOrganizationFeatures();
  const itemType = isAssetTrackingModeEnabled ? "Asset" : "Product";

  const steps = isEditMode
    ? [`Edit ${itemType}`, "Additional Details", "Confirm Changes"]
    : [`${itemType} Creation`, "Additional Details", "Review"];

  if (!isEditMode && activeStep === 3) {
    return <AddAssetSuccess />;
  }

  return (
    <FormProvider {...methods}>
      <Box
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "var(--double-gap)",
          maxWidth: "1200px",
          mx: "auto",
          px: 3,
          pt: 8,
        }}
      >
        <Stack direction="row" spacing="var(--default-gap)" alignItems="center">
          <IconButton onClick={() => router.push(ROUTES.ASSETS)}>
            <ArrowBackIcon color="action" />
          </IconButton>
          <Typography variant="body1">All {itemType}s</Typography>
          <Chip label={isEditMode ? "Editing" : "In progress"} sx={{ color: theme.palette.primary.light }} />
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
            bgcolor: "white",
            borderRadius: 1,
            p: 3,
            mt: 0,
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
                {activeStep === 0 ? (isEditMode ? `Edit ${itemType}` : `${itemType} Creation`) : activeStep === 1 ? `Additional ${itemType} Details` : "Confirm Changes"}
              </Typography>

              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {activeStep === 0
                  ? isEditMode
                    ? `Edit the details of this ${itemType.toLowerCase()}. Ensure all fields are accurate before saving.`
                    : isAssetTrackingModeEnabled
                      ? 'Add a new asset to the inventory by filling the details below. Every asset must have a unique identifier (SKUKEY) to help you identify different assets. If you wish to increase/decrease quantity to an existing asset, please head over to the inventory page and use "Add Item" instead.'
                      : 'Add a new product by filling the details below. Every product must have a unique identifier (SKUKEY) to help you identify different products.'
                  : activeStep === 1
                  ? `Fill up optional details about the ${itemType.toLowerCase()}. You can choose to edit these details later.`
                  : `Confirm the details of this ${itemType.toLowerCase()}. Once confirmed, the ${itemType.toLowerCase()} will be updated shortly.`}
              </Typography>
            </Box>

            {error && (
              <Typography color="error" sx={{ mb: 2 }}>
                {error}
              </Typography>
            )}

            <form
              onSubmit={(e) => {
                console.log("=== FORM SUBMIT EVENT TRIGGERED ===");
                console.log("Event:", e);
                console.log("Calling handleSubmit(onSubmit)...");
                const result = handleSubmit(onSubmit)(e);
                console.log("handleSubmit result:", result);
              }}
              style={{ height: "100%", display: "flex", flexDirection: "column" }}
            >
              <div style={{ flex: 1 }}>
                {activeStep === 0 && <AssetCreation />}
                {activeStep === 1 && <AdditionalDetails />}
                {activeStep === 2 && <LastStep />}
              </div>

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
                  <>
                    <Button
                      variant="contained"
                      disabled={isAssetUpdating}
                      type="submit"
                      onClick={() => {
                        console.log("=== SAVE CHANGES BUTTON CLICKED ===");
                        console.log("Is asset updating:", isAssetUpdating);
                        console.log("Is edit mode:", isEditMode);
                      }}
                    >
                      {isAssetUpdating ? (isEditMode ? "Saving..." : `Creating ${itemType}...`) : isEditMode ? "Save Changes" : `Create ${itemType}`}
                    </Button>
                  </>
                )}
              </Stack>
            </form>
          </Stack>
        </Box>
      </Box>
    </FormProvider>
  );
}
