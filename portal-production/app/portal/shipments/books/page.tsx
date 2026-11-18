"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import { BOOKS_ROUTE } from "@/helpers/shipmentsNav";

/** Books lands on FX rates. */
export default function BooksHome() {
  const router = useRouter();
  useEffect(() => router.replace(`${BOOKS_ROUTE}/fx-rates`), [router]);
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress />
    </Box>
  );
}
