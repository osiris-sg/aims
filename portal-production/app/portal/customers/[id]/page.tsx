"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import { Avatar, Box, Skeleton, Stack, Typography } from "@mui/material";
import Table from "@/components/Table";
import { Button, IconButton } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { ColumnDef } from "@tanstack/react-table";
import AddSiteOffice from "./components/AddSiteOffice";
import { useGetSiteOffices } from "./hooks/useGetSiteOffices";
import { toast } from "react-toastify";
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
  // --- Site Offices State and Fetch Logic ---
  const { siteOffices, isLoading: isLoadingSiteOffices, refetch: refetchSiteOffices } = useGetSiteOffices();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAddDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedSiteOffice, setSelectedSiteOffice] = useState<any | null>(null);

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

  const siteOfficeColumns: ColumnDef<any>[] = [
    {
      accessorKey: "name",
      header: "Name",
    },
    {
      accessorKey: "address",
      header: "Address",
    },
    {
      accessorKey: "contacts",
      header: "Contact(s)",
      cell: ({ row }) => row.original.contactDetails?.map((cd: any) => `${cd.name} (${cd.phone})`).join(", ") || "-",
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }) => (
        <Box sx={{ display: "flex", gap: "var(--default-gap)" }}>
          <IconButton
            onClick={() => {
              setSelectedSiteOffice(row.original);
              setAddDialogOpen(true);
            }}
          >
            <EditIcon />
          </IconButton>
          <IconButton
            onClick={async () => {
              try {
                const token = await getToken();
                if (!token) throw new Error("No token available");

                const response = await request(
                  {
                    path: `/customers/site-offices/${row.original.id}`,
                    method: "DELETE",
                  },
                  {},
                  token
                );

                if (response.success) {
                  console.log("Deleted site office:", row.original.id);
                  toast.success("Site Office deleted successfully!");
                  refetchSiteOffices();
                } else {
                  console.error("Failed to delete site office:", response);
                  toast.error("Failed to delete Site Office.");
                }
              } catch (error) {
                console.error("Error deleting site office:", error);
                toast.error("An error occurred while deleting the Site Office.");
              }
            }}
            color="error"
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

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
                fontSize: "3rem",
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

                {/* Site Offices Section */}
                <Box sx={{ mt: 4, gap: 2 }}>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    Site Offices
                  </Typography>
                  <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
                    <Button variant="outlined" onClick={() => setAddDialogOpen(true)}>
                      Add Site Office
                    </Button>
                  </Box>
                  {isLoadingSiteOffices ? <Skeleton variant="rectangular" width="100%" height={200} /> : <Table columns={siteOfficeColumns} data={siteOffices} onRowSelect={() => {}} />}
                </Box>
              </>
            )}
          </Stack>
        </Box>
      </Box>
      <AddSiteOffice
        open={isAddDialogOpen}
        siteOffice={selectedSiteOffice}
        onClose={() => {
          setAddDialogOpen(false);
          setSelectedSiteOffice(null);
        }}
      />
    </MainCard>
  );
}
