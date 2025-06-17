"use client";

import React from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

export default function AddAssetSuccess() {
  const router = useRouter();

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--double-gap)",
        maxWidth: "1200px",
        mx: "auto",
        px: 3,
        pt: 8,
      }}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
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
        {/* <CheckCircleIcon sx={{ fontSize: 80, color: "success.main" }} /> */}

        {/* <Stack spacing="var(--default-gap)" alignItems="center">
          <Typography variant="h4" sx={{ color: "text.secondary", textAlign: "center" }}>
            Asset Created Successfully
          </Typography>

          <Typography variant="body1" sx={{ color: "text.secondary", textAlign: "center" }}>
            Your asset has been created successfully. You can now add items to this asset in the inventory page.
          </Typography>
        </Stack>

        <Stack direction="row" spacing="var(--default-gap)" sx={{ mt: 2 }}>
          <Button variant="outlined" onClick={() => router.push(ROUTES.ASSETS)}>
            Go to Assets
          </Button>
          <Button variant="contained" onClick={() => router.push(ROUTES.INVENTORY)}>
            Add Item to Inventory
          </Button>
        </Stack> */}
        <Stack direction="column" justifyContent="center" alignItems="center" height="100%">
          <Box fontSize={70}>🎉</Box>
          <Typography variant="body1" sx={{ textAlign: "center" }}>
            Project Created <br /> Successfully
          </Typography>
          <Typography variant="body2" color="text.secondary" my="var(--default-gap)">
            Your new project has been created successfully
          </Typography>
          <Stack direction="row" spacing={2} justifyContent="center">
            <Button variant="contained" color="secondary" onClick={() => router.push(ROUTES.PROJECTS)}>
              Done
            </Button>
            {/* change when i do project detials page */}
            <Button variant="contained" color="secondary" onClick={() => router.push(ROUTES.INVENTORY)}>
              <Typography sx={{ lineHeight: "1.2" }}>
                Assign Items <br />
                To Project
              </Typography>
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
