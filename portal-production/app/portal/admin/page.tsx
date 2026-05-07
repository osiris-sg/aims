"use client";

import React, { useState, useEffect } from "react";
import { Box, Grid, Card, CardContent, Typography, Button, Chip, CircularProgress } from "@mui/material";
import { Business as OrganizationIcon, Inventory as InventoryIcon, Description as DocumentIcon, People as CustomersIcon, Settings as AssetIcon, Dashboard as ProjectIcon, Person as PeopleIcon } from "@mui/icons-material";
import { useRouter } from "next/navigation";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";

interface DashboardStats {
  totalOrganizations: number;
  totalAssets: number;
  totalInventories: number;
  totalCustomers: number;
  totalDocuments: number;
  totalDocumentTemplates: number;
  totalProjects: number;
  totalUserOrganizations: number;
  totalUserRoles: number;
  totalUsers: number;
}

interface Organization {
  id: string;
  name: string;
  _count: {
    assets: number;
    inventories: number;
    customers: number;
    documents: number;
    documentTemplates: number;
    projects: number;
    userOrganizations: number;
  };
}

export default function AdminDashboard() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const token = await getToken();

      if (!token) {
        console.error("No authentication token available");
        return;
      }

      const [statsResponse, orgsResponse] = await Promise.all([request({ path: "/admin/dashboard/stats", method: "GET" }, {}, token), request({ path: "/admin/organizations", method: "GET" }, {}, token)]);

      if (statsResponse.success) {
        setStats(statsResponse.data);
      }

      if (orgsResponse.success) {
        setOrganizations(orgsResponse.data);
      }
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const navigateToSection = (section: string) => {
    router.push(`/portal/admin/${section}`);
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  const statsCards = [
    { title: "Organizations", value: stats?.totalOrganizations || 0, icon: <OrganizationIcon />, color: "primary.main", path: "organizations" },
    { title: "Total Assets", value: stats?.totalAssets || 0, icon: <AssetIcon />, color: "success.dark", path: "assets" },
    { title: "Total Inventories", value: stats?.totalInventories || 0, icon: <InventoryIcon />, color: "customYellow.dark", path: "inventories" },
    { title: "Total Customers", value: stats?.totalCustomers || 0, icon: <CustomersIcon />, color: "secondary.main", path: "customers" },
    { title: "Total Documents", value: stats?.totalDocuments || 0, icon: <DocumentIcon />, color: "customRed.main", path: "documents" },
    { title: "Total Projects", value: stats?.totalProjects || 0, icon: <ProjectIcon />, color: "text.primary", path: "projects" },
    { title: "Total Users", value: stats?.totalUsers || 0, icon: <PeopleIcon />, color: "text.primary", path: "users" },
  ];

  return (
    <Box>
      {/* Stats Overview */}
      <Typography variant="h5" sx={{ mb: 3, fontWeight: "bold" }}>
        Platform Overview
      </Typography>

      <Grid container spacing={3} sx={{ mb: 4 }}>
        {statsCards.map((card, index) => (
          <Grid item xs={12} sm={6} md={4} key={index}>
            <Card
              sx={{
                cursor: "pointer",
                transition: "transform 0.2s",
                "&:hover": { transform: "translateY(-4px)" },
              }}
              onClick={() => navigateToSection(card.path)}
            >
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Box>
                    <Typography variant="h4" sx={{ fontWeight: "bold", color: card.color }}>
                      {card.value}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      {card.title}
                    </Typography>
                  </Box>
                  <Box sx={{ color: card.color, fontSize: "2rem" }}>{card.icon}</Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Organizations Quick View */}
      <Typography variant="h5" sx={{ mb: 3, fontWeight: "bold" }}>
        Organizations Quick View
      </Typography>

      <Grid container spacing={2}>
        {organizations.map((org) => (
          <Grid item xs={12} md={6} lg={4} key={org.id}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: "bold", mb: 2 }}>
                  {org.name}
                </Typography>

                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
                  <Chip label={`${org._count.assets} Assets`} size="small" color="primary" />
                  <Chip label={`${org._count.inventories} Inventory`} size="small" color="secondary" />
                  <Chip label={`${org._count.customers} Customers`} size="small" color="success" />
                  <Chip label={`${org._count.documents} Documents`} size="small" color="warning" />
                  <Chip label={`${org._count.userOrganizations} Users`} size="small" color="info" />
                </Box>

                <Button variant="outlined" size="small" onClick={() => router.push(`/portal/admin/organizations/${org.id}`)}>
                  View Details
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
