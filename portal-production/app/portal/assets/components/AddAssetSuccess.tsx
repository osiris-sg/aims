"use client";

import { ROUTES } from "@/routes";
import { Box, Typography, Stack, Button } from "@mui/material";
import { useRouter } from "next/navigation";
import React from "react";

export default function AddAssetSuccess() {
  const router = useRouter();

  const handleAddInventory = () => {
    router.push(ROUTES.INVENTORY);
  };

  return (
    <Stack direction="column" justifyContent="center" alignItems="center" height="100%">
      <Box fontSize={70}>🎉</Box>
      <Typography variant="body1" sx={{ textAlign: "center" }}>
        Product Added <br /> Successfully
      </Typography>
      <Typography variant="body2" color="text.secondary" my="var(--default-gap)">
        Your new product has been added successfully
      </Typography>
      <Stack direction="row" spacing={2} justifyContent="center">
        <Button variant="contained" color="secondary" onClick={() => router.push(ROUTES.ASSETS)}>
          Done
        </Button>
        <Button variant="contained" color="secondary" onClick={handleAddInventory}>
          <Typography sx={{ lineHeight: "1.2" }}>
            Add Item <br />
            To Inventory
          </Typography>
        </Button>
      </Stack>
    </Stack>
  );
}
