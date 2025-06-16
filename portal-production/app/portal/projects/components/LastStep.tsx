import React from "react";
import { Stack, Typography, Table, TableHead, TableRow, TableCell, TableBody, Box, Skeleton } from "@mui/material";
import { useFormContext, useWatch } from "react-hook-form";
import { useGetCustomers } from "../hooks/useGetCustomers";

export default function LastStep() {
  const { control, getValues } = useFormContext();
  const assignments = useWatch({ control, name: "assignments" }) || [];
  const { customers, isLoading } = useGetCustomers();
  const customerId = useWatch({ control, name: "customerId" });
  const selectedCustomer = customers.find((c) => c.id === customerId);
  console.log("Selected Customer:", selectedCustomer);

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="body2" fontWeight={500}>
          Project Name
        </Typography>
        <Typography variant="body1">{getValues("name")}</Typography>
      </Box>
      {isLoading ? (
        <Skeleton width={200} />
      ) : (
        <Box>
          <Typography variant="body2" fontWeight={500}>
            Customer
          </Typography>
          <Typography variant="body1">{selectedCustomer?.name || "Unknown"}</Typography>
        </Box>
      )}
      <Box>
        <Typography variant="body2" fontWeight={500}>
          Start Date
        </Typography>
        <Typography variant="body1">{getValues("startDate")?.toString()}</Typography>
      </Box>
      <Box>
        <Typography variant="body2" fontWeight={500}>
          End Date
        </Typography>
        <Typography variant="body1">{getValues("endDate")?.toString()}</Typography>
      </Box>
      <Box>
        <Typography variant="body2" fontWeight={500}>
          Status
        </Typography>
        <Typography variant="body1">{getValues("status")}</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Assignments
        </Typography>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>SKU Key</TableCell>
              <TableCell>Inventory ID</TableCell>
              <TableCell>Start Date</TableCell>
              <TableCell>End Date</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {assignments.map((item: any, index: number) => (
              <TableRow key={index}>
                <TableCell>{item.skuKey}</TableCell>
                <TableCell>{item.inventoryId}</TableCell>
                <TableCell>{item.startDate?.toString()}</TableCell>
                <TableCell>{item.endDate?.toString()}</TableCell>
                <TableCell>{item.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  );
}
