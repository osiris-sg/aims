"use client";
import * as React from "react";
import { styled, useTheme } from "@mui/material/styles";
import Avatar from "@mui/material/Avatar";
import MuiDrawer, { drawerClasses } from "@mui/material/Drawer";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import { UserButton, useUser } from "@clerk/nextjs";
import { useSidebar } from "./SidebarContext";
import { usePathname, useRouter } from "next/navigation";
import MenuIcon from "@mui/icons-material/Menu";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import ReceiptIcon from "@mui/icons-material/Receipt";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import BuildIcon from "@mui/icons-material/Build";
import DescriptionIcon from "@mui/icons-material/Description";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import FolderIcon from "@mui/icons-material/Folder";

const drawerWidth = 280;
const collapsedDrawerWidth = 64;

const Drawer = styled(MuiDrawer)<{ collapsed: boolean }>(({ collapsed }) => ({
  width: collapsed ? collapsedDrawerWidth : drawerWidth,
  flexShrink: 0,
  boxSizing: "border-box",
  transition: "width 0.3s ease",
  [`& .${drawerClasses.paper}`]: {
    width: collapsed ? collapsedDrawerWidth : drawerWidth,
    boxSizing: "border-box",
    transition: "width 0.3s ease",
    overflow: "hidden",
  },
}));

// Document types with their display names and icons
const DOCUMENT_TYPES = [
  {
    type: "INVOICE",
    label: "Invoice",
    shortLabel: "INV",
    icon: ReceiptIcon,
    description: "Tax Invoice",
  },
  {
    type: "DELIVERY_ORDER",
    label: "Delivery Order",
    shortLabel: "DO",
    icon: LocalShippingIcon,
    description: "Delivery Order",
  },
  {
    type: "QUOTATION",
    label: "Quotation",
    shortLabel: "QO",
    icon: RequestQuoteIcon,
    description: "Quotation",
  },
  {
    type: "RDO",
    label: "Return DO",
    shortLabel: "RDO",
    icon: AssignmentReturnIcon,
    description: "Return Delivery Order",
  },
  {
    type: "MSR",
    label: "Service Report",
    shortLabel: "MSR",
    icon: BuildIcon,
    description: "Material Service Report",
  },
];

