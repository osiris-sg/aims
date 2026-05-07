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
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
// import InfoRoundedIcon from "@mui/icons-material/InfoRounded";
import { useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import Link from "next/link";
import { ROUTES } from "@/app/portal/routes";
import { usePathname } from "next/navigation";
import Collapse from "@mui/material/Collapse";
import ExpandLess from "@mui/icons-material/ExpandLess";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { useSidebar } from "./SidebarContext";
import Tooltip from "@mui/material/Tooltip";

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

const secondaryListItems: any = [{ text: "Organization Settings", path: "/portal/settings/organization", icon: <SettingsRoundedIcon /> }];

export default function SideBarContent() {
  const theme = useTheme();
  const pathname = usePathname();
  const { organization } = useOrganization();
  const { isCollapsed } = useSidebar();

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
      const documentItem = (
        <ListItem
          disablePadding
          sx={{
            display: "block",
            borderRadius: "var(--default-border-radius)",
            backgroundColor: isItemActive(item) ? alpha("#6FFBBE", 0.08) : "transparent",
            ":hover": { backgroundColor: "rgba(255,255,255,0.05)" },
            mb: 0.5,
          }}
          onClick={isCollapsed ? undefined : handleDocumentsClick}
        >
          <ListItemButton
            selected={isItemActive(item)}
            component={isCollapsed ? Link : "div"}
            href={isCollapsed ? ROUTES.DOCUMENTS : undefined}
            sx={{
              justifyContent: "center",
              minHeight: 48,
              px: isCollapsed ? 1.5 : 2,
              borderRadius: "var(--default-border-radius)",
            }}
          >
            <ListItemIcon
              sx={{
                color: isItemActive(item) ? "#6FFBBE" : "rgba(255,255,255,0.78)",
                minWidth: "fit-content!important",
                marginRight: isCollapsed ? "0" : "var(--default-gap)",
                justifyContent: "center",
                display: "flex",
              }}
            >
              {item.icon}
            </ListItemIcon>
            {!isCollapsed && (
              <>
                <ListItemText
                  primary={item.text}
                  sx={{
                    color: isItemActive(item) ? "#6FFBBE" : "rgba(255,255,255,0.78)",
                  }}
                />
                {openDocuments ? <ExpandLess sx={{ color: "rgba(255,255,255,0.78)" }} /> : <ExpandMore sx={{ color: "rgba(255,255,255,0.78)" }} />}
              </>
            )}
          </ListItemButton>
        </ListItem>
      );

      if (isCollapsed) {
        return (
          <Tooltip key={index} title={item.text} placement="right">
            {documentItem}
          </Tooltip>
        );
      }

      return (
        <React.Fragment key={index}>
          {documentItem}
          <Collapse in={openDocuments} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              <ListItemButton sx={{ pl: 4 }} component={Link} href={ROUTES.DOCUMENTS}>
                <ListItemText primary="All Documents" sx={{ color: "rgba(255,255,255,0.78)" }} />
              </ListItemButton>
              <ListItemButton sx={{ pl: 4 }} component={Link} href="/portal/documents/templates">
                <ListItemText primary="All Document Templates" sx={{ color: "rgba(255,255,255,0.78)" }} />
              </ListItemButton>
              <ListItemButton sx={{ pl: 4 }} component={Link} href={ROUTES.DOCUMENT_EXTRACTION}>
                <ListItemText primary="Document Extraction (AI)" sx={{ color: "rgba(255,255,255,0.78)" }} />
              </ListItemButton>
            </List>
          </Collapse>
        </React.Fragment>
      );
    } else if (item.text === "User Management") {
      const userManagementItem = (
        <ListItem
          disablePadding
          sx={{
            display: "block",
            borderRadius: "var(--default-border-radius)",
            backgroundColor: isItemActive(item) ? alpha("#6FFBBE", 0.08) : "transparent",
            ":hover": { backgroundColor: "rgba(255,255,255,0.05)" },
            mb: 0.5,
          }}
          onClick={isCollapsed ? undefined : handleUserManagementClick}
        >
          <ListItemButton selected={isItemActive(item)} component={isCollapsed ? Link : "div"} href={isCollapsed ? ROUTES.PERMISSIONS : undefined} sx={{ justifyContent: isCollapsed ? "center" : "flex-start" }}>
            <ListItemIcon
              sx={{
                color: isItemActive(item) ? "#6FFBBE" : "rgba(255,255,255,0.78)",
                minWidth: "fit-content!important",
                marginRight: isCollapsed ? "0" : "var(--default-gap)",
                justifyContent: "center",
                display: "flex",
              }}
            >
              {item.icon}
            </ListItemIcon>
            {!isCollapsed && (
              <>
                <ListItemText
                  primary={item.text}
                  sx={{
                    color: isItemActive(item) ? "#6FFBBE" : "rgba(255,255,255,0.78)",
                  }}
                />
                {openUserManagement ? <ExpandLess sx={{ color: "rgba(255,255,255,0.78)" }} /> : <ExpandMore sx={{ color: "rgba(255,255,255,0.78)" }} />}
              </>
            )}
          </ListItemButton>
        </ListItem>
      );

      if (isCollapsed) {
        return (
          <Tooltip key={index} title={item.text} placement="right">
            {userManagementItem}
          </Tooltip>
        );
      }

      return (
        <React.Fragment key={index}>
          {userManagementItem}
          <Collapse in={openUserManagement} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              <ListItemButton sx={{ pl: 4 }} component={Link} href={ROUTES.PERMISSIONS}>
                <ListItemText primary="Roles" sx={{ color: "rgba(255,255,255,0.78)" }} />
              </ListItemButton>
              <ListItemButton sx={{ pl: 4 }} component={Link} href={ROUTES.USERS}>
                <ListItemText primary="Users" sx={{ color: "rgba(255,255,255,0.78)" }} />
              </ListItemButton>
            </List>
          </Collapse>
        </React.Fragment>
      );
    } else {
      const regularItem = (
        <ListItem
          key={index}
          disablePadding
          sx={{
            display: "block",
            borderRadius: "var(--default-border-radius)",
            backgroundColor: isItemActive(item) ? alpha("#6FFBBE", 0.08) : "transparent",
            ":hover": { backgroundColor: "rgba(255,255,255,0.05)" },
            mb: 0.5,
          }}
        >
          <Link href={item.path} key={item.text} style={{ textDecoration: "none", color: "inherit" }}>
            <ListItemButton
              selected={isItemActive(item)}
              sx={{
                justifyContent: "center",
                minHeight: 48,
                px: isCollapsed ? 1.5 : 2,
                borderRadius: "var(--default-border-radius)",
              }}
            >
              <ListItemIcon
                sx={{
                  color: isItemActive(item) ? "#6FFBBE" : "rgba(255,255,255,0.78)",
                  minWidth: "fit-content!important",
                  marginRight: isCollapsed ? "0" : "var(--default-gap)",
                }}
              >
                {item.icon}
              </ListItemIcon>
              {!isCollapsed && (
                <ListItemText
                  primary={item.text}
                  sx={{
                    color: isItemActive(item) ? "#6FFBBE" : "rgba(255,255,255,0.78)",
                  }}
                />
              )}
            </ListItemButton>
          </Link>
        </ListItem>
      );

      if (isCollapsed) {
        return (
          <Tooltip key={index} title={item.text} placement="right">
            {regularItem}
          </Tooltip>
        );
      }

      return regularItem;
    }
  };

  return (
    <Stack
      sx={{
        flexGrow: 1,
        p: isCollapsed ? 1 : "var(--default-gap)",
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
        {secondaryListItems.map((item: any, index: number) => {
          const isActive = pathname.startsWith(item.path);
          const secondaryItem = (
            <ListItem
              key={index}
              disablePadding
              sx={{
                display: "block",
                borderRadius: "var(--default-border-radius)",
                backgroundColor: isActive ? alpha("#6FFBBE", 0.08) : "transparent",
                ":hover": { backgroundColor: "rgba(255,255,255,0.05)" },
                mb: 0.5,
              }}
            >
              <ListItemButton
                sx={{
                  justifyContent: "center",
                  minHeight: 48,
                  px: isCollapsed ? 1.5 : 2,
                  borderRadius: "var(--default-border-radius)",
                }}
                component={Link}
                href={item.path}
              >
                <ListItemIcon
                  sx={{
                    color: isActive ? "#6FFBBE" : "rgba(255,255,255,0.78)",
                    minWidth: "fit-content!important",
                    marginRight: isCollapsed ? "0" : "var(--default-gap)",
                    justifyContent: "center",
                    display: "flex",
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                {!isCollapsed && (
                  <ListItemText
                    primary={item.text}
                    sx={{
                      color: isActive ? "#6FFBBE" : "rgba(255,255,255,0.78)",
                    }}
                  />
                )}
              </ListItemButton>
            </ListItem>
          );

          if (isCollapsed) {
            return (
              <Tooltip key={index} title={item.text} placement="right">
                {secondaryItem}
              </Tooltip>
            );
          }

          return secondaryItem;
        })}
      </List>
    </Stack>
  );
}
