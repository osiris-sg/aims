import { createColumnHelper } from "@tanstack/react-table";
import { Typography, Chip, IconButton, Box } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";

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