export default function DocumentSidebar() {
  const theme = useTheme();
  const { user } = useUser();
  const { isCollapsed, toggleSidebar } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();

  // Extract current document type from pathname
  const pathSegments = pathname?.split("/").filter(Boolean) || [];
  const currentDocType = pathSegments[2] || ""; // e.g., INVOICE, DELIVERY_ORDER

  const handleBackToDocuments = () => {
    router.push("/portal/documents");
  };

  const handleDocTypeClick = (docType: string) => {
    // Navigate to create new document of this type
    // For now, just go to documents list filtered by type
    router.push(`/portal/documents?type=${docType}`);
  };

  return (
    <Drawer
      collapsed={isCollapsed}
      variant="permanent"
      sx={{
        display: { xs: "none", md: "block" },
        [`& .${drawerClasses.paper}`]: {
          backgroundColor: "primary.main",
          overflow: "hidden",
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          gap: "var(--half-gap)",
          padding: isCollapsed ? "16px 8px" : "var(--default-padding)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isCollapsed ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <Avatar
              src="/asserts/aims-logo.png"
              alt=""
              sx={{
                borderRadius: "var(--default-border-radius)",
                width: "2rem",
                height: "2rem",
              }}
            />
            <Tooltip title="Expand sidebar">
              <IconButton
                onClick={toggleSidebar}
                size="small"
                sx={{
                  color: theme.palette.primary.contrastText,
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                  },
                }}
              >
                <MenuIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ) : (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: "var(--half-gap)" }}>
              <Avatar
                src="/asserts/aims-logo.png"
                alt=""
                sx={{
                  borderRadius: "var(--default-border-radius)",
                  width: "1.75rem",
                  height: "1.75rem",
                }}
              />
              <Typography variant="h5" sx={{ color: theme.palette.primary.contrastText }}>
                AIMS
              </Typography>
            </Box>
            <Tooltip title="Collapse sidebar">
              <IconButton
                onClick={toggleSidebar}
                sx={{
                  color: theme.palette.primary.contrastText,
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                  },
                }}
              >
                <MenuOpenIcon />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>

      {/* Content */}
      <Box
        sx={{
          overflow: "auto",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <List sx={{ px: isCollapsed ? 0.5 : 1, py: 1 }}>
          {/* Back to Documents button */}
          <ListItem disablePadding sx={{ mb: 1 }}>
            <Tooltip title={isCollapsed ? "Back to Documents" : ""} placement="right">
              <ListItemButton
                onClick={handleBackToDocuments}
                sx={{
                  borderRadius: 1,
                  mx: isCollapsed ? 0 : 1,
                  justifyContent: isCollapsed ? "center" : "flex-start",
                  color: theme.palette.primary.contrastText,
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                  },
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: isCollapsed ? 0 : 40,
                    color: theme.palette.primary.contrastText,
                  }}
                >
                  <ArrowBackIcon />
                </ListItemIcon>
                {!isCollapsed && <ListItemText primary="Back to Documents" />}
              </ListItemButton>
            </Tooltip>
          </ListItem>

          <Divider sx={{ borderColor: "rgba(255, 255, 255, 0.2)", mx: 2, my: 1 }} />

          {/* Section Title */}
          {!isCollapsed && (
            <Typography
              variant="overline"
              sx={{
                color: "rgba(255, 255, 255, 0.7)",
                px: 2,
                py: 1,
                display: "block",
                fontWeight: 600,
              }}
            >
              Document Types
            </Typography>
          )}

          {/* Document Type List */}
          {DOCUMENT_TYPES.map((docType) => {
            const Icon = docType.icon;
            const isActive = currentDocType.toUpperCase() === docType.type.toUpperCase();

            return (
              <ListItem key={docType.type} disablePadding sx={{ mb: 0.5 }}>
                <Tooltip title={isCollapsed ? docType.label : ""} placement="right">
                  <ListItemButton
                    onClick={() => handleDocTypeClick(docType.type)}
                    sx={{
                      borderRadius: 1,
                      mx: isCollapsed ? 0 : 1,
                      justifyContent: isCollapsed ? "center" : "flex-start",
                      backgroundColor: isActive ? "rgba(255, 255, 255, 0.2)" : "transparent",
                      color: theme.palette.primary.contrastText,
                      "&:hover": {
                        backgroundColor: isActive
                          ? "rgba(255, 255, 255, 0.25)"
                          : "rgba(255, 255, 255, 0.1)",
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: isCollapsed ? 0 : 40,
                        color: isActive
                          ? theme.palette.secondary.light
                          : theme.palette.primary.contrastText,
                      }}
                    >
                      <Icon />
                    </ListItemIcon>
                    {!isCollapsed && (
                      <ListItemText
                        primary={docType.label}
                        secondary={docType.description}
                        primaryTypographyProps={{
                          fontWeight: isActive ? 600 : 400,
                        }}
                        secondaryTypographyProps={{
                          sx: { color: "rgba(255, 255, 255, 0.6)", fontSize: "0.75rem" },
                        }}
                      />
                    )}
                  </ListItemButton>
                </Tooltip>
              </ListItem>
            );
          })}
        </List>
      </Box>

      {/* Footer */}
      <Stack
        direction="row"
        sx={{
          p: 2,
          gap: 1,
          alignItems: "center",
          borderTop: "1px solid",
          borderColor: "rgba(255, 255, 255, 0.2)",
          justifyContent: isCollapsed ? "center" : "flex-start",
        }}
      >
        <UserButton afterSignOutUrl="/" />
        {!isCollapsed && (
          <Box sx={{ mr: "auto" }}>
            <Typography variant="body2" sx={{ fontWeight: 500, color: theme.palette.primary.contrastText }}>
              {user?.fullName}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                width: 200,
                color: theme.palette.primary.light,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user?.emailAddresses[0]?.emailAddress}
            </Typography>
          </Box>
        )}
      </Stack>
    </Drawer>
  );
}
