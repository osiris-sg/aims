"use client";

import React, { useState, useEffect } from "react";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import { Avatar, Box, Skeleton, Stack, Typography } from "@mui/material";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  createdAt: string;
}

export default function ViewCustomerPage({ params }: { params: { id: string } }) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchCustomer = async () => {
    if (!organizationId) return;
    setIsLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/customers/${params.id}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        setCustomer(response.data);
      }
    } catch (error) {
      console.error("Error fetching customer:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomer();
  }, [organizationId, params.id]);

  return (
    <MainCard>
      <Box sx={{ gap: "var(--default-gap)", display: "flex", flexDirection: "column" }}>
        <Typography variant="body1" color="text.secondary">
          Customer / <strong>{isLoading ? <Skeleton width={120} /> : customer?.name}</strong>
        </Typography>

        <Box display="flex" flexDirection="column" alignItems="center" gap={5}>
          {isLoading ? (
            <Skeleton variant="circular" width={120} height={120} />
          ) : (
            <Avatar
              alt={customer?.name}
              src="/avatar-placeholder.png"
              sx={{
                width: 120,
                height: 120,
                fontSize: 48,
                bgcolor: "primary.main",
                color: "white",
              }}
            >
              {customer?.name?.charAt(0)}
            </Avatar>
          )}

          <Stack spacing={2} alignItems="center">
            {isLoading ? (
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
    </MainCard>
  );
}
