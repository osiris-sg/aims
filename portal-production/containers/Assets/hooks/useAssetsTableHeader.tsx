/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Avatar, IconButton, Typography } from "@mui/material";
import { Box } from "@mui/material";
import { ColumnDef } from "@tanstack/react-table";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ModeEditIcon from "@mui/icons-material/ModeEdit";
import DeleteIcon from "@mui/icons-material/Delete";
import useDeleteAssetHandler from "./useDeleteAssetHandler";
import { useSelector } from "react-redux";
import { selectCategories } from "../slice/selectors";
import useViewAssetHandler from "./useViewAssetHandler";
import useEditAssetHandler from "./useEditAssetHandler";

export default function useAssetsTableHeader() {
  const { setAssetToDelete } = useDeleteAssetHandler();
  const categories = useSelector(selectCategories);
  const { handleView } = useViewAssetHandler();
  const { handleEdit } = useEditAssetHandler();

  const columns: ColumnDef<any>[] = [
    {
      accessorKey: "skuKey",
      header: "SKU-Key",
    },
    {
      accessorKey: "name",
      header: "Asset Name",
    },
    {
      accessorKey: "image",
      header: "Image",
      cell: ({ row }) => {
        const imageUrl = row.original.image;
        return <Avatar src={`${process.env.NEXT_PUBLIC_RESOURCE_URL}${imageUrl}`} alt="Image" sx={{ borderRadius: "0.4rem", width: 50, height: 50 }} />;
      },
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => <Typography variant="body2">{categories.find((item) => item.id === row.original.categoryId)?.name}</Typography>,
    },
    {
      accessorKey: "inStockInventoryCount",
      header: "Status-In Stock",
    },
    {
      accessorKey: "status",
      header: "Status",
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
          <IconButton
            onClick={() => handleEdit(row.original)}
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
          </IconButton>
          <IconButton
            onClick={() => setAssetToDelete(row.original.id)}
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
