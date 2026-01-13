"use client";

import { Box, Typography } from "@mui/material";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";

export default function SalesPage() {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "60vh",
        gap: 2,
      }}
    >
      <DescriptionOutlinedIcon sx={{ fontSize: 64, color: "text.secondary" }} />
      <Typography variant="h5" color="text.secondary">
        Please click on any of the documents to start editing
      </Typography>
    </Box>
  );
}
