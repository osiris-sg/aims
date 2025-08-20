import { createColumnHelper } from "@tanstack/react-table";
import { Typography, Chip, IconButton, Box } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { getDocumentTypeDisplayNameWithDefaults } from "@/helpers/documentTypeHelper";

const columnHelper = createColumnHelper<any>();

export default function useDocumentsTableHeader() {
  const columns = [
    columnHelper.accessor("type", {
      header: "Document Type",
      cell: (info) => {
        const documentType = info.getValue();
        const organization = info.row.original.organization;
        const displayName = getDocumentTypeDisplayNameWithDefaults(documentType, organization);
        return <Typography variant="body2">{displayName}</Typography>;
      },
    }),
    columnHelper.accessor("organization.name", {
      header: "Organization",
      cell: (info) => <Chip label={info.getValue() || "Unknown"} size="small" variant="outlined" />,
    }),
    columnHelper.accessor("createdAt", {
      header: "Created",
      cell: (info) => <Typography variant="body2">{new Date(info.getValue()).toLocaleDateString()}</Typography>,
    }),
    columnHelper.accessor("id", {
      id: "actions",
      header: "Actions",
      cell: (info) => (
        <Box sx={{ display: "flex", gap: 1 }}>
          <IconButton size="small" sx={{ color: "primary.main" }}>
            <VisibilityIcon fontSize="small" />
          </IconButton>
        </Box>
      ),
    }),
  ];

  return {
    columns,
    deleteDialog: null,
  };
}
