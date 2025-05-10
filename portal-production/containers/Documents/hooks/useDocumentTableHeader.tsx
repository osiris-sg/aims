/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { ColumnDef } from "@tanstack/react-table";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ModeEditIcon from "@mui/icons-material/ModeEdit";
import { Box, IconButton, Typography } from "@mui/material";
import React, { useState } from "react";
import moment from "moment";
// Removed: import useDeleteDocumentHandler from "./useDeleteDocumentHandler";
import useViewInventoryHandler from "./useViewInventoryHandler";
import { useGetAssets } from "./useGetAssets";
import { useGetCountries } from "./useGetCountries";
import useViewQRHandler from "./useViewQRHandler";
import { on } from "events";
export default function useDocumentTableHeader() {
  // const categories = useSelector(selectCategories);
  // Removed: const { setDocumentToDelete, onDeleteConfirm } = useDeleteDocumentHandler();
  const { handleView } = useViewInventoryHandler();
  const { openQRDialog } = useViewQRHandler();

  const { assets, categories } = useGetAssets();

  // Removed: const [confirmOpen, setConfirmOpen] = useState(false);
  // Removed: const [deleteId, setDeleteId] = useState<string | null>(null);

  const columns: ColumnDef<any>[] = [
    {
      accessorKey: "id",
      header: "Document ID",
    },
    {
      accessorKey: "name",
      header: "Document Name",
    },
    {
      accessorKey: "associated_item",
      header: "Associated Item",
    },
    {
      accessorKey: "associated_customer",
      header: "Associated Customer",
    },
    {
      accessorKey: "createdAt",
      header: "Created Date",
      cell: ({ row }) => moment(row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }) => (
        <Box sx={{ display: "flex", gap: "var(--default-gap)" }}>
          <IconButton
            onClick={() => handleView(row.original)}
            sx={{
              color: "customYellow.contrastText",
              bgcolor: "customYellow.main",
              "&:hover": {
                bgcolor: "customYellow.dark",
              },
              borderRadius: "8px",
            }}
          >
            <VisibilityIcon />
          </IconButton>
          {/* <IconButton
            onClick={() => {}}
            sx={{
              borderRadius: "8px",
              color: "secondary.contrastText",
              bgcolor: "secondary.main",
              "&:hover": {
                bgcolor: "secondary.dark",
              },
            }}
          >
            <ModeEditIcon />
          </IconButton> */}
          {/* Removed Delete IconButton */}
        </Box>
      ),
    },
  ];

  return {
    columns,
    // Removed deleteDialog from return
  };
}
