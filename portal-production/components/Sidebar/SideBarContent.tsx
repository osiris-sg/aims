/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import AnalyticsRoundedIcon from "@mui/icons-material/AnalyticsRounded";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import PeopleRoundedIcon from "@mui/icons-material/PeopleRounded";
import AssignmentRoundedIcon from "@mui/icons-material/AssignmentRounded";
// import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import InventoryIcon from "@mui/icons-material/Inventory";
import DescriptionIcon from "@mui/icons-material/Description";
// import InfoRoundedIcon from "@mui/icons-material/InfoRounded";
import { useTheme } from "@mui/material";
import Link from "next/link";
import { ROUTES } from "@/routes";
import { usePathname } from "next/navigation";
import Collapse from "@mui/material/Collapse";
import ExpandLess from "@mui/icons-material/ExpandLess";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { useOrganization } from "@/app/portal/hooks/useOrganization";

const mainListItems = [
  { text: "Inventory", path: ROUTES.INVENTORY, icon: <InventoryIcon /> },
  { text: "Assets", path: ROUTES.ASSETS, icon: <AnalyticsRoundedIcon /> },
  { text: "Customers", path: ROUTES.CUSTOMERS, icon: <PeopleRoundedIcon /> },
  { text: "Documents", path: ROUTES.DOCUMENTS, icon: <DescriptionIcon /> },
  { text: "Invoices", path: ROUTES.INVOICES, icon: <AssignmentRoundedIcon /> },
  { text: "Projects", path: ROUTES.PROJECTS, icon: <AccountTreeIcon /> },
  { text: "User Management", path: ROUTES.PERMISSIONS, icon: <PeopleRoundedIcon /> },
];

const secondaryListItems: any = [
  // { text: "Settings", icon: <SettingsRoundedIcon /> },
  // { text: "Notifications", icon: <InfoRoundedIcon /> },
];

export default function SideBarContent() {
  const theme = useTheme();
  const pathname = usePathname();
  const { canManageOrganizations, isLoading: permissionsLoading } = useUserPermissions();
  const { organization } = useOrganization();

  const [openDocuments, setOpenDocuments] = React.useState(false);
  const [openUserManagement, setOpenUserManagement] = React.useState(false);

  // Check if user can manage organizations (either through permissions or being OsirisAdmin)
  const canViewOrganizations = () => {
    console.log("Checking organization access:", {
      permissionsLoading,
      organizationName: organization?.name,
      organization: organization,
    });

    // Temporary: Always show for Osiris Platform users (OsirisAdmin) while debugging permissions
    if (organization?.name === "Osiris Platform") {
      console.log("✅ User is in Osiris Platform organization - showing Organizations tab");
      return true;
    }

    // If permissions are still loading, don't show the tab yet for others
    if (permissionsLoading) {
      console.log("⏳ Permissions still loading...");
      return false;
    }

    // Check for explicit organization management permissions
    try {
      const hasPermissions = canManageOrganizations();
      console.log("Permission check result:", hasPermissions);
      if (hasPermissions) {
        console.log("✅ User has organization management permissions");
        return true;
      }
    } catch (error) {
      console.error("Error checking permissions:", error);
    }

    console.log("❌ User cannot view organizations");
    return false;
  };

  const handleDocumentsClick = () => setOpenDocuments(!openDocuments);
  const handleUserManagementClick = () => setOpenUserManagement(!openUserManagement);

  const renderListItem = (item: any, index: number) => {
    if (item.text === "Documents") {
      return (
        <React.Fragment key={index}>
          <ListItem
            disablePadding
            sx={{
              display: "block",
              borderRadius: "var(--default-border-radius)",
              backgroundColor: pathname.startsWith(item.path) ? theme.palette.primary.contrastText : "transparent",
              ":hover": { backgroundColor: theme.palette.primary.light },
            }}
            onClick={handleDocumentsClick}
          >
            <ListItemButton selected={pathname.startsWith(item.path)}>
              <ListItemIcon
                sx={{
                  color: pathname.startsWith(item.path) ? theme.palette.primary.main : theme.palette.primary.contrastText,
                  minWidth: "fit-content!important",
                  marginRight: "var(--default-gap)",
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.text}
                sx={{
                  color: pathname.startsWith(item.path) ? theme.palette.primary.main : theme.palette.primary.contrastText,
                }}
              />
              {openDocuments ? <ExpandLess /> : <ExpandMore />}
            </ListItemButton>
          </ListItem>
          <Collapse in={openDocuments} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              <ListItemButton sx={{ pl: 4 }} component={Link} href={`${mainListItems[3].path}`}>
                <ListItemText primary="All Documents" />
              </ListItemButton>
              <ListItemButton sx={{ pl: 4 }} component={Link} href="/portal/documents/templates">
                <ListItemText primary="All Document Templates" />
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
              backgroundColor: pathname.startsWith(item.path) ? theme.palette.primary.contrastText : "transparent",
              ":hover": { backgroundColor: theme.palette.primary.light },
            }}
            onClick={handleUserManagementClick}
          >
            <ListItemButton selected={pathname.startsWith(item.path)}>
              <ListItemIcon
                sx={{
                  color: pathname.startsWith(item.path) ? theme.palette.primary.main : theme.palette.primary.contrastText,
                  minWidth: "fit-content!important",
                  marginRight: "var(--default-gap)",
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.text}
                sx={{
                  color: pathname.startsWith(item.path) ? theme.palette.primary.main : theme.palette.primary.contrastText,
                }}
              />
              {openUserManagement ? <ExpandLess /> : <ExpandMore />}
            </ListItemButton>
          </ListItem>
          <Collapse in={openUserManagement} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              <ListItemButton sx={{ pl: 4 }} component={Link} href={ROUTES.PERMISSIONS}>
                <ListItemText primary="Roles" />
              </ListItemButton>
              <ListItemButton sx={{ pl: 4 }} component={Link} href={ROUTES.USERS}>
                <ListItemText primary="Users" />
              </ListItemButton>
              {canViewOrganizations() && (
                <ListItemButton sx={{ pl: 4 }} component={Link} href={ROUTES.ORGANIZATIONS}>
                  <ListItemText primary="Organizations" />
                </ListItemButton>
              )}
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
            backgroundColor: pathname.startsWith(item.path) ? theme.palette.primary.contrastText : "transparent",
            ":hover": { backgroundColor: theme.palette.primary.light },
          }}
        >
          <Link href={item.path} key={item.text} style={{ textDecoration: "none", color: "inherit" }}>
            <ListItemButton selected={pathname.startsWith(item.path)}>
              <ListItemIcon
                sx={{
                  color: pathname.startsWith(item.path) ? theme.palette.primary.main : theme.palette.primary.contrastText,
                  minWidth: "fit-content!important",
                  marginRight: "var(--default-gap)",
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.text}
                sx={{
                  color: pathname.startsWith(item.path) ? theme.palette.primary.main : theme.palette.primary.contrastText,
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
          <ListItem
            key={index}
            disablePadding
            sx={{
              display: "block",
              borderRadius: "var(--default-border-radius)",
              ":hover": { backgroundColor: theme.palette.primary.light },
            }}
          >
            <ListItemButton>
              <ListItemIcon
                sx={{
                  color: theme.palette.primary.contrastText,
                  minWidth: "fit-content!important",
                  marginRight: "var(--default-gap)",
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText primary={item.text} sx={{ color: theme.palette.primary.contrastText }} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Stack>
  );
}
