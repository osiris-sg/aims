/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { ColumnDef } from "@tanstack/react-table";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ModeEditIcon from "@mui/icons-material/ModeEdit";
import DeleteIcon from "@mui/icons-material/Delete";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import { Box, IconButton, Typography } from "@mui/material";
import React from "react";
import moment from "moment";
import useDeleteInventoryHandler from "./useDeleteInventoryHandler";
import useViewInventoryHandler from "./useViewInventoryHandler";
import { useGetAssets } from "./useGetAssets";
import { useGetCountries } from "./useGetCountries";
import useViewQRHandler from "./useViewQRHandler";
export default function useInventoryTableHeader() {
  // const categories = useSelector(selectCategories);
  const { setInventoryToDelete } = useDeleteInventoryHandler();
  const { handleView } = useViewInventoryHandler();
  const { openQRDialog } = useViewQRHandler();

  const { assets, categories } = useGetAssets();

  const columns: ColumnDef<any>[] = [
    {
      accessorKey: "sku",
      header: "SKU",
    },
    {
      accessorKey: "name",
      header: "Asset Name",
      cell: ({ row }) => {
        const asset = assets.docs.find((item) => item.id === row.original.assetId);
        return <Typography variant="body2">{asset ? asset.name : "N/A"}</Typography>;
      },
    },
    {
      accessorKey: "category",
      header: "Category",
      // cell: ({ row }) => {
      //   const asset = assets.docs.find((item) => item.id === row.original.asset);
      //   const category = categories.find((item) => item.id === asset?.category);
      //   return <Typography variant="body2">{category ? category.name : "N/A"}</Typography>;
      // },
    },
    {
      accessorKey: "status",
      header: "Status",
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
            onClick={() => openQRDialog(row.original.sku)}
            sx={{
              color: "customYellow.contrastText",
              bgcolor: "tertiary.dark",
              "&:hover": {
                bgcolor: "gray",
              },
              borderRadius: "8px",
            }}
          >
            <QrCode2Icon />
          </IconButton>
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
          <IconButton
            onClick={() => setInventoryToDelete(row.original.id)}
            sx={{
              color: "customRed.contrastText",
              bgcolor: "customRed.main",
              "&:hover": {
                bgcolor: "customRed.dark",
              },
              borderRadius: "8px",
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
