import { createColumnHelper } from "@tanstack/react-table";
import { Typography, Chip } from "@mui/material";

const columnHelper = createColumnHelper<any>();

export default function useProjectsTableHeader() {
  const columns = [
    columnHelper.accessor("name", {
      header: "Project Name",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {info.getValue()}
        </Typography>
      ),
    }),
    columnHelper.accessor("organization.name", {
      header: "Organization",
      cell: (info) => <Chip label={info.getValue() || "Unknown"} size="small" variant="outlined" />,
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => <Chip label={info.getValue() || "Unknown"} size="small" color="primary" />,
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
