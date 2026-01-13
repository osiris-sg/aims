"use client";
import React, { useState } from "react";
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  Skeleton,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import EditIcon from "@mui/icons-material/Edit";
import { useQuantityHistory } from "../hooks/useQuantityAdjustment";
import { format } from "date-fns";

interface QuantityHistoryTableProps {
  assetId: string;
}

export default function QuantityHistoryTable({ assetId }: QuantityHistoryTableProps) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const { data, isLoading } = useQuantityHistory({
    assetId,
    page: page + 1, // API is 1-indexed
    limit: rowsPerPage,
  });

  const adjustments = data?.docs || [];
  const totalCount = data?.totalDocuments || 0;

  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const getAdjustmentIcon = (type: string) => {
    switch (type) {
      case "ADD":
        return <AddIcon fontSize="small" color="success" />;
      case "SUBTRACT":
        return <RemoveIcon fontSize="small" color="error" />;
      case "SET":
        return <EditIcon fontSize="small" color="info" />;
      default:
        return undefined;
    }
  };

  const getAdjustmentColor = (type: string): "success" | "error" | "info" | "default" => {
    switch (type) {
      case "ADD":
        return "success";
      case "SUBTRACT":
        return "error";
      case "SET":
        return "info";
      default:
        return "default";
    }
  };

  const formatAdjustmentText = (adjustment: any) => {
    switch (adjustment.adjustmentType) {
      case "ADD":
        return `+${adjustment.amount}`;
      case "SUBTRACT":
        return `-${adjustment.amount}`;
      case "SET":
        return `Set to ${adjustment.newQty}`;
      default:
        return adjustment.amount;
    }
  };

  if (isLoading) {
    return (
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Quantity History
        </Typography>
        <Skeleton variant="rectangular" height={200} />
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Quantity History
      </Typography>

      {adjustments.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <Typography color="text.secondary">No adjustment history yet</Typography>
        </Box>
      ) : (
        <>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Change</TableCell>
                  <TableCell align="right">Previous</TableCell>
                  <TableCell align="right">New</TableCell>
                  <TableCell>Adjusted By</TableCell>
                  <TableCell>Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {adjustments.map((adjustment: any) => (
                  <TableRow key={adjustment.id} hover>
                    <TableCell>
                      <Typography variant="body2">
                        {format(new Date(adjustment.adjustedAt), "MMM d, yyyy")}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {format(new Date(adjustment.adjustedAt), "h:mm a")}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        icon={getAdjustmentIcon(adjustment.adjustmentType)}
                        label={adjustment.adjustmentType}
                        size="small"
                        color={getAdjustmentColor(adjustment.adjustmentType)}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        color={
                          adjustment.adjustmentType === "ADD"
                            ? "success.main"
                            : adjustment.adjustmentType === "SUBTRACT"
                            ? "error.main"
                            : "info.main"
                        }
                      >
                        {formatAdjustmentText(adjustment)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.secondary">
                        {adjustment.previousQty}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={500}>
                        {adjustment.newQty}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{adjustment.adjustedBy}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {adjustment.reason || "-"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            rowsPerPageOptions={[5, 10, 25]}
            component="div"
            count={totalCount}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={handleChangePage}
            onRowsPerPageChange={handleChangeRowsPerPage}
          />
        </>
      )}
    </Paper>
  );
}
