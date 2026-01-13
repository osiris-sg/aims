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
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
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
import FolderIcon from "@mui/icons-material/Folder";
import InventoryIcon from "@mui/icons-material/Inventory";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import AddBoxIcon from "@mui/icons-material/AddBox";
import IndeterminateCheckBoxIcon from "@mui/icons-material/IndeterminateCheckBox";
import SellIcon from "@mui/icons-material/Sell";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";

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

// Sales document types
const SALES_DOCUMENT_TYPES = [
  {
    type: "TI",
    label: "Invoice",
    shortLabel: "INV",
    icon: ReceiptIcon,
    description: "Tax Invoice",
  },
  {
    type: "DO",
    label: "Delivery Order",
    shortLabel: "DO",
    icon: LocalShippingIcon,
    description: "Delivery Order",
  },
  {
    type: "QO",
    label: "Quotation",
    shortLabel: "QO",
    icon: RequestQuoteIcon,
    description: "Quotation",
  },
  {
    type: "SO",
    label: "Sales Order",
    shortLabel: "SO",
    icon: SellIcon,
    description: "Sales Order",
  },
  {
    type: "RDO",
    label: "Return DO",
    shortLabel: "RDO",
    icon: AssignmentReturnIcon,
    description: "Return Delivery Order",
  },
  {
    type: "CN",
    label: "Credit Note",
    shortLabel: "CN",
    icon: CreditCardIcon,
    description: "Credit Note",
  },
  {
    type: "DN",
    label: "Debit Note",
    shortLabel: "DN",
    icon: MoneyOffIcon,
    description: "Debit Note",
  },
  {
    type: "MSR",
    label: "Service Report",
    shortLabel: "MSR",
    icon: BuildIcon,
    description: "Material Service Report",
  },
];

// Inventory document types
const INVENTORY_DOCUMENT_TYPES = [
  {
    type: "SAI",
    label: "Stock Adjustment In",
    shortLabel: "SAI",
    icon: AddBoxIcon,
    description: "Stock Adjustment In",
  },
  {
    type: "SAO",
    label: "Stock Adjustment Out",
    shortLabel: "SAO",
    icon: IndeterminateCheckBoxIcon,
    description: "Stock Adjustment Out",
  },
  {
    type: "PO",
    label: "Purchase Order",
    shortLabel: "PO",
    icon: ShoppingCartIcon,
    description: "Purchase Order",
  },
  {
    type: "PR",
    label: "Purchase Return",
    shortLabel: "PR",
    icon: AssignmentReturnIcon,
    description: "Purchase Return",
  },
];

export default function DocumentSidebar() {
  const theme = useTheme();
  const { user } = useUser();
  const { isCollapsed, toggleSidebar } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState<"sales" | "inventory">("sales");

  // Extract current document type from pathname
  const pathSegments = pathname?.split("/").filter(Boolean) || [];
  const currentDocType = pathSegments[2] || ""; // e.g., INVOICE, DELIVERY_ORDER

  // Determine active tab based on current document type
  React.useEffect(() => {
    const inventoryTypes = INVENTORY_DOCUMENT_TYPES.map(d => d.type.toUpperCase());
    if (inventoryTypes.includes(currentDocType.toUpperCase())) {
      setActiveTab("inventory");
    } else {
      setActiveTab("sales");
    }
  }, [currentDocType]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: "sales" | "inventory") => {
    setActiveTab(newValue);
  };

  const handleDocTypeClick = (docType: string) => {
    // Navigate to the appropriate page for this document type
    const salesRoutes: Record<string, string> = {
      TI: "/portal/sales/invoices",
      DO: "/portal/sales/delivery-orders",
      QO: "/portal/sales/quotations",
      SO: "/portal/sales/sales-orders",
      RDO: "/portal/sales/delivery-orders", // Use same route for now
      CN: "/portal/sales/credit-notes",
      DN: "/portal/sales/debit-notes",
      MSR: "/portal/sales/delivery-orders", // Use same route for now
    };

    const inventoryRoutes: Record<string, string> = {
      SAI: "/portal/inventory/adjustment-in",
      SAO: "/portal/inventory/adjustment-out",
      PO: "/portal/inventory/purchases",
      PR: "/portal/inventory/purchases-return",
    };

    const route = salesRoutes[docType] || inventoryRoutes[docType] || `/portal/documents?type=${docType}`;
    router.push(route);
  };

  // Get the document types based on active tab
  const currentDocTypes = activeTab === "sales" ? SALES_DOCUMENT_TYPES : INVENTORY_DOCUMENT_TYPES;

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

          {/* Tabs for Sales/Inventory */}
          {!isCollapsed && (
            <Box sx={{ px: 1, mb: 1 }}>
              <Tabs
                value={activeTab}
                onChange={handleTabChange}
                variant="fullWidth"
                sx={{
                  minHeight: 36,
                  bgcolor: "rgba(255, 255, 255, 0.1)",
                  borderRadius: 1,
                  "& .MuiTab-root": {
                    color: "rgba(255, 255, 255, 0.7)",
                    minHeight: 36,
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    "&.Mui-selected": {
                      color: theme.palette.primary.contrastText,
                      bgcolor: "rgba(255, 255, 255, 0.2)",
                    },
                  },
                  "& .MuiTabs-indicator": {
                    display: "none",
                  },
                }}
              >
                <Tab label="Sales" value="sales" />
                <Tab label="Inventory" value="inventory" />
              </Tabs>
            </Box>
          )}

          {/* Collapsed: Show icons for tab selection */}
          {isCollapsed && (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5, mb: 1 }}>
              <Tooltip title="Sales" placement="right">
                <IconButton
                  onClick={() => setActiveTab("sales")}
                  size="small"
                  sx={{
                    color: activeTab === "sales" ? theme.palette.secondary.light : "rgba(255, 255, 255, 0.7)",
                    bgcolor: activeTab === "sales" ? "rgba(255, 255, 255, 0.2)" : "transparent",
                    "&:hover": { bgcolor: "rgba(255, 255, 255, 0.1)" },
                  }}
                >
                  <SellIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Inventory" placement="right">
                <IconButton
                  onClick={() => setActiveTab("inventory")}
                  size="small"
                  sx={{
                    color: activeTab === "inventory" ? theme.palette.secondary.light : "rgba(255, 255, 255, 0.7)",
                    bgcolor: activeTab === "inventory" ? "rgba(255, 255, 255, 0.2)" : "transparent",
                    "&:hover": { bgcolor: "rgba(255, 255, 255, 0.1)" },
                  }}
                >
                  <InventoryIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          )}

          {/* Section Title */}
          {!isCollapsed && (
            <Typography
              variant="overline"
              sx={{
                color: "rgba(255, 255, 255, 0.7)",
                px: 2,
                py: 0.5,
                display: "block",
                fontWeight: 600,
              }}
            >
              {activeTab === "sales" ? "Sales Documents" : "Inventory Documents"}
            </Typography>
          )}

          {/* Document Type List */}
          {currentDocTypes.map((docType) => {
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
