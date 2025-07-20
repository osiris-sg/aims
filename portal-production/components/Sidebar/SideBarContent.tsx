/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import AnalyticsRoundedIcon from "@mui/icons-material/AnalyticsRounded";
import DashboardIcon from "@mui/icons-material/Dashboard";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import PeopleRoundedIcon from "@mui/icons-material/PeopleRounded";
import AssignmentRoundedIcon from "@mui/icons-material/AssignmentRounded";
// import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import InventoryIcon from "@mui/icons-material/Inventory";
import DescriptionIcon from "@mui/icons-material/Description";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
// import InfoRoundedIcon from "@mui/icons-material/InfoRounded";
import { useTheme } from "@mui/material";
import Link from "next/link";
import { ROUTES } from "@/routes";
import { usePathname } from "next/navigation";
import Collapse from "@mui/material/Collapse";
import ExpandLess from "@mui/icons-material/ExpandLess";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { useOrganization } from "@/app/portal/hooks/useOrganization";

const getMainListItems = (isAdmin: boolean) => {
  const baseItems = [
    { text: "Dashboard", path: ROUTES.DASHBOARD, icon: <DashboardIcon /> },
    { text: "Inventory", path: ROUTES.INVENTORY, icon: <InventoryIcon /> },
    { text: "Assets", path: ROUTES.ASSETS, icon: <AnalyticsRoundedIcon /> },
    { text: "Customers", path: ROUTES.CUSTOMERS, icon: <PeopleRoundedIcon /> },
    { text: "Documents", path: ROUTES.DOCUMENTS, icon: <DescriptionIcon /> },
    { text: "Invoices", path: ROUTES.INVOICES, icon: <AssignmentRoundedIcon /> },
    { text: "Projects", path: ROUTES.PROJECTS, icon: <AccountTreeIcon /> },
    { text: "User Management", path: ROUTES.PERMISSIONS, icon: <PeopleRoundedIcon /> },
    { text: "Audit", path: ROUTES.AUDIT, icon: <AnalyticsRoundedIcon /> },
  ];

  if (isAdmin) {
    baseItems.unshift({
      text: "Admin Panel",
      path: "/portal/admin",
      icon: <AdminPanelSettingsIcon />,
    });
  }

  return baseItems;
};

const secondaryListItems: any = [
  // { text: "Settings", icon: <SettingsRoundedIcon /> },
  // { text: "Notifications", icon: <InfoRoundedIcon /> },
];

