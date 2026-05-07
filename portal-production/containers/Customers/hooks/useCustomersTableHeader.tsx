/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { ColumnDef } from "@tanstack/react-table";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ModeEditIcon from "@mui/icons-material/ModeEdit";
import DeleteIcon from "@mui/icons-material/Delete";
import { Box, IconButton } from "@mui/material";
import React from "react";
import moment from "moment";
import useDeleteCustomerHandler from "./useDeleteCustomerHandler";
import useViewCustomerHandler from "./useViewCustomerHandler";

export default function useCustomersTableHeader() {
  const { setCustomerToDelete } = useDeleteCustomerHandler();
  const { handleView } = useViewCustomerHandler();
  const columns: ColumnDef<any>[] = [
    {
      accessorKey: "name",
      header: "Name",
    },
    {
      accessorKey: "email",
      header: "Email",
    },
    {
      accessorKey: "phone",
      header: "Phone",
    },
    {
      accessorKey: "address",
      header: "Address",
    },
    {
      accessorKey: "createdAt",
      header: "Created Date",
      cell: ({ row }) => moment(row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "updatedAt",
      header: "Updated Date",
      cell: ({ row }) => moment(row.original.updatedAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }) => (
        <Box sx={{ display: "flex", gap: "var(--default-gap)" }}>
          <IconButton
            onClick={() => handleView(row.original)}
            sx={{
              color: "text.secondary",
              "&:hover": { color: "primary.main" },
            }}
          >
            <VisibilityIcon />
          </IconButton>
          <IconButton
            onClick={() => {}}
            sx={{
              color: "text.secondary",
              "&:hover": { color: "info.main" },
            }}
          >
            <ModeEditIcon />
          </IconButton>
          <IconButton
            onClick={() => setCustomerToDelete(row.original.id)}
            sx={{
              color: "text.secondary",
              "&:hover": { color: "error.main" },
            }}
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

  return { columns };
}
