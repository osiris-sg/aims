import { ROUTES } from "@/routes";
import { Box } from "@mui/material";
import { redirect } from "next/navigation";
import React from "react";

export default function page() {
  redirect(ROUTES.INVENTORY);

  return <Box></Box>;
}