export default function SideBarContent() {
  const theme = useTheme();
  const pathname = usePathname();
  const { organization } = useOrganization();

  const [openDocuments, setOpenDocuments] = React.useState(false);
  const [openUserManagement, setOpenUserManagement] = React.useState(false);

  // Check if user is OsirisAdmin
  const isOsirisAdmin = () => {
    return organization?.name === "osiris-platform";
  };

  const handleDocumentsClick = () => setOpenDocuments(!openDocuments);
  const handleUserManagementClick = () => setOpenUserManagement(!openUserManagement);

  const mainListItems = getMainListItems(isOsirisAdmin());

  // Function to check if a nav item should be active - FIX THE HIGHLIGHTING ISSUE
  const isItemActive = (item: any) => {
    // Special case for Dashboard - only active on exact "/portal" path
    if (item.text === "Dashboard") {
      return pathname === "/portal";
    }
    // For Documents, check if any document path is active
    if (item.text === "Documents") {
      return pathname.startsWith("/portal/documents");
    }
    // For User Management, check if any user management path is active
    if (item.text === "User Management") {
      return pathname.startsWith("/portal/user-management") || pathname.startsWith("/portal/permissions");
    }
    // For all other items, use exact path matching to prevent conflicts
    return pathname.startsWith(item.path) && pathname !== "/portal";
  };

  const renderListItem = (item: any, index: number) => {
    if (item.text === "Documents") {
      return (
        <React.Fragment key={index}>
          <ListItem
            disablePadding
            sx={{
              display: "block",
              borderRadius: "var(--default-border-radius)",
              backgroundColor: isItemActive(item) ? theme.palette.primary.contrastText : "transparent",
              ":hover": { backgroundColor: theme.palette.primary.light },
            }}
            onClick={handleDocumentsClick}
          >
            <ListItemButton selected={isItemActive(item)}>
              <ListItemIcon
                sx={{
                  color: isItemActive(item) ? theme.palette.primary.main : "white",
                  minWidth: "fit-content!important",
                  marginRight: "var(--default-gap)",
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.text}
                sx={{
                  color: isItemActive(item) ? theme.palette.primary.main : "white",
                }}
              />
              {openDocuments ? <ExpandLess sx={{ color: "white" }} /> : <ExpandMore sx={{ color: "white" }} />}
            </ListItemButton>
          </ListItem>
          <Collapse in={openDocuments} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              <ListItemButton sx={{ pl: 4 }} component={Link} href={ROUTES.DOCUMENTS}>
                <ListItemText primary="All Documents" sx={{ color: "white" }} />
              </ListItemButton>
              <ListItemButton sx={{ pl: 4 }} component={Link} href="/portal/documents/templates">
                <ListItemText primary="All Document Templates" sx={{ color: "white" }} />
              </ListItemButton>
            </List>
          </Collapse>
        </React.Fragment>
      );
    } else if (item.text === "User Management") {
      return (
        <React.Fragment key={index}>
          <ListItem
            disablePadding
            sx={{
              display: "block",
              borderRadius: "var(--default-border-radius)",
              backgroundColor: isItemActive(item) ? theme.palette.primary.contrastText : "transparent",
              ":hover": { backgroundColor: theme.palette.primary.light },
            }}
            onClick={handleUserManagementClick}
          >
            <ListItemButton selected={isItemActive(item)}>
              <ListItemIcon
                sx={{
                  color: isItemActive(item) ? theme.palette.primary.main : "white",
                  minWidth: "fit-content!important",
                  marginRight: "var(--default-gap)",
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.text}
                sx={{
                  color: isItemActive(item) ? theme.palette.primary.main : "white",
                }}
              />
              {openUserManagement ? <ExpandLess sx={{ color: "white" }} /> : <ExpandMore sx={{ color: "white" }} />}
            </ListItemButton>
          </ListItem>
          <Collapse in={openUserManagement} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              <ListItemButton sx={{ pl: 4 }} component={Link} href={ROUTES.PERMISSIONS}>
                <ListItemText primary="Roles" sx={{ color: "white" }} />
              </ListItemButton>
              <ListItemButton sx={{ pl: 4 }} component={Link} href={ROUTES.USERS}>
                <ListItemText primary="Users" sx={{ color: "white" }} />
              </ListItemButton>
            </List>
          </Collapse>
        </React.Fragment>
      );
    } else {
      return (
        <ListItem
          key={index}
          disablePadding
          sx={{
            display: "block",
            borderRadius: "var(--default-border-radius)",
            backgroundColor: isItemActive(item) ? theme.palette.primary.contrastText : "transparent",
            ":hover": { backgroundColor: theme.palette.primary.light },
          }}
        >
          <Link href={item.path} key={item.text} style={{ textDecoration: "none", color: "inherit" }}>
            <ListItemButton selected={isItemActive(item)}>
              <ListItemIcon
                sx={{
                  color: isItemActive(item) ? theme.palette.primary.main : "white",
                  minWidth: "fit-content!important",
                  marginRight: "var(--default-gap)",
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.text}
                sx={{
                  color: isItemActive(item) ? theme.palette.primary.main : "white",
                }}
              />
            </ListItemButton>
          </Link>
        </ListItem>
      );
    }
  };

  return (
    <Stack
      sx={{
        flexGrow: 1,
        p: "var(--default-gap)",
        justifyContent: "space-between",
      }}
    >
      <List
        dense
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--half-gap)",
        }}
      >
        {mainListItems.map((item, index) => renderListItem(item, index))}
      </List>
      <List
        dense
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--half-gap)",
        }}
      >
        {secondaryListItems.map((item: any, index: number) => (
          <ListItem key={index} disablePadding sx={{ display: "block" }}>
            <ListItemButton>
              <ListItemIcon sx={{ minWidth: "fit-content!important", marginRight: "var(--default-gap)" }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Stack>
  );
}
