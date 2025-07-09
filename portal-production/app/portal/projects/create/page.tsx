"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { Box, Button, Chip, Divider, IconButton, Stack, Typography } from "@mui/material";
import { FormProvider } from "react-hook-form";
import { ROUTES } from "@/routes";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useTheme } from "@mui/material/styles";
import CustomStepper from "@/components/CustomStepper";
import { useAddProjectFormHandler } from "../hooks/useAddProjectFormHandler";
import AssetCreation from "../components/AssetCreation";
import AdditionalDetails from "../components/AdditionalDetails";
import LastStep from "../components/LastStep";
import AddAssetSuccess from "../components/AddAssetSuccess";

export default function AddAssetPage() {
  const theme = useTheme();
  const router = useRouter();
  const { activeStep, handleNext, handleBack, methods, handleSubmit, isAssetUpdating, isSkuCheckInProgress, isSkuKeyAvailable, error, isEditMode } = useAddProjectFormHandler();

  const steps = isEditMode ? ["Edit Project", "Add Items (Optional)", "Confirm Changes"] : ["Project Creation", "Add Items (Optional)", "Review"];

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
          <IconButton onClick={() => router.push(ROUTES.PROJECTS)}>
            <ArrowBackIcon color="action" />
          </IconButton>
          <Typography variant="body1">All Projects</Typography>
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
                {activeStep === 0 ? (isEditMode ? "Edit Project" : "Project Creation") : activeStep === 1 ? "Add Items From Your Inventory" : "Confirm Changes"}
              </Typography>

              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {activeStep === 0
                  ? isEditMode
                    ? "Edit the details of this project. Ensure all fields are accurate before saving."
                    : "Create a new project by filling in the information below. Each project can include multiple asset assignments. You can manage inventories later from the inventory page."
                  : activeStep === 1
                  ? "Fill up optional details about the asset. You can choose to edit these details later."
                  : "Confirm the details of this asset. Once confirmed, the asset will be updated shortly."}
              </Typography>
            </Box>

            {error && (
              <Typography color="error" sx={{ mb: 2 }}>
                {error}
              </Typography>
            )}

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
              <Button variant="outlined" onClick={() => router.push(ROUTES.PROJECTS)}>
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
              <Button variant="contained" disabled={isAssetUpdating} onClick={handleSubmit()}>
                {isAssetUpdating ? (isEditMode ? "Saving..." : "Creating...") : isEditMode ? "Save Changes" : "Submit"}
              </Button>
            )}
          </Stack>
        </Box>
      </Box>
    </FormProvider>
  );
}
