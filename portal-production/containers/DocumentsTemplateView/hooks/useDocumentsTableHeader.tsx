/* eslint-disable @typescript-eslint/no-explicit-any */
import { IconButton } from "@mui/material";
import { Box } from "@mui/material";
import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import ModeEditIcon from "@mui/icons-material/ModeEdit";
// import DeleteIcon from "@mui/icons-material/Delete";
// import useDeleteDocumentHandler from "./useDeleteDocumentHandler";
import useEditDocumentHandler from "./useEditDocumentHandler";

export default function useDocumentsTableHeader() {
  // const { setDocumentToDelete } = useDeleteDocumentHandler();
  const { handleEdit } = useEditDocumentHandler();

  const columns: ColumnDef<any>[] = [
    {
      accessorKey: "name",
      header: "Document Name",
      cell: ({ row }) => {
        // If it's a subrow, render the document info
        if (row.original.document) {
          return (
            <Link href={row.original.link} style={{ textDecoration: "none", color: "secondary.main", paddingLeft: "var(--default-padding)" }}>
              {row.original.document}
            </Link>
          );
        }
        // Otherwise render the normal log message
        return row.original.name;
      },
    },
    {
      accessorKey: "action",
      header: "Actions",
      cell: ({ row }) => (
        <Box sx={{ display: "flex", gap: "var(--default-gap)" }}>
          <IconButton
            onClick={() => handleEdit(row.original)}
            sx={{
              color: "text.secondary",
              "&:hover": { color: "info.main" },
            }}
          >
            <ModeEditIcon />
          </IconButton>
          {/* <IconButton
            onClick={() => setDocumentToDelete(row.original.id)}
            sx={{
              color: "text.secondary",
              "&:hover": { color: "error.main" },
            }}
          >
            <DeleteIcon />
          </IconButton> */}
        </Box>
      ),
    },
  ];

  return { columns };
}
