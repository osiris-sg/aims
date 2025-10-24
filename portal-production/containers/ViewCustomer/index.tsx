"use client";

import { Avatar, Box, Skeleton, Stack, Typography } from "@mui/material";
import useGetCustomer from "./hooks/useGetCustomer";

export default function ViewCustomer() {
  const { customer, isGetCustomerLoading } = useGetCustomer();

  return (
    <Box sx={{ gap: "var(--default-gap)", display: "flex", flexDirection: "column" }}>
      <Typography variant="body1" color="text.secondary">
        Customer / <strong>{isGetCustomerLoading ? <Skeleton width={120} /> : customer?.name}</strong>
      </Typography>

      <Box display="flex" flexDirection="column" alignItems="center" gap={5}>
        {isGetCustomerLoading ? (
          <Skeleton variant="circular" width={120} height={120} />
        ) : (
          <Avatar
            alt={customer?.name}
            src="/avatar-placeholder.png"
            sx={{
              width: 120,
              height: 120,
              fontSize: "3rem",
              bgcolor: "primary.main",
              color: "white",
            }}
          >
            {customer?.name?.charAt(0)}
          </Avatar>
        )}

        <Stack spacing={2} alignItems="center">
          {isGetCustomerLoading ? (
            <>
              <Skeleton variant="text" width={200} height={40} />
              <Skeleton variant="text" width={250} height={30} />
              <Skeleton variant="text" width={220} height={30} />
              <Skeleton variant="text" width={300} height={30} />
            </>
          ) : (
            <>
              <Typography variant="h2" fontWeight={600}>
                {customer?.name || "-"}
              </Typography>

              <Typography variant="h4" color="text.secondary">
                <strong>Email:</strong> {customer?.email || "-"}
              </Typography>
              <Typography variant="h4" color="text.secondary">
                <strong>Phone:</strong> {customer?.phone || "-"}
              </Typography>
              <Typography variant="h4" color="text.secondary" textAlign="center">
                <strong>Address:</strong> {customer?.address || "-"}
              </Typography>
            </>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
