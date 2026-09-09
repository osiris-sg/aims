import { createColumnHelper } from "@tanstack/react-table";
import { Typography, Chip } from "@mui/material";
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
  ];

  return {
    columns,
    deleteDialog: null,
  };
}
